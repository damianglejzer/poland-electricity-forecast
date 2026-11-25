"""Promote the locally trained model and its data to the public database (e.g. Neon).

Workflow: train and review a model locally (MLflow), then `make publish`. The public API and the
daily forecast job only ever read what was published, so a model goes live only when its author
decides it should.

What is copied:
- `load`, `weather`: upserted (the target may already be ahead thanks to the daily job).
- `predictions`: backtest/in-sample rows are replaced; forecast rows are only *added*, so the
  live ex-ante record in the target is never rewritten.
- `model_runs`: upserted by id; `model_artifacts`: only the current model.
- `refresh_log`: the latest successful refresh, if it is newer than the target's.
"""

import logging

from sqlalchemy import Engine, delete, func, select, text

from pse_forecast import db
from pse_forecast.config import get_settings
from pse_forecast.model_store import current_version

log = logging.getLogger(__name__)
CHUNK = 20_000


def _copy_table(src: Engine, dst: Engine, table, keys: list[str], where=None, **kw) -> int:
    stmt = select(table)
    if where is not None:
        stmt = stmt.where(where)
    total = 0
    with src.connect() as conn:
        result = conn.execution_options(yield_per=CHUNK).execute(stmt).mappings()
        for part in result.partitions(CHUNK):
            total += db.upsert(dst, table, [dict(r) for r in part], keys, **kw)
    return total


def publish(target_url: str | None = None, source: Engine | None = None) -> dict:
    target_url = target_url or get_settings().publish_database_url
    if not target_url:
        raise RuntimeError("No target database. Set PUBLISH_DATABASE_URL or pass --target.")
    src = source or db.get_engine()
    dst = db.get_engine(target_url)
    if src.url == dst.url:
        raise RuntimeError("Source and target database are the same.")

    version = current_version(src)
    if version is None:
        raise RuntimeError("No trained model to publish. Run `make train` first.")
    counts: dict[str, int] = {}

    log.info("Copying demand and weather data")
    counts["load"] = _copy_table(src, dst, db.load, ["ts_utc"])
    counts["weather"] = _copy_table(src, dst, db.weather, ["ts_utc"])

    log.info("Copying predictions")
    p = db.predictions
    with dst.begin() as conn:
        conn.execute(delete(p).where(p.c.kind.in_(["backtest", "insample"])))
    counts["predictions_eval"] = _copy_table(
        src, dst, p, ["ts_utc", "kind"], where=p.c.kind.in_(["backtest", "insample"])
    )
    counts["predictions_forecast_added"] = _copy_table(
        src, dst, p, ["ts_utc", "kind"], where=p.c.kind == "forecast", overwrite=False
    )

    log.info("Publishing model %s", version)
    a = db.model_artifacts
    counts["model_artifacts"] = _copy_table(
        src, dst, a, ["model_version"], where=a.c.model_version == version
    )
    with dst.begin() as conn:
        conn.execute(delete(a).where(a.c.model_version != version))
        conn.execute(db.model_runs.update().values(is_current=False))
    counts["model_runs"] = _copy_table(src, dst, db.model_runs, ["id"])
    if dst.dialect.name == "postgresql":  # ids were inserted explicitly; move the sequence on
        with dst.begin() as conn:
            conn.execute(
                text(
                    "SELECT setval(pg_get_serial_sequence('model_runs', 'id'), "
                    "(SELECT COALESCE(MAX(id), 1) FROM model_runs))"
                )
            )

    r = db.refresh_log
    ok = r.c.status.in_(["ok", "partial"])
    with src.connect() as conn:
        latest = conn.execute(select(r).where(ok).order_by(r.c.finished_at.desc()).limit(1))
        latest = latest.mappings().first()
    with dst.begin() as conn:
        dst_latest = conn.execute(select(func.max(r.c.finished_at)).where(ok)).scalar()
        if latest and (dst_latest is None or _naive(latest["finished_at"]) > _naive(dst_latest)):
            conn.execute(r.insert().values(**{k: v for k, v in latest.items() if k != "id"}))

    log.info("Published: %s", counts)
    return {"model_version": version, "rows": counts}


def _naive(ts):
    return ts.replace(tzinfo=None) if ts is not None and ts.tzinfo else ts
