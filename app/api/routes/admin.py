"""Admin endpoints for operational maintenance."""
from __future__ import annotations

import logging
import secrets
from typing import Any

from fastapi import APIRouter, Depends, Request

from app.api.admin_auth import enforce_admin
from app.api.dependencies import get_service_registry
from app.core.config import get_app_config, update_app_config
from app.core.exceptions import BadRequestError
from app.services.registry import ServiceRegistry

logger = logging.getLogger("admin_audit")

router = APIRouter(prefix="/admin", tags=["admin"])


def _audit(action: str, *, ip: str, meta: dict[str, Any] | None = None) -> None:
    payload = {"action": action, "ip": ip}
    if meta:
        payload.update(meta)
    logger.info("admin_action %s", payload)


def _require_admin(request: Request) -> str:
    return enforce_admin(request)


@router.get("/status")
async def admin_status(request: Request) -> dict:
    ip = _require_admin(request)
    config = get_app_config()
    return {
        "auth_enabled": config.auth_enabled,
        "admin_allowlist": config.admin_allowlist,
        "api_token_set": bool(config.api_token),
        "admin_token_set": bool(config.admin_token),
        "request_ip": ip,
    }


@router.post("/auth/enable")
async def enable_auth(request: Request) -> dict:
    ip = _require_admin(request)
    config = update_app_config(auth_enabled=True)
    _audit("auth_enable", ip=ip)
    return {"auth_enabled": config.auth_enabled}


@router.post("/auth/disable")
async def disable_auth(request: Request) -> dict:
    ip = _require_admin(request)
    config = update_app_config(auth_enabled=False)
    _audit("auth_disable", ip=ip)
    return {"auth_enabled": config.auth_enabled}


@router.post("/token/rotate")
async def rotate_api_token(request: Request) -> dict:
    ip = _require_admin(request)
    new_token = secrets.token_urlsafe(32)
    config = update_app_config(api_token=new_token)
    _audit("api_token_rotate", ip=ip)
    return {"api_token": config.api_token}


@router.post("/admin-token/rotate")
async def rotate_admin_token(request: Request) -> dict:
    ip = _require_admin(request)
    new_token = secrets.token_urlsafe(32)
    config = update_app_config(admin_token=new_token)
    _audit("admin_token_rotate", ip=ip)
    return {"admin_token": config.admin_token}


@router.post("/allowlist")
async def update_allowlist(request: Request) -> dict:
    ip = _require_admin(request)
    payload = await request.json()
    allowlist = payload.get("allowlist")
    if not isinstance(allowlist, list):
        raise BadRequestError("allowlist must be a list of IPs")
    allowlist = [str(item).strip() for item in allowlist if str(item).strip()]
    config = update_app_config(admin_allowlist=allowlist)
    _audit("admin_allowlist_update", ip=ip, meta={"allowlist": allowlist})
    return {"admin_allowlist": config.admin_allowlist}


@router.post("/services/restart")
async def restart_services(
    request: Request,
    registry: ServiceRegistry = Depends(get_service_registry),
) -> dict:
    ip = _require_admin(request)
    await registry.shutdown()
    await registry.startup()
    _audit("services_restart", ip=ip)
    return {"status": "restarted"}


@router.get("/config")
async def export_config(request: Request) -> dict:
    ip = _require_admin(request)
    config = get_app_config()
    _audit("config_export", ip=ip)
    return {
        "app_settings": {
            "host": config.host,
            "port": config.port,
            "log_level": config.log_level,
            "pushall_interval": config.pushall_interval,
            "cam_interval": config.cam_interval,
            "go2rtc_port": config.go2rtc_port,
            "go2rtc_path": config.go2rtc_path,
            "go2rtc_log_output": config.go2rtc_log_output,
            "auth_enabled": config.auth_enabled,
            "admin_allowlist": config.admin_allowlist,
        }
    }
