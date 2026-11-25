from datetime import date, timedelta

import numpy as np
import pandas as pd

from pse_forecast.features import FEATURES, build_features, complete_days, slot_grid
from pse_forecast.sources.calendar import is_bridge, is_holiday
from tests.conftest import synthetic_load, synthetic_weather

START, END = date(2025, 3, 1), date(2025, 4, 10)


def _frame(target_start=date(2025, 3, 20), target_end=date(2025, 4, 10)):
    load_df = synthetic_load(START, END)
    return load_df, build_features(load_df, synthetic_weather(START, END), target_start, target_end)


def test_dst_days_have_92_and_100_slots():
    assert len(slot_grid(date(2025, 3, 30), date(2025, 3, 30))) == 92
    assert len(slot_grid(date(2025, 10, 26), date(2025, 10, 26))) == 100
    assert len(slot_grid(date(2025, 6, 1), date(2025, 6, 1))) == 96


def test_all_features_present_and_one_row_per_slot():
    _, df = _frame()
    assert set(FEATURES) <= set(df.columns)
    assert df["ts_utc"].is_unique


def test_lags_use_only_data_at_least_two_days_old():
    load_df, df = _frame()
    y = load_df.set_index("ts_utc")["actual"]
    row = df.iloc[500]
    assert row["lag_2d"] == y[row["ts_utc"] - pd.Timedelta(days=2)]
    assert row["lag_7d"] == y[row["ts_utc"] - pd.Timedelta(days=7)]
    d2 = row["business_date"] - timedelta(days=2)
    assert np.isclose(row["d2_mean"], load_df.loc[load_df["business_date"] == d2, "actual"].mean())


def test_no_leakage_when_future_actuals_change():
    """Changing demand on day D and D-1 must not change any feature of day D."""
    load_df = synthetic_load(START, END)
    target = date(2025, 4, 2)
    base = build_features(load_df, synthetic_weather(START, END), target, target)
    tampered = load_df.copy()
    mask = tampered["business_date"].isin([target, target - timedelta(days=1)])
    tampered.loc[mask, "actual"] = 99_999.0
    after = build_features(tampered, synthetic_weather(START, END), target, target)
    pd.testing.assert_frame_equal(base[FEATURES], after[FEATURES])


def test_weather_is_interpolated_to_15_minutes():
    _, df = _frame()
    assert df["temperature"].notna().all()
    assert (df["hdd"] >= 0).all() and (df["cdd"] >= 0).all()


def test_polish_calendar():
    assert is_holiday(date(2025, 11, 11))  # Independence Day
    assert is_holiday(date(2025, 5, 3))  # Constitution Day
    assert not is_holiday(date(2025, 11, 12))
    assert is_bridge(date(2025, 5, 2))  # Friday between 1 May (Thu) and the weekend
    assert not is_bridge(date(2025, 5, 5))


def test_complete_days_ignores_partial_day():
    load_df = synthetic_load(date(2025, 1, 1), date(2025, 1, 3))
    load_df.loc[load_df.index[-10:], "actual"] = np.nan
    assert complete_days(load_df) == [date(2025, 1, 1), date(2025, 1, 2)]
