"""Taipei business-time helpers for inventory movement timestamps."""
from __future__ import annotations

import datetime as dt

TAIPEI_TZ = dt.timezone(dt.timedelta(hours=8))
SQL_DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def now_sql() -> str:
    """Return current Taiwan business time in SQLite-comparable format."""
    return dt.datetime.now(dt.timezone.utc).astimezone(TAIPEI_TZ).strftime(SQL_DATETIME_FORMAT)


def datetime_to_sql(value: dt.datetime) -> str:
    """Format a local business datetime for movement storage/query."""
    return value.replace(microsecond=0).strftime(SQL_DATETIME_FORMAT)


def normalize_user_datetime(value: str) -> str:
    """Normalize a user-provided local date/datetime to the SQL format."""
    raw = value.strip().replace("T", " ")
    if len(raw) == 10:
        raw += " 00:00:00"
    elif len(raw) == 16:
        raw += ":00"
    try:
        parsed = dt.datetime.fromisoformat(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("日期格式需為 YYYY-MM-DD 或 YYYY-MM-DD HH:MM[:SS]") from exc
    if parsed.tzinfo is not None:
        raise ValueError("movement datetime 必須使用本地時間，不接受 timezone offset")
    return parsed.strftime(SQL_DATETIME_FORMAT)
