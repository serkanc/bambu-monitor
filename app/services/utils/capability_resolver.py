"""Helper utilities to apply capability metadata onto printer state."""
from __future__ import annotations

from app.models import AmsStatus, PrinterState
from app.services.capability_registry import (
    resolve_ams_capabilities,
    resolve_printer_capabilities,
)


class CapabilityResolver:
    """Resolve and apply printer/AMS capabilities."""

    def apply_printer_capabilities(self, state: PrinterState, printer_model: str | None) -> None:
        """Update the printer capability snapshot."""
        resolved = resolve_printer_capabilities(printer_model or state.capabilities.model)
        state.capabilities = resolved

    def apply_ams_capabilities(self, ams_status: AmsStatus) -> AmsStatus:
        """Decorate AMS units with capability flags."""
        if not ams_status.ams_units:
            return ams_status

        updated_units = []
        for unit in ams_status.ams_units:
            caps = resolve_ams_capabilities(unit.product_name)
            updated_units.append(unit.copy(update={"capabilities": caps}))

        return ams_status.copy(update={"ams_units": updated_units})
