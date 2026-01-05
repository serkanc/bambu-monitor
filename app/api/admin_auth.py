"""Admin auth helpers with rate limiting and allowlist."""
from __future__ import annotations

import time
from collections import deque
from typing import Deque, Dict

from fastapi import Request

from app.core.config import get_app_config
from app.core.exceptions import ForbiddenError, UnauthorizedError, TooManyRequestsError


_rate_window_s = 60
_rate_limit = 5
_hits: Dict[str, Deque[float]] = {}


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce_admin(request: Request) -> str:
    config = get_app_config()
    admin_token = config.admin_token or ""
    if not admin_token:
        raise UnauthorizedError("Admin token not configured")

    ip = _client_ip(request)
    allowlist = config.admin_allowlist or []
    if allowlist and ip not in allowlist:
        raise ForbiddenError("IP not allowed")

    now = time.time()
    bucket = _hits.setdefault(ip, deque())
    while bucket and now - bucket[0] > _rate_window_s:
        bucket.popleft()
    if len(bucket) >= _rate_limit:
        raise TooManyRequestsError("Rate limit exceeded")
    bucket.append(now)

    auth_header = request.headers.get("authorization", "")
    api_key = request.headers.get("x-admin-token", "")
    provided = ""
    if auth_header.lower().startswith("bearer "):
        provided = auth_header[7:].strip()
    elif api_key:
        provided = api_key.strip()
    if not provided:
        raise UnauthorizedError("Missing admin token")
    if provided != admin_token:
        raise UnauthorizedError("Invalid admin token")
    return ip
