"""FastAPI application: a read-only API over forecasts, evaluation and the deployed model.

All routes live under /api. Nothing here trains models or downloads data: training happens
offline and data is refreshed by a scheduled job, so the public API stays fast and safe.
"""

import datetime as dt
import logging
from datetime import date

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from pse_forecast import services
from pse_forecast.config import get_settings
from pse_forecast.db import get_engine

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
api = APIRouter(prefix="/api")


@api.get("/health", tags=["system"])
def health() -> dict:
    return {"status": "ok"}


@api.get("/status", tags=["system"])
def status() -> dict:
    engine = get_engine()
    return {
        **services.last_update(engine),
        "model": services.current_run(engine),
    }


@api.get("/series", tags=["data"])
def series(
    start: date | None = Query(None, description="First local date (default: today)"),
    days: int = Query(2, ge=1, le=14),
) -> dict:
    """Actual demand, PSE forecast, model forecast and baseline at 15-minute resolution."""
    return services.series(get_engine(), start or services.today(), days)


@api.get("/kpis", tags=["data"])
def kpis() -> dict:
    return services.kpis(get_engine())


@api.get("/benchmark", tags=["evaluation"])
def benchmark(days: int | None = Query(None, ge=7, le=365)) -> dict:
    """Out-of-sample error of the model vs PSE vs baseline: daily, by hour, by day type."""
    return services.benchmark(get_engine(), days)


@api.get("/track-record", tags=["evaluation"])
def track_record() -> dict:
    """Live record: only genuine day-ahead forecasts, stored before each day started."""
    return services.track_record(get_engine())


@api.get("/insights", tags=["data"])
def insights() -> dict:
    """Typical daily demand profile and demand vs temperature, to explain the problem."""
    return services.insights(get_engine())


@api.get("/model", tags=["model"])
def model() -> dict:
    engine = get_engine()
    return {
        "current": services.current_run(engine),
        "history": services.model_history(engine),
    }


@api.get("/model/importance", tags=["model"])
def importance() -> dict:
    result = services.importance(get_engine())
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
    try:
        return services.whatif(
            get_engine(), req.date, req.temp_delta, req.cloud_cover, req.holiday, req.dow
        )
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


app.include_router(api)
