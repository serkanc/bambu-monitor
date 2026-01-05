"""Server metadata helpers used by the HTTP API."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone


SERVER_START_TIME = time.time()
SERVER_START_DATETIME = datetime.fromtimestamp(SERVER_START_TIME, timezone.utc)


def get_server_start_time() -> datetime:
    """Return the UTC timestamp when the server started."""

    return SERVER_START_DATETIME


def get_uptime_seconds() -> float:
    """Return the number of seconds that have elapsed since startup."""

    return max(0.0, time.time() - SERVER_START_TIME)


def get_server_time() -> datetime:
    """Return the current UTC time."""

    return datetime.now(timezone.utc)


def format_uptime(seconds: float) -> str:
    """Render uptime as an HH:MM:SS-like string."""

    duration = timedelta(seconds=int(seconds))
    return str(duration)
