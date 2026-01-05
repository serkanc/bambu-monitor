"""State diff publisher over SSE."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

from app.core.server_info import (
    format_uptime,
    get_server_start_time,
    get_server_time,
    get_uptime_seconds,
)
from app.models import PrinterState
from app.services.state_notifier import StateNotifier
from app.services.state_repository import StateRepository

logger = logging.getLogger(__name__)


@dataclass(eq=False)
class _Subscriber:
    queue: asyncio.Queue
    printer_id: Optional[str] = None
    __hash__ = object.__hash__


class StateStreamService:
    """Publish full snapshots and diffs to SSE subscribers."""

    def __init__(self, repository: StateRepository, notifier: StateNotifier) -> None:
        self._repository = repository
        self._subscribers: set[_Subscriber] = set()
        self._snapshots: dict[str, dict[str, Any]] = {}
        self._versions: dict[str, int] = {}
        self._lock = asyncio.Lock()
        self._shutdown_event = asyncio.Event()
        notifier.register(self._handle_state_update)

    def is_shutdown(self) -> bool:
        return self._shutdown_event.is_set()

    def reset(self) -> None:
        self._shutdown_event.clear()

    async def shutdown(self) -> None:
        self._shutdown_event.set()
        async with self._lock:
            subscribers = list(self._subscribers)
            self._subscribers.clear()
        for sub in subscribers:
            with contextlib.suppress(asyncio.QueueEmpty):
                while True:
                    sub.queue.get_nowait()
            with contextlib.suppress(asyncio.QueueFull):
                sub.queue.put_nowait(None)

    async def subscribe(self, printer_id: Optional[str]) -> _Subscriber:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        subscriber = _Subscriber(queue=queue, printer_id=printer_id)
        async with self._lock:
            self._subscribers.add(subscriber)
        return subscriber

    async def unsubscribe(self, subscriber: _Subscriber) -> None:
        async with self._lock:
            self._subscribers.discard(subscriber)

    async def build_snapshot(self, printer_id: str) -> dict[str, Any]:
        state = await self._repository.get_state(printer_id)
        state_dict = self._serialize_state(state)
        version = self._versions.get(printer_id, 0) + 1
        self._versions[printer_id] = version
        self._snapshots[printer_id] = state_dict
        return {
            "version": version,
            "ts": datetime.utcnow().isoformat(),
            "printer_id": printer_id,
            "state": state_dict,
        }

    async def _handle_state_update(self, printer_id: str, state: PrinterState) -> None:
        try:
            payload = self._build_diff_payload(printer_id, state)
            if not payload:
                return
            await self._broadcast(payload["printer_id"], payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning("State stream publish failed: %s", exc)

    def _build_diff_payload(
        self,
        printer_id: str,
        state: PrinterState,
    ) -> Optional[dict[str, Any]]:
        current = self._serialize_state(state)
        previous = self._snapshots.get(printer_id)
        if previous is None:
            version = self._versions.get(printer_id, 0) + 1
            self._versions[printer_id] = version
            self._snapshots[printer_id] = current
            return {
                "event": "snapshot",
                "id": version,
                "data": {
                    "version": version,
                    "ts": datetime.utcnow().isoformat(),
                    "printer_id": printer_id,
                    "state": current,
                },
                "printer_id": printer_id,
            }

        changes: dict[str, Any] = {}
        self._diff_dict(previous, current, "", changes)
        if not changes:
            return None

        version = self._versions.get(printer_id, 0) + 1
        self._versions[printer_id] = version
        self._snapshots[printer_id] = current
        return {
            "event": "diff",
            "id": version,
            "data": {
                "version": version,
                "ts": datetime.utcnow().isoformat(),
                "printer_id": printer_id,
                "changes": changes,
            },
            "printer_id": printer_id,
        }

    async def _broadcast(self, printer_id: str, payload: dict[str, Any]) -> None:
        if self._shutdown_event.is_set():
            return
        dead: list[_Subscriber] = []
        async with self._lock:
            for sub in self._subscribers:
                if sub.printer_id and sub.printer_id != printer_id:
                    continue
                try:
                    sub.queue.put_nowait(payload)
                except asyncio.QueueFull:
                    dead.append(sub)
        if dead:
            async with self._lock:
                for sub in dead:
                    self._subscribers.discard(sub)
            for sub in dead:
                self._drain_queue(sub.queue)
                with contextlib.suppress(asyncio.QueueFull):
                    sub.queue.put_nowait(None)
            logger.warning("State stream subscriber dropped due to backpressure")

    @staticmethod
    def _drain_queue(queue: asyncio.Queue) -> None:
        with contextlib.suppress(asyncio.QueueEmpty):
            while True:
                queue.get_nowait()

    @staticmethod
    def _serialize_state(state: PrinterState) -> dict[str, Any]:
        try:
            state_dict = state.dict()
        except AttributeError:
            state_dict = json.loads(state.json())
        uptime_seconds = get_uptime_seconds()
        state_dict['server_info'] = {
            'start_time': get_server_start_time().isoformat(),
            'server_time': get_server_time().isoformat(),
            'uptime': format_uptime(uptime_seconds),
            'uptime_seconds': uptime_seconds,
        }
        return state_dict

    def _diff_dict(
        self,
        previous: dict[str, Any],
        current: dict[str, Any],
        prefix: str,
        out: dict[str, Any],
    ) -> None:
        for key, value in current.items():
            path = f"{prefix}.{key}" if prefix else key
            if key not in previous:
                out[path] = value
                continue
            old_value = previous[key]
            if isinstance(value, dict) and isinstance(old_value, dict):
                self._diff_dict(old_value, value, path, out)
                continue
            if value != old_value:
                out[path] = value

        for key in previous.keys():
            if key not in current:
                path = f"{prefix}.{key}" if prefix else key
                out[path] = None
