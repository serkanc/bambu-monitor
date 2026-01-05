"""Builders for printer control command payloads."""
from __future__ import annotations

from app.schemas import (
    AmsFilamentCommandRequest,
    AmsMaterialSettingRequest,
    NozzleAccessoryRequest,
    SkipObjectsRequest,
)


class ControlCommandService:
    """Build MQTT command payloads for control endpoints."""

    @staticmethod
    def build_ams_filament_command(payload: AmsFilamentCommandRequest) -> dict:
        ams_id = payload.ams_id if payload.ams_id is not None else 0
        is_load = payload.action == "load"
        base_slot = max(0, payload.slot_id)
        slot_value = base_slot if is_load else 255
        target_value = base_slot if is_load else 255
        curr_temp = payload.current_temp if payload.current_temp is not None else (-1 if is_load else 210)
        target_temp = payload.target_temp if payload.target_temp is not None else (-1 if is_load else 210)

        return {
            "print": {
                "ams_id": ams_id,
                "command": "ams_change_filament",
                "sequence_id": payload.sequence_id,
                "curr_temp": curr_temp,
                "slot_id": slot_value,
                "tar_temp": target_temp,
                "target": target_value,
                "reason": "success",
                "result": "success",
            }
        }

    @staticmethod
    def build_nozzle_accessory_payload(payload: NozzleAccessoryRequest) -> dict:
        return {
            "system": {
                "sequence_id": "0",
                "accessory_type": "nozzle",
                "command": "set_accessories",
                "nozzle_diameter": payload.nozzle_diameter,
                "nozzle_type": payload.nozzle_type,
            }
        }

    @classmethod
    def build_ams_material_payloads(
        cls,
        payload: AmsMaterialSettingRequest,
        nozzle_diameter: str | None,
    ) -> tuple[dict, dict]:
        ams_id = payload.ams_id if payload.ams_id is not None else 0
        slot_id = payload.slot_id
        tray_id = payload.tray_id
        tray_type = cls.normalize_tray_type(payload.tray_type)
        if not tray_type:
            raise ValueError("tray_type is required")
        tray_color = cls.normalize_tray_color(payload.tray_color)
        if not tray_color:
            raise ValueError("tray_color is invalid")
        tray_info_idx = str(payload.tray_info_idx or "").strip()
        if not tray_info_idx:
            raise ValueError("tray_info_idx is required")
        setting_id = str(payload.setting_id or tray_info_idx).strip()

        if not nozzle_diameter:
            raise ValueError("Nozzle diameter unavailable")

        first_payload = {
            "print": {
                "ams_id": ams_id,
                "command": "ams_filament_setting",
                "nozzle_temp_max": payload.nozzle_temp_max,
                "nozzle_temp_min": payload.nozzle_temp_min,
                "sequence_id": "0",
                "setting_id": setting_id,
                "slot_id": slot_id,
                "tray_color": tray_color,
                "tray_id": tray_id,
                "tray_info_idx": tray_info_idx,
                "tray_type": tray_type,
            }
        }

        second_payload = {
            "print": {
                "ams_id": ams_id,
                "cali_idx": -1,
                "command": "extrusion_cali_sel",
                "filament_id": tray_info_idx,
                "nozzle_diameter": nozzle_diameter,
                "sequence_id": "0",
                "slot_id": slot_id,
                "tray_id": tray_id,
            }
        }

        return first_payload, second_payload

    @staticmethod
    def build_skip_objects_payload(payload: SkipObjectsRequest) -> dict:
        obj_list = [obj for obj in payload.obj_list if isinstance(obj, int)]
        return {
            "print": {
                "command": "skip_objects",
                "obj_list": obj_list,
                "sequence_id": payload.sequence_id,
            }
        }

    @staticmethod
    def normalize_tray_type(value: str | list[str]) -> str:
        if isinstance(value, list):
            for entry in value:
                if entry:
                    return str(entry)
            return ""
        return str(value or "")

    @staticmethod
    def normalize_tray_color(value: str) -> str:
        raw = str(value or "").strip().replace("#", "")
        if len(raw) == 6:
            raw = f"{raw}FF"
        if len(raw) == 8 and all(ch in "0123456789abcdefABCDEF" for ch in raw):
            return raw.upper()
        return ""

    @staticmethod
    def normalize_nozzle_diameter(value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text or text == "?":
            return None
        try:
            parsed = float(text)
        except ValueError:
            return None
        return f"{parsed:.1f}"
