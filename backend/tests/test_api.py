from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from pse_forecast import db, services
from pse_forecast.api.main import app


@pytest.fixture(scope="module")
def client(seeded_engine):
    return TestClient(app)


def test_training_beats_naive_baseline(seeded_engine):
    _, result = seeded_engine
    m = result["metrics"]
    assert m["model_mape"] < m["baseline_mape"]
    assert result["model_version"].startswith("local-")  # MLflow unreachable in tests
    assert str(services.today() + timedelta(days=1)) in result["forecast_days"]


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_series_today_and_tomorrow(client):
    body = client.get("/api/series").json()
    assert len(body["days"]) == 2
    assert len(body["points"]) >= 184
    tomorrow = body["points"][-1]
    assert tomorrow["actual"] is None and tomorrow["pse"] is not None
    assert tomorrow["model"] is not None
    assert body["days"][1]["model_kind"] == "forecast"


def test_series_past_day_uses_backtest(client):
    day = services.today() - timedelta(days=5)
    body = client.get("/api/series", params={"start": str(day), "days": 1}).json()
    assert body["days"][0]["model_kind"] == "backtest"
    assert all(p["actual"] is not None for p in body["points"])


def test_kpis(client):
    body = client.get("/api/kpis").json()
    assert body["tomorrow_peak"]["value"] > 10_000
    assert set(body["accuracy_30d"]) >= {"model", "pse", "baseline"}
    assert body["last_refresh"] is not None


def test_benchmark(client):
    body = client.get("/api/benchmark").json()
    assert body["available"]
    assert len(body["by_hour"]) == 24
    assert {r["day_type"] for r in body["by_day_type"]} >= {"weekday", "weekend"}
    assert body["summary"]["model"]["mape"] > 0


def test_model_and_importance(client):
    body = client.get("/api/model").json()
    assert body["current"]["metrics"]["model_mape"] > 0
    imp = client.get("/api/model/importance").json()
    assert imp["features"][0]["mean_abs_shap"] >= imp["features"][-1]["mean_abs_shap"]
    assert set(imp["groups"]) == {"calendar", "recent demand", "weather"}


def test_whatif_unchanged_and_weekend(client):
    base = client.post("/api/whatif", json={}).json()
    assert all(p["base"] == p["scenario"] for p in base["points"])
    sunday = client.post("/api/whatif", json={"dow": 6}).json()
    if base["inputs"]["dow"] < 5:
        assert sunday["summary"]["scenario_energy_gwh"] < sunday["summary"]["base_energy_gwh"]
    assert sunday["contributions"]


def test_whatif_validation(client):
    assert client.post("/api/whatif", json={"temp_delta": 50}).status_code == 422


def test_api_is_read_only(client):
    assert client.post("/api/jobs/train").status_code in (404, 405)
    assert client.post("/api/jobs/refresh").status_code in (404, 405)


def test_cors_allows_configured_origin(client):
    r = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
    r = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_kpis_forecast_day(client):
    body = client.get("/api/kpis").json()
    assert body["forecast_day"] == str(services.today() + timedelta(days=1))
    assert body["latest_forecast_day"] >= body["forecast_day"]


def test_insights(client):
    body = client.get("/api/insights").json()
    assert body["available"]
    assert len(body["profile"]) == 96
    assert {"weekday", "sunday"} <= set(body["profile"][0])
    assert len(body["temperature"]) > 100


def test_track_record_uses_only_live_forecasts(seeded_engine, client):
    engine, _ = seeded_engine
    p = db.predictions
    first = services.today() - timedelta(days=2)
    with engine.connect() as conn:
        rows = conn.execute(
            select(p).where(p.c.kind == "backtest", p.c.business_date >= first)
        ).mappings()
        live = [{**r, "kind": "forecast", "created_at": datetime.now(UTC)} for r in rows]
    db.upsert(engine, p, live, ["ts_utc", "kind"])
    body = client.get("/api/track-record").json()
    assert body["available"]
    assert body["first_forecast"] == str(first)
    assert body["n_days"] == 2
