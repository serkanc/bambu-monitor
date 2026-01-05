"""Simple repository that owns printer state caches and access locks."""
from __future__ import annotations

import asyncio
import inspect
from typing import Any, Awaitable, Callable, Dict, Optional, TypeVar

from app.models import PrinterState

T = TypeVar("T")
StateStoreUpdater = Callable[["_PrinterStore"], Awaitable[T] | T]


class _PrinterStore:
    """Tuple of the cached PrinterState plus its payload and lock."""

    def __init__(self) -> None:
        self.state = PrinterState()
        self.master_data: Dict[str, Any] = {}
        self.lock = asyncio.Lock()


class StateRepository:
    """Maintain per-printer caches and expose guarded accessors.

    Write access should be coordinated through StateOrchestrator to keep a single
    writer boundary for state mutations.
    """

    def __init__(self) -> None:
        self._stores: Dict[str, _PrinterStore] = {}
        self._stores_lock = asyncio.Lock()
        self._active_printer_id: Optional[str] = None

    def set_active_printer(self, printer_id: str) -> None:
        self._active_printer_id = printer_id

    def get_active_printer_id(self) -> Optional[str]:
        return self._active_printer_id

    def is_active_printer(self, printer_id: str) -> bool:
        return printer_id == self._active_printer_id

    async def get_state(self, printer_id: Optional[str] = None) -> PrinterState:
        printer_id = printer_id or self._active_printer_id
        if not printer_id:
            return PrinterState()

        store = await self._get_store(printer_id)
        async with store.lock:
            return store.state.copy(deep=True)

    async def get_master_data(self, printer_id: Optional[str] = None) -> Dict[str, Any]:
        printer_id = printer_id or self._active_printer_id
        if not printer_id:
            return {}

        store = await self._get_store(printer_id)
        async with store.lock:
            return store.master_data.copy()

    async def reset(self, printer_id: Optional[str] = None) -> None:
        if printer_id is not None:
            async with self._stores_lock:
                self._stores.pop(printer_id, None)
            return

        async with self._stores_lock:
            self._stores.clear()

    async def update_store(self, printer_id: str, updater: StateStoreUpdater[T]) -> T:
        """Update the store for a printer (intended for orchestrator use only)."""
        store = await self._get_store(printer_id)
        async with store.lock:
            result = updater(store)
            if inspect.isawaitable(result):
                return await result
            return result

    async def _get_store(self, printer_id: str) -> _PrinterStore:
        async with self._stores_lock:
            if printer_id not in self._stores:
                self._stores[printer_id] = _PrinterStore()
            return self._stores[printer_id]
