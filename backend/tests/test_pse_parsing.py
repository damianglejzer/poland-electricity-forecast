import json
from datetime import date
from pathlib import Path

import pandas as pd

from pse_forecast.sources.pse import parse_kse_load
from pse_forecast.validation import validate_load

FIXTURE = Path(__file__).parent / "fixtures" / "kse_load_2025-10-26.json"


def test_parse_dst_day_has_100_unique_slots():
    rows = json.loads(FIXTURE.read_text())["value"]
    df = parse_kse_load(rows)
    assert len(df) == 100  # autumn DST change: 25 hours
    assert df["ts_utc"].is_unique
    assert (df["ts_utc"].diff().dropna() == pd.Timedelta(minutes=15)).all()
    assert set(df["business_date"]) == {date(2025, 10, 26)}
    # dtime_utc is the interval END; we store the START
    assert df["ts_utc"].iloc[0] == pd.Timestamp("2025-10-25 22:00", tz="UTC")


def test_parsed_values_pass_validation():
    df = validate_load(parse_kse_load(json.loads(FIXTURE.read_text())["value"]))
    assert df["actual"].between(8_000, 30_000).all()
    assert df["pse_fcst"].notna().all()


def test_parse_handles_missing_actuals_and_empty():
    rows = json.loads(FIXTURE.read_text())["value"][:4]
    rows[0]["load_actual"] = None
    df = parse_kse_load(rows)
    assert df["actual"].isna().sum() == 1
    assert parse_kse_load([]).empty
