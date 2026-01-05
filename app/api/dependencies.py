"""FastAPI dependency providers."""
from dataclasses import dataclass

from fastapi import Depends, Query, Request

from app.core.exceptions import ServiceUnavailableError

from app.models import PrinterState
from app.services.debug_service import DebugService
from app.services.filament_capture_service import FilamentCaptureService
from app.services.filament_catalog_service import FilamentCatalogService
from app.services.ftps_service import FTPSService
from app.services.health_service import HealthService
from app.services.mqtt_service import MQTTService
from app.services.camera_service import CameraService
from app.services.printer_presence_service import PrinterPresenceService
from app.services.printer_config_service import PrinterConfigService
from app.services.registry import ServiceRegistry
from app.services.state_manager import StateManager
from app.services.print_job_service import PrintJobService
from app.services.event_service import EventService
from app.services.state_stream_service import StateStreamService


@dataclass(slots=True)
class DeviceContext:
    """Resolved device state and services for a target printer."""

    registry: ServiceRegistry
    state_manager: StateManager
    printer_id: str
    state: PrinterState
    is_active: bool
    mqtt_service: MQTTService | None
    ftps_service: FTPSService | None
    camera_service: CameraService | None

    def require_mqtt(self) -> MQTTService:
        if not self.mqtt_service:
            raise ServiceUnavailableError("Printer not configured yet")
        return self.mqtt_service

    def require_ftps(self) -> FTPSService:
        if not self.ftps_service:
            raise ServiceUnavailableError("Printer not configured yet")
        return self.ftps_service


def get_service_registry(request: Request) -> ServiceRegistry:
    """Return the service registry stored on the FastAPI application state."""

    registry = request.app.state.services
    if not isinstance(registry, ServiceRegistry):
        raise RuntimeError("Service registry not initialised")
    return registry


def get_state_manager(registry: ServiceRegistry = Depends(get_service_registry)) -> StateManager:
    return registry.state_manager


def get_ftps_service(registry: ServiceRegistry = Depends(get_service_registry)):
    service = registry.ftps_service
    if service is None:
        raise ServiceUnavailableError("Printer not configured yet")
    return service


def get_debug_service(
    registry: ServiceRegistry = Depends(get_service_registry)
) -> DebugService:
    """Return the singleton DebugService from the registry."""
    return registry.debug_service


def get_filament_catalog_service(
    registry: ServiceRegistry = Depends(get_service_registry),
) -> FilamentCatalogService:
    return registry.filament_catalog_service


def get_filament_capture_service(
    registry: ServiceRegistry = Depends(get_service_registry),
) -> FilamentCaptureService:
    return registry.filament_capture_service


def get_presence_service(registry: ServiceRegistry = Depends(get_service_registry)) -> PrinterPresenceService:
    return registry.presence_service


async def get_device_context(
    printer_id: str | None = Query(default=None),
    registry: ServiceRegistry = Depends(get_service_registry),
    state_manager: StateManager = Depends(get_state_manager),
) -> DeviceContext:
    target_id = printer_id or registry.settings.printer_id
    state = await state_manager.get_state(target_id)
    is_active = target_id == registry.settings.printer_id
    mqtt_service = registry.mqtt_service if is_active else None
    ftps_service = registry.ftps_service if is_active else None
    camera_service = registry.camera_service if is_active else None
    return DeviceContext(
        registry=registry,
        state_manager=state_manager,
        printer_id=target_id,
        state=state,
        is_active=is_active,
        mqtt_service=mqtt_service,
        ftps_service=ftps_service,
        camera_service=camera_service,
    )


async def get_active_device_context(
    registry: ServiceRegistry = Depends(get_service_registry),
    state_manager: StateManager = Depends(get_state_manager),
) -> DeviceContext:
    return await get_device_context(
        printer_id=None,
        registry=registry,
        state_manager=state_manager,
    )


def get_printer_config_service(
    registry: ServiceRegistry = Depends(get_service_registry),
    presence_service: PrinterPresenceService = Depends(get_presence_service),
    state_manager: StateManager = Depends(get_state_manager),
) -> PrinterConfigService:
    return PrinterConfigService(
        registry=registry,
        presence_service=presence_service,
        state_manager=state_manager,
    )


def get_health_service(
    registry: ServiceRegistry = Depends(get_service_registry),
    state_manager: StateManager = Depends(get_state_manager),
    ftps_service: FTPSService = Depends(get_ftps_service),
) -> HealthService:
    return HealthService(
        registry=registry,
        state_manager=state_manager,
        ftps_service=ftps_service,
    )


def get_print_job_service(
    registry: ServiceRegistry = Depends(get_service_registry)
) -> PrintJobService:
    return registry.print_job_service

def get_event_service(registry: ServiceRegistry = Depends(get_service_registry)) -> EventService:
    return registry.event_service


def get_state_stream_service(
    registry: ServiceRegistry = Depends(get_service_registry),
) -> StateStreamService:
    return registry.state_stream_service
