"""Domain models representing the printer state."""
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class PrinterGCodeState(str, Enum):
    """Normalized gcode_state values reported by printers."""

    FINISH = "FINISH"
    SLICING = "SLICING"
    RUNNING = "RUNNING"
    PAUSE = "PAUSE"
    PREPARE = "PREPARE"
    INIT = "INIT"
    FAILED = "FAILED"
    IDLE = "IDLE"
    UNKNOWN = "UNKNOWN"


_GCODE_STATE_ALIASES = {
    PrinterGCodeState.FINISH.value: PrinterGCodeState.FINISH,
    "FINISHED": PrinterGCodeState.FINISH,
    PrinterGCodeState.SLICING.value: PrinterGCodeState.SLICING,
    PrinterGCodeState.RUNNING.value: PrinterGCodeState.RUNNING,
    "PRINTING": PrinterGCodeState.RUNNING,
    PrinterGCodeState.PAUSE.value: PrinterGCodeState.PAUSE,
    "PAUSED": PrinterGCodeState.PAUSE,
    PrinterGCodeState.PREPARE.value: PrinterGCodeState.PREPARE,
    "PREPARING": PrinterGCodeState.PREPARE,
    PrinterGCodeState.INIT.value: PrinterGCodeState.INIT,
    "INITIALIZING": PrinterGCodeState.INIT,
    PrinterGCodeState.FAILED.value: PrinterGCodeState.FAILED,
    "FAIL": PrinterGCodeState.FAILED,
    PrinterGCodeState.IDLE.value: PrinterGCodeState.IDLE,
    PrinterGCodeState.UNKNOWN.value: PrinterGCodeState.UNKNOWN,
}


class AmsStatusMain(int, Enum):
    """High-byte AMS status codes indicating the main AMS state."""

    IDLE = 0x00
    FILAMENT_CHANGE = 0x01
    RFID_IDENTIFYING = 0x02
    ASSIST = 0x03
    CALIBRATION = 0x04
    SELF_CHECK = 0x10
    DEBUG = 0x20
    UNKNOWN = 0xFF


class AmsSubStatus(int, Enum):
    """Low-byte AMS status codes indicating the active sub-operation."""
    IDLE = 0x00
    HEAT_NOZZLE = 0x02
    CUT_FILAMENT = 0x03
    PULL_CURRENT_FILAMENT = 0x04
    CUT_OR_PUSH_NEW_FILAMENT = 0x05
    PUSH_NEW_FILAMENT = 0x06
    PULL_CURR_FILAMENT_OR_PURGE_OLD_FILAMENT = 0x07
    CHECK_POSITION = 0x08
    WAIT = 0x09
    CHECK_POSITION_AGAIN = 0x0B
    UNKNOWN = 0xFF


class SdCardState(int, Enum):
    """SD card state encoded in bits 8-9 of home_flag."""

    NO_SDCARD = 0
    HAS_SDCARD_NORMAL = 1
    HAS_SDCARD_ABNORMAL = 2
    HAS_SDCARD_READONLY = 3


class AmsTray(BaseModel):
    """Single AMS tray diagnostic information."""

    id: str
    material: str = "Empty"
    remain: int = 0
    color: str = "000000FF"
    nozzle_min: str = "?"
    nozzle_max: str = "?"
    tray_type: str = "Unknown"
    tray_info_idx: str = ""


class ExternalSpool(BaseModel):
    """Diagnostics for the machine's external VT spool."""

    id: str
    material: str = "External Spool"
    remain: int = 0
    color: str = "000000FF"
    nozzle_min: str = "?"
    nozzle_max: str = "?"
    tray_type: str = "External Spool"
    tray_info_idx: str = ""


class PrinterCapabilities(BaseModel):
    """Feature toggles available on the active printer."""

    model: str | None = None
    fields: Dict[str, Dict[str, bool]] = Field(default_factory=dict)


class AmsUnitCapabilities(BaseModel):
    """Feature toggles per AMS product."""

    product_name: str | None = None
    fields: Dict[str, Dict[str, bool]] = Field(default_factory=dict)


class AmsUnit(BaseModel):
    """Bambu AMS unit definition."""

    id: str
    ams_id: str
    humidity: str = "?"
    temp: str = "?"
    firmware: str = "N/A"
    product_name: str | None = None
    trays: List[AmsTray] = Field(default_factory=list)
    capabilities: AmsUnitCapabilities = Field(default_factory=AmsUnitCapabilities)


class AmsStatus(BaseModel):
    """Aggregated AMS information."""

    ams_hub_connected: str = "Disconnected"
    ams_status_main: str = AmsStatusMain.UNKNOWN.name
    ams_status_sub: str = AmsSubStatus.UNKNOWN.name
    total_ams: int = 0
    slots: List[AmsTray] = Field(default_factory=list)
    ams_units: List[AmsUnit] = Field(default_factory=list)
    external_spool: ExternalSpool | None = None
    tray_exist_bits: str = "0"
    tray_is_bbl_bits: str = "0"
    tray_tar: str = "255"
    tray_now: str = "255"
    tray_pre: str = "255"
    tray_read_done_bits: str = "0"
    tray_reading_bits: str = "0"
    active_tray_index: Optional[int] = None
    tray_exist_slots: List[bool] = Field(default_factory=list)
    version: str | None = None

class CameraStatus(str, Enum):
    """Represents the lifecycle of the internal camera pipeline."""

    STOPPED = "stopped"
    CONNECTING = "connecting"
    STREAMING = "streaming"
    STALL_WARNING = "stall_warning"
    RECONNECTING = "reconnecting"
    PAUSED = "paused"

class HMSError(BaseModel):
    code: str
    description: Optional[str] = None
    timestamp: Optional[str] = None

class PrintError(BaseModel):
    code: str
    description: str    

class LastSentProjectFile(BaseModel):
    """Snapshot of the last project_file command sent by the app."""

    command: str
    url: str
    file: str | None = None
    param: str | None = None
    bed_leveling: bool | None = None
    flow_cali: bool | None = None
    timelapse: bool | None = None
    use_ams: bool | None = None
    ams_mapping: list[int] | None = None
    layer_inspect: bool | None = None
    vibration_cali: bool | None = None
    sent_at: str | None = None


class PrintAgainState(BaseModel):
    """Derived information used to decide whether the print-again button is active."""

    visible: bool = False
    enabled: bool = False
    payload: dict[str, Any] | None = None
    reason: str | None = None


class SkipObjectPlate(BaseModel):
    index: int | str | None = None
    available: bool = False
    reason: str | None = None
    pick_path: str | None = None
    pick_url: str | None = None


class SkipObjectState(BaseModel):
    available: bool = False
    reason: str | None = None
    plates: list[SkipObjectPlate] = Field(default_factory=list)


class PrintStatus(BaseModel):
    """Real-time printer status."""

    nozzle_temp: float = 0.0
    nozzle_target_temper: float = 0.0
    bed_temp: float = 0.0
    bed_target_temper: float = 0.0
    chamber_temp: float = 0.0
    print_stage: str = "?"
    percent: int = 0
    remaining_time: int = 0
    layer: str = "0/0"
    gcode_state: PrinterGCodeState = PrinterGCodeState.UNKNOWN
    file: Optional[str] = None
    finish_time: str = "-"
    nozzle_type: str = "?"
    nozzle_diameter: str = "?"
    wifi_signal: str = "?"
    fan_gear: int = 0
    speed_level: int = 0
    speed_magnitude: int = 0
    heatbreak_fan_speed: str = "0"
    cooling_fan_speed: str = "0"
    print_error: Optional[PrintError] = None
    hms_errors: list[HMSError] = []
    chamber_light: str = "off"
    timelapse_enabled: bool = False
    sdcard: bool = False
    sdcard_state: str = SdCardState.NO_SDCARD.name
    firmware: str | None = None
    mc_print_sub_stage: int = 0
    hw_switch_state: str | None = None
    home_flag_features: list[dict[str, bool | None | str]] = Field(default_factory=list)
    feature_toggles: list[dict[str, bool | None | str]] = Field(default_factory=list)
    stg: list[int] = Field(default_factory=list)
    stg_cur: int = 0
    print_type: str = "idle"
    mc_print_line_number: str = "0"
    mc_print_stage: int = 0

    gcode_file_prepare_percent: int | None = None

    stage_labels: list[str] = Field(default_factory=list)
    stage_current_label: str | None = None
    skipped_objects: list[int] = Field(default_factory=list)
    skip_object_state: SkipObjectState | None = None
    print_again: PrintAgainState = Field(default_factory=PrintAgainState)


STAGE_DESCRIPTIONS: dict[int, str] = {
    0: "Printing",
    1: "Auto bed leveling",
    2: "Heatbed preheating",
    3: "Vibration compensation",
    4: "Changing filament",
    5: "M400 pause",
    6: "Paused (filament ran out)",
    7: "Heating nozzle",
    8: "Calibrating dynamic flow",
    9: "Scanning bed surface",
    10: "Inspecting first layer",
    11: "Identifying build plate type",
    12: "Calibrating Micro Lidar",
    13: "Homing toolhead",
    14: "Cleaning nozzle tip",
    15: "Checking extruder temperature",
    16: "Paused by the user",
    17: "Pause (front cover fall off)",
    18: "Calibrating the micro lidar",
    19: "Calibrating flow ratio",
    20: "Pause (nozzle temperature malfunction)",
    21: "Pause (heatbed temperature malfunction)",
    22: "Filament unloading",
    23: "Pause (step loss)",
    24: "Filament loading",
    25: "Motor noise cancellation",
    26: "Pause (AMS offline)",
    27: "Pause (low speed of the heatbreak fan)",
    28: "Pause (chamber temperature control problem)",
    29: "Cooling chamber",
    30: "Pause (Gcode inserted by user)",
    31: "Motor noise showoff",
    32: "Pause (nozzle clumping)",
    33: "Pause (cutter error)",
    34: "Pause (first layer error)",
    35: "Pause (nozzle clog)",
    36: "Measuring motion precision",
    37: "Enhancing motion precision",
    38: "Measure motion accuracy",
    39: "Nozzle offset calibration",
    40: "High temperature auto bed leveling",
    41: "Auto Check: Quick Release Lever",
    42: "Auto Check: Door and Upper Cover",
    43: "Laser Calibration",
    44: "Auto Check: Platform",
    45: "Confirming BirdsEye Camera location",
    46: "Calibrating BirdsEye Camera",
    47: "Auto bed leveling - phase 1",
    48: "Auto bed leveling - phase 2",
    49: "Heating chamber",
    50: "Cooling heatbed",
    51: "Printing calibration lines",
    52: "Auto Check: Material",
    53: "Live View Camera Calibration",
    54: "Waiting for heatbed target temperature",
    55: "Auto Check: Material Position",
    56: "Cutting Module Offset Calibration",
    57: "Measuring Surface",
    58: "Thermal Preconditioning for first layer",
    59: "Homing Blade Holder",
    60: "Calibrating Camera Offset",
    61: "Calibrating Blade Holder Position",
    62: "Hotend Pick and Place Test",
    63: "Waiting for chamber temperature to equalize",
    64: "Preparing Hotend",
    65: "Calibrating detection position of nozzle clumping",
    66: "Purifying the chamber air",
}


def resolve_stage_label(code: int | str | None) -> str:
    if code is None:
        return "-"
    try:
        numeric = int(code)
    except (TypeError, ValueError):
        return str(code)
    return STAGE_DESCRIPTIONS.get(numeric, f"Stage {numeric}")


def resolve_ams_status(value: int | None) -> tuple[str, str, int | None, int | None]:
    if value is None:
        return AmsStatusMain.UNKNOWN.name, AmsSubStatus.UNKNOWN.name, None, None
    try:
        raw = int(value)
    except (TypeError, ValueError):
        return AmsStatusMain.UNKNOWN.name, AmsSubStatus.UNKNOWN.name, None, None
    main_int = (raw & 0xFF00) >> 8
    sub_int = raw & 0xFF
    try:
        main_status = AmsStatusMain(main_int)
    except ValueError:
        main_status = AmsStatusMain.UNKNOWN
    try:
        sub_status = AmsSubStatus(sub_int)
    except ValueError:
        sub_status = AmsSubStatus.UNKNOWN
    return main_status.name, sub_status.name, main_int, sub_int


_HOME_FLAG_STATUS_BITS: dict[int, str] = {
    0: "X_AXIS_AT_HOME",
    1: "Y_AXIS_AT_HOME",
    2: "Z_AXIS_AT_HOME",
    3: "IS_220V_VOLTAGE",
    4: "STEP_LOSS_RECOVERY",
    7: "AMS_DETECT_REMAIN",
    10: "AMS_AUTO_REFILL",
}

_HOME_FLAG_SUPPORT_ONLY_BITS: dict[int, str] = {
    15: "FLOW_CALIBRATION",
    16: "PA_CALIBRATION",
    21: "MOTOR_NOISE_CALIBRATION",
    22: "USER_PRESET",
    30: "AGORA",
}

_HOME_FLAG_TOGGLE_BITS: dict[str, dict[str, int]] = {
    "FILAMENT_TANGLE_DETECT": {"support": 19, "enabled": 20},
    "NOZZLE_BLOB_DETECTION": {"support": 25, "enabled": 24},
    "UPGRADE_KIT": {"support": 27, "enabled": 26},
    "AIR_PRINT_DETECTION": {"support": 29, "enabled": 28},
    "PROMPT_SOUND": {"support": 18, "enabled": 17},
}


def parse_home_flag(value: int | None) -> tuple[list[dict[str, bool | None | str]], str]:
    if value is None:
        return [], SdCardState.NO_SDCARD.name
    try:
        raw = int(value)
    except (TypeError, ValueError):
        return [], SdCardState.NO_SDCARD.name
    features: list[dict[str, bool | None | str]] = []

    for bit, key in sorted(_HOME_FLAG_STATUS_BITS.items()):
        features.append(
            {
                "key": key,
                "supported": None,
                "enabled": bool(raw & (1 << bit)),
            }
        )

    for bit, key in sorted(_HOME_FLAG_SUPPORT_ONLY_BITS.items()):
        features.append(
            {
                "key": key,
                "supported": bool(raw & (1 << bit)),
                "enabled": None,
            }
        )

    for key, bits in sorted(_HOME_FLAG_TOGGLE_BITS.items()):
        support_bit = bits["support"]
        enabled_bit = bits["enabled"]
        features.append(
            {
                "key": key,
                "supported": bool(raw & (1 << support_bit)),
                "enabled": bool(raw & (1 << enabled_bit)),
            }
        )

    sd_state_value = (raw >> 8) & 0x03
    try:
        sd_state = SdCardState(sd_state_value).name
    except ValueError:
        sd_state = SdCardState.NO_SDCARD.name
    return features, sd_state

class PrinterEvent(BaseModel):
    """Event emitted from printer status transitions."""

    id: str = Field(default_factory=lambda: uuid4().hex)
    printer_id: str
    gcode_state: PrinterGCodeState = PrinterGCodeState.UNKNOWN
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    percent: int | None = None
    layer: str | None = None
    remaining_time: int | None = None
    finish_time: str | None = None
    speed_level: int | None = None
    file: str | None = None

class PrinterState(BaseModel):
    """Complete printer state snapshot."""

    print: PrintStatus = Field(default_factory=PrintStatus)
    ams: AmsStatus = Field(default_factory=AmsStatus)
    camera_frame: Optional[str] = None
    updated_at: str = ""
    printer_online: bool = False
    ftps_status: Literal["connected", "reconnecting", "disconnected"] = "disconnected"
    capabilities: PrinterCapabilities = Field(default_factory=PrinterCapabilities)
    camera_status: CameraStatus = CameraStatus.STOPPED
    camera_status_reason: Optional[str] = None
    last_sent_project_file: LastSentProjectFile | None = None


class CameraAccess(BaseModel):
    """Camera access descriptor for proxy/direct modes."""

    mode: Literal["proxy", "direct"]
    url: str
    source: Optional[str] = None
    stream_type: Optional[Literal["image", "webrtc"]] = None


def normalize_gcode_state(value: str | None) -> PrinterGCodeState:
    """Normalize raw gcode_state values emitted by printers."""

    raw = value
    if raw is None:
        return PrinterGCodeState.UNKNOWN
    normalized = str(raw).strip().upper()
    if not normalized:
        return PrinterGCodeState.UNKNOWN
    return _GCODE_STATE_ALIASES.get(normalized, PrinterGCodeState.UNKNOWN)
