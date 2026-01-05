"""Utilities to derive external spool information from master payloads."""
from __future__ import annotations

from typing import Any, Dict

from app.models import ExternalSpool, PrinterState


class SpoolResolver:
    """Attach VT tray metadata to the printer state."""

    def attach_external_spool(self, state: PrinterState, master_data: Dict[str, Any]) -> None:
        spool_data = self._locate_vt_tray(master_data)
        external_spool = self._build_external_spool(spool_data)
        state.ams = state.ams.copy(update={"external_spool": external_spool})

    def _locate_vt_tray(self, master_data: Dict[str, Any]) -> dict[str, Any] | None:
        vt_data = master_data.get("vt_tray")
        if isinstance(vt_data, dict):
            return vt_data

        print_section = master_data.get("print")
        if isinstance(print_section, dict):
            vt_data = print_section.get("vt_tray")
            if isinstance(vt_data, dict):
                return vt_data

        return None

    def _build_external_spool(self, vt_data: dict[str, Any] | None) -> ExternalSpool | None:
        if not vt_data:
            return None

        def to_int(value: Any, default: int = 0) -> int:
            try:
                if isinstance(value, (str, bytes)) and not str(value).strip():
                    return default
                return int(float(value))
            except (TypeError, ValueError):
                return default

        record_id = vt_data.get("id") or vt_data.get("tray_id") or vt_data.get("tray_id_name") or "?"
        tray_type = vt_data.get("tray_type") or vt_data.get("tray_info_idx") or "External Spool"
        color = vt_data.get("tray_color") or vt_data.get("color") or "000000FF"

        return ExternalSpool(
            id=str(record_id),
            material=str(tray_type),
            remain=to_int(vt_data.get("remain")),
            color=str(color),
            nozzle_min=str(vt_data.get("nozzle_temp_min", vt_data.get("nozzle_min", "?"))),
            nozzle_max=str(vt_data.get("nozzle_temp_max", vt_data.get("nozzle_max", "?"))),
            tray_type=str(tray_type),
            tray_info_idx=str(
                vt_data.get("tray_info_idx")
                or vt_data.get("tray_id_name")
                or vt_data.get("filament_id")
                or ""
            ),
        )
