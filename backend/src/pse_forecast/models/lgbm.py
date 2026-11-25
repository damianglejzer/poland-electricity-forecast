"""LightGBM regressor wrapper: training with early stopping, prediction and SHAP values."""

import lightgbm as lgb
import numpy as np
import pandas as pd

from pse_forecast.features import FEATURES

PARAMS = {
    "objective": "regression_l1",  # MAE objective: robust and aligned with MAPE-style metrics
    "learning_rate": 0.03,
    "num_leaves": 63,
    "min_data_in_leaf": 40,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbose": -1,
    "num_threads": 4,
    "seed": 42,
}
MAX_ROUNDS = 3000
CATEGORICAL = ["dow", "day_type"]


def _dataset(df: pd.DataFrame, reference=None) -> lgb.Dataset:
    return lgb.Dataset(
        df[FEATURES],
        label=df["actual"],
        categorical_feature=CATEGORICAL,
        reference=reference,
        free_raw_data=False,
    )


def find_num_rounds(train: pd.DataFrame, valid: pd.DataFrame) -> int:
    """Early stopping on a validation block that follows the training block in time."""
    dtrain = _dataset(train)
    dvalid = _dataset(valid, reference=dtrain)
    booster = lgb.train(
        PARAMS,
        dtrain,
        num_boost_round=MAX_ROUNDS,
        valid_sets=[dvalid],
        callbacks=[lgb.early_stopping(100, verbose=False)],
    )
    return max(booster.best_iteration, 50)


def fit(train: pd.DataFrame, num_rounds: int) -> lgb.Booster:
    return lgb.train(PARAMS, _dataset(train), num_boost_round=num_rounds)


def predict(booster: lgb.Booster, df: pd.DataFrame) -> np.ndarray:
    return booster.predict(df[FEATURES])


def shap_values(booster: lgb.Booster, df: pd.DataFrame) -> pd.DataFrame:
    """TreeSHAP contributions (built into LightGBM). Last column is the expected value."""
    contrib = booster.predict(df[FEATURES], pred_contrib=True)
    return pd.DataFrame(contrib, columns=[*FEATURES, "_base"], index=df.index)
