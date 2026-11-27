"""Protection for a public API on free-tier hosting.

The API is read-only (there is no endpoint that trains models or writes data), so the main risk
is abuse: a client hammering endpoints to exhaust the small server or the database's monthly
compute allowance. Defences, from cheapest to most specific:

- request size limit (the only POST body is a tiny what-if scenario)
- rate limits per client and for all clients together (sliding one-minute windows)
- response caching, so repeated requests are served from memory without touching the database
- a concurrency cap on what-if, the one endpoint that runs the model
- security headers on every response

Behind a proxy (Render, which sits behind Cloudflare) the client address comes from the proxy's
headers; enable `TRUST_PROXY_HEADERS` only there, because clients can forge these headers when
there is no proxy in front.
"""

import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from functools import wraps

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from pse_forecast.config import get_settings

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "cross-origin",
}
DOCS_PATHS = ("/api/docs", "/api/openapi.json")


class RateLimiter:
    """Sliding-window limiter: at most `limit` hits per `window` seconds per key.

    Keeps at most `max_keys` clients in memory (least recently seen are dropped), so a flood of
    forged addresses cannot exhaust memory.
    """

    def __init__(self, limit: int, window: float = 60.0, max_keys: int = 10_000) -> None:
        self.limit, self.window, self.max_keys = limit, window, max_keys
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def hit(self, key: str, now: float | None = None) -> float | None:
        """Record a hit. Returns None if allowed, else seconds until the next hit is allowed."""
        now = time.monotonic() if now is None else now
        with self._lock:
            hits = self._hits.pop(key, None) or deque()
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            limited = len(hits) >= self.limit
            if not limited:
                hits.append(now)
            self._hits[key] = hits
            while len(self._hits) > self.max_keys:
                self._hits.popitem(last=False)
            return max(0.0, hits[0] + self.window - now) if limited else None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        for header in ("cf-connecting-ip", "true-client-ip"):
            if value := request.headers.get(header):
                return value.strip()
        if forwarded := request.headers.get("x-forwarded-for"):
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class Limits:
    def __init__(self) -> None:
        s = get_settings()
        self.per_client = RateLimiter(s.rate_limit_per_minute)
        self.whatif = RateLimiter(s.whatif_rate_limit_per_minute)
        self.everyone = RateLimiter(s.global_rate_limit_per_minute)

    def reset(self) -> None:
        for limiter in (self.per_client, self.whatif, self.everyone):
            limiter.reset()


limits = Limits()


def _too_many(retry_after: float, detail: str) -> JSONResponse:
    return JSONResponse(
        {"detail": detail}, status_code=429, headers={"Retry-After": str(int(retry_after) + 1)}
    )


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        limited_path = path.startswith("/api/") and path != "/api/health"

        if limited_path and request.method not in ("OPTIONS",):
            size = request.headers.get("content-length")
            if size and (not size.isdigit() or int(size) > get_settings().max_body_bytes):
                return JSONResponse({"detail": "Request body too large"}, status_code=413)
            ip = client_ip(request)
            if (wait := limits.everyone.hit("*")) is not None:
                return _too_many(wait, "The server is busy, please try again shortly")
            if (wait := limits.per_client.hit(ip)) is not None:
                return _too_many(wait, "Too many requests, please slow down")
            if path == "/api/whatif" and (wait := limits.whatif.hit(ip)) is not None:
                return _too_many(wait, "Too many scenarios, please wait a moment")

        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if (
            request.method == "GET"
            and limited_path
            and not path.startswith(DOCS_PATHS)
            and response.status_code == 200
        ):
            # Data changes once a day: let browsers reuse responses for a few minutes.
            response.headers.setdefault("Cache-Control", "public, max-age=300")
        return response


def ttl_cache(seconds: float, maxsize: int = 256) -> Callable:
    """Cache a function's results in memory for `seconds`, keyed by its arguments."""

    def decorator(fn: Callable) -> Callable:
        store: OrderedDict = OrderedDict()
        lock = threading.Lock()

        @wraps(fn)
        def wrapper(*args, **kwargs):
            key = (args, tuple(sorted(kwargs.items())))
            now = time.monotonic()
            with lock:
                hit = store.get(key)
                if hit and hit[0] > now:
                    store.move_to_end(key)
                    return hit[1]
            value = fn(*args, **kwargs)
            with lock:
                store[key] = (now + seconds, value)
                store.move_to_end(key)
                while len(store) > maxsize:
                    store.popitem(last=False)
            return value

        wrapper.cache_clear = store.clear  # type: ignore[attr-defined]
        return wrapper

    return decorator
