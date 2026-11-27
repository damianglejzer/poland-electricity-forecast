"""Database schema and small helpers (SQLAlchemy Core, works on Postgres and SQLite)."""

import ipaddress
import socket
from collections.abc import Iterable
from functools import lru_cache

import pandas as pd
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Engine,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    select,
)
from sqlalchemy.engine import make_url
from sqlalchemy.pool import StaticPool

from pse_forecast.config import get_settings

metadata = MetaData()

# 15-minute national demand: actual (target) and PSE's official day-ahead forecast (benchmark).
load = Table(
    "load",
    metadata,
    Column("ts_utc", DateTime(timezone=True), primary_key=True),  # interval start, UTC
    Column("business_date", Date, nullable=False, index=True),  # local (Europe/Warsaw) date
    Column("actual", Float),
    Column("pse_fcst", Float),
    Column("updated_at", DateTime(timezone=True)),
)

# Hourly population-weighted weather for Poland.
weather = Table(
    "weather",
    metadata,
    Column("ts_utc", DateTime(timezone=True), primary_key=True),
    Column("temperature", Float),
    Column("cloud_cover", Float),
    Column("radiation", Float),
    Column("wind_speed", Float),
    Column("source", String(16)),
    Column("updated_at", DateTime(timezone=True)),
)

# Model output. kind: forecast (ex-ante, production model), backtest (out-of-sample), insample.
predictions = Table(
    "predictions",
    metadata,
    Column("ts_utc", DateTime(timezone=True), primary_key=True),
    Column("kind", String(16), primary_key=True),
    Column("business_date", Date, nullable=False, index=True),
    Column("yhat", Float),
    Column("model_version", String(64)),
    Column("created_at", DateTime(timezone=True)),
)

model_runs = Table(
    "model_runs",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("model_version", String(64), nullable=False),
    Column("mlflow_run_id", String(64)),
    Column("trained_at", DateTime(timezone=True), nullable=False),
    Column("train_start", Date),
    Column("train_end", Date),
    Column("test_start", Date),
    Column("test_end", Date),
    Column("n_train", Integer),
    Column("params", JSON),
    Column("metrics", JSON),
    Column("importance", JSON),
    Column("is_current", Boolean, default=False),
)

# Serialized LightGBM boosters. Keeping the model in the database means any API instance
# (e.g. a stateless free-tier container) can serve the current model without a disk.
model_artifacts = Table(
    "model_artifacts",
    metadata,
    Column("model_version", String(64), primary_key=True),
    Column("created_at", DateTime(timezone=True)),
    Column("model_text", Text, nullable=False),
)

refresh_log = Table(
    "refresh_log",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("started_at", DateTime(timezone=True), nullable=False),
    Column("finished_at", DateTime(timezone=True)),
    Column("status", String(16), nullable=False),
    Column("message", Text),
    Column("rows_load", Integer),
    Column("rows_weather", Integer),
)


def normalize_url(url: str) -> str:
    """Accept plain `postgres://` / `postgresql://` URLs, as shown by Neon or Render."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


def get_engine(url: str | None = None) -> Engine:
    return _engine(normalize_url(url or get_settings().database_url))


def reset_engines() -> None:
    _engine.cache_clear()


def ipv4_connect_args(url: str) -> dict:
    """Pin an IPv4 address for a dual-stack database host such as Neon.

    Docker's default network and GitHub's runners have no IPv6 route, yet the driver may try only
    a host's IPv6 addresses and fail with "Network is unreachable". libpq connects to `hostaddr`
    while still using the host name for TLS (SNI), which Neon needs to route the connection.
    """
    host = make_url(url).host
    if not host:
        return {}
    try:
        ipaddress.ip_address(host)
        return {}  # already an IP address
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)
    except OSError:
        return {}  # let the driver report the problem
    return {"hostaddr": infos[0][4][0]} if infos else {}


@lru_cache
def _engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    else:
        # Pre-ping and recycle: serverless Postgres (Neon) closes idle connections when it sleeps.
        engine = create_engine(
            url,
            connect_args=ipv4_connect_args(url),
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            pool_recycle=300,
            pool_timeout=10,
        )
    if get_settings().manage_schema:
        metadata.create_all(engine)
    return engine


def _records(df: pd.DataFrame) -> list[dict]:
    """DataFrame -> list of dicts with NaN/NaT converted to None."""
    out = df.astype(object).where(df.notna(), None)
    return out.to_dict("records")


def upsert(
    engine: Engine,
    table: Table,
    rows: pd.DataFrame | Iterable[dict],
    keys: list[str],
    overwrite: bool = True,
) -> int:
    """Insert rows; on a key conflict update the row (or keep the old one if not `overwrite`)."""
    records = _records(rows) if isinstance(rows, pd.DataFrame) else list(rows)
    if not records:
        return 0
    if engine.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    stmt = insert(table)
    update_cols = {c: stmt.excluded[c] for c in records[0] if c not in keys}
    if overwrite and update_cols:
        stmt = stmt.on_conflict_do_update(index_elements=keys, set_=update_cols)
    else:
        stmt = stmt.on_conflict_do_nothing(index_elements=keys)
    with engine.begin() as conn:
        for i in range(0, len(records), 5000):
            conn.execute(stmt, records[i : i + 5000])
    return len(records)


def read_frame(engine: Engine, stmt) -> pd.DataFrame:
    with engine.connect() as conn:
        df = pd.read_sql(stmt, conn)
    if "ts_utc" in df.columns:
        df["ts_utc"] = pd.to_datetime(df["ts_utc"], utc=True)
    if "business_date" in df.columns:
        df["business_date"] = pd.to_datetime(df["business_date"]).dt.date
    return df


def read_load(engine: Engine) -> pd.DataFrame:
    return read_frame(
        engine,
        select(load.c.ts_utc, load.c.business_date, load.c.actual, load.c.pse_fcst).order_by(
            load.c.ts_utc
        ),
    )


def read_weather(engine: Engine) -> pd.DataFrame:
    return read_frame(
        engine,
        select(
            weather.c.ts_utc,
            weather.c.temperature,
            weather.c.cloud_cover,
            weather.c.radiation,
            weather.c.wind_speed,
        ).order_by(weather.c.ts_utc),
    )
