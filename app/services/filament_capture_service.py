"""Capture successful AMS filament commands for custom filament reuse."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class FilamentCaptureService:
    """Hold successful AMS filament command payloads in memory."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._by_printer: Dict[str, Dict[str, Dict[str, Any]]] = {}

    @staticmethod
    def _normalize_text(value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text if text else None

    @staticmethod
    def _normalize_int(value: Any) -> int | None:
        if value is None or value == "":
            return None
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _normalize_color(value: Any) -> str | None:
        raw = FilamentCaptureService._normalize_text(value)
        if not raw:
            return None
        raw = raw.replace("#", "")
        if len(raw) == 6:
            raw = f"{raw}FF"
        if len(raw) == 8 and all(ch in "0123456789abcdefABCDEF" for ch in raw):
            return raw.upper()
        return None

    @staticmethod
    def _normalize_tray_type(value: Any) -> str | None:
        if isinstance(value, list):
            for item in value:
                text = FilamentCaptureService._normalize_text(item)
                if text:
                    return text
            return None
        return FilamentCaptureService._normalize_text(value)

    @staticmethod
    def _normalize_nozzle_diameter(value: Any) -> str | None:
        text = FilamentCaptureService._normalize_text(value)
        if not text or text == "?":
            return None
        try:
            parsed = float(text)
        except ValueError:
            return None
        return f"{parsed:.1f}"

    @staticmethod
    def _is_success(value: Any) -> bool:
        return str(value or "").strip().lower() == "success"

    async def ingest_payload(self, printer_id: str, payload: Dict[str, Any]) -> None:
        if not printer_id or not isinstance(payload, dict):
            return
        print_data = payload.get("print")
        if not isinstance(print_data, dict):
            return
        command = str(print_data.get("command") or "").strip()
        if command not in {"ams_filament_setting", "extrusion_cali_sel"}:
            return
        if not self._is_success(print_data.get("result")):
            return

        tray_info_idx = None
        updates: Dict[str, Any] = {}

        if command == "ams_filament_setting":
            tray_info_idx = self._normalize_text(print_data.get("tray_info_idx"))
            if not tray_info_idx:
                return
            updates = {
                "tray_info_idx": tray_info_idx,
                "tray_type": self._normalize_tray_type(print_data.get("tray_type")),
                "setting_id": self._normalize_text(print_data.get("setting_id")),
                "nozzle_temp_min": self._normalize_int(print_data.get("nozzle_temp_min")),
                "nozzle_temp_max": self._normalize_int(print_data.get("nozzle_temp_max")),
                "tray_color": self._normalize_color(print_data.get("tray_color")),
                "ams_id": self._normalize_int(print_data.get("ams_id")),
                "tray_id": self._normalize_int(print_data.get("tray_id")),
                "slot_id": self._normalize_int(print_data.get("slot_id")),
                "sequence_id": self._normalize_text(print_data.get("sequence_id")),
            }
        elif command == "extrusion_cali_sel":
            tray_info_idx = self._normalize_text(print_data.get("filament_id"))
            if not tray_info_idx:
                return
            updates = {
                "tray_info_idx": tray_info_idx,
                "nozzle_diameter": self._normalize_nozzle_diameter(
                    print_data.get("nozzle_diameter")
                ),
                "ams_id": self._normalize_int(print_data.get("ams_id")),
                "tray_id": self._normalize_int(print_data.get("tray_id")),
                "slot_id": self._normalize_int(print_data.get("slot_id")),
                "sequence_id": self._normalize_text(print_data.get("sequence_id")),
            }

        if not tray_info_idx:
            return

        async with self._lock:
            printer_cache = self._by_printer.setdefault(printer_id, {})
            record = printer_cache.get(tray_info_idx, {"tray_info_idx": tray_info_idx})
            for key, value in updates.items():
                if value is None:
                    continue
                record[key] = value
            record["last_seen"] = datetime.utcnow().isoformat()
            printer_cache[tray_info_idx] = record

    async def list_candidates(self, printer_id: str) -> List[Dict[str, Any]]:
        if not printer_id:
            return []
        async with self._lock:
            printer_cache = self._by_printer.get(printer_id, {})
            return list(printer_cache.values())

    async def build_candidates(
        self,
        printer_id: str,
        *,
        state: Any,
        catalog: List[Any],
    ) -> List[Dict[str, Any]]:
        if not printer_id:
            return []

        candidates = [
            {**item, "source": item.get("source") or "command"}
            for item in await self.list_candidates(printer_id)
        ]
        merged: Dict[str, Dict[str, Any]] = {
            str(item.get("tray_info_idx")): item
            for item in candidates
            if item.get("tray_info_idx")
        }

        catalog_tray_ids = {
            getattr(item, "tray_info_idx", None)
            for item in catalog
            if getattr(item, "tray_info_idx", None)
        }

        ams = getattr(state, "ams", None)
        if not ams:
            return list(merged.values())

        def to_int(value: Any) -> int | None:
            return self._normalize_int(value)

        for unit in getattr(ams, "ams_units", []):
            ams_id = to_int(getattr(unit, "ams_id", None))
            for tray in getattr(unit, "trays", []):
                tray_info_idx = str(getattr(tray, "tray_info_idx", "") or "").strip()
                if not tray_info_idx or tray_info_idx in catalog_tray_ids:
                    continue
                if tray_info_idx in merged:
                    continue
                tray_id = to_int(getattr(tray, "id", None))
                merged[tray_info_idx] = {
                    "tray_info_idx": tray_info_idx,
                    "source": "ams_slot",
                    "tray_type": getattr(tray, "tray_type", None) or getattr(tray, "material", None),
                    "setting_id": None,
                    "nozzle_temp_min": to_int(getattr(tray, "nozzle_min", None)),
                    "nozzle_temp_max": to_int(getattr(tray, "nozzle_max", None)),
                    "tray_color": getattr(tray, "color", None),
                    "ams_id": ams_id,
                    "tray_id": tray_id,
                    "slot_id": None,
                    "nozzle_diameter": None,
                    "sequence_id": None,
                    "last_seen": None,
                }

        external_spool = getattr(ams, "external_spool", None)
        if external_spool:
            tray_info_idx = str(getattr(external_spool, "tray_info_idx", "") or "").strip()
            if tray_info_idx and tray_info_idx not in catalog_tray_ids:
                if tray_info_idx not in merged:
                    tray_id = to_int(getattr(external_spool, "id", None))
                    merged[tray_info_idx] = {
                        "tray_info_idx": tray_info_idx,
                        "source": "external_spool",
                        "tray_type": getattr(external_spool, "tray_type", None)
                        or getattr(external_spool, "material", None),
                        "setting_id": None,
                        "nozzle_temp_min": to_int(getattr(external_spool, "nozzle_min", None)),
                        "nozzle_temp_max": to_int(getattr(external_spool, "nozzle_max", None)),
                        "tray_color": getattr(external_spool, "color", None),
                        "ams_id": None,
                        "tray_id": tray_id,
                        "slot_id": None,
                        "nozzle_diameter": None,
                        "sequence_id": None,
                        "last_seen": None,
                    }

        return list(merged.values())
