"""Auth routes for admin login and setup password."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from pathlib import Path

from app.core.auth import hash_password, verify_password
from app.core.config import get_app_config, is_password_setup_required, update_app_config
from app.core.exceptions import ConflictError, UnauthorizedError, BadRequestError
from app.services.cache_service import PrintCacheService

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginPayload(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class SetupPasswordPayload(BaseModel):
    password: str = Field(..., min_length=6)


class ChangePasswordPayload(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6)


class AllowlistPayload(BaseModel):
    allowlist: list[str] = Field(default_factory=list)


class CacheCleanPayload(BaseModel):
    days: int = Field(..., ge=1, le=3650)


class CacheSettingsPayload(BaseModel):
    cache_upload_enabled: bool = Field(default=False)


def _require_admin_session(request: Request) -> None:
    session = getattr(request, "session", {}) or {}
    if not session.get("admin_logged_in"):
        raise UnauthorizedError("Login required")


@router.post("/login")
async def login(payload: LoginPayload, request: Request) -> dict:
    config = get_app_config()
    if not config.admin_password_hash:
        raise ConflictError("Admin password not configured")
    if payload.username.strip().lower() != "admin":
        raise UnauthorizedError("Invalid credentials")
    if not verify_password(payload.password, config.admin_password_hash):
        raise UnauthorizedError("Invalid credentials")
    request.session["admin_logged_in"] = True
    return {"ok": True}


@router.post("/logout")
async def logout(request: Request) -> dict:
    request.session.clear()
    return {"ok": True}


@router.post("/setup-password")
async def setup_password(payload: SetupPasswordPayload, request: Request) -> dict:
    if not is_password_setup_required():
        raise ConflictError("Setup password is not required")
    if not payload.password or len(payload.password) < 6:
        raise BadRequestError("Password must be at least 6 characters")
    password_hash = hash_password(payload.password)
    update_app_config(admin_password_hash=password_hash)
    return {"ok": True}


@router.post("/change-password")
async def change_password(payload: ChangePasswordPayload, request: Request) -> dict:
    _require_admin_session(request)
    config = get_app_config()
    if not config.admin_password_hash:
        raise ConflictError("Admin password not configured")
    if not verify_password(payload.current_password, config.admin_password_hash):
        raise UnauthorizedError("Invalid credentials")
    new_hash = hash_password(payload.new_password)
    update_app_config(admin_password_hash=new_hash)
    return {"ok": True}


@router.get("/tokens")
async def get_tokens(request: Request) -> dict:
    _require_admin_session(request)
    config = get_app_config()
    return {"api_token": config.api_token or ""}


@router.post("/api-token/rotate")
async def rotate_api_token(request: Request) -> dict:
    _require_admin_session(request)
    new_token = secrets.token_urlsafe(32)
    config = update_app_config(api_token=new_token)
    return {"api_token": config.api_token}


@router.post("/admin-token/rotate")
async def rotate_admin_token(request: Request) -> dict:
    _require_admin_session(request)
    new_token = secrets.token_urlsafe(32)
    config = update_app_config(admin_token=new_token)
    return {"admin_token": config.admin_token}


@router.get("/allowlist")
async def get_allowlist(request: Request) -> dict:
    _require_admin_session(request)
    config = get_app_config()
    return {"allowlist": config.admin_allowlist or []}


@router.post("/allowlist")
async def update_allowlist(payload: AllowlistPayload, request: Request) -> dict:
    _require_admin_session(request)
    config = update_app_config(admin_allowlist=payload.allowlist)
    return {"allowlist": config.admin_allowlist or []}


@router.post("/session-secret/rotate")
async def rotate_session_secret(request: Request) -> dict:
    _require_admin_session(request)
    new_secret = secrets.token_urlsafe(32)
    update_app_config(session_secret=new_secret)
    return {"ok": True, "restart_required": True}


@router.get("/cache/status")
async def get_cache_status(request: Request) -> dict:
    _require_admin_session(request)
    service = PrintCacheService(Path("data/print-cache"))
    stats = await service.get_stats()
    return {
        "size_bytes": stats.total_bytes,
        "file_count": stats.file_count,
        "folder_count": stats.folder_count,
    }


@router.post("/cache/clean")
async def clean_cache(payload: CacheCleanPayload, request: Request) -> dict:
    _require_admin_session(request)
    service = PrintCacheService(Path("data/print-cache"))
    result = await service.clean(older_than_seconds=payload.days * 86400)
    stats = await service.get_stats()
    return {
        "removed_bytes": result.removed_bytes,
        "removed_files": result.removed_files,
        "removed_folders": result.removed_folders,
        "removed_bundles": result.removed_bundles,
        "size_bytes": stats.total_bytes,
    }


@router.get("/cache/settings")
async def get_cache_settings(request: Request) -> dict:
    _require_admin_session(request)
    config = get_app_config()
    return {"cache_upload_enabled": bool(config.cache_upload_enabled)}


@router.post("/cache/settings")
async def update_cache_settings(payload: CacheSettingsPayload, request: Request) -> dict:
    _require_admin_session(request)
    config = update_app_config(cache_upload_enabled=payload.cache_upload_enabled)
    return {"cache_upload_enabled": bool(config.cache_upload_enabled)}
