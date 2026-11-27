"""The public API must stay read-only and resist abuse."""

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from pse_forecast.api.main import app, clear_caches
from pse_forecast.config import get_settings
from pse_forecast.security import RateLimiter, client_ip, limits


@pytest.fixture
def client(seeded_engine):
    clear_caches()
    limits.reset()
    yield TestClient(app)
    limits.reset()


def test_only_read_routes_are_exposed():
    """No endpoint may train, refresh, publish or otherwise change anything."""
    routes = {
        (method.upper(), path) for path, ops in app.openapi()["paths"].items() for method in ops
    }
    routes |= {
        (method, route.path)
        for route in app.router.routes
        if getattr(route, "path", "").startswith("/api/")
        for method in (getattr(route, "methods", None) or set()) - {"HEAD"}
    }
    writes = {r for r in routes if r[0] != "GET"}
    assert writes == {("POST", "/api/whatif")}  # computes a scenario, stores nothing
    assert not any(word in path for _, path in routes for word in ("train", "refresh", "job"))


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"


def test_data_responses_are_cacheable(client):
    assert client.get("/api/kpis").headers["cache-control"] == "public, max-age=300"
    assert "cache-control" not in client.get("/api/health").headers


def test_rejects_large_bodies(client):
    headers = {"Content-Type": "application/json"}
    r = client.post("/api/whatif", content=b"x" * 20_000, headers=headers)
    assert r.status_code == 413


def test_rejects_dates_outside_the_data(client):
    assert client.get("/api/series", params={"start": "1990-01-01"}).status_code == 422
    assert client.post("/api/whatif", json={"date": "2100-01-01"}).status_code == 422


def test_per_client_rate_limit(client, monkeypatch):
    monkeypatch.setattr(limits, "per_client", RateLimiter(3))
    codes = [client.get("/api/kpis").status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    r = client.get("/api/kpis")
    assert int(r.headers["retry-after"]) >= 1
    assert client.get("/api/health").status_code == 200  # uptime checks are never limited


def test_whatif_has_its_own_stricter_limit(client, monkeypatch):
    monkeypatch.setattr(limits, "whatif", RateLimiter(2))
    codes = [client.post("/api/whatif", json={"temp_delta": -3}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert client.get("/api/kpis").status_code == 200  # other pages keep working


def test_global_limit_protects_the_database(client, monkeypatch):
    monkeypatch.setattr(limits, "everyone", RateLimiter(2))
    codes = [client.get("/api/model").status_code for _ in range(3)]
    assert codes[-1] == 429


def test_whatif_results_are_cached(client):
    a = client.post("/api/whatif", json={"temp_delta": -5.1}).json()
    b = client.post("/api/whatif", json={"temp_delta": -4.9}).json()  # rounds to the same key
    assert a == b


def test_rate_limiter_window_and_memory_bound():
    limiter = RateLimiter(2, window=60, max_keys=3)
    assert limiter.hit("a", now=0) is None
    assert limiter.hit("a", now=1) is None
    assert limiter.hit("a", now=2) == pytest.approx(58)
    assert limiter.hit("a", now=61) is None  # the window slid past the first hit
    for key in "bcdef":
        limiter.hit(key, now=70)
    assert len(limiter._hits) == 3


def _request(headers: dict, host="10.0.0.1") -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw, "client": (host, 1234)})


def test_client_ip_ignores_proxy_headers_unless_trusted(monkeypatch):
    forged = {"X-Forwarded-For": "1.2.3.4", "CF-Connecting-IP": "5.6.7.8"}
    assert client_ip(_request(forged)) == "10.0.0.1"
    monkeypatch.setattr(get_settings(), "trust_proxy_headers", True)
    assert client_ip(_request(forged)) == "5.6.7.8"
    assert client_ip(_request({"X-Forwarded-For": "1.2.3.4, 9.9.9.9"})) == "1.2.3.4"
