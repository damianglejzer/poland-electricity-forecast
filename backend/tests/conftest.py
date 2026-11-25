import os
from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd
import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")
# Point MLflow at a closed port so training skips tracking quickly in tests.
os.environ["MLFLOW_TRACKING_URI"] = "http://127.0.0.1:9"

from pse_forecast import db  # noqa: E402
from pse_forecast.config import TZ, get_settings  # noqa: E402
from pse_forecast.features import slot_grid  # noqa: E402


def synthetic_load(start, end, actual_until=None, seed=0) -> pd.DataFrame:
    """Demand with daily/weekly shape, temperature response and noise."""
    rng = np.random.default_rng(seed)
    grid = slot_grid(start, end)
    local = grid.tz_convert(TZ)
    hour = np.asarray(local.hour + local.minute / 60)
    daily = 3000 * np.sin((hour - 6) / 24 * 2 * np.pi).clip(-0.6, None)
    weekly = np.where(local.dayofweek >= 5, -2500, 0)
    actual = 17000 + daily + weekly + rng.normal(0, 200, len(grid))
    df = pd.DataFrame(
        {
            "ts_utc": grid,
            "business_date": local.date,
            "actual": actual,
            "pse_fcst": actual + rng.normal(0, 400, len(grid)),
        }
    )
    if actual_until is not None:
        df.loc[df["business_date"] > actual_until, "actual"] = np.nan
    return df


def synthetic_weather(start, end) -> pd.DataFrame:
    grid = pd.date_range(
        pd.Timestamp(start, tz=TZ).tz_convert("UTC") - pd.Timedelta(hours=2),
        pd.Timestamp(end + timedelta(days=1), tz=TZ).tz_convert("UTC") + pd.Timedelta(hours=2),
        freq="1h",
    )
    h = np.asarray(grid.hour)
    return pd.DataFrame(
        {
            "ts_utc": grid,
            "temperature": 10 + 5 * np.sin((h - 9) / 24 * 2 * np.pi),
            "cloud_cover": 50.0,
            "radiation": np.clip(600 * np.sin((h - 5) / 14 * np.pi), 0, None),
            "wind_speed": 12.0,
        }
    )


@pytest.fixture(scope="session")
def seeded_engine():
    """In-memory SQLite with ~150 days of synthetic data ending tomorrow, plus a trained model."""
    get_settings.cache_clear()
    db.reset_engines()
    engine = db.get_engine("sqlite://")

    today = datetime.now(TZ).date()
    start, end = today - timedelta(days=150), today + timedelta(days=1)
    load_df = synthetic_load(start, end, actual_until=today - timedelta(days=1))
    load_df["updated_at"] = datetime.now(UTC)
    db.upsert(engine, db.load, load_df, ["ts_utc"])
    db.upsert(engine, db.weather, synthetic_weather(start, end), ["ts_utc"])
    with engine.begin() as conn:
        conn.execute(
            db.refresh_log.insert().values(
                started_at=datetime.now(UTC), finished_at=datetime.now(UTC), status="ok"
            )
        )

    from pse_forecast.training import train

    result = train(engine, test_days=21)
    yield engine, result
    db.reset_engines()
