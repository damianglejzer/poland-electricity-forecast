"""FastAPI application: a read-only API over forecasts, evaluation and the deployed model.

All routes live under /api. Nothing here trains models or downloads data: training happens
offline and data is refreshed by a scheduled job. Abuse protection (rate limits, caching, size
limits, security headers) is in security.py.
"""

import datetime as dt
import logging
import threading
from datetime import date, timedelta

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from pse_forecast import services
from pse_forecast.config import DATA_START, get_settings
from pse_forecast.db import get_engine
from pse_forecast.security import SecurityMiddleware, ttl_cache

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="PSE Demand Forecast API",
    description="Next-day 15-minute forecasts of Polish national electricity demand (KSE), "
    "benchmarked against PSE's official forecast.",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    max_age=3600,
)
app.add_middleware(SecurityMiddleware)
api = APIRouter(prefix="/api")

# Data changes once a day, so responses are cached in memory: repeated requests (or a client
# hammering the API) are answered without touching the database.
DATA_TTL = 600


def _check_date(d: date | None) -> None:
    if d is not None and not (DATA_START <= d <= services.today() + timedelta(days=3)):
        raise HTTPException(422, f"Date must be between {DATA_START} and a few days from today")


@ttl_cache(DATA_TTL)
def _status() -> dict:
    engine = get_engine()
    return {**services.last_update(engine), "model": services.current_run(engine)}


@ttl_cache(DATA_TTL)
def _series(start: date, days: int) -> dict:
    return services.series(get_engine(), start, days)


@ttl_cache(DATA_TTL)
def _kpis() -> dict:
    return services.kpis(get_engine())


@ttl_cache(DATA_TTL)
def _benchmark(days: int | None) -> dict:
    return services.benchmark(get_engine(), days)


@ttl_cache(DATA_TTL)
def _track_record() -> dict:
    return services.track_record(get_engine())


@ttl_cache(DATA_TTL)
def _insights() -> dict:
    return services.insights(get_engine())


@ttl_cache(DATA_TTL)
def _model() -> dict:
    engine = get_engine()
    return {"current": services.current_run(engine), "history": services.model_history(engine)}


@ttl_cache(DATA_TTL)
def _importance() -> dict | None:
    return services.importance(get_engine())


@ttl_cache(DATA_TTL, maxsize=512)
def _whatif(target, temp_delta, cloud_cover, holiday, dow) -> dict:
    return services.whatif(get_engine(), target, temp_delta, cloud_cover, holiday, dow)


_whatif_slots = threading.BoundedSemaphore(get_settings().whatif_max_concurrent)


def clear_caches() -> None:
    for fn in (_status, _series, _kpis, _benchmark, _track_record, _insights, _model):
        fn.cache_clear()
    _importance.cache_clear()
    _whatif.cache_clear()


@api.get("/health", tags=["system"])
def health() -> dict:
    return {"status": "ok"}


@api.get("/status", tags=["system"])
def status() -> dict:
    return _status()


@api.get("/series", tags=["data"])
def series(
    start: date | None = Query(None, description="First local date (default: today)"),
    days: int = Query(2, ge=1, le=14),
) -> dict:
    """Actual demand, PSE forecast, model forecast and baseline at 15-minute resolution."""
    _check_date(start)
    return _series(start or services.today(), days)


@api.get("/kpis", tags=["data"])
def kpis() -> dict:
    return _kpis()


@api.get("/benchmark", tags=["evaluation"])
def benchmark(days: int | None = Query(None, ge=7, le=365)) -> dict:
    """Out-of-sample error of the model vs PSE vs baseline: daily, by hour, by day type."""
    return _benchmark(days)


@api.get("/track-record", tags=["evaluation"])
def track_record() -> dict:
    """Live record: only genuine day-ahead forecasts, stored before each day started."""
    return _track_record()


@api.get("/insights", tags=["data"])
def insights() -> dict:
    """Typical daily demand profile and demand vs temperature, to explain the problem."""
    return _insights()


@api.get("/model", tags=["model"])
def model() -> dict:
    return _model()


@api.get("/model/importance", tags=["model"])
def importance() -> dict:
    result = _importance()
    if result is None:
        raise HTTPException(404, "No trained model yet")
    return result


class WhatIfRequest(BaseModel):
    date: dt.date | None = Field(None, description="Target day (default: latest forecast day)")
    temp_delta: float = Field(0.0, ge=-15, le=15, description="Temperature change in °C")
    cloud_cover: float | None = Field(None, ge=0, le=100, description="Override cloud cover, %")
    holiday: bool | None = Field(None, description="Force public holiday on/off")
    dow: int | None = Field(None, ge=0, le=6, description="Treat the day as this weekday (0=Mon)")


@api.post("/whatif", tags=["model"])
def whatif(req: WhatIfRequest) -> dict:
    """Re-score a day under a scenario (the only endpoint that runs the model)."""
    _check_date(req.date)
    # Round inputs so near-identical scenarios share a cache entry.
    key = (
        req.date,
        round(req.temp_delta * 2) / 2,
        None if req.cloud_cover is None else round(req.cloud_cover),
        req.holiday,
        req.dow,
    )
    if not _whatif_slots.acquire(timeout=10):
        raise HTTPException(503, "The simulator is busy, please try again in a moment")
    try:
        return _whatif(*key)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        _whatif_slots.release()


app.include_router(api)
