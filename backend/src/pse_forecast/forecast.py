"""Storage of model forecasts.

Forecasts are kept as an honest, ex-ante record: once a day has started (local time), its stored
forecast is never overwritten, so a live track record compares what the model *really*
predicted the day before with what actually happened.
"""

import logging
from datetime import UTC, date, datetime

import numpy as np
import pandas as pd
from sqlalchemy import Engine, select

from pse_forecast import db
from pse_forecast.config import TZ

log = logging.getLogger(__name__)


def prediction_rows(df: pd.DataFrame, yhat: np.ndarray, kind: str, version: str) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "ts_utc": df["ts_utc"].to_numpy(),
            "kind": kind,
            "business_date": df["business_date"].to_numpy(),
            "yhat": np.round(yhat, 1),
            "model_version": version,
            "created_at": datetime.now(UTC),
        }
    )


def store_forecasts(engine: Engine, rows: pd.DataFrame, today: date | None = None) -> list[str]:
    """Store forecast rows, never replacing a forecast for a day that has already started.

    Returns the list of days that were written.
    """
    if rows.empty:
        return []
    today = today or datetime.now(TZ).date()
    t = db.predictions
    with engine.connect() as conn:
        existing = {
            d if isinstance(d, date) else date.fromisoformat(str(d))
            for d in conn.execute(
                select(t.c.business_date)
                .where(t.c.kind == "forecast", t.c.business_date <= today)
                .distinct()
            ).scalars()
        }
    locked = rows["business_date"].isin(existing) & (rows["business_date"] <= today)
    if locked.any():
        kept = sorted(set(rows.loc[locked, "business_date"]))
        log.info("Keeping existing ex-ante forecasts for %s", kept)
    rows = rows[~locked]
    db.upsert(engine, t, rows, ["ts_utc", "kind"])
    return sorted({str(d) for d in rows["business_date"]})
