"""Service registry that wires all application services together."""
import asyncio
import logging
from typing import Optional

from app.core.config import (
    DEFAULT_CAM_DEVICE_ID,
    DEFAULT_CAM_PORT,
    DEFAULT_FTP_PORT,
    DEFAULT_MQTT_PORT,
    DEFAULT_USERNAME,
    Settings,
    get_app_config,
)
from app.core.request_context import request_context
from app.core.tasks import LifecycleManager
from app.services.camera_service import CameraService
from app.services.connection_orchestrator import ConnectionOrchestrator
from app.services.debug_service import DebugService
from app.services.filament_capture_service import FilamentCaptureService
from app.services.ftps_service import FTPSService
from app.services.filament_catalog_service import FilamentCatalogService
from app.services.mqtt_service import MQTTService
from app.services.printer_onboarding_service import PrinterOnboardingService
from app.services.printer_presence_service import PrinterPresenceService
from app.services.utils.capability_resolver import CapabilityResolver
from app.services.utils.spool_resolver import SpoolResolver
from app.services.state_manager import StateManager
from app.services.state_notifier import StateNotifier
from app.services.state_orchestrator import StateOrchestrator
from app.services.state_repository import StateRepository
from app.services.state_stream_service import StateStreamService
from app.services.state_assembler import StateAssembler
from app.services.event_service import EventService
from app.services.print_job_service import PrintJobService

logger = logging.getLogger(__name__)


class ServiceRegistry:
    """Container object for dependency injection."""

    def __init__(self, settings: Settings | None) -> None:
        self._app_config = get_app_config()
        self._configured_settings = settings
        self.settings = settings or self._build_placeholder_settings()
        self.state_repository = StateRepository()
        self.state_notifier = StateNotifier()
        self.capability_resolver = CapabilityResolver()
        self.spool_resolver = SpoolResolver()
        self.filament_capture_service = FilamentCaptureService()
        self.state_assembler = StateAssembler(
            capability_resolver=self.capability_resolver,
            spool_resolver=self.spool_resolver,
        )
        self.state_orchestrator = StateOrchestrator(
            repository=self.state_repository,
            notifier=self.state_notifier,
            capability_resolver=self.capability_resolver,
            spool_resolver=self.spool_resolver,
            filament_capture_service=self.filament_capture_service,
            assembler=self.state_assembler,
        )
        self.state_manager = StateManager(
            repository=self.state_repository,
            orchestrator=self.state_orchestrator,
        )
        if self._configured_settings:
            self.state_manager.set_active_printer(self._configured_settings.printer_id)
        self.state_stream_service = StateStreamService(
            repository=self.state_repository,
            notifier=self.state_notifier,
        )
        self.event_service = EventService(self.state_notifier)
        self.debug_service = DebugService(repository=self.state_repository)
        self.presence_service = PrinterPresenceService(
            self.settings,
            repository=self.state_repository,
            orchestrator=self.state_orchestrator,
        )
        self.filament_catalog_service = FilamentCatalogService()
        self._build_services(self._configured_settings)
        self._build_print_job_service()
        self.connection_orchestrator = ConnectionOrchestrator(
            mqtt_service=self.mqtt_service,
            ftps_service=self.ftps_service,
            camera_service=self.camera_service,
            presence_service=self.presence_service,
        )
        self._startup_lock = asyncio.Lock()
        self._shutdown_lock = asyncio.Lock()
        self._reconfigure_lock = asyncio.Lock()
        self._lifecycle = LifecycleManager(name="service-registry", logger=logger)

    def _build_placeholder_settings(self) -> Settings:
        return Settings(
            printer_id="__unconfigured__",
            printer_ip="0.0.0.0",
            access_code="00000000",
            serial="0000000000000000",
            printer_model="Unconfigured",
            external_camera_url=None,
            username=DEFAULT_USERNAME,
            mqtt_port=DEFAULT_MQTT_PORT,
            ftp_port=DEFAULT_FTP_PORT,
            cam_port=DEFAULT_CAM_PORT,
            cam_device_id=DEFAULT_CAM_DEVICE_ID,
            pushall_interval=self._app_config.pushall_interval,
            cam_interval=self._app_config.cam_interval,
            host=self._app_config.host,
            port=self._app_config.port,
            log_level=self._app_config.log_level,
            go2rtc_port=self._app_config.go2rtc_port,
            go2rtc_path=self._app_config.go2rtc_path,
            go2rtc_log_output=self._app_config.go2rtc_log_output,
        )

    @property
    def has_configured_printer(self) -> bool:
        return self._configured_settings is not None

    def _build_services(self, settings: Settings | None) -> None:
        if not settings:
            self.ftps_service = None
            self.camera_service = None
            self.mqtt_service = None
            return
        self.ftps_service = FTPSService(settings)
        self._wire_ftps_connection()
        self.camera_service = CameraService(settings, self.state_orchestrator)
        self.mqtt_service = MQTTService(settings, self.state_orchestrator, self.debug_service)

    def _build_print_job_service(self) -> None:
        self.print_job_service = PrintJobService(
            ftps_service=self.ftps_service,
            mqtt_service=self.mqtt_service,
            state_orchestrator=self.state_orchestrator,
        )
        self.state_orchestrator.set_print_job_service(self.print_job_service)

    def _wire_ftps_connection(self) -> None:
        if not self.ftps_service:
            return
        self.ftps_service.set_connection_listener(
            lambda status: self.state_orchestrator.set_ftps_status(
                self.settings.printer_id,
                status,
            )
        )

    def create_onboarding_service(self) -> PrinterOnboardingService:
        """Factory for printer onboarding helper that shares registry credentials."""

        return PrinterOnboardingService(
            username=self.settings.printer_username,
            mqtt_port=self.settings.mqtt_port,
        )

    async def startup(self, *, start_presence: bool = True) -> None:
        async with self._startup_lock:
            with request_context("bg:registry"):
                logger.info("Starting background services")
                self._build_print_job_service()
                self.state_stream_service.reset()
                start_steps = []
                if self._configured_settings and self.connection_orchestrator:
                    start_steps.append(self.connection_orchestrator.start)
                elif start_presence and self.presence_service:
                    start_steps.append(self.presence_service.start)
                await self._lifecycle.start(start_steps)
                logger.info("Background services started")

    async def shutdown(self, *, stop_presence: bool = True) -> None:
        async with self._shutdown_lock:
            with request_context("bg:registry"):
                logger.info("Stopping background services")
                if self.print_job_service:
                    await self.print_job_service.shutdown()
                await self.state_stream_service.shutdown()
                stop_steps = []
                if self.connection_orchestrator:
                    stop_steps.append(self.connection_orchestrator.stop)
                elif stop_presence and self.presence_service:
                    stop_steps.append(self.presence_service.stop)
                await self._lifecycle.stop(stop_steps)
                await self._lifecycle.cancel_tracked()
                logger.info("Background services stopped")

    async def reconfigure(self, new_settings: Settings, *, force: bool = False) -> None:
        """Restart all services using a new printer configuration."""

        async with self._reconfigure_lock:
            if (
                not force
                and self._configured_settings
                and new_settings.printer_id == self._configured_settings.printer_id
            ):
                logger.info(
                    "Printer %s already active, skipping reconfigure", new_settings.printer_id
                )
                return

            logger.info("Switching active printer to %s", new_settings.printer_id)
            await self.shutdown(stop_presence=False)
            self._configured_settings = new_settings
            self.settings = new_settings
            self.state_manager.set_active_printer(new_settings.printer_id)
            self._build_services(new_settings)
            self.connection_orchestrator = ConnectionOrchestrator(
                mqtt_service=self.mqtt_service,
                ftps_service=self.ftps_service,
                camera_service=self.camera_service,
                presence_service=self.presence_service,
            )
            await self.startup(start_presence=False)
