"""Forecasts are an ex-ante record: a day that has started keeps the forecast it had."""

from datetime import UTC, datetime, timedelta

import pandas as pd
from sqlalchemy import select

from pse_forecast import db
from pse_forecast.config import TZ
from pse_forecast.features import local_day_bounds_utc
from pse_forecast.forecast import store_forecasts


def _forecast_at(engine, ts) -> float | None:
    p = db.predictions
    with engine.connect() as conn:
        return conn.execute(
            select(p.c.yhat).where(p.c.kind == "forecast", p.c.ts_utc == ts.to_pydatetime())
        ).scalar()


def test_store_forecasts_keeps_started_days():
    engine = db.get_engine("sqlite:///file:ex_ante?mode=memory&uri=true")
    today = datetime.now(TZ).date()
    first_slot = lambda d: local_day_bounds_utc(d, d)[0]  # noqa: E731
    rows = pd.DataFrame(
        {
            "ts_utc": [first_slot(today), first_slot(today + timedelta(days=1))],
            "kind": "forecast",
            "business_date": [today, today + timedelta(days=1)],
            "yhat": [100.0, 200.0],
            "model_version": "v1",
            "created_at": datetime.now(UTC),
        }
    )
    assert store_forecasts(engine, rows) == [str(today), str(today + timedelta(days=1))]
    rows["yhat"] = [111.0, 222.0]
    assert store_forecasts(engine, rows) == [str(today + timedelta(days=1))]
    assert _forecast_at(engine, first_slot(today)) == 100.0  # today already started: kept
    assert _forecast_at(engine, first_slot(today + timedelta(days=1))) == 222.0
