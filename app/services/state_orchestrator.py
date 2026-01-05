"""Handle derived state updates by composing repository, assembler, and notifier."""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from app.models import AmsStatus, CameraStatus, LastSentProjectFile, SkipObjectState
from app.services.filament_capture_service import FilamentCaptureService
from app.services.utils.capability_resolver import CapabilityResolver
from app.services.utils.spool_resolver import SpoolResolver
from app.services.state_assembler import StateAssembler
from app.services.state_notifier import StateNotifier
from app.services.state_repository import StateRepository
from app.services.utils.print_again import update_print_again_state

logger = logging.getLogger(__name__)


class StateOrchestrator:
    """Coordinated updater that merges payloads and notifies listeners."""

    def __init__(
        self,
        repository: StateRepository,
        notifier: StateNotifier,
        *,
        capability_resolver: CapabilityResolver | None = None,
        spool_resolver: SpoolResolver | None = None,
        filament_capture_service: FilamentCaptureService | None = None,
        assembler: StateAssembler | None = None,
        print_job_service: object | None = None,
    ) -> None:
        self._repository = repository
        self._notifier = notifier
        self._capability_resolver = capability_resolver or CapabilityResolver()
        self._spool_resolver = spool_resolver or SpoolResolver()
        self._filament_capture_service = filament_capture_service or FilamentCaptureService()
        self._assembler = assembler or StateAssembler(
            capability_resolver=self._capability_resolver,
            spool_resolver=self._spool_resolver,
        )
        self._print_job_service = print_job_service
        self._skip_object_file_cache: dict[str, str] = {}

    def set_print_job_service(self, service: object | None) -> None:
        self._print_job_service = service

    async def update_print_data(self, printer_id: str, payload: Dict[str, Any]) -> None:
        try:
            await self._filament_capture_service.ingest_payload(printer_id, payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to capture filament payload: %s", exc)

        async def _update(store: Any):
            store.master_data = self._deep_merge(store.master_data, payload)
            await self._assembler.assemble(printer_id, store.master_data, store.state)
            await self._maybe_update_skip_object_state(printer_id, store)
            return store.state.copy(deep=True)

        state_snapshot = await self._repository.update_store(printer_id, _update)
        await self._notifier.notify(printer_id, state_snapshot)

    async def set_last_sent_project_file(
        self,
        printer_id: str,
        record: LastSentProjectFile | None,
    ) -> None:
        async def _update(store: Any):
            store.state.last_sent_project_file = record
            update_print_again_state(store.state)
            store.state.updated_at = self._current_time()
            return store.state.copy(deep=True)

        state_snapshot = await self._repository.update_store(printer_id, _update)
        await self._notifier.notify(printer_id, state_snapshot)

    async def _maybe_update_skip_object_state(self, printer_id: str, store: Any) -> None:
        if not self._print_job_service:
            return
        filename = store.state.print.file
        if not filename:
            store.state.print.skip_object_state = None
            return
        safe_name = Path(str(filename)).name
        last_file = self._skip_object_file_cache.get(printer_id)
        if last_file == safe_name and store.state.print.skip_object_state is not None:
            return
        result = await self._print_job_service.get_cached_metadata_result_local(
            printer_id,
            safe_name,
        )
        skip_payload = result.get("skip_object") if isinstance(result, dict) else None
        if skip_payload is None:
            store.state.print.skip_object_state = None
        else:
            try:
                store.state.print.skip_object_state = SkipObjectState(**skip_payload)
            except Exception:
                store.state.print.skip_object_state = None
        self._skip_object_file_cache[printer_id] = safe_name

    async def set_skip_object_state(
        self,
        printer_id: str,
        record: dict | None,
    ) -> None:
        async def _update(store: Any):
            if record is None:
                store.state.print.skip_object_state = None
            else:
                try:
                    store.state.print.skip_object_state = SkipObjectState(**record)
                except Exception:
                    store.state.print.skip_object_state = None
            store.state.updated_at = self._current_time()
            return store.state.copy(deep=True)

        state_snapshot = await self._repository.update_store(printer_id, _update)
        await self._notifier.notify(printer_id, state_snapshot)

    async def update_camera_frame(self, printer_id: str, frame: str) -> None:
        async def _update(store: Any):
            store.state.camera_frame = frame
            store.state.updated_at = self._current_time()

        await self._repository.update_store(printer_id, _update)

    async def set_printer_online(self, printer_id: str, online: bool) -> None:
        async def _update(store: Any):
            store.state.printer_online = online
            if not online:
                store.state.ams = AmsStatus()
            store.state.updated_at = self._current_time()
            return store.state.copy(deep=True)

        state_snapshot = await self._repository.update_store(printer_id, _update)
        await self._notifier.notify(printer_id, state_snapshot)

    async def set_ftps_status(self, printer_id: str, status: str) -> None:
        async def _update(store: Any):
            if store.state.ftps_status == status:
                return None
            store.state.ftps_status = status
            store.state.updated_at = self._current_time()
            return store.state.copy(deep=True)

        state_snapshot = await self._repository.update_store(printer_id, _update)
        if state_snapshot:
            await self._notifier.notify(printer_id, state_snapshot)

    async def set_camera_status(
        self,
        printer_id: str,
        status: CameraStatus,
        reason: Optional[str] = None,
    ) -> None:
        async def _update(store: "StateRepository._PrinterStore"):
            if (
                store.state.camera_status == status
                and store.state.camera_status_reason == reason
            ):
                return None
            store.state.camera_status = status
            store.state.camera_status_reason = reason
            store.state.updated_at = self._current_time()
            return store.state.copy(deep=True)

        state_snapshot = await self._repository.update_store(printer_id, _update)
        if state_snapshot:
            await self._notifier.notify(printer_id, state_snapshot)

    def _deep_merge(self, master: Dict[str, Any], new: Dict[str, Any]) -> Dict[str, Any]:
        result = master.copy()

        for key, value in new.items():
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = self._deep_merge(result[key], value)
            elif value in (None, "", "?", "0/0"):
                continue
            elif isinstance(value, str) and not value.strip():
                continue
            else:
                result[key] = value

        return result

    @staticmethod
    def _current_time() -> str:
        return datetime.now().strftime("%H:%M:%S")
