"""Publish state snapshot updates to registered observers."""
from __future__ import annotations

import inspect
import logging
from typing import Awaitable, Callable, List

from app.models import PrinterState

StateHook = Callable[[str, PrinterState], Awaitable[None] | None]

logger = logging.getLogger(__name__)


class StateNotifier:
    """Central dispatcher for printer state change hooks."""

    def __init__(self) -> None:
        self._hooks: List[StateHook] = []

    def register(self, hook: StateHook) -> None:
        self._hooks.append(hook)

    async def notify(self, printer_id: str, state: PrinterState) -> None:
        for hook in self._hooks:
            try:
                result = hook(printer_id, state)
                if inspect.isawaitable(result):
                    await result
            except Exception:  # noqa: BLE001
                logger.warning("State hook failed for printer %s", printer_id)
