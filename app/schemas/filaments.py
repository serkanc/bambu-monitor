from __future__ import annotations

from typing import List

from pydantic import BaseModel, Field


class FilamentCatalogItem(BaseModel):
    """Filtered filament profile compatible with the active printer."""

    alias: str
    brand: str | None = None
    material: str | None = None
    setting_id: str
    tray_info_idx: str
    tray_type: List[str] = Field(default_factory=list)
    nozzle_temp_min: int | None = None
    nozzle_temp_max: int | None = None
    is_custom: bool = False


class FilamentCatalog(BaseModel):
    """Wrapper for the filtered filament catalog list."""

    items: List[FilamentCatalogItem] = Field(default_factory=list)


class FilamentCaptureCandidate(BaseModel):
    """Captured filament settings from successful AMS commands."""

    tray_info_idx: str
    source: str | None = None
    tray_type: str | None = None
    setting_id: str | None = None
    nozzle_temp_min: int | None = None
    nozzle_temp_max: int | None = None
    tray_color: str | None = None
    ams_id: int | None = None
    tray_id: int | None = None
    slot_id: int | None = None
    nozzle_diameter: str | None = None
    sequence_id: str | None = None
    last_seen: str | None = None


class CustomFilamentRequest(BaseModel):
    """Payload to persist a custom filament definition."""

    alias: str
    setting_id: str | None = None
    tray_info_idx: str
    tray_type: str | list[str]
    nozzle_temp_min: int
    nozzle_temp_max: int
