"""Train, evaluate, register and deploy the forecasting model.

1. Time-based split: the last `test_days` complete days are held out (never seen in training).
2. Number of boosting rounds is chosen by early stopping on the 30 days before the test window.
3. The evaluation model is scored on the test window against the baseline and PSE's forecast.
4. A production model is refit on all labelled data and forecasts today and tomorrow.
5. Everything is logged to MLflow; the model is registered and aliased `production`.
6. The booster is stored in the database, where the API and the daily forecast job load it.

Training runs offline (on the author's machine), never inside the public API.
"""

import json
import logging
from datetime import UTC, datetime, timedelta

import httpx
import pandas as pd
from sqlalchemy import delete, update

from pse_forecast import db
from pse_forecast.config import DATA_START, get_settings
from pse_forecast.features import FEATURE_GROUPS, FEATURES, build_features, complete_days
from pse_forecast.forecast import prediction_rows, store_forecasts
from pse_forecast.metrics import all_metrics
from pse_forecast.model_store import save_model
from pse_forecast.models import baseline, lgbm

log = logging.getLogger(__name__)
VALID_DAYS = 30


def _importance(booster, test: pd.DataFrame) -> dict:
    gain = booster.feature_importance(importance_type="gain")
    gain = gain / gain.sum()
    shap = lgbm.shap_values(booster, test)[FEATURES].abs().mean()
    features = sorted(
        (
            {
                "feature": f,
                "group": FEATURE_GROUPS[f],
                "gain": float(g),
                "mean_abs_shap": float(shap[f]),
            }
            for f, g in zip(FEATURES, gain, strict=True)
        ),
        key=lambda r: -r["mean_abs_shap"],
    )
    groups: dict[str, float] = {}
    for r in features:
        groups[r["group"]] = groups.get(r["group"], 0.0) + r["mean_abs_shap"]
    return {"features": features, "groups": groups}


def _mlflow_available(uri: str) -> bool:
    try:
        return httpx.get(f"{uri}/health", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


def _log_to_mlflow(booster, params, metrics, importance, info, example: pd.DataFrame):
    """Returns (run_id, model_version) or (None, None) if MLflow is unavailable."""
    settings = get_settings()
    if not _mlflow_available(settings.mlflow_tracking_uri):
        log.warning("MLflow not reachable at %s; skipping tracking", settings.mlflow_tracking_uri)
        return None, None
    import mlflow
    import mlflow.lightgbm
    from mlflow import MlflowClient

    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment)
    with mlflow.start_run(run_name=f"lgbm-{datetime.now(UTC):%Y%m%d-%H%M}") as run:
        mlflow.log_params(params)
        mlflow.log_params({k: str(v) for k, v in info.items()})
        mlflow.log_metrics(metrics)
        mlflow.log_dict(importance, "feature_importance.json")
        mlflow.lightgbm.log_model(
            booster,
            artifact_path="model",
            registered_model_name=settings.registered_model_name,
            input_example=example,
        )
    client = MlflowClient()
    mv = client.search_model_versions(f"run_id='{run.info.run_id}'")[0]
    client.set_registered_model_alias(settings.registered_model_name, "production", mv.version)
    return run.info.run_id, f"v{mv.version}"


def train(engine=None, test_days: int | None = None) -> dict:
    settings = get_settings()
    engine = engine or db.get_engine()
    test_days = test_days or settings.test_days

    load_df = db.read_load(engine)
    weather_df = db.read_weather(engine)
    days = complete_days(load_df)
    if len(days) < test_days + VALID_DAYS + 60:
        raise RuntimeError(
            f"Not enough data to train ({len(days)} complete days). Run `make refresh` first."
        )
    last_complete = days[-1]
    frame = build_features(load_df, weather_df, DATA_START, load_df["business_date"].max())

    labelled = frame[
        (frame["business_date"] <= last_complete)
        & frame["actual"].notna()
        & frame["lag_14d"].notna()
    ]
    test_start = last_complete - timedelta(days=test_days - 1)
    valid_start = test_start - timedelta(days=VALID_DAYS)
    train_df = labelled[labelled["business_date"] < test_start]
    test_df = labelled[labelled["business_date"] >= test_start].copy()

    n_rounds = lgbm.find_num_rounds(
        train_df[train_df["business_date"] < valid_start],
        train_df[train_df["business_date"] >= valid_start],
    )
    log.info("Early stopping chose %d rounds", n_rounds)
    eval_model = lgbm.fit(train_df, n_rounds)

    test_df["model"] = lgbm.predict(eval_model, test_df)
    test_df["baseline"] = baseline.predict(test_df)
    scored = test_df.dropna(subset=["actual", "model", "baseline", "pse_fcst"])
    metrics = {}
    for source, col in (("model", "model"), ("pse", "pse_fcst"), ("baseline", "baseline")):
        for name, value in all_metrics(scored["actual"], scored[col]).items():
            metrics[f"{source}_{name}"] = round(value, 4)
    log.info("Test metrics: %s", metrics)
    importance = _importance(eval_model, test_df)

    # Production model: same hyper-parameters, refit on everything we know.
    prod_model = lgbm.fit(labelled, n_rounds)
    future = frame[frame["business_date"] > last_complete]
    future = future[future["lag_2d"].notna() | future["d2_mean"].notna()]

    info = {
        "train_start": train_df["business_date"].min(),
        "train_end": train_df["business_date"].max(),
        "test_start": test_start,
        "test_end": last_complete,
        "n_train": len(train_df),
        "n_test": len(scored),
    }
    params = {**lgbm.PARAMS, "num_boost_round": n_rounds, "features": len(FEATURES)}
    run_id, version = None, None
    try:
        run_id, version = _log_to_mlflow(
            prod_model, params, metrics, importance, info, future[FEATURES].head(3)
        )
    except Exception:
        log.exception("MLflow logging failed; continuing with a local model version")
    version = version or f"local-{datetime.now(UTC):%Y%m%d%H%M}"
    save_model(engine, prod_model, version)

    # Evaluation predictions are replaced by each run; ex-ante forecasts are an append-only record.
    evaluation = pd.concat(
        [
            prediction_rows(test_df, test_df["model"].to_numpy(), "backtest", version),
            prediction_rows(train_df, lgbm.predict(eval_model, train_df), "insample", version),
        ]
    )
    with engine.begin() as conn:
        conn.execute(
            delete(db.predictions).where(db.predictions.c.kind.in_(["backtest", "insample"]))
        )
        conn.execute(update(db.model_runs).values(is_current=False))
    db.upsert(engine, db.predictions, evaluation, ["ts_utc", "kind"])
    with engine.begin() as conn:
        conn.execute(
            db.model_runs.insert().values(
                model_version=version,
                mlflow_run_id=run_id,
                trained_at=datetime.now(UTC),
                train_start=info["train_start"],
                train_end=info["train_end"],
                test_start=test_start,
                test_end=last_complete,
                n_train=len(train_df),
                params=json.loads(json.dumps(params)),
                metrics=metrics,
                importance=importance,
                is_current=True,
            )
        )
    forecast_days = store_forecasts(
        engine, prediction_rows(future, lgbm.predict(prod_model, future), "forecast", version)
    )
    return {
        "model_version": version,
        "mlflow_run_id": run_id,
        "metrics": metrics,
        "test_start": str(test_start),
        "test_end": str(last_complete),
        "forecast_days": forecast_days,
    }
