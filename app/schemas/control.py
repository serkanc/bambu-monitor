"""Schemas for printer control endpoints."""
from typing import Literal, Optional

from pydantic import BaseModel


class SimpleMessage(BaseModel):
    """Generic success/error wrapper."""

    success: bool
    message: str


class ChamberLightRequest(BaseModel):
    """Payload for chamber light commands."""

    mode: str


class PrinterCommandRequest(BaseModel):
    """Generic printer command payload."""

    command: str
    param: str


class AmsFilamentCommandRequest(BaseModel):
    """Payload for AMS load/unload commands."""

    ams_id: Optional[int] = None
    slot_id: int
    action: Literal["load", "unload"]
    sequence_id: str = "0"
    current_temp: Optional[int] = None
    target_temp: Optional[int] = None


class FeatureToggleRequest(BaseModel):
    """Payload for feature toggle commands."""

    key: str
    enabled: bool
    sequence_id: str = "0"
    peer_enabled: Optional[bool] = None


class NozzleAccessoryRequest(BaseModel):
    """Payload for nozzle accessory updates."""

    nozzle_type: Literal["stainless_steel", "hardened_steel"]
    nozzle_diameter: float


class AmsMaterialSettingRequest(BaseModel):
    """Payload for AMS filament setting updates."""

    ams_id: Optional[int] = None
    slot_id: int
    tray_id: int
    setting_id: Optional[str] = None
    tray_info_idx: str
    tray_type: str | list[str]
    nozzle_temp_min: int
    nozzle_temp_max: int
    tray_color: str


class SkipObjectsRequest(BaseModel):
    """Payload for skip object commands."""

    obj_list: list[int]
    sequence_id: str = "0"
