import logging
import time

import httpx

log = logging.getLogger(__name__)


def get_json(client: httpx.Client, url: str, params: dict | None = None, attempts: int = 3):
    """GET with simple exponential backoff on network errors and 5xx/429 responses."""
    for attempt in range(1, attempts + 1):
        try:
            resp = client.get(url, params=params)
            if resp.status_code < 500 and resp.status_code != 429:
                resp.raise_for_status()
                return resp.json()
            msg = f"HTTP {resp.status_code}"
        except httpx.TransportError as exc:
            msg = repr(exc)
        if attempt == attempts:
            raise RuntimeError(f"GET {url} failed after {attempts} attempts: {msg}")
        log.warning("GET %s failed (%s), retrying", url, msg)
        time.sleep(2**attempt)
    raise AssertionError("unreachable")
