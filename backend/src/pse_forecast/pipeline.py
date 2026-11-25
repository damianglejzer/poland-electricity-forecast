"""Data refresh: incremental download of PSE demand and weather into the database."""

import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, insert, select, update

from pse_forecast import db
from pse_forecast.config import DATA_START, TZ
from pse_forecast.sources import pse, weather
from pse_forecast.validation import validate_load, validate_weather

log = logging.getLogger(__name__)

# Re-download a few recent days: actuals for "today" are partial and PSE may revise values.
OVERLAP_DAYS = 3
FORECAST_DAYS = 2  # PSE publishes its forecast for tomorrow; weather a bit further


def _start_date(engine, column) -> date:
    with engine.connect() as conn:
        last = conn.execute(select(func.max(column))).scalar()
    if last is None:
        return DATA_START
    last_date = last.date() if isinstance(last, datetime) else last
    return max(DATA_START, last_date - timedelta(days=OVERLAP_DAYS))


def refresh(engine=None) -> dict:
    engine = engine or db.get_engine()
    started = datetime.now(UTC)
    with engine.begin() as conn:
        log_id = conn.execute(
            insert(db.refresh_log).values(started_at=started, status="running")
        ).inserted_primary_key[0]

    today = datetime.now(TZ).date()
    end = today + timedelta(days=FORECAST_DAYS)
    result = {"rows_load": 0, "rows_weather": 0, "errors": []}
    now = datetime.now(UTC)

    try:
        start = _start_date(engine, db.load.c.business_date)
        log.info("Fetching PSE kse-load %s..%s", start, end)
        load_df = validate_load(pse.fetch_kse_load(start, end))
        load_df["updated_at"] = now
        result["rows_load"] = db.upsert(engine, db.load, load_df, ["ts_utc"])
    except Exception as exc:  # keep going: weather may still succeed
        log.exception("PSE refresh failed")
        result["errors"].append(f"PSE: {str(exc)[:300]}")

    try:
        start = _start_date(engine, db.weather.c.ts_utc)
        log.info("Fetching Open-Meteo weather %s..%s", start, end)
        w = validate_weather(weather.fetch_weather(start, end))
        w["source"] = "open-meteo"
        w["updated_at"] = now
        result["rows_weather"] = db.upsert(engine, db.weather, w, ["ts_utc"])
    except Exception as exc:
        log.exception("Weather refresh failed")
        result["errors"].append(f"Weather: {str(exc)[:300]}")

    status = "failed" if len(result["errors"]) == 2 else ("partial" if result["errors"] else "ok")
    with engine.begin() as conn:
        conn.execute(
            update(db.refresh_log)
            .where(db.refresh_log.c.id == log_id)
            .values(
                finished_at=datetime.now(UTC),
                status=status,
                message="; ".join(result["errors"]) or None,
                rows_load=result["rows_load"],
                rows_weather=result["rows_weather"],
            )
        )
    result["status"] = status
    return result
