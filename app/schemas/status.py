"""Response schemas for printer status endpoints."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    AmsStatus,
    CameraStatus,
    LastSentProjectFile,
    PrintStatus,
    PrinterCapabilities,
    PrinterGCodeState,
)


class StatusResponse(BaseModel):
    """Complete status response returned by `/api/status`."""

    printer_online: bool
    ftps_status: Literal["connected", "reconnecting", "disconnected"] = "disconnected"
    updated_at: str
    print: PrintStatus
    ams: AmsStatus
    capabilities: PrinterCapabilities
    camera_status: CameraStatus = CameraStatus.STOPPED
    camera_status_reason: str | None = None
    go2rtc_running: bool | None = None
    last_sent_project_file: LastSentProjectFile | None = None
    server_info: "ServerInfo"


class ServerInfo(BaseModel):
    """Metadata about the monitoring server."""

    start_time: str
    server_time: str
    uptime: str
    uptime_seconds: float


class PrinterInfoResponse(BaseModel):
    """Current printer configuration response."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "printer_1",
                "printer_ip": "192.168.1.86",
                "serial": "03919A3B0800100",
                "model": "X1 Carbon",
                "access_code": "91182137",
                "external_camera_url": "rtsp://user:pass@camera.local/stream",
                "mqtt_port": 8883,
                "ftp_port": 990,
                "cam_port": 6000,
            }
        }
    )

    id: str
    printer_ip: str
    serial: str
    model: str
    access_code: str
    external_camera_url: str | None = None
    mqtt_port: int
    ftp_port: int
    cam_port: int



class PrinterStatusSummary(BaseModel):
    """Lightweight snapshot of the latest print status."""

    gcode_state: PrinterGCodeState | None = None
    layer: str | None = None
    percent: int | None = None
    remaining_time: int | None = None
    finish_time: str | None = None
    speed_level: int | None = None
    file: str | None = None
    hms_error: str | None = None


class PrinterListItem(BaseModel):
    """Slim representation used by the dashboard for printer switching."""

    id: str
    printer_ip: str
    serial: str
    model: str
    access_code: str
    external_camera_url: str | None = None
    is_active: bool = False
    online: bool = False
    is_default: bool = False
    status_summary: PrinterStatusSummary | None = None


class SelectPrinterRequest(BaseModel):
    """Request payload used to switch the active printer."""

    printer_id: str = Field(..., description="Identifier of the printer to activate")


class DeviceModuleInfo(BaseModel):
    """Metadata returned from the onboarding get_version command."""

    name: str
    product_name: str | None = None
    sw_ver: str | None = None
    visible: bool | None = None


class CreatePrinterRequest(BaseModel):
    """Payload used to register a new printer."""

    id: str = Field(..., description="Unique printer identifier")
    printer_ip: str = Field(..., description="IP address of the printer")
    access_code: str = Field(..., description="Access code displayed by the printer")
    serial: str = Field(..., description="Serial number used for MQTT communication")
    external_camera_url: str | None = Field(
        default=None,
        description="External RTSP/RTPS camera URL",
    )
    skip_verify: bool = Field(
        False,
        description="Skip printer verification when only metadata changes",
    )
    make_default: bool = Field(
        False,
        description="When true, mark the registered printer as the default entry",
    )


class CreatePrinterResponse(BaseModel):
    """Response returned after successfully onboarding and storing a printer."""

    printer: PrinterInfoResponse
    firmware: str | None = None
    modules: list[DeviceModuleInfo] = []
    ams_modules: list[str] = []


class DeletePrinterResponse(BaseModel):
    """Response returned after deleting a printer definition."""

    removed_id: str
    remaining: int
    active_printer: PrinterInfoResponse | None = None
