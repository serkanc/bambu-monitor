"""Print status parser extracted from StateManager."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.models import HMSError, PrintError, PrintStatus, normalize_gcode_state, parse_home_flag
from app.services.utils.hms_utils import (
    format_timestamp,
    get_error_description,
    get_hms_description,
    int_to_hex_groups,
)


class PrintDataParser:
    """Responsible for transforming raw print payloads into PrintStatus."""

    def parse(
        self,
        print_data: Dict[str, Any],
        module_index: Dict[str, Dict[str, Any]] | None,
        serial: str | None = None,
    ) -> PrintStatus:
        """Normalize print payload to PrintStatus."""

        try:
            module_index = module_index or {}
            nozzle_temp = print_data.get("nozzle_temper")
            bed_temp = print_data.get("bed_temper")
            chamber_temp = print_data.get("chamber_temper")
            mc_stage = print_data.get("mc_print_stage")
            mc_percent = print_data.get("mc_percent")
            remaining_time = print_data.get("mc_remaining_time")
            gcode_file = print_data.get("gcode_file")
            gcode_state = print_data.get("gcode_state")

            nozzle_type = print_data.get("nozzle_type", "?")
            nozzle_diameter = print_data.get("nozzle_diameter", "?")
            nozzle_target_temper = print_data.get("nozzle_target_temper", 0)
            bed_target_temper = print_data.get("bed_target_temper", 0)

            wifi_signal = print_data.get("wifi_signal", "?")
            fan_gear = print_data.get("fan_gear", 0)
            speed_level = print_data.get("spd_lvl")
            speed_magnitude = self._normalize_int(print_data.get("spd_mag"), default=0)
            mc_print_sub_stage = self._normalize_int(print_data.get("mc_print_sub_stage"), default=0)
            hw_switch_state = print_data.get("hw_switch_state")
            home_flag_value = print_data.get("home_flag")
            home_flag_features, sdcard_state = parse_home_flag(home_flag_value)
            feature_toggles = list(home_flag_features)

            def insert_after(target_key: str, entry: Dict[str, Any]) -> None:
                insert_index = next(
                    (
                        idx
                        for idx, item in enumerate(feature_toggles)
                        if item.get("key") == target_key
                    ),
                    None,
                )
                if insert_index is None:
                    feature_toggles.append(entry)
                else:
                    feature_toggles.insert(insert_index + 1, entry)

            xcam_payload = print_data.get("xcam") or {}
            marker_detector = xcam_payload.get("buildplate_marker_detector")
            if marker_detector is not None:
                entry = {
                    "key": "BUILDPLATE_MARKER_DETECTOR",
                    "supported": True,
                    "enabled": bool(marker_detector),
                }
                insert_after("PROMPT_SOUND", entry)

            ipcam_payload = print_data.get("ipcam") or {}
            ipcam_record = ipcam_payload.get("ipcam_record")
            timelapse_enabled = self._to_bool(ipcam_payload.get("timelapse"))
            if ipcam_record is not None:
                is_recording = str(ipcam_record).strip().lower() == "enable"
                camera_entry = {
                    "key": "CAMERA_RECORDING",
                    "supported": True,
                    "enabled": is_recording,
                }
                feature_toggles = [
                    feature
                    for feature in feature_toggles
                    if feature.get("key") != "CAMERA_RECORDING"
                ]
                insert_after("PROMPT_SOUND", camera_entry)

            ams_payload = print_data.get("ams") or {}
            power_on_flag = ams_payload.get("power_on_flag")
            if power_on_flag is not None:
                startup_entry = {
                    "key": "AMS_ON_STARTUP",
                    "supported": True,
                    "enabled": bool(power_on_flag),
                }
                feature_toggles = [
                    feature
                    for feature in feature_toggles
                    if feature.get("key") != "AMS_ON_STARTUP"
                ]
                insert_after("AMS_DETECT_REMAIN", startup_entry)
            stage_history = self._normalize_stage_list(print_data.get("stg"))
            stage_current = self._normalize_int(print_data.get("stg_cur"), default=0)
            prepare_percent_raw = print_data.get("gcode_file_prepare_percent")
            prepare_percent = None
            if prepare_percent_raw is not None:
                prepare_percent = self._normalize_int(prepare_percent_raw, default=0)
            print_type = str(print_data.get("print_type") or "idle")
            mc_print_line_number = str(print_data.get("mc_print_line_number") or "0")
            mc_print_stage = self._normalize_int(print_data.get("mc_print_stage"), default=0)
            skipped_objects = self._normalize_int_list(print_data.get("s_obj"))

            print_error_obj = self._build_print_error(print_data.get("print_error"), serial=serial)

            speed_level = self._normalize_int(speed_level, default=0)
            heatbreak_fan_speed = print_data.get("heatbreak_fan_speed", "0")
            cooling_fan_speed = print_data.get("cooling_fan_speed", "0")

            hms_errors = self._build_hms_errors(print_data.get("hms", []), serial=serial)
            chamber_light = self._extract_chamber_light(print_data.get("lights_report", []))

            layer_str = self._format_layers(print_data)
            remaining_val = self._format_remaining(remaining_time)
            finish_time = self._format_finish(remaining_val)

            ota_module = module_index.get("ota")
            ota_firmware = ota_module.get("sw_ver") if ota_module else None

            normalized_state = normalize_gcode_state(gcode_state)

            return PrintStatus(
                nozzle_temp=float(nozzle_temp) if nozzle_temp is not None else 0.0,
                nozzle_target_temper=float(nozzle_target_temper) if nozzle_target_temper is not None else 0.0,
                bed_temp=float(bed_temp) if bed_temp is not None else 0.0,
                bed_target_temper=float(bed_target_temper) if bed_target_temper is not None else 0.0,
                chamber_temp=float(chamber_temp) if chamber_temp is not None else 0.0,
                print_stage=mc_stage or "?",
                percent=mc_percent or 0,
                remaining_time=remaining_val,
                layer=layer_str,
                gcode_state=normalized_state,
                file=gcode_file,
                finish_time=finish_time,
                nozzle_type=nozzle_type,
                nozzle_diameter=nozzle_diameter,
                wifi_signal=wifi_signal,
                fan_gear=fan_gear,
                speed_level=speed_level or 0,
                speed_magnitude=speed_magnitude,
                heatbreak_fan_speed=heatbreak_fan_speed,
                cooling_fan_speed=cooling_fan_speed,
                hms_errors=hms_errors,
                print_error=print_error_obj,
                chamber_light=chamber_light,
                timelapse_enabled=timelapse_enabled,
                sdcard=self._to_bool(print_data.get("sdcard")),
                firmware=ota_firmware,
                mc_print_sub_stage=mc_print_sub_stage,
                hw_switch_state=str(hw_switch_state) if hw_switch_state is not None else None,
                home_flag_features=home_flag_features,
                feature_toggles=feature_toggles,
                stg=stage_history,
                stg_cur=stage_current,
                gcode_file_prepare_percent=prepare_percent,
                print_type=print_type,
                mc_print_line_number=mc_print_line_number,
                mc_print_stage=mc_print_stage,
                skipped_objects=skipped_objects,
                sdcard_state=sdcard_state,
            )
        except Exception as exc:
            raise RuntimeError("PrintDataParser failed") from exc

    @staticmethod
    def _build_print_error(error_data: Any, serial: str | None = None) -> Optional[PrintError]:
        if not error_data:
            return None
        print_error_code = int_to_hex_groups(error_data)
        if not print_error_code:
            return None
        description = get_error_description(print_error_code, serial=serial)
        if not description:
            return None
        return PrintError(code=print_error_code, description=description)

    @staticmethod
    def _build_hms_errors(hms_data: Any, serial: str | None = None) -> List[HMSError]:
        results: List[HMSError] = []
        if not isinstance(hms_data, list):
            return results
        for hms in hms_data:
            if not isinstance(hms, dict):
                continue
            attr = int_to_hex_groups(hms.get("attr"))
            code = int_to_hex_groups(hms.get("code"))
            if not attr or not code:
                continue
            full_code = f"{attr}-{code}"
            description = get_hms_description(full_code, serial=serial)
            if description is None:
                description = ""
            results.append(
                HMSError(
                    code=f"HMS_{full_code}",
                    description=description,
                    timestamp=format_timestamp(hms.get("timestamp")),
                )
            )
        return results

    @staticmethod
    def _extract_chamber_light(lights_report: Any) -> str:
        chamber_light = "off"
        if isinstance(lights_report, list):
            for light in lights_report:
                if light.get("node") == "chamber_light":
                    chamber_light = light.get("mode", "off")
        return chamber_light

    @staticmethod
    def _format_layers(print_data: Dict[str, Any]) -> str:
        layer_num = print_data.get("layer_num")
        total_layer_num = print_data.get("total_layer_num")
        return f"{layer_num or 0}/{total_layer_num or 0}"

    @staticmethod
    def _format_remaining(value: Any) -> int:
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str) and value.isdigit():
            return int(value)
        return 0

    @staticmethod
    def _format_finish(remaining: int) -> str:
        if remaining > 0:
            return (datetime.now() + timedelta(minutes=remaining)).strftime("%H:%M")
        return "-"

    @staticmethod
    def _to_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            normalized = value.strip().lower()
            return normalized in {"1", "true", "on", "yes", "enable", "enabled"}
        return False

    @staticmethod
    def _normalize_int(value: Any, default: int = 0) -> int:
        try:
            if value is None:
                return default
            if isinstance(value, str):
                value = value.strip()
                if not value:
                    return default
            return int(float(value))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _normalize_stage_list(values: Any) -> list[int]:
        if not isinstance(values, list):
            return []
        result = []
        for item in values:
            try:
                result.append(int(item))
            except (TypeError, ValueError):
                continue
        return result

    @staticmethod
    def _normalize_int_list(values: Any) -> list[int]:
        if not isinstance(values, list):
            return []
        result = []
        for item in values:
            try:
                result.append(int(item))
            except (TypeError, ValueError):
                continue
        return result
