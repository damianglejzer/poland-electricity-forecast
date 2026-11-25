import pandas as pd
import pandera.errors
import pytest

from pse_forecast.validation import validate_load, validate_weather


def _load(**overrides):
    df = pd.DataFrame(
        {
            "ts_utc": pd.date_range("2025-01-01", periods=4, freq="15min", tz="UTC"),
            "business_date": [pd.Timestamp("2025-01-01").date()] * 4,
            "actual": [15000.0, 15100.0, None, 15300.0],
            "pse_fcst": [15050.0] * 4,
        }
    )
    return df.assign(**overrides)


def test_valid_load_passes():
    assert len(validate_load(_load())) == 4


def test_out_of_range_demand_fails():
    with pytest.raises(pandera.errors.SchemaErrors):
        validate_load(_load(actual=[15.0, 15.1, 15.2, 15.3]))  # GW instead of MW


def test_off_grid_timestamp_fails():
    df = _load()
    df.loc[1, "ts_utc"] = df.loc[1, "ts_utc"] + pd.Timedelta(minutes=7)
    with pytest.raises(pandera.errors.SchemaErrors):
        validate_load(df)


def test_weather_cloud_cover_range():
    df = pd.DataFrame(
        {
            "ts_utc": pd.date_range("2025-01-01", periods=2, freq="1h", tz="UTC"),
            "temperature": [1.0, 2.0],
            "cloud_cover": [50.0, 150.0],
            "radiation": [0.0, 0.0],
            "wind_speed": [3.0, 3.0],
        }
    )
    with pytest.raises(pandera.errors.SchemaErrors):
        validate_weather(df)
