"""Centralized connection orchestration for MQTT/FTPS/Camera services."""
from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Optional

from app.core.request_context import request_context
from app.core.tasks import monitor_task
from app.core.tasks import monitor_task
from app.services.camera_service import CameraService
from app.services.ftps_service import FTPSService
from app.services.mqtt_service import MQTTService
from app.services.printer_presence_service import PrinterPresenceService

logger = logging.getLogger(__name__)


class _LogThrottle:
    def __init__(self) -> None:
        self._counts: dict[str, int] = {}

    def should_log(self, key: str) -> bool:
        count = self._counts.get(key, 0) + 1
        self._counts[key] = count
        if count <= 3:
            return True
        return count % 5 == 0

    def reset(self, key: str) -> None:
        if key in self._counts:
            self._counts.pop(key, None)


class ConnectionOrchestrator:
    """Coordinate connections across MQTT/FTPS/Camera with shared policy."""

    def __init__(
        self,
        *,
        mqtt_service: Optional[MQTTService],
        ftps_service: Optional[FTPSService],
        camera_service: Optional[CameraService],
        presence_service: Optional[PrinterPresenceService],
        poll_interval: float = 2.0,
    ) -> None:
        self._mqtt_service = mqtt_service
        self._ftps_service = ftps_service
        self._camera_service = camera_service
        self._presence_service = presence_service
        self._poll_interval = poll_interval
        self._running = False
        self._task: Optional[asyncio.Task[None]] = None
        self._lock = asyncio.Lock()
        self._throttle = _LogThrottle()
        self._mqtt_online = False
        self._services_started = {
            "mqtt": False,
            "presence": False,
            "ftps": False,
            "camera": False,
        }

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        with request_context("bg:orchestrator"):
            self._task = monitor_task(
                asyncio.create_task(self._run(), name="connection-orchestrator"),
                name="connection-orchestrator",
                logger=logger,
                on_error=self._handle_task_crash,
            )
        logger.info("Connection orchestrator started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self._stop_services()
        logger.info("Connection orchestrator stopped")

    def _handle_task_crash(self, exc: BaseException) -> None:
        if not self._running:
            return
        logger.error("Connection orchestrator crashed, restarting")
        self._running = False
        asyncio.create_task(self.start())

    async def _run(self) -> None:
        while self._running:
            try:
                await self._tick()
            except Exception as exc:  # noqa: BLE001
                if self._throttle.should_log("orchestrator.tick"):
                    logger.warning("Connection orchestrator tick failed: %s", exc)
            await asyncio.sleep(self._poll_interval)

    async def _tick(self) -> None:
        async with self._lock:
            await self._ensure_presence_running()
            await self._ensure_mqtt_running()

            online = self._is_mqtt_online()
            if online != self._mqtt_online:
                self._mqtt_online = online
                logger.info("MQTT online=%s (gating FTPS/Camera)", online)

            if self._mqtt_online:
                await self._resume_dependents()
            else:
                await self._pause_dependents()

    def _is_mqtt_online(self) -> bool:
        if not self._mqtt_service:
            return False
        return bool(self._mqtt_service.is_connected())

    async def _ensure_mqtt_running(self) -> None:
        if not self._mqtt_service:
            return
        if self._services_started["mqtt"]:
            return
        try:
            await self._mqtt_service.start()
            self._services_started["mqtt"] = True
            self._throttle.reset("mqtt.start")
        except Exception as exc:  # noqa: BLE001
            if self._throttle.should_log("mqtt.start"):
                logger.warning("MQTT start failed: %s", exc)

    async def _ensure_presence_running(self) -> None:
        if not self._presence_service:
            return
        if self._services_started["presence"]:
            return
        try:
            await self._presence_service.start()
            self._services_started["presence"] = True
            self._throttle.reset("presence.start")
        except Exception as exc:  # noqa: BLE001
            if self._throttle.should_log("presence.start"):
                logger.warning("Presence start failed: %s", exc)

    async def _ensure_ftps_running(self) -> None:
        if not self._ftps_service:
            return
        if self._services_started["ftps"]:
            return
        try:
            self._ftps_service.set_reconnect_paused(False)
            await self._ftps_service.start()
            self._services_started["ftps"] = True
            self._throttle.reset("ftps.start")
        except Exception as exc:  # noqa: BLE001
            if self._throttle.should_log("ftps.start"):
                logger.warning("FTPS start failed: %s", exc)

    async def _ensure_camera_running(self) -> None:
        if not self._camera_service:
            return
        if self._services_started["camera"]:
            return
        try:
            self._camera_service.set_reconnect_paused(False)
            await self._camera_service.start()
            self._services_started["camera"] = True
            self._throttle.reset("camera.start")
        except Exception as exc:  # noqa: BLE001
            if self._throttle.should_log("camera.start"):
                logger.warning("Camera start failed: %s", exc)

    async def _pause_dependents(self) -> None:
        if self._ftps_service:
            self._ftps_service.set_reconnect_paused(True)
        if self._camera_service:
            self._camera_service.set_reconnect_paused(True)

    async def _resume_dependents(self) -> None:
        if self._ftps_service:
            self._ftps_service.set_reconnect_paused(False)
        if self._camera_service:
            self._camera_service.set_reconnect_paused(False)
        await self._ensure_ftps_running()
        await self._ensure_camera_running()

    async def _stop_services(self) -> None:
        await self._pause_dependents()
        if self._mqtt_service and self._services_started["mqtt"]:
            try:
                await self._mqtt_service.stop()
            except Exception as exc:  # noqa: BLE001
                logger.warning("MQTT stop failed: %s", exc)
            self._services_started["mqtt"] = False
        if self._presence_service and self._services_started["presence"]:
            try:
                await self._presence_service.stop()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Presence stop failed: %s", exc)
            self._services_started["presence"] = False
