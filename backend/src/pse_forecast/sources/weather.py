"""Population-weighted weather for Poland from Open-Meteo (free, no API key).

We use the *historical forecast* API: archived numerical weather forecasts, which also extend a
few days into the future. Training on archived forecasts (not reanalysis) means the model learns
from inputs of the same quality it gets at prediction time.
"""

from datetime import date, timedelta

import httpx
import numpy as np
import pandas as pd

from pse_forecast.config import get_settings
from pse_forecast.sources.http import get_json

HIST_FORECAST_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# (name, lat, lon, metropolitan population in millions) - weights approximate where demand is.
CITIES = [
    ("Warszawa", 52.23, 21.01, 3.1),
    ("Katowice", 50.26, 19.02, 2.2),
    ("Kraków", 50.06, 19.94, 1.5),
    ("Wrocław", 51.11, 17.03, 1.2),
    ("Gdańsk", 54.35, 18.65, 1.1),
    ("Łódź", 51.76, 19.46, 1.0),
    ("Poznań", 52.41, 16.93, 1.0),
    ("Szczecin", 53.43, 14.55, 0.7),
]

VARIABLES = {
    "temperature_2m": "temperature",
    "cloud_cover": "cloud_cover",
    "shortwave_radiation": "radiation",
    "wind_speed_10m": "wind_speed",
}
COLUMNS = ["ts_utc", *VARIABLES.values()]


def parse_open_meteo(payload: list[dict] | dict) -> pd.DataFrame:
    """Combine per-city hourly series into one population-weighted hourly frame."""
    locations = payload if isinstance(payload, list) else [payload]
    weights = np.array([c[3] for c in CITIES[: len(locations)]], dtype=float)
    frames = []
    for loc in locations:
        hourly = loc["hourly"]
        df = pd.DataFrame({VARIABLES[k]: hourly[k] for k in VARIABLES}, dtype=float)
        df.index = pd.to_datetime(hourly["time"]).tz_localize("UTC")
        frames.append(df)
    stacked = np.stack([f.to_numpy() for f in frames])  # (cities, hours, vars)
    mask = ~np.isnan(stacked)
    w = weights[:, None, None] * mask
    with np.errstate(invalid="ignore", divide="ignore"):
        avg = np.nansum(stacked * weights[:, None, None], axis=0) / w.sum(axis=0)
    out = pd.DataFrame(avg, index=frames[0].index, columns=list(VARIABLES.values()))
    out = out.round(2).dropna(how="all").rename_axis("ts_utc").reset_index()
    return out


def fetch_weather(start: date, end: date, url: str = HIST_FORECAST_URL, chunk_days: int = 120):
    settings = get_settings()
    frames = []
    with httpx.Client(timeout=settings.http_timeout) as client:
        chunk_start = start
        while chunk_start <= end:
            chunk_end = min(chunk_start + timedelta(days=chunk_days - 1), end)
            params = {
                "latitude": ",".join(str(c[1]) for c in CITIES),
                "longitude": ",".join(str(c[2]) for c in CITIES),
                "hourly": ",".join(VARIABLES),
                "start_date": chunk_start.isoformat(),
                "end_date": chunk_end.isoformat(),
                "timezone": "UTC",
            }
            frames.append(parse_open_meteo(get_json(client, url, params)))
            chunk_start = chunk_end + timedelta(days=1)
    if not frames:
        return pd.DataFrame(columns=COLUMNS)
    return pd.concat(frames).drop_duplicates("ts_utc", keep="last").reset_index(drop=True)
