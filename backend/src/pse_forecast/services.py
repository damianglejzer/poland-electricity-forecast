"""Read-side logic behind the API (kept framework-free so it is easy to test)."""

from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import Engine, func, select

from pse_forecast import db
from pse_forecast.config import TZ, get_settings
from pse_forecast.features import (
    FEATURE_GROUPS,
    FEATURES,
    add_weather_derived,
    build_features,
    local_day_bounds_utc,
    set_day_type,
)
from pse_forecast.metrics import all_metrics
from pse_forecast.model_store import load_model
from pse_forecast.models import lgbm
from pse_forecast.sources.calendar import day_type, holiday_name

# When several prediction kinds exist for a slot, prefer the most honest one.
KIND_PRIORITY = {"forecast": 0, "backtest": 1, "insample": 2}
SOURCES = {"model": "model", "pse": "pse_fcst", "baseline": "baseline"}


def today() -> date:
    return datetime.now(TZ).date()


def _clean(value):
    if value is None:
        return None
    if isinstance(value, float | np.floating):
        return None if np.isnan(value) else round(float(value), 2)
    return value


def _local_iso(ts: pd.Timestamp) -> str:
    return ts.tz_convert(TZ).isoformat()


def _load_between(engine: Engine, lo: pd.Timestamp, hi: pd.Timestamp) -> pd.DataFrame:
    t = db.load
    return db.read_frame(
        engine,
        select(t.c.ts_utc, t.c.business_date, t.c.actual, t.c.pse_fcst)
        .where(t.c.ts_utc >= lo.to_pydatetime(), t.c.ts_utc < hi.to_pydatetime())
        .order_by(t.c.ts_utc),
    )


def _predictions_between(
    engine: Engine, lo: pd.Timestamp, hi: pd.Timestamp, kinds=("forecast", "backtest", "insample")
) -> pd.DataFrame:
    t = db.predictions
    df = db.read_frame(
        engine,
        select(t.c.ts_utc, t.c.kind, t.c.yhat).where(
            t.c.ts_utc >= lo.to_pydatetime(), t.c.ts_utc < hi.to_pydatetime(), t.c.kind.in_(kinds)
        ),
    )
    if df.empty:
        return pd.DataFrame(
            {"ts_utc": pd.Series(dtype="datetime64[ns, UTC]"), "kind": [], "yhat": []}
        )
    df["prio"] = df["kind"].map(KIND_PRIORITY)
    df = df.sort_values(["ts_utc", "prio"]).drop_duplicates("ts_utc", keep="first")
    return df.drop(columns="prio")


def combined(engine: Engine, start: date, end: date, kinds=None) -> pd.DataFrame:
    """Per-slot actual, PSE forecast, model prediction and 7-day-naive baseline for [start, end]."""
    lo, hi = local_day_bounds_utc(start, end)
    hist = _load_between(engine, lo - pd.Timedelta(days=7), hi)
    df = hist[hist["ts_utc"] >= lo].copy()
    base = hist.set_index("ts_utc")["actual"]
    df["baseline"] = base.reindex(df["ts_utc"] - pd.Timedelta(days=7)).to_numpy()
    preds = _predictions_between(engine, lo, hi, kinds or tuple(KIND_PRIORITY))
    df = df.merge(
        preds.rename(columns={"yhat": "model", "kind": "model_kind"}), on="ts_utc", how="left"
    )
    if df.empty:  # forecasts can exist for slots with no load row yet
        return df
    return df.sort_values("ts_utc").reset_index(drop=True)


def series(engine: Engine, start: date, days: int = 2) -> dict:
    end = start + timedelta(days=days - 1)
    df = combined(engine, start, end)
    points = [
        {
            "ts": _local_iso(r.ts_utc),
            "actual": _clean(r.actual),
            "pse": _clean(r.pse_fcst),
            "model": _clean(r.model),
            "baseline": _clean(r.baseline),
        }
        for r in df.itertuples()
    ]
    day_info = []
    for d in pd.date_range(start, end).date:
        kinds = df.loc[df["business_date"] == d, "model_kind"].dropna().unique().tolist()
        day_info.append(
            {
                "date": str(d),
                "model_kind": kinds[0] if kinds else None,
                "day_type": day_type(d),
                "holiday": holiday_name(d),
            }
        )
    return {"start": str(start), "end": str(end), "days": day_info, "points": points}


def _mape_frame(df: pd.DataFrame) -> pd.DataFrame:
    err = pd.DataFrame({"business_date": df["business_date"], "ts_utc": df["ts_utc"]})
    for name, col in SOURCES.items():
        err[name] = (df[col] - df["actual"]).abs() / df["actual"] * 100
    return err


def last_update(engine: Engine) -> dict:
    with engine.connect() as conn:
        refreshed = conn.execute(
            select(func.max(db.refresh_log.c.finished_at)).where(
                db.refresh_log.c.status.in_(["ok", "partial"])
            )
        ).scalar()
        data_until = conn.execute(
            select(func.max(db.load.c.ts_utc)).where(db.load.c.actual.is_not(None))
        ).scalar()
        rows = conn.execute(select(func.count()).select_from(db.load)).scalar()
        first_day = conn.execute(select(func.min(db.load.c.business_date))).scalar()
        last_day = conn.execute(select(func.max(db.load.c.business_date))).scalar()

    def iso(ts):
        if ts is None:
            return None
        return _local_iso(
            pd.Timestamp(ts).tz_localize("UTC") if ts.tzinfo is None else pd.Timestamp(ts)
        )

    return {
        "last_refresh": iso(refreshed),
        "actuals_until": iso(pd.Timestamp(data_until) + pd.Timedelta(minutes=15))
        if data_until
        else None,
        "rows": rows,
        "first_day": str(first_day) if first_day else None,
        "last_day": str(last_day) if last_day else None,
    }


def current_run(engine: Engine) -> dict | None:
    t = db.model_runs
    with engine.connect() as conn:
        row = (
            conn.execute(select(t).where(t.c.is_current.is_(True)).order_by(t.c.id.desc()).limit(1))
            .mappings()
            .first()
        )
    return _run_dict(row) if row else None


def _run_dict(row) -> dict:
    settings = get_settings()
    out = {k: row[k] for k in row if k not in ("importance",)}
    for k in ("train_start", "train_end", "test_start", "test_end"):
        out[k] = str(out[k]) if out[k] else None
    trained = pd.Timestamp(out["trained_at"])
    out["trained_at"] = _local_iso(trained if trained.tzinfo else trained.tz_localize("UTC"))
    out["mlflow_url"] = settings.mlflow_public_url or None
    if row["mlflow_run_id"] and settings.mlflow_public_url:
        out["mlflow_model_url"] = (
            f"{settings.mlflow_public_url}/#/models/{settings.registered_model_name}"
        )
    return out


def model_history(engine: Engine, limit: int = 10) -> list[dict]:
    t = db.model_runs
    with engine.connect() as conn:
        rows = conn.execute(select(t).order_by(t.c.id.desc()).limit(limit)).mappings().all()
    return [_run_dict(r) for r in rows]


def importance(engine: Engine) -> dict | None:
    t = db.model_runs
    with engine.connect() as conn:
        row = conn.execute(
            select(t.c.importance, t.c.model_version)
            .where(t.c.is_current.is_(True))
            .order_by(t.c.id.desc())
            .limit(1)
        ).first()
    if not row:
        return None
    return {"model_version": row.model_version, **row.importance}


def _latest_forecast_day(engine: Engine) -> str | None:
    with engine.connect() as conn:
        latest = conn.execute(
            select(func.max(db.predictions.c.business_date)).where(
                db.predictions.c.kind == "forecast"
            )
        ).scalar()
    return str(latest) if latest else None


def kpis(engine: Engine) -> dict:
    t0 = today()
    tomorrow = t0 + timedelta(days=1)
    out: dict = {"today": str(t0), "tomorrow": str(tomorrow), **last_update(engine)}

    run = current_run(engine)
    out["model_version"] = run["model_version"] if run else None
    latest = _latest_forecast_day(engine)
    out["latest_forecast_day"] = latest
    # Normally tomorrow; if the daily job has not run, the most recent day that has a forecast.
    focus = tomorrow if latest is None else min(tomorrow, date.fromisoformat(latest))
    out["forecast_day"] = str(focus)

    nxt = combined(engine, focus, focus)
    peak = None
    if not nxt.empty and nxt["model"].notna().any():
        i = nxt["model"].idxmax()
        peak = {"value": _clean(nxt.at[i, "model"]), "ts": _local_iso(nxt.at[i, "ts_utc"])}
        if nxt["pse_fcst"].notna().any():
            j = nxt["pse_fcst"].idxmax()
            peak["pse_value"] = _clean(nxt.at[j, "pse_fcst"])
            peak["pse_ts"] = _local_iso(nxt.at[j, "ts_utc"])
        peak["energy_gwh"] = _clean(nxt["model"].sum() / 4 / 1000)
    out["tomorrow_peak"] = peak

    # Accuracy over the last 30 days that have both actuals and out-of-sample predictions.
    acc = combined(
        engine, t0 - timedelta(days=30), t0 - timedelta(days=1), kinds=("forecast", "backtest")
    )
    acc = acc.dropna(subset=["actual", "model", "pse_fcst", "baseline"]) if not acc.empty else acc
    if acc.empty:
        out["accuracy_30d"] = None
    else:
        out["accuracy_30d"] = {
            name: _clean(all_metrics(acc["actual"], acc[col])["mape"])
            for name, col in SOURCES.items()
        }
        out["accuracy_30d"]["days"] = int(acc["business_date"].nunique())
    return out


def _evaluate(engine: Engine, start: date, end: date, kinds: tuple[str, ...]) -> dict:
    """Error of model, PSE and baseline on the same slots: summary, daily, by hour, by day type."""
    df = combined(engine, start, end, kinds=kinds) if start <= end else pd.DataFrame()
    if not df.empty:
        df = df.dropna(subset=["actual", "model", "pse_fcst", "baseline"])
    if df.empty:
        return {"available": False}

    err = _mape_frame(df)
    daily = err.groupby("business_date")[list(SOURCES)].mean().reset_index()
    local = err["ts_utc"].dt.tz_convert(TZ)
    by_hour = err.assign(hour=local.dt.hour).groupby("hour")[list(SOURCES)].mean().reset_index()
    err["day_type"] = err["business_date"].map(day_type)
    by_type = err.groupby("day_type").agg(
        **{s: (s, "mean") for s in SOURCES}, n_days=("business_date", "nunique")
    )
    by_type = by_type.reindex(["weekday", "weekend", "holiday"]).dropna(how="all").reset_index()

    summary = {name: all_metrics(df["actual"], df[col]) for name, col in SOURCES.items()}

    def rows(frame: pd.DataFrame) -> list[dict]:
        return [
            {k: _clean(v) if not isinstance(v, date) else str(v) for k, v in r.items()}
            for r in frame.to_dict("records")
        ]

    return {
        "available": True,
        "start": str(df["business_date"].min()),
        "end": str(df["business_date"].max()),
        "n_days": int(df["business_date"].nunique()),
        "summary": {k: {m: _clean(v) for m, v in vals.items()} for k, vals in summary.items()},
        "daily": rows(daily),
        "by_hour": rows(by_hour),
        "by_day_type": rows(by_type),
    }


def benchmark(engine: Engine, days: int | None = None) -> dict:
    """Out-of-sample evaluation: the held-out test window plus every live forecast since."""
    run = current_run(engine)
    if not run:
        return {"available": False}
    start = date.fromisoformat(run["test_start"])
    end = today() - timedelta(days=1)
    if days:
        start = max(start, end - timedelta(days=days - 1))
    return _evaluate(engine, start, end, ("forecast", "backtest"))


def track_record(engine: Engine) -> dict:
    """Only genuine day-ahead forecasts (made before the day started) vs what happened."""
    t = db.predictions
    with engine.connect() as conn:
        first = conn.execute(
            select(func.min(t.c.business_date)).where(t.c.kind == "forecast")
        ).scalar()
    if first is None:
        return {"available": False}
    first = first if isinstance(first, date) else date.fromisoformat(str(first))
    result = _evaluate(engine, first, today() - timedelta(days=1), ("forecast",))
    result["first_forecast"] = str(first)
    return result


# --------------------------------------------------------------------------- insights

_insights_cache: dict = {"key": None, "value": None}


def insights(engine: Engine) -> dict:
    """Simple facts about the data that explain why demand is predictable (cached per refresh)."""
    info = last_update(engine)
    key = (str(engine.url), info["last_refresh"], info["rows"])
    if _insights_cache["key"] == key:
        return _insights_cache["value"]

    end = today() - timedelta(days=1)
    lo, hi = local_day_bounds_utc(end - timedelta(days=364), end)
    load_df = _load_between(engine, lo, hi).dropna(subset=["actual"])
    if load_df.empty:
        return {"available": False}

    local = load_df["ts_utc"].dt.tz_convert(TZ)
    kinds = load_df["business_date"].map(day_type)
    dow = local.dt.dayofweek
    group = np.where(
        (kinds == "holiday") | (dow == 6), "sunday", np.where(dow == 5, "saturday", "weekday")
    )
    prof = load_df.assign(group=group, slot=(local.dt.hour * 4 + local.dt.minute // 15))
    profile = prof.groupby(["slot", "group"])["actual"].mean().unstack("group").round(0)
    profile_rows = [
        {
            "time": f"{slot // 4:02d}:{(slot % 4) * 15:02d}",
            **{g: _clean(profile.at[slot, g]) for g in profile.columns},
        }
        for slot in profile.index
    ]

    w = db.weather
    weather_df = db.read_frame(
        engine,
        select(w.c.ts_utc, w.c.temperature).where(
            w.c.ts_utc >= lo.to_pydatetime(), w.c.ts_utc < hi.to_pydatetime()
        ),
    )
    daily = load_df.groupby("business_date")["actual"].agg(["mean", "count"])
    daily = daily[daily["count"] >= 90]
    weather_df["business_date"] = weather_df["ts_utc"].dt.tz_convert(TZ).dt.date
    temp = weather_df.groupby("business_date")["temperature"].mean()
    scatter = [
        {
            "date": str(d),
            "temperature": _clean(temp.get(d)),
            "demand": _clean(round(row["mean"])),
            "day_type": day_type(d),
        }
        for d, row in daily.iterrows()
        if d in temp.index and not np.isnan(temp[d])
    ]
    value = {
        "available": True,
        "profile": profile_rows,
        "temperature": scatter,
        "coverage": {
            "first_day": info["first_day"],
            "last_day": info["last_day"],
            "rows": info["rows"],
        },
    }
    _insights_cache.update(key=key, value=value)
    return value


# --------------------------------------------------------------------------- what-if


def _radiation_factor(cloud: pd.Series) -> pd.Series:
    """Kasten-Czeplak clear-sky attenuation by cloud cover (0-100 %)."""
    return 1 - 0.75 * (cloud.clip(0, 100) / 100) ** 3.4


SHAP_STRIDE = 4
_shap_cache: dict[tuple, pd.DataFrame] = {}


def _base_shap(booster, version, target: date, base: pd.DataFrame) -> pd.DataFrame:
    key = (version, id(booster), target)
    if key not in _shap_cache:
        if len(_shap_cache) > 64:
            _shap_cache.clear()
        _shap_cache[key] = lgbm.shap_values(booster, base.iloc[::SHAP_STRIDE])
    return _shap_cache[key]


def whatif_default_date(engine: Engine) -> date:
    with engine.connect() as conn:
        latest = conn.execute(
            select(func.max(db.predictions.c.business_date)).where(
                db.predictions.c.kind == "forecast"
            )
        ).scalar()
    return latest or today() + timedelta(days=1)


def whatif(
    engine: Engine,
    target: date | None = None,
    temp_delta: float = 0.0,
    cloud_cover: float | None = None,
    holiday: bool | None = None,
    dow: int | None = None,
) -> dict:
    booster, meta = load_model(engine)
    if booster is None:
        raise LookupError("No model deployed yet.")
    target = target or whatif_default_date(engine)

    lo, hi = local_day_bounds_utc(target - timedelta(days=16), target)
    load_df = _load_between(engine, lo, hi)
    w = db.weather
    weather_df = db.read_frame(
        engine,
        select(w.c.ts_utc, w.c.temperature, w.c.cloud_cover, w.c.radiation, w.c.wind_speed).where(
            w.c.ts_utc >= (hi - pd.Timedelta(days=2)).to_pydatetime(),
            w.c.ts_utc < (hi + pd.Timedelta(hours=2)).to_pydatetime(),
        ),
    )
    base = build_features(load_df, weather_df, target, target)
    if base["temperature"].isna().all():
        raise ValueError(f"No weather data for {target}. Run a data refresh.")

    scen = base.copy()
    scen["temperature"] = scen["temperature"] + temp_delta
    if cloud_cover is not None:
        factor = _radiation_factor(pd.Series(cloud_cover, index=scen.index)) / _radiation_factor(
            scen["cloud_cover"]
        )
        scen["radiation"] = (scen["radiation"] * factor).clip(lower=0)
        scen["cloud_cover"] = float(cloud_cover)
    if holiday is not None:
        scen["is_holiday"] = int(holiday)
        if holiday:
            scen["is_bridge"] = 0
    if dow is not None:
        scen["dow"] = int(dow)
    scen = add_weather_derived(set_day_type(scen))

    yb = lgbm.predict(booster, base)
    ys = lgbm.predict(booster, scen)
    # TreeSHAP is the slow part (~1000 trees): explain one slot per hour, which is plenty for
    # day-average contributions, and cache the unchanged day so sliders only pay for the scenario.
    shap_b = _base_shap(booster, (meta or {}).get("model_version"), target, base)
    shap_s = lgbm.shap_values(booster, scen.iloc[::SHAP_STRIDE])
    contributions = sorted(
        (
            {
                "feature": f,
                "group": FEATURE_GROUPS[f],
                "base": round(float(shap_b[f].mean()), 1),
                "scenario": round(float(shap_s[f].mean()), 1),
                "delta": round(float((shap_s[f] - shap_b[f]).mean()), 1),
            }
            for f in FEATURES
        ),
        key=lambda r: -abs(r["scenario"]),
    )
    peak_b, peak_s = int(np.argmax(yb)), int(np.argmax(ys))
    return {
        "date": str(target),
        "model_version": (meta or {}).get("model_version"),
        "inputs": {
            "temperature_mean": _clean(base["temperature"].mean()),
            "cloud_cover_mean": _clean(base["cloud_cover"].mean()),
            "is_holiday": bool(base["is_holiday"].iloc[0]),
            "holiday_name": holiday_name(target),
            "dow": int(base["dow"].iloc[0]),
        },
        "points": [
            {"ts": _local_iso(ts), "base": round(float(b), 1), "scenario": round(float(s), 1)}
            for ts, b, s in zip(base["ts_utc"], yb, ys, strict=True)
        ],
        "summary": {
            "base_peak": round(float(yb[peak_b]), 1),
            "base_peak_ts": _local_iso(base["ts_utc"].iloc[peak_b]),
            "scenario_peak": round(float(ys[peak_s]), 1),
            "scenario_peak_ts": _local_iso(base["ts_utc"].iloc[peak_s]),
            "base_energy_gwh": round(float(yb.sum() / 4 / 1000), 2),
            "scenario_energy_gwh": round(float(ys.sum() / 4 / 1000), 2),
            "expected_value": round(float(shap_b["_base"].iloc[0]), 1),
        },
        "contributions": contributions,
    }
