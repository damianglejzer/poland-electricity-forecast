"""Seasonal-naive baseline: demand in the same quarter-hour exactly one week earlier."""

import pandas as pd


def predict(features: pd.DataFrame) -> pd.Series:
    return features["lag_7d"]
