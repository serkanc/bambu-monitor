"""State snapshot + diff stream over SSE."""
from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from app.api.dependencies import get_state_manager, get_state_stream_service
from app.core.exceptions import ServiceUnavailableError
from app.services.state_manager import StateManager
from app.services.state_stream_service import StateStreamService

router = APIRouter()

class SafeStreamingResponse(StreamingResponse):
    async def listen_for_disconnect(self, receive) -> None:
        try:
            await super().listen_for_disconnect(receive)
        except asyncio.CancelledError:
            return


def _sse_event(event: str, data: dict, event_id: Optional[int] = None) -> str:
    payload = json.dumps(data, separators=(",", ":"))
    parts = []
    if event_id is not None:
        parts.append(f"id: {event_id}")
    parts.append(f"event: {event}")
    parts.append(f"data: {payload}")
    return "\n".join(parts) + "\n\n"


@router.get("/state/stream")
async def stream_state(
    request: Request,
    printer_id: Optional[str] = Query(default=None),
    state_manager: StateManager = Depends(get_state_manager),
    stream_service: StateStreamService = Depends(get_state_stream_service),
):
    active_id = printer_id or state_manager.get_active_printer_id()
    if not active_id:
        raise ServiceUnavailableError("Printer not configured yet")

    subscriber = await stream_service.subscribe(active_id)
    snapshot_payload = await stream_service.build_snapshot(active_id)

    async def event_stream():
        try:
            yield _sse_event("snapshot", snapshot_payload, snapshot_payload.get("version"))
            try:
                while True:
                    if stream_service.is_shutdown():
                        break
                    if await request.is_disconnected():
                        break
                    try:
                        item = await asyncio.wait_for(subscriber.queue.get(), timeout=25)
                    except asyncio.TimeoutError:
                        yield _sse_event("ping", {"ts": asyncio.get_event_loop().time()})
                        continue
                    if item is None:
                        break
                    if not item:
                        continue
                    yield _sse_event(item["event"], item["data"], item.get("id"))
            except asyncio.CancelledError:
                return
        finally:
            await stream_service.unsubscribe(subscriber)

    return SafeStreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
