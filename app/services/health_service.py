"""Health check service."""
from datetime import datetime

from app.services.ftps_service import FTPSService
from app.services.registry import ServiceRegistry
from app.services.state_manager import StateManager


class HealthService:
    """Encapsulates health probe logic for the API layer."""

    def __init__(
        self,
        registry: ServiceRegistry,
        state_manager: StateManager,
        ftps_service: FTPSService,
    ) -> None:
        self._registry = registry
        self._state_manager = state_manager
        self._ftps_service = ftps_service

    async def check(self, printer_id: str | None = None) -> dict:
        target_id = printer_id or self._registry.settings.printer_id
        state = await self._state_manager.get_state(target_id)
        ftps_status = await self._ftps_service.check_connection()

        return {
            "status": "healthy" if state.printer_online else "degraded",
            "timestamp": datetime.utcnow().isoformat(),
            "printer_online": state.printer_online,
            "ftps_status": ftps_status.get("status") or "disconnected",
        }
