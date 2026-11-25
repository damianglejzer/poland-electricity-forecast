"""Basic data-quality checks with Pandera: bad data fails loudly instead of corrupting training."""

import pandas as pd
import pandera.pandas as pa

_load_schema = pa.DataFrameSchema(
    {
        "ts_utc": pa.Column("datetime64[ns, UTC]", unique=True),
        "business_date": pa.Column(object),
        # Polish net demand is ~10-30 GW; wider bounds catch unit errors (kW vs MW) or zeros.
        "actual": pa.Column(float, pa.Check.in_range(5_000, 40_000), nullable=True),
        "pse_fcst": pa.Column(float, pa.Check.in_range(5_000, 40_000), nullable=True),
    },
    checks=[
        pa.Check(
            lambda df: (df["ts_utc"].dt.minute % 15 == 0).all(),
            error="timestamps must be on the 15-minute grid",
        )
    ],
    coerce=True,
)

_weather_schema = pa.DataFrameSchema(
    {
        "ts_utc": pa.Column("datetime64[ns, UTC]", unique=True),
        "temperature": pa.Column(float, pa.Check.in_range(-40, 45), nullable=True),
        "cloud_cover": pa.Column(float, pa.Check.in_range(0, 100), nullable=True),
        "radiation": pa.Column(float, pa.Check.in_range(0, 1400), nullable=True),
        "wind_speed": pa.Column(float, pa.Check.in_range(0, 200), nullable=True),
    },
    coerce=True,
)


def validate_load(df: pd.DataFrame) -> pd.DataFrame:
    return _load_schema.validate(df, lazy=True)


def validate_weather(df: pd.DataFrame) -> pd.DataFrame:
    return _weather_schema.validate(df, lazy=True)
