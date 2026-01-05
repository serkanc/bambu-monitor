"""API endpoints for printer event logs."""
from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_event_service
from app.schemas import EventListResponse, SimpleMessage
from app.services.event_service import EventService

router = APIRouter()


@router.get("/events", response_model=EventListResponse, summary="List recent printer events")
async def list_events(
    printer_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    event_service: EventService = Depends(get_event_service),
) -> EventListResponse:
    events = await event_service.list_events(printer_id=printer_id, limit=limit)
    latest_event_id = events[0].id if events else None
    return EventListResponse(events=events, latest_event_id=latest_event_id)


@router.delete("/events", response_model=SimpleMessage, summary="Clear stored events")
async def clear_events(
    printer_id: str | None = Query(default=None),
    event_service: EventService = Depends(get_event_service),
) -> SimpleMessage:
    await event_service.clear_events(printer_id=printer_id)
    target = f"printer {printer_id}" if printer_id else "all printers"
    return SimpleMessage(success=True, message=f"Events cleared for {target}")
