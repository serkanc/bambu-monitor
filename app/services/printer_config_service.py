"""Printer configuration and status orchestration helpers."""
from __future__ import annotations

import logging

from app.core.config import (
    PrinterConfig,
    get_default_printer_id,
    get_settings,
    list_printer_definitions_async,
    register_printer,
    remove_printer,
    set_default_printer,
    update_printer,
)
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    InternalError,
    NotFoundError,
)
from app.core.server_info import (
    format_uptime,
    get_server_start_time,
    get_server_time,
    get_uptime_seconds,
)
from app.models import PrinterGCodeState
from app.schemas import (
    CreatePrinterRequest,
    CreatePrinterResponse,
    DeletePrinterResponse,
    DeviceModuleInfo,
    PrinterInfoResponse,
    PrinterListItem,
    PrinterStatusSummary,
    SelectPrinterRequest,
    ServerInfo,
    StatusResponse,
)
from app.services.printer_onboarding_service import DeviceProbeResult
from app.services.printer_presence_service import PrinterPresenceService
from app.services.registry import ServiceRegistry
from app.services.state_manager import StateManager

logger = logging.getLogger(__name__)


class PrinterConfigService:
    """Service layer for printer configuration endpoints."""

    def __init__(
        self,
        registry: ServiceRegistry,
        presence_service: PrinterPresenceService,
        state_manager: StateManager,
    ) -> None:
        self._registry = registry
        self._presence_service = presence_service
        self._state_manager = state_manager

    async def read_status(self, printer_id: str | None) -> StatusResponse:
        target_id = printer_id or self._registry.settings.printer_id
        state = await self._state_manager.get_state(target_id)
        camera_service = self._registry.camera_service
        go2rtc_running = (
            bool(camera_service and camera_service.is_go2rtc_running())
            if camera_service
            else None
        )
        last_sent_project_file = state.last_sent_project_file
        if (
            last_sent_project_file is None
            and self._registry.print_job_service
        ):
            last_sent_project_file = await self._registry.print_job_service.get_last_sent_project_file(
                target_id
            )
        uptime_seconds = get_uptime_seconds()
        return StatusResponse(
            printer_online=state.printer_online,
            ftps_status=state.ftps_status,
            updated_at=state.updated_at,
            print=state.print,
            ams=state.ams,
            capabilities=state.capabilities,
            camera_status=state.camera_status,
            camera_status_reason=state.camera_status_reason,
            go2rtc_running=go2rtc_running,
            last_sent_project_file=last_sent_project_file,
            server_info=ServerInfo(
                start_time=get_server_start_time().isoformat(),
                server_time=get_server_time().isoformat(),
                uptime=format_uptime(uptime_seconds),
                uptime_seconds=uptime_seconds,
            ),
        )

    def get_current_printer(self) -> PrinterInfoResponse:
        settings = self._registry.settings
        return PrinterInfoResponse(
            id=settings.printer_id,
            printer_ip=settings.printer_ip,
            serial=settings.serial,
            model=settings.printer_model,
            access_code=settings.access_code,
            external_camera_url=settings.external_camera_url,
            mqtt_port=settings.mqtt_port,
            ftp_port=settings.ftp_port,
            cam_port=settings.cam_port,
        )

    async def list_printers(self) -> list[PrinterListItem]:
        printers = await list_printer_definitions_async()
        active_id = self._registry.settings.printer_id
        presence_states = await self._presence_service.list_states()
        default_id = get_default_printer_id()

        def is_online(printer_id: str) -> bool:
            state = presence_states.get(printer_id)
            return bool(state and state.online)

        async def build_summary(printer_id: str) -> PrinterStatusSummary | None:
            try:
                state = await self._state_manager.get_state(printer_id)
            except Exception:  # noqa: BLE001
                return None
            if not state:
                return None

            gcode_state = state.print.gcode_state or PrinterGCodeState.UNKNOWN
            if isinstance(gcode_state, str):
                try:
                    gcode_state = PrinterGCodeState(gcode_state.upper())
                except ValueError:
                    gcode_state = PrinterGCodeState.UNKNOWN
            error_text = None
            if state.print.hms_errors:
                first_error = state.print.hms_errors[0]
                parts = []
                if first_error.code:
                    parts.append(str(first_error.code))
                if first_error.description:
                    parts.append(str(first_error.description))
                error_text = " - ".join(parts) if parts else None

            summary = PrinterStatusSummary(
                gcode_state=gcode_state if gcode_state != PrinterGCodeState.UNKNOWN else None,
                layer=state.print.layer if state.print.layer not in (None, "", "0/0") else None,
                percent=state.print.percent,
                remaining_time=state.print.remaining_time,
                finish_time=state.print.finish_time if state.print.finish_time not in (None, "-", "") else None,
                speed_level=state.print.speed_level,
                file=state.print.file or None,
                hms_error=error_text,
            )
            return summary

        summaries: dict[str, PrinterStatusSummary | None] = {}
        for printer in printers:
            summaries[printer.id] = await build_summary(printer.id)

        ordered_printers = sorted(
            printers,
            key=lambda printer: 0 if printer.id == default_id else 1,
        )

        return [
            PrinterListItem(
                id=printer.id,
                printer_ip=printer.printer_ip,
                serial=printer.serial,
                model=printer.model,
                access_code=printer.access_code,
                external_camera_url=printer.external_camera_url,
                is_active=printer.id == active_id,
                online=is_online(printer.id),
                is_default=printer.id == default_id,
                status_summary=summaries.get(printer.id),
            )
            for printer in ordered_printers
        ]

    async def verify_printer(self, payload: CreatePrinterRequest) -> CreatePrinterResponse:
        onboarding = self._registry.create_onboarding_service()

        try:
            probe_result = await onboarding.probe_printer(
                printer_ip=payload.printer_ip,
                access_code=payload.access_code,
                serial=payload.serial,
            )
        except RuntimeError as exc:
            raise BadRequestError(str(exc)) from exc

        return self._build_onboarding_response(payload, probe_result)

    async def update_printer(
        self,
        printer_id: str,
        payload: CreatePrinterRequest,
    ) -> CreatePrinterResponse:
        printers = await list_printer_definitions_async()
        existing = next((printer for printer in printers if printer.id == printer_id), None)
        if existing is None:
            raise NotFoundError(f"Printer with id '{printer_id}' not found")

        skip_verify = (
            payload.skip_verify
            and payload.printer_ip == existing.printer_ip
            and payload.serial == existing.serial
            and payload.access_code == existing.access_code
        )

        if skip_verify:
            probe_result = DeviceProbeResult(
                product_name=existing.model,
                firmware=None,
                modules=[],
            )
        else:
            onboarding = self._registry.create_onboarding_service()
            try:
                probe_result = await onboarding.probe_printer(
                    printer_ip=payload.printer_ip,
                    access_code=payload.access_code,
                    serial=payload.serial,
                )
            except RuntimeError as exc:
                raise BadRequestError(str(exc)) from exc

        printer_config = PrinterConfig(
            id=payload.id,
            printer_ip=payload.printer_ip,
            access_code=payload.access_code,
            serial=payload.serial,
            model=probe_result.product_name,
            external_camera_url=payload.external_camera_url,
        )

        try:
            update_printer(printer_id, printer_config)
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise InternalError(str(exc)) from exc

        if payload.make_default:
            try:
                set_default_printer(printer_config.id)
            except ValueError as exc:
                raise InternalError(str(exc)) from exc

        response = self._build_onboarding_response(payload, probe_result)
        await self._presence_service.remove_printer(printer_id)
        await self._presence_service.add_printer(printer_config)

        if self._registry.settings.printer_id == printer_id:
            try:
                new_settings = get_settings(printer_id=printer_config.id)
                await self._registry.reconfigure(new_settings, force=True)
                await self._state_manager.set_printer_online(new_settings.printer_id, True)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Failed to reconfigure services after printer update: %s", exc)
                raise InternalError("Printer updated but server configuration failed") from exc

        return response

    async def register_printer(self, payload: CreatePrinterRequest) -> CreatePrinterResponse:
        onboarding = self._registry.create_onboarding_service()

        try:
            probe_result = await onboarding.probe_printer(
                printer_ip=payload.printer_ip,
                access_code=payload.access_code,
                serial=payload.serial,
            )
        except RuntimeError as exc:
            raise BadRequestError(str(exc)) from exc

        printer_config = PrinterConfig(
            id=payload.id,
            printer_ip=payload.printer_ip,
            access_code=payload.access_code,
            serial=payload.serial,
            model=probe_result.product_name,
            external_camera_url=payload.external_camera_url,
        )

        was_configured = self._registry.has_configured_printer

        try:
            register_printer(printer_config)
        except ValueError as exc:
            raise ConflictError(str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise InternalError(str(exc)) from exc

        if payload.make_default:
            try:
                set_default_printer(printer_config.id)
            except ValueError as exc:
                raise InternalError(str(exc)) from exc

        await self._presence_service.add_printer(printer_config)

        response = self._build_onboarding_response(payload, probe_result)

        if not was_configured:
            try:
                new_settings = get_settings(printer_id=printer_config.id)
                await self._registry.reconfigure(new_settings)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Failed to apply new printer configuration: %s", exc)
                raise InternalError("Printer added but server configuration failed") from exc

        return response

    async def delete_printer(self, printer_id: str) -> DeletePrinterResponse:
        printers = await list_printer_definitions_async()
        target = next((printer for printer in printers if printer.id == printer_id), None)
        if target is None:
            raise NotFoundError(f"Printer with id '{printer_id}' not found")
        if len(printers) <= 1:
            raise ConflictError("En az bir yazici kaydi bulunmalidir.")

        try:
            updated_config = remove_printer(printer_id)
        except ValueError as exc:
            raise NotFoundError(str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise InternalError(str(exc)) from exc

        await self._presence_service.remove_printer(printer_id)

        new_active: PrinterInfoResponse | None = None
        if self._registry.settings.printer_id == printer_id:
            fallback = updated_config.printers[0]
            try:
                new_settings = get_settings(printer_id=fallback.id)
            except Exception as exc:  # noqa: BLE001
                raise InternalError(str(exc)) from exc
            await self._registry.reconfigure(new_settings)
            new_active = PrinterInfoResponse(
                id=new_settings.printer_id,
                printer_ip=new_settings.printer_ip,
                serial=new_settings.serial,
                model=new_settings.printer_model,
                access_code=new_settings.access_code,
                external_camera_url=new_settings.external_camera_url,
                mqtt_port=new_settings.mqtt_port,
                ftp_port=new_settings.ftp_port,
                cam_port=new_settings.cam_port,
            )

        return DeletePrinterResponse(
            removed_id=printer_id,
            remaining=len(updated_config.printers),
            active_printer=new_active,
        )

    async def select_printer(self, payload: SelectPrinterRequest) -> PrinterInfoResponse:
        try:
            new_settings = get_settings(printer_id=payload.printer_id)
        except ValueError as exc:
            raise NotFoundError(str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise BadRequestError(str(exc)) from exc

        presence_state = await self._presence_service.get_state(payload.printer_id)
        if presence_state is not None and not presence_state.online:
            raise ConflictError("Secilen yazici cevrim disi oldugu icin aktif edilemez.")

        await self._registry.reconfigure(new_settings)
        return PrinterInfoResponse(
            id=new_settings.printer_id,
            printer_ip=new_settings.printer_ip,
            serial=new_settings.serial,
            model=new_settings.printer_model,
            access_code=new_settings.access_code,
            external_camera_url=new_settings.external_camera_url,
            mqtt_port=new_settings.mqtt_port,
            ftp_port=new_settings.ftp_port,
            cam_port=new_settings.cam_port,
        )

    def set_default_printer(self, printer_id: str) -> PrinterInfoResponse:
        try:
            updated_config = set_default_printer(printer_id)
        except ValueError as exc:
            raise NotFoundError(str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise InternalError(str(exc)) from exc

        target = next(
            (entry for entry in updated_config.printers if entry.id == printer_id),
            None,
        )
        if target is None:
            raise NotFoundError(f"Printer with id '{printer_id}' not found")

        settings = self._registry.settings
        return PrinterInfoResponse(
            id=target.id,
            printer_ip=target.printer_ip,
            serial=target.serial,
            model=target.model,
            access_code=target.access_code,
            external_camera_url=target.external_camera_url,
            mqtt_port=settings.mqtt_port,
            ftp_port=settings.ftp_port,
            cam_port=settings.cam_port,
        )

    def _build_onboarding_response(
        self,
        payload: CreatePrinterRequest,
        probe_result: DeviceProbeResult,
    ) -> CreatePrinterResponse:
        response_printer = PrinterInfoResponse(
            id=payload.id,
            printer_ip=payload.printer_ip,
            serial=payload.serial,
            model=probe_result.product_name,
            access_code=payload.access_code,
            external_camera_url=payload.external_camera_url,
            mqtt_port=self._registry.settings.mqtt_port,
            ftp_port=self._registry.settings.ftp_port,
            cam_port=self._registry.settings.cam_port,
        )

        module_records = [
            DeviceModuleInfo(
                name=module.name,
                product_name=module.product_name,
                sw_ver=module.sw_ver,
                visible=module.visible,
            )
            for module in probe_result.modules
        ]

        ams_modules = [
            module.product_name or module.name
            for module in probe_result.modules
            if module.product_name and "ams" in module.product_name.lower()
        ]

        return CreatePrinterResponse(
            printer=response_printer,
            firmware=probe_result.firmware,
            modules=module_records,
            ams_modules=ams_modules,
        )
