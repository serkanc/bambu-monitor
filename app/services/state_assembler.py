"""Build complete PrinterState snapshots from merged master data."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict

from app.models import PrinterState, resolve_stage_label, resolve_ams_status
from app.core.config import get_settings
from app.services.utils.capability_resolver import CapabilityResolver
from app.services.parsers import AmsParser, PrintDataParser
from app.services.utils.spool_resolver import SpoolResolver
from app.services.utils.print_again import update_print_again_state

logger = logging.getLogger(__name__)


class StateAssembler:
    """Responsible for translating master payloads into PrinterState."""

    def __init__(
        self,
        *,
        capability_resolver: CapabilityResolver | None = None,
        spool_resolver: SpoolResolver | None = None,
    ) -> None:
        self._print_parser = PrintDataParser()
        self._ams_parser = AmsParser()
        self._capability_resolver = capability_resolver or CapabilityResolver()
        self._spool_resolver = spool_resolver or SpoolResolver()

    async def assemble(self, printer_id: str, master_data: Dict[str, Any], state: PrinterState) -> None:
        """Update the provided state instance using merged master data."""
        try:
            print_section = master_data.get("print", master_data)
            module_index = self._collect_info_modules(master_data)
            await self._parse_print_data(printer_id, state, print_section, module_index)

            ams_section = master_data.get("ams")
            if not ams_section and isinstance(print_section, dict):
                ams_section = print_section.get("ams")
            if ams_section:
                await self._parse_ams_data(printer_id, state, ams_section, module_index)
            self._apply_ams_status(state, print_section)

            self._spool_resolver.attach_external_spool(state, master_data)
            printer_model = self._detect_printer_model(module_index, master_data)
            self._capability_resolver.apply_printer_capabilities(state, printer_model)
            state.ams = self._capability_resolver.apply_ams_capabilities(state.ams)

            update_print_again_state(state)

            state.updated_at = datetime.now().strftime("%H:%M:%S")
            logger.debug("Printer %s state updated from master data", printer_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to parse master data for %s: %s", printer_id, exc)

    async def _parse_print_data(
        self,
        printer_id: str,
        state: PrinterState,
        print_data: Dict[str, Any],
        module_index: dict[str, dict[str, Any]] | None,
    ) -> None:
        try:
            serial = None
            try:
                settings = get_settings(printer_id=printer_id)
                serial = settings.serial
            except Exception as exc:  # noqa: BLE001
                logger.debug("Failed to resolve serial for %s: %s", printer_id, exc)

            parsed = self._print_parser.parse(print_data, module_index, serial=serial)
            state.print = parsed
            state.print.stage_labels = [
                resolve_stage_label(code) for code in parsed.stg
            ]
            state.print.stage_current_label = resolve_stage_label(parsed.stg_cur)
            logger.debug(
                (
                    "Printer %s state updated from print data; gcode=%s; firmware=%s; "
                    "stage_history=%s; stage_current=%s; stage_main=%s; stage_sub=%s"
                ),
                printer_id,
                parsed.gcode_state,
                parsed.firmware,
                parsed.stg,
                parsed.stg_cur,
                parsed.mc_print_stage,
                parsed.mc_print_sub_stage,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to parse printer data: %s", exc)

    async def _parse_ams_data(
        self,
        printer_id: str,
        state: PrinterState,
        ams_data: Dict[str, Any],
        module_index: dict[str, dict[str, Any]] | None,
    ) -> None:
        try:
            module_index = module_index or {}
            ams_module = self._lookup_module(module_index, "ams_f1/0")
            parsed = self._ams_parser.parse(ams_data, ams_module)
            state.ams = parsed
            logger.debug(
                "Printer %s AMS data updated: %s units, %s slots",
                printer_id,
                len(parsed.ams_units),
                len(parsed.slots),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to parse AMS data: %s", exc)

    def _apply_ams_status(self, state: PrinterState, print_section: Dict[str, Any]) -> None:
        if not isinstance(print_section, dict):
            return
        ams_status_value = print_section.get("ams_status")
        if ams_status_value is None:
            return
        ams_status_main, ams_status_sub, _, _ = resolve_ams_status(ams_status_value)
        state.ams.ams_status_main = ams_status_main
        state.ams.ams_status_sub = ams_status_sub

    def _detect_printer_model(
        self,
        module_index: dict[str, dict[str, Any]] | None,
        master_data: Dict[str, Any],
    ) -> str | None:
        module_index = module_index or {}
        preferred_modules = ("ota", "mb_core", "mb0")
        for key in preferred_modules:
            module = module_index.get(key)
            if module:
                product = module.get("product_name")
                if product:
                    return str(product)
        for module in module_index.values():
            product = module.get("product_name")
            if product:
                return str(product)

        info_block = master_data.get("info")
        if isinstance(info_block, dict):
            product = info_block.get("product_name")
            if product:
                return str(product)

        print_section = master_data.get("print")
        if isinstance(print_section, dict):
            product = print_section.get("product_name")
            if product:
                return str(product)

        return None

    def _collect_info_modules(self, master_data: Dict[str, Any]) -> dict[str, dict[str, Any]]:
        index: dict[str, dict[str, Any]] = {}

        def collect(section: Any) -> None:
            if not isinstance(section, dict):
                return
            if section.get("command") != "get_version":
                return
            modules = section.get("module")
            if not isinstance(modules, list):
                return
            for module in modules:
                if not isinstance(module, dict):
                    continue
                raw_name = str(module.get("name", "") or "").strip().lower()
                if not raw_name or raw_name in index:
                    continue
                index[raw_name] = module

        collect(master_data.get("info"))
        print_section = master_data.get("print")
        if isinstance(print_section, dict):
            collect(print_section.get("info"))

        return index

    def _lookup_module(
        self,
        module_index: dict[str, dict[str, Any]] | None,
        name: str,
    ) -> dict[str, Any] | None:
        if not module_index:
            return None
        return module_index.get(name.lower())
