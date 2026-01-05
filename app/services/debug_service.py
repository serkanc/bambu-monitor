"""Service that stores incoming MQTT payloads for debugging purposes."""
import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.services.state_repository import StateRepository

logger = logging.getLogger(__name__)


class DebugService:
    """Keep the latest MQTT payloads for diagnostics."""

    def __init__(self, repository: StateRepository) -> None:
        self._message_history: Dict[str, List[Dict[str, Any]]] = {}
        self._repository = repository
        self._lock = asyncio.Lock()

    async def add_message(self, printer_id: str, raw_payload: bytes) -> None:
        """Store a payload and merge it into the master JSON."""

        async with self._lock:
            try:
                payload = json.loads(raw_payload.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                logger.error("Failed to decode MQTT payload: %s", exc)
                # Store an entry even when decode fails.
                entry = {
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                    "raw_json": {"error": f"Failed to decode: {exc}", "raw_bytes": str(raw_payload)},
                }
                history = self._message_history.setdefault(printer_id, [])
                history.insert(0, entry)
                self._message_history[printer_id] = history[:10]
                return

            entry = {
                "timestamp": datetime.now().strftime("%H:%M:%S"),
                "raw_json": payload,
            }

            history = self._message_history.setdefault(printer_id, [])
            history.insert(0, entry)
            self._message_history[printer_id] = history[:10]

    async def get_debug_info(self, printer_id: str | None = None) -> Dict[str, Any]:
        """Return accumulated debug statistics."""

        async with self._lock:
            printer_id = printer_id or self._repository.get_active_printer_id()
            history = self._message_history.get(printer_id or "", [])
            state = await self._repository.get_state(printer_id)
            master_data = await self._repository.get_master_data(printer_id)
            if state.print:
                logger.debug(
                    "DebugService snapshot for %s; stg=%s; stg_cur=%s; mc_print_stage=%s",
                    printer_id,
                    state.print.stg,
                    state.print.stg_cur,
                    state.print.mc_print_stage,
                )

            return {
                "master_json": master_data,
                "message_history": list(history),
                "state": {
                    "printer_online": state.printer_online,
                    "updated_at": state.updated_at,
                    "print": state.print.dict() if state.print else {},
                    "ams": state.ams.dict() if state.ams else {},
                },
                "stats": {
                    "total_messages": len(history),
                    "master_keys_count": len(master_data),
                    "last_update": datetime.now().strftime("%H:%M:%S"),
                },
            }
