"""The production model lives in the database, next to the data it serves.

Training writes the booster as text into `model_artifacts`; the API and the daily forecast job
load whichever version `model_runs` marks as current. No shared disk and no MLflow server are
needed at serving time, which keeps the API stateless (it runs on a free-tier container).
"""

import threading
from datetime import UTC, datetime

import lightgbm as lgb
from sqlalchemy import Engine, select

from pse_forecast import db

_lock = threading.Lock()
_cache: dict = {"key": None, "booster": None}


def save_model(engine: Engine, booster: lgb.Booster, version: str) -> None:
    db.upsert(
        engine,
        db.model_artifacts,
        [
            {
                "model_version": version,
                "created_at": datetime.now(UTC),
                "model_text": booster.model_to_string(),
            }
        ],
        ["model_version"],
    )


def current_version(engine: Engine) -> str | None:
    t = db.model_runs
    with engine.connect() as conn:
        return conn.execute(
            select(t.c.model_version)
            .where(t.c.is_current.is_(True))
            .order_by(t.c.id.desc())
            .limit(1)
        ).scalar()


def load_model(engine: Engine) -> tuple[lgb.Booster | None, dict | None]:
    """Return (booster, meta) for the current model, or (None, None) if none is deployed."""
    version = current_version(engine)
    if version is None:
        return None, None
    key = (engine.url.render_as_string(hide_password=True), version)
    with _lock:
        if _cache["key"] != key:
            with engine.connect() as conn:
                text = conn.execute(
                    select(db.model_artifacts.c.model_text).where(
                        db.model_artifacts.c.model_version == version
                    )
                ).scalar()
            if text is None:
                return None, None
            _cache["booster"] = lgb.Booster(model_str=text)
            _cache["key"] = key
        return _cache["booster"], {"model_version": version}
