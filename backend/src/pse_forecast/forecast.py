"""Day-ahead forecasting with the deployed model (no retraining).

This is what the daily scheduled job runs after a data refresh: load the current model from the
database, build features for the days after the last complete day and store the predictions.

Forecasts are kept as an honest, ex-ante record: once a day has started (local time), its stored
forecast is never overwritten, so the live track record compares what the model *really*
predicted the day before with what actually happened.
"""

import logging
from datetime import UTC, date, datetime, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import Engine, select

from pse_forecast import db
from pse_forecast.config import TZ
from pse_forecast.features import build_features, complete_days
from pse_forecast.model_store import load_model
from pse_forecast.models import lgbm

log = logging.getLogger(__name__)

# Demand history needed to compute the longest lag feature (14 days) plus a margin.
HISTORY_DAYS = 21


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


def future_frame(load_df: pd.DataFrame, weather_df: pd.DataFrame) -> pd.DataFrame:
    """Feature rows for the days after the last complete day that have enough history."""
    last_complete = complete_days(load_df)[-1]
    start = last_complete - timedelta(days=HISTORY_DAYS)
    frame = build_features(load_df, weather_df, start, load_df["business_date"].max())
    future = frame[frame["business_date"] > last_complete]
    return future[future["lag_2d"].notna() | future["d2_mean"].notna()]


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


def forecast(engine: Engine | None = None) -> dict:
    engine = engine or db.get_engine()
    booster, meta = load_model(engine)
    if booster is None:
        raise RuntimeError("No model deployed yet. Train one with `make train` first.")
    version = meta["model_version"]

    load_df = db.read_load(engine)
    if load_df.empty:
        raise RuntimeError("No demand data. Run a data refresh first.")
    weather_df = db.read_weather(engine)
    future = future_frame(load_df, weather_df)
    missing_weather = future["temperature"].isna().mean() if not future.empty else 0.0
    if missing_weather > 0.5:
        raise RuntimeError("Weather forecast missing for the target days. Refresh the data.")

    rows = prediction_rows(future, lgbm.predict(booster, future), "forecast", version)
    written = store_forecasts(engine, rows)
    log.info("Model %s forecast days: %s", version, written or "none (already forecast)")
    return {"model_version": version, "forecast_days": written}
