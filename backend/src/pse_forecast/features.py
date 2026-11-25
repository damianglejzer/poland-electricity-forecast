"""Feature engineering for next-day 15-minute demand forecasting.

Forecast setting: the forecast for day D is made on the morning of D-1 (like PSE's own forecast).
Therefore every demand-based feature uses data that is at least 48 hours old, so the model never
sees demand from D-1 or D itself (no leakage, and it works in production).
"""

from datetime import date, datetime, time, timedelta

import numpy as np
import pandas as pd

from pse_forecast.config import TZ
from pse_forecast.sources.calendar import calendar_table

CALENDAR_FEATURES = [
    "slot",
    "slot_sin",
    "slot_cos",
    "dow",
    "is_weekend",
    "is_holiday",
    "is_bridge",
    "is_xmas",
    "day_type",
    "month",
    "doy_sin",
    "doy_cos",
]
LAG_FEATURES = ["lag_2d", "lag_7d", "lag_14d", "d2_mean", "d2_max", "d7_mean"]
WEATHER_FEATURES = [
    "temperature",
    "cloud_cover",
    "radiation",
    "wind_speed",
    "temp_day_mean",
    "hdd",
    "cdd",
]
FEATURES = CALENDAR_FEATURES + LAG_FEATURES + WEATHER_FEATURES
FEATURE_GROUPS = {
    **dict.fromkeys(CALENDAR_FEATURES, "calendar"),
    **dict.fromkeys(LAG_FEATURES, "recent demand"),
    **dict.fromkeys(WEATHER_FEATURES, "weather"),
}

HDD_BASE, CDD_BASE = 15.0, 22.0
# Minimum quarter-hours for a day to count as "complete" (DST spring day has 92).
MIN_SLOTS_PER_DAY = 92


def local_day_bounds_utc(start: date, end: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """UTC instants of local midnight at `start` and local midnight after `end`."""
    lo = datetime.combine(start, time(0), tzinfo=TZ)
    hi = datetime.combine(end + timedelta(days=1), time(0), tzinfo=TZ)
    return pd.Timestamp(lo).tz_convert("UTC"), pd.Timestamp(hi).tz_convert("UTC")


def slot_grid(start: date, end: date) -> pd.DatetimeIndex:
    lo, hi = local_day_bounds_utc(start, end)
    return pd.date_range(lo, hi, freq="15min", inclusive="left", name="ts_utc")


def complete_days(load_df: pd.DataFrame) -> list[date]:
    counts = load_df.dropna(subset=["actual"]).groupby("business_date").size()
    return sorted(counts[counts >= MIN_SLOTS_PER_DAY].index)


def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    """Calendar features from `ts_utc` (local-time based). Modifies and returns df."""
    local = df["ts_utc"].dt.tz_convert(TZ)
    df["business_date"] = local.dt.date
    slot = local.dt.hour * 4 + local.dt.minute // 15
    df["slot"] = slot
    df["slot_sin"] = np.sin(2 * np.pi * slot / 96)
    df["slot_cos"] = np.cos(2 * np.pi * slot / 96)
    df["dow"] = local.dt.dayofweek
    df["month"] = local.dt.month
    doy = local.dt.dayofyear
    df["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    df["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
    cal = calendar_table(df["business_date"].unique())
    for col in ("is_holiday", "is_bridge", "is_xmas"):
        df[col] = df["business_date"].map(lambda d, c=col: cal[d][c])
    return set_day_type(df)


def set_day_type(df: pd.DataFrame) -> pd.DataFrame:
    df["is_weekend"] = (df["dow"] >= 5).astype(int)
    # 0 working day, 1 Saturday, 2 Sunday or public holiday
    df["day_type"] = np.where(
        (df["is_holiday"] == 1) | (df["dow"] == 6), 2, np.where(df["dow"] == 5, 1, 0)
    )
    return df


def _daily_stat(y: pd.Series, local_dates: pd.Series, how: str) -> pd.Series:
    grouped = y.groupby(local_dates.values)
    stat = grouped.agg(how)
    stat[grouped.count() < MIN_SLOTS_PER_DAY] = np.nan
    return stat


def build_features(
    load_df: pd.DataFrame, weather_df: pd.DataFrame, start: date, end: date
) -> pd.DataFrame:
    """One row per 15-minute slot for local dates [start, end] with target and features.

    load_df: ts_utc, business_date, actual, pse_fcst   weather_df: hourly ts_utc + weather columns
    """
    grid = slot_grid(start, end)
    df = pd.DataFrame({"ts_utc": grid})

    y = load_df.set_index("ts_utc")["actual"].astype(float)
    y = y[~y.index.duplicated(keep="last")].sort_index()
    pse_fcst = load_df.set_index("ts_utc")["pse_fcst"]
    pse_fcst = pse_fcst[~pse_fcst.index.duplicated(keep="last")]
    df["actual"] = y.reindex(grid).to_numpy()
    df["pse_fcst"] = pse_fcst.reindex(grid).to_numpy()

    df = add_calendar_features(df)

    # Same-slot lags. Shifting in UTC is off by one hour on DST-change days only (negligible).
    for days in (2, 7, 14):
        df[f"lag_{days}d"] = y.reindex(grid - pd.Timedelta(days=days)).to_numpy()

    # Daily level of demand two and seven days back (complete local days only).
    y_local_dates = pd.Series(y.index.tz_convert(TZ).date, index=y.index)
    daily_mean = _daily_stat(y, y_local_dates, "mean")
    daily_max = _daily_stat(y, y_local_dates, "max")
    d2 = df["business_date"].map(lambda d: d - timedelta(days=2))
    d7 = df["business_date"].map(lambda d: d - timedelta(days=7))
    df["d2_mean"] = d2.map(daily_mean).astype(float)
    df["d2_max"] = d2.map(daily_max).astype(float)
    df["d7_mean"] = d7.map(daily_mean).astype(float)

    # Weather: hourly -> 15-minute by time interpolation.
    weather_cols = ["temperature", "cloud_cover", "radiation", "wind_speed"]
    if weather_df.empty:
        for c in weather_cols:
            df[c] = np.nan
    else:
        w = weather_df.set_index("ts_utc")[weather_cols].astype(float).sort_index()
        w = w[~w.index.duplicated(keep="last")]
        w15 = w.reindex(w.index.union(grid)).interpolate("time", limit=8, limit_area="inside")
        w15 = w15.reindex(grid)
        for c in weather_cols:
            df[c] = w15[c].to_numpy()
    df = add_weather_derived(df)
    return df


def add_weather_derived(df: pd.DataFrame) -> pd.DataFrame:
    df["temp_day_mean"] = df.groupby("business_date")["temperature"].transform("mean")
    df["hdd"] = (HDD_BASE - df["temperature"]).clip(lower=0)
    df["cdd"] = (df["temperature"] - CDD_BASE).clip(lower=0)
    return df
