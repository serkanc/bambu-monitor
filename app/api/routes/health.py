"""Health check endpoint."""
from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_health_service
from app.services.health_service import HealthService

router = APIRouter()


@router.get("/health", summary="Health probe")
async def health_check(
    printer_id: str | None = Query(default=None),
    health_service: HealthService = Depends(get_health_service),
) -> dict:
    return await health_service.check(printer_id)
