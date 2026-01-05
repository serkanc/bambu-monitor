"""Facade that exposes state read/observe APIs while delegating mutations."""
from __future__ import annotations

from typing import Any, Dict, Optional

from app.models import CameraStatus, PrinterState
from app.services.state_orchestrator import StateOrchestrator
from app.services.state_repository import StateRepository


class StateManager:
    """Pass-through layer used by routes and legacy consumers."""

    def __init__(self, repository: StateRepository, orchestrator: StateOrchestrator) -> None:
        self._repository = repository
        self._orchestrator = orchestrator

    def set_active_printer(self, printer_id: str) -> None:
        self._repository.set_active_printer(printer_id)

    def get_active_printer_id(self) -> Optional[str]:
        return self._repository.get_active_printer_id()

    def is_active_printer(self, printer_id: str) -> bool:
        return self._repository.is_active_printer(printer_id)

    async def get_state(self, printer_id: Optional[str] = None) -> PrinterState:
        return await self._repository.get_state(printer_id)

    async def get_master_data(self, printer_id: Optional[str] = None) -> Dict[str, Any]:
        return await self._repository.get_master_data(printer_id)

    async def update_print_data(self, printer_id: str, payload: Dict[str, Any]) -> None:
        await self._orchestrator.update_print_data(printer_id, payload)

    async def set_skip_object_state(self, printer_id: str, payload: dict | None) -> None:
        await self._orchestrator.set_skip_object_state(printer_id, payload)

    async def update_camera_frame(self, printer_id: str, frame: str) -> None:
        await self._orchestrator.update_camera_frame(printer_id, frame)

    async def set_printer_online(self, printer_id: str, online: bool) -> None:
        await self._orchestrator.set_printer_online(printer_id, online)

    async def set_ftps_status(self, printer_id: str, status: str) -> None:
        await self._orchestrator.set_ftps_status(printer_id, status)

    async def set_camera_status(
        self,
        printer_id: str,
        status: CameraStatus,
        reason: Optional[str] = None,
    ) -> None:
        await self._orchestrator.set_camera_status(printer_id, status, reason)

    async def reset(self, printer_id: Optional[str] = None) -> None:
        await self._repository.reset(printer_id)
