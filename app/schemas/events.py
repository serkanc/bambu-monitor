"""Schemas for event API endpoints."""
from pydantic import BaseModel, Field

from app.models import PrinterEvent


class EventListResponse(BaseModel):
    """Envelope returned when listing printer events."""

    events: list[PrinterEvent] = Field(default_factory=list)
    latest_event_id: str | None = None
