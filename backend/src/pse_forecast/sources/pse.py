"""Client for the PSE public reports API v2 (https://api.raporty.pse.pl).

The `kse-load` entity holds, per 15-minute interval, the actual national demand of the Polish
power system (`load_actual`, net basis) and PSE's official forecast (`load_fcst`). Both are on
the same basis, so the target and the benchmark are directly comparable.
"""

from datetime import date, timedelta

import httpx
import pandas as pd

from pse_forecast.config import get_settings
from pse_forecast.sources.http import get_json

COLUMNS = ["ts_utc", "business_date", "actual", "pse_fcst"]


def parse_kse_load(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    raw = pd.DataFrame(rows)
    # `dtime_utc` marks the END of the 15-minute interval; store the interval start.
    end_utc = pd.to_datetime(raw["dtime_utc"]).dt.tz_localize("UTC")
    df = pd.DataFrame(
        {
            "ts_utc": end_utc - pd.Timedelta(minutes=15),
            "business_date": pd.to_datetime(raw["business_date"]).dt.date,
            "actual": pd.to_numeric(raw["load_actual"], errors="coerce"),
            "pse_fcst": pd.to_numeric(raw["load_fcst"], errors="coerce"),
        }
    )
    return df.drop_duplicates("ts_utc", keep="last").sort_values("ts_utc").reset_index(drop=True)


def fetch_kse_load(start: date, end: date, chunk_days: int = 31) -> pd.DataFrame:
    settings = get_settings()
    url = f"{settings.pse_base_url}/kse-load"
    rows: list[dict] = []
    with httpx.Client(timeout=settings.http_timeout) as client:
        chunk_start = start
        while chunk_start <= end:
            chunk_end = min(chunk_start + timedelta(days=chunk_days - 1), end)
            params = {
                "$filter": f"business_date ge '{chunk_start}' and business_date le '{chunk_end}'",
                "$first": 10000,
            }
            data = get_json(client, url, params)
            rows.extend(data.get("value", []))
            next_link = data.get("nextLink")
            while next_link:
                data = get_json(client, next_link)
                rows.extend(data.get("value", []))
                next_link = data.get("nextLink")
            chunk_start = chunk_end + timedelta(days=1)
    return parse_kse_load(rows)
