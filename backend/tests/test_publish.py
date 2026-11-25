"""Publishing to the public database and forecasting there with the deployed model."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from pse_forecast import db, services
from pse_forecast.features import local_day_bounds_utc
from pse_forecast.forecast import forecast
from pse_forecast.model_store import current_version, load_model
from pse_forecast.publish import publish


def _count(engine, table, *where) -> int:
    with engine.connect() as conn:
        return conn.execute(select(func.count()).select_from(table).where(*where)).scalar()


def _forecast_at(engine, ts) -> float | None:
    p = db.predictions
    with engine.connect() as conn:
        return conn.execute(
            select(p.c.yhat).where(p.c.kind == "forecast", p.c.ts_utc == ts.to_pydatetime())
        ).scalar()


def test_publish_then_forecast_on_target(seeded_engine, tmp_path):
    src, _ = seeded_engine
    url = f"sqlite:///{tmp_path}/public.db"
    dst = db.get_engine(url)
    today = services.today()
    tomorrow = today + timedelta(days=1)

    # The public database already holds a live forecast for today: it must survive publishing.
    ts = local_day_bounds_utc(today, today)[0]
    db.upsert(
        dst,
        db.predictions,
        [
            {
                "ts_utc": ts.to_pydatetime(),
                "kind": "forecast",
                "business_date": today,
                "yhat": 1.0,
                "model_version": "old",
                "created_at": datetime.now(UTC),
            }
        ],
        ["ts_utc", "kind"],
    )

    result = publish(url, source=src)
    version = current_version(src)
    assert result["model_version"] == version == current_version(dst)
    assert _count(dst, db.load) == _count(src, db.load)
    assert _count(dst, db.model_artifacts) == 1
    p = db.predictions
    assert _count(dst, p, p.c.kind == "backtest") == _count(src, p, p.c.kind == "backtest")
    assert _forecast_at(dst, ts) == 1.0

    publish(url, source=src)  # idempotent
    assert _count(dst, db.load) == _count(src, db.load)
    assert _count(dst, db.model_runs, db.model_runs.c.is_current.is_(True)) == 1

    booster, meta = load_model(dst)
    assert booster is not None and meta["model_version"] == version
    out = forecast(dst)
    assert str(today) not in out["forecast_days"]  # today is locked
    assert str(tomorrow) in out["forecast_days"]
    assert _forecast_at(dst, ts) == 1.0
    assert _count(dst, p, p.c.kind == "forecast", p.c.business_date == tomorrow) >= 92
