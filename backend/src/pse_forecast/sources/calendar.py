"""Polish public holidays and derived calendar flags."""

from collections.abc import Iterable
from datetime import date, timedelta
from functools import lru_cache

import holidays


@lru_cache
def _holidays(year: int) -> dict[date, str]:
    return dict(holidays.Poland(years=year))


def is_holiday(d: date) -> bool:
    return d in _holidays(d.year)


def holiday_name(d: date) -> str | None:
    return _holidays(d.year).get(d)


def _is_off(d: date) -> bool:
    return d.weekday() >= 5 or is_holiday(d)


def is_bridge(d: date) -> bool:
    """A working day squeezed between a holiday and a weekend (many people take it off)."""
    if _is_off(d):
        return False
    prev_off, next_off = _is_off(d - timedelta(days=1)), _is_off(d + timedelta(days=1))
    prev_hol, next_hol = is_holiday(d - timedelta(days=1)), is_holiday(d + timedelta(days=1))
    return (prev_off and next_off) and (prev_hol or next_hol)


def is_xmas_period(d: date) -> bool:
    return (d.month == 12 and d.day >= 24) or (d.month == 1 and d.day <= 6)


def day_type(d: date, holiday: bool | None = None) -> str:
    holiday = is_holiday(d) if holiday is None else holiday
    if holiday:
        return "holiday"
    return "weekend" if d.weekday() >= 5 else "weekday"


def calendar_table(dates: Iterable[date]) -> dict[date, dict]:
    return {
        d: {
            "is_holiday": int(is_holiday(d)),
            "is_bridge": int(is_bridge(d)),
            "is_xmas": int(is_xmas_period(d)),
        }
        for d in dates
    }
