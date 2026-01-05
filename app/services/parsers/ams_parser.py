"""AMS status parser extracted from StateManager."""
from __future__ import annotations

from typing import Any, Dict, List

from app.models import AmsStatus, AmsTray, AmsUnit
from app.services.utils.state_utils import (
    bits_to_bool,
    decode_tray_bits,
    normalize_str,
    parse_slot_int,
)


class AmsParser:
    """Produces an AmsStatus snapshot from raw AMS payloads."""

    def parse(
        self,
        ams_data: Any,
        module_metadata: Dict[str, Any] | None = None,
    ) -> AmsStatus:
        """Normalize the AMS payload into an AmsStatus model."""

        module_metadata = module_metadata or {}
        ams_module_sw = module_metadata.get("sw_ver")
        ams_product_name = module_metadata.get("product_name")

        metadata_source = ams_data if isinstance(ams_data, dict) else {}
        ams_list = self._extract_ams_units(ams_data)

        slots: List[AmsTray] = []
        ams_units: List[AmsUnit] = []

        for unit_data in ams_list:
            unit = AmsUnit(
                id=self._coerce_str(unit_data.get("id"), "?"),
                ams_id=self._coerce_str(
                    unit_data.get("ams_id") or unit_data.get("id"), "?"
                ),
                humidity=self._coerce_str(unit_data.get("humidity"), "?"),
                temp=self._coerce_str(unit_data.get("temp"), "?"),
                firmware=ams_module_sw or "N/A",
                product_name=ams_product_name,
            )

            trays = unit_data.get("tray", [])
            if isinstance(trays, list):
                for tray in trays:
                    tray_info = self._build_tray(tray)
                    unit.trays.append(tray_info)
                    slots.append(tray_info)

            ams_units.append(unit)

        tray_exist_bits_value = normalize_str(
            metadata_source.get("tray_exist_bits"), "0"
        )
        tray_is_bbl_bits_value = normalize_str(
            metadata_source.get("tray_is_bbl_bits"), "0"
        )
        tray_tar_value = normalize_str(metadata_source.get("tray_tar"), "255")
        tray_now_value = normalize_str(metadata_source.get("tray_now"), "255")
        tray_pre_value = normalize_str(metadata_source.get("tray_pre"), "255")
        tray_read_done_bits_value = normalize_str(
            metadata_source.get("tray_read_done_bits"), "0"
        )
        tray_reading_bits_value = normalize_str(
            metadata_source.get("tray_reading_bits"), "0"
        )
        active_tray_index = parse_slot_int(metadata_source.get("tray_now"))
        tray_exist_slots = decode_tray_bits(tray_exist_bits_value, 4)

        ams_exist_bits = metadata_source.get("ams_exist_bits")
        version_value = normalize_str(metadata_source.get("version"), "N/A")

        hub_connected_flag = bits_to_bool(ams_exist_bits)
        hub_label = "Connected" if hub_connected_flag else "Disconnected"

        return AmsStatus(
            ams_hub_connected=hub_label,
            total_ams=len(ams_units),
            slots=slots,
            ams_units=ams_units,
            tray_exist_bits=tray_exist_bits_value,
            tray_is_bbl_bits=tray_is_bbl_bits_value,
            tray_tar=tray_tar_value,
            tray_now=tray_now_value,
            tray_pre=tray_pre_value,
            tray_read_done_bits=tray_read_done_bits_value,
            tray_reading_bits=tray_reading_bits_value,
            active_tray_index=active_tray_index,
            tray_exist_slots=tray_exist_slots,
            version=version_value,
        )

    @staticmethod
    def _extract_ams_units(value: Any) -> List[Dict[str, Any]]:
        if isinstance(value, dict):
            units = value.get("ams")
            if isinstance(units, list):
                return [unit for unit in units if isinstance(unit, dict)]
            return [value]
        if isinstance(value, list):
            return [unit for unit in value if isinstance(unit, dict)]
        return []

    @staticmethod
    def _build_tray(tray_data: Dict[str, Any]) -> AmsTray:
        tray_type = tray_data.get("tray_type") or "Empty"
        color = tray_data.get("tray_color") or "000000FF"
        return AmsTray(
            id=AmsParser._coerce_str(tray_data.get("id", "?")),
            material=AmsParser._coerce_str(tray_type, "Empty"),
            remain=AmsParser._safe_int(tray_data.get("remain")),
            color=AmsParser._coerce_str(color, "000000FF"),
            nozzle_min=AmsParser._coerce_str(tray_data.get("nozzle_temp_min"), "?"),
            nozzle_max=AmsParser._coerce_str(tray_data.get("nozzle_temp_max"), "?"),
            tray_type=AmsParser._coerce_str(tray_type, "Empty"),
            tray_info_idx=AmsParser._coerce_str(tray_data.get("tray_info_idx") or "", ""),
        )

    @staticmethod
    def _coerce_str(value: Any, default: str = "?") -> str:
        if value is None:
            return default
        return str(value)

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        if value is None or value == "":
            return default
        try:
            if isinstance(value, str):
                value = value.strip()
                if not value:
                    return default
            return int(float(value))
        except (TypeError, ValueError):
            return default
