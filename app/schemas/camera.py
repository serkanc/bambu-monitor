"""Schemas for camera-related endpoints."""
from typing import Optional

from pydantic import BaseModel, Field

from app.models import CameraAccess


class CameraFrameResponse(BaseModel):
    """Camera frame payload."""

    frame: Optional[str]
    updated_at: str


class CameraAccessResponse(BaseModel):
    """List of camera access targets."""

    cameras: list[CameraAccess] = Field(default_factory=list)


class WebRTCOfferRequest(BaseModel):
    """WebRTC offer payload for camera streaming."""

    sdp: str
    source: Optional[str] = None


class WebRTCAnswerResponse(BaseModel):
    """WebRTC answer payload returned from the relay."""

    sdp: str
    session_id: str


class WebRTCSessionRequest(BaseModel):
    """Session management payload for keepalive/release."""

    session_id: str
