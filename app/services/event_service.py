"""Event aggregation service for printer state transitions."""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Tuple

from app.models import PrinterEvent, PrinterState, PrinterGCodeState
from app.services.state_notifier import StateNotifier


class EventService:
    """Collect printer events triggered by status transitions."""

    _INTERESTING_STATES = {PrinterGCodeState.FINISH, PrinterGCodeState.PAUSE}
    _SNAPSHOT_CHANNEL_STATE = "gcode_state"
    _SNAPSHOT_CHANNEL_PRINT_ERROR = "print_error"
    _SNAPSHOT_CHANNEL_HMS = "hms_errors"

    def __init__(self, notifier: StateNotifier, *, max_events_per_printer: int = 50) -> None:
        self._max_events = max_events_per_printer
        self._events: Dict[str, Deque[PrinterEvent]] = {}
        self._snapshots: Dict[Tuple[str, str], str] = {}
        self._lock = asyncio.Lock()
        notifier.register(self._handle_state_update)

    async def _handle_state_update(
        self,
        printer_id: str,
        state: PrinterState,
    ) -> None:
        """Hook invoked on every state update to capture interesting transitions."""
        current_state = state.print.gcode_state or PrinterGCodeState.UNKNOWN
        if isinstance(current_state, str):
            try:
                current_state = PrinterGCodeState(current_state.upper())
            except ValueError:
                current_state = PrinterGCodeState.UNKNOWN

        state_value = current_state.value if isinstance(current_state, PrinterGCodeState) else str(current_state)
        changed = self._update_snapshot(printer_id, self._SNAPSHOT_CHANNEL_STATE, state_value)
        if changed and current_state in self._INTERESTING_STATES:
            message = "Print finished" if current_state == PrinterGCodeState.FINISH else "Print paused"
            await self._append_event(
                self._build_event(printer_id, state, message, current_state),
            )

        await self._track_print_error(printer_id, state)
        await self._track_hms_error(printer_id, state)

    def _build_event(
        self,
        printer_id: str,
        state: PrinterState,
        message: str,
        gcode_state: PrinterGCodeState | str | None = None,
    ) -> PrinterEvent:
        resolved_state = gcode_state or state.print.gcode_state or PrinterGCodeState.UNKNOWN
        if isinstance(resolved_state, str):
            try:
                resolved_state = PrinterGCodeState(resolved_state.upper())
            except ValueError:
                resolved_state = PrinterGCodeState.UNKNOWN
        return PrinterEvent(
            printer_id=printer_id,
            gcode_state=resolved_state,
            message=message,
            percent=state.print.percent,
            layer=state.print.layer,
            remaining_time=state.print.remaining_time,
            finish_time=state.print.finish_time,
            speed_level=state.print.speed_level,
            file=state.print.file,
        )

    async def _track_print_error(self, printer_id: str, state: PrinterState) -> None:
        error = state.print.print_error
        snapshot_payload = None
        message = None
        if error:
            code = self._clean_text(error.code)
            desc = self._clean_text(error.description)
            sub_code = self._clean_text(getattr(error, "sub_code", None))
            snapshot_payload = {"code": code, "description": desc, "sub_code": sub_code}
            label = code or "Unknown code"
            if desc:
                label = f"{label} - {desc}" if code else desc
            message = f"Print error detected: {label}"

        changed = self._update_snapshot(printer_id, self._SNAPSHOT_CHANNEL_PRINT_ERROR, snapshot_payload)
        if snapshot_payload and changed:
            await self._append_event(self._build_event(printer_id, state, message or "Print error"))

    async def _track_hms_error(self, printer_id: str, state: PrinterState) -> None:
        errors = state.print.hms_errors or []
        normalized_errors = [
            {
                "code": self._clean_text(err.code),
                "description": self._clean_text(err.description),
                "sub_code": self._clean_text(getattr(err, "sub_code", None)),
            }
            for err in errors
            if err
        ]
        first = normalized_errors[0] if normalized_errors else None
        message = None
        if first:
            code = first.get("code", "")
            desc = first.get("description", "")
            label = code or "Unknown HMS code"
            if desc:
                label = f"{label} - {desc}" if code else desc
            message = f"HMS error detected: {label}"

        changed = self._update_snapshot(printer_id, self._SNAPSHOT_CHANNEL_HMS, normalized_errors or None)
        if normalized_errors and changed:
            await self._append_event(self._build_event(printer_id, state, message or "HMS error"))

    async def _append_event(self, event: PrinterEvent) -> None:
        async with self._lock:
            queue = self._events.get(event.printer_id)
            if queue is None:
                queue = deque(maxlen=self._max_events)
                self._events[event.printer_id] = queue
            queue.appendleft(event)

    async def list_events(
        self,
        *,
        printer_id: str | None = None,
        limit: int | None = None,
    ) -> List[PrinterEvent]:
        """Return recent events sorted by timestamp (newest first)."""

        async with self._lock:
            if printer_id:
                combined = list(self._events.get(printer_id, []))
            else:
                combined = [
                    event
                    for queue in self._events.values()
                    for event in queue
                ]

        combined.sort(key=lambda evt: evt.created_at, reverse=True)
        if limit is not None and limit > 0:
            combined = combined[:limit]

        return [event.copy(deep=True) for event in combined]

    async def clear_events(self, *, printer_id: str | None = None) -> None:
        """Clear stored events for the specified printer (or all printers)."""

        async with self._lock:
            if printer_id:
                self._events.pop(printer_id, None)
                return
            self._events.clear()

    def _update_snapshot(self, printer_id: str, channel: str, value: Any) -> bool:
        """Store normalized snapshot; return True if changed."""

        normalized = self._normalize_snapshot(value)
        key = (printer_id, channel)

        if normalized is None:
            return self._snapshots.pop(key, None) is not None

        previous = self._snapshots.get(key)
        if previous == normalized:
            return False
        self._snapshots[key] = normalized
        return True

    @staticmethod
    def _normalize_snapshot(value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, (str, int, float, bool)):
            return str(value)
        if hasattr(value, "model_dump"):
            value = value.model_dump()
        elif hasattr(value, "dict"):
            value = value.dict()
        try:
            return json.dumps(value, sort_keys=True, default=str)
        except (TypeError, ValueError):
            return str(value)

    @staticmethod
    def _clean_text(text: Optional[str]) -> str:
        if not text:
            return ""
        return str(text).strip()
