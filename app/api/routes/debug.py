"""Debug endpoints exposing master JSON and recent payloads."""
from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_debug_service
from app.core.config import get_app_config
from app.core.exceptions import NotFoundError
from app.services.debug_service import DebugService

router = APIRouter(prefix="/debug")


def _ensure_debug_enabled() -> None:
    if not get_app_config().debug_enabled:
        raise NotFoundError("Debug endpoints disabled")


@router.get("", name="debug_data_root")
async def debug_data_root(
    printer_id: str | None = Query(default=None),
    debug_service: DebugService = Depends(get_debug_service),
) -> dict:
    _ensure_debug_enabled()
    return await debug_service.get_debug_info(printer_id=printer_id)


@router.get("/data")
async def debug_data(
    printer_id: str | None = Query(default=None),
    debug_service: DebugService = Depends(get_debug_service),
) -> dict:
    """Return master JSON and recent messages as JSON."""

    _ensure_debug_enabled()
    return await debug_service.get_debug_info(printer_id=printer_id)
