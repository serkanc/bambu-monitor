"""Feature toggle command builder."""
from __future__ import annotations

from typing import Dict


class FeatureCommandBuilder:
    """Build printer command payloads for feature toggles."""

    _TOGGLE_KEYS = {
        "STEP_LOSS_RECOVERY",
        "PROMPT_SOUND",
        "FILAMENT_TANGLE_DETECT",
        "AMS_DETECT_REMAIN",
        "AMS_ON_STARTUP",
        "AMS_AUTO_REFILL",
        "AIR_PRINT_DETECTION",
        "CAMERA_RECORDING",
        "NOZZLE_BLOB_DETECTION",
        "BUILDPLATE_MARKER_DETECTOR",
    }

    @classmethod
    def build_payload(
        cls,
        key: str,
        enabled: bool,
        sequence_id: str = "0",
        peer_enabled: bool | None = None,
    ) -> Dict:
        if key not in cls._TOGGLE_KEYS:
            raise ValueError(f"Unsupported feature key: {key}")

        if key == "BUILDPLATE_MARKER_DETECTOR":
            return {
                "xcam": {
                    "command": "xcam_control_set",
                    "control": bool(enabled),
                    "enable": bool(enabled),
                    "module_name": "buildplate_marker_detector",
                    "print_halt": True,
                }
            }

        if key == "CAMERA_RECORDING":
            return {
                "camera": {
                    "command": "ipcam_record_set",
                    "control": "enable" if enabled else "disable",
                    "sequence_id": sequence_id,
                }
            }

        if key in {"AMS_DETECT_REMAIN", "AMS_ON_STARTUP"}:
            calibrate_remain_flag = bool(enabled) if key == "AMS_DETECT_REMAIN" else bool(peer_enabled)
            startup_read_option = bool(enabled) if key == "AMS_ON_STARTUP" else bool(peer_enabled)
            return {
                "print": {
                    "ams_id": -1,
                    "calibrate_remain_flag": calibrate_remain_flag,
                    "command": "ams_user_setting",
                    "sequence_id": sequence_id,
                    "startup_read_option": startup_read_option,
                    "tray_read_option": False,
                }
            }

        payload = {
            "print": {
                "command": "print_option",
                "sequence_id": sequence_id,
            }
        }

        if key == "STEP_LOSS_RECOVERY":
            payload["print"]["auto_recovery"] = bool(enabled)
        elif key == "PROMPT_SOUND":
            payload["print"]["sound_enable"] = bool(enabled)
        elif key == "FILAMENT_TANGLE_DETECT":
            payload["print"]["filament_tangle_detect"] = bool(enabled)
        elif key == "AMS_AUTO_REFILL":
            payload["print"]["auto_switch_filament"] = bool(enabled)
        elif key == "AIR_PRINT_DETECTION":
            payload["print"]["air_print_detect"] = bool(enabled)
        elif key == "NOZZLE_BLOB_DETECTION":
            payload["print"]["nozzle_blob_detect"] = bool(enabled)
        else:
            raise ValueError(f"Unhandled feature key: {key}")

        return payload
