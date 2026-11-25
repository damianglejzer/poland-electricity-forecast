import numpy as np
import pandas as pd


def mape(y: pd.Series, yhat: pd.Series) -> float:
    return float(np.mean(np.abs((y - yhat) / y)) * 100)


def mae(y: pd.Series, yhat: pd.Series) -> float:
    return float(np.mean(np.abs(y - yhat)))


def rmse(y: pd.Series, yhat: pd.Series) -> float:
    return float(np.sqrt(np.mean((y - yhat) ** 2)))


def all_metrics(y: pd.Series, yhat: pd.Series) -> dict[str, float]:
    return {"mape": mape(y, yhat), "mae": mae(y, yhat), "rmse": rmse(y, yhat)}
