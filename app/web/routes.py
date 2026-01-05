"""Routes serving the HTML dashboard."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app.core.config import get_app_config, is_password_setup_required, is_setup_required
from app.services.registry import ServiceRegistry

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES = Jinja2Templates(directory=str(BASE_DIR / "templates"))

DEFAULT_UI_STATE: Dict[str, Any] = {
    "statusPanel": {
        "activeTab": "status",
        "selectedSlot": None,
        "chamberLight": {"base": "off", "pending": None, "expiresAt": 0},
        "featureTogglePending": {},
        "lastDisplayedPrintErrorCode": None,
        "lastAcknowledgedPrintErrorCode": None,
    },
    "controls": {
        "activeTab": "movement",
        "lastActiveTab": "movement",
        "chamberLight": {"base": "off", "pending": None, "expiresAt": 0},
        "speedLevel": {"base": 0, "pending": None, "expiresAt": 0},
    },
    "printerSelector": {
        "printers": [],
        "selectedId": None,
        "pendingId": None,
        "isSwitching": False,
        "isRefreshing": False,
        "isAdding": False,
        "userCollapsed": True,
        "refreshIntervalMs": 5000,
        "apiRetryScheduled": False,
        "lastEmittedSelectionId": None,
        "openStatusDetailId": None,
        "printerUnreadMap": {},
        "isSetupMode": False,
        "isVerified": False,
        "verificationPayloadHash": None,
        "isEditing": False,
        "editingPrinterId": None,
        "modalMode": "add",
        "modalSecondaryAction": "close",
        "editingPrinterAccessCode": "",
        "initialPayload": None,
        "canApplyWithoutVerify": False,
    },
    "fileExplorer": {
        "currentPath": "/",
        "activeFile": None,
        "isContextMenuOpen": False,
        "isLoading": False,
        "lastError": None,
        "files": [],
    },
    "printSetup": {
        "metadata": None,
        "currentPlateIndex": 0,
        "amsMapping": [],
        "currentTrayMeta": [],
        "currentFilamentGroups": [],
        "typeMismatchMessages": [],
        "nozzleWarningText": "",
        "nozzleMismatch": False,
        "plateMappings": {},
        "plateFiles": [],
        "plateFilamentIds": [],
        "maxFilamentId": 0,
        "platePreviewUrls": [],
        "externalSlotValue": -2,
        "externalFocusIndex": None,
        "pendingFileURL": None,
    },
}

router = APIRouter()


def _is_logged_in(request: Request) -> bool:
    session = getattr(request, "session", {}) or {}
    return bool(session.get("admin_logged_in"))


async def _collect_initial_data(request: Request) -> Optional[Dict[str, Any]]:
    services: ServiceRegistry | None = getattr(request.app.state, "services", None)
    if not services:
        return None
    printer_id = services.state_manager.get_active_printer_id() or services.settings.printer_id
    if not printer_id:
        return None

    state = await services.state_manager.get_state(printer_id)
    master_data = await services.state_manager.get_master_data(printer_id)

    printer_info = master_data.get("printer")
    if not printer_info:
        printer_info = {
            "id": services.settings.printer_id,
            "printer_ip": services.settings.printer_ip,
            "access_code": services.settings.access_code,
            "serial": services.settings.serial,
            "model": services.settings.printer_model,
            "external_camera_url": services.settings.external_camera_url,
        }

    capabilities = state.capabilities.dict() if state.capabilities else None
    ams = state.ams.dict() if state.ams else None
    external_spool = ams.get("external_spool") if ams else None

    return {
        "selectedPrinterId": printer_id,
        "printer": printer_info,
        "capabilities": capabilities,
        "ams": ams,
        "externalSpool": external_spool,
        "ui": DEFAULT_UI_STATE,
    }


@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request) -> HTMLResponse:
    """Render the main dashboard page."""

    if is_setup_required():
        return RedirectResponse("/setup")
    if not _is_logged_in(request):
        return RedirectResponse("/login")
    app_config = get_app_config()
    initial_data = await _collect_initial_data(request)
    response = TEMPLATES.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "first_run": False,
            "initial_data": initial_data,
            "api_token": app_config.api_token,
        },
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get("/login", response_class=HTMLResponse)
async def login_view(request: Request) -> HTMLResponse:
    """Render the login page."""

    if is_setup_required():
        return RedirectResponse("/setup")
    if _is_logged_in(request):
        return RedirectResponse("/")
    response = TEMPLATES.TemplateResponse(
        "login.html",
        {"request": request},
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get("/setup", response_class=HTMLResponse)
async def setup_wizard(request: Request) -> HTMLResponse:
    """Render the dashboard preloaded with the add-printer modal."""

    if not is_setup_required():
        return RedirectResponse("/")
    app_config = get_app_config()
    initial_data = await _collect_initial_data(request)
    password_required = is_password_setup_required()
    setup_step = "password" if password_required else "printer"
    response = TEMPLATES.TemplateResponse(
        "setup.html",
        {
            "request": request,
            "first_run": True,
            "initial_data": initial_data,
            "api_token": app_config.api_token,
            "setup_step": setup_step,
            "password_required": password_required,
        },
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get("/debug", response_class=HTMLResponse)
async def debug_console(request: Request) -> HTMLResponse:
    """Render the interactive debug console."""

    if is_setup_required():
        return RedirectResponse("/setup")
    if not _is_logged_in(request):
        return RedirectResponse("/login")
    app_config = get_app_config()
    return TEMPLATES.TemplateResponse(
        "debug.html",
        {"request": request, "api_token": app_config.api_token},
    )
