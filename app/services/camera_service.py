"""Decision layer for camera access and optional proxy streaming."""
from __future__ import annotations

from typing import TYPE_CHECKING
import asyncio
import contextlib
import logging
import os
from pathlib import Path
import time
from typing import Optional
import urllib.parse
import urllib.request
from uuid import uuid4

from app.core.config import Settings
from app.core.request_context import request_context
from app.core.tasks import monitor_task
from app.models import CameraAccess, CameraStatus
from app.services.state_orchestrator import StateOrchestrator
from app.services.utils.backoff import Backoff

if TYPE_CHECKING:
    from app.core.bambu_camera import BambuCameraEngine

logger = logging.getLogger(__name__)


class WebRTCSessionManager:
    """Best-effort viewer limit with keepalive-based expiry."""

    def __init__(self, max_viewers: int = 2, ttl_seconds: int = 45) -> None:
        self._max_viewers = max_viewers
        self._ttl_seconds = ttl_seconds
        self._sessions: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def claim(self) -> str | None:
        async with self._lock:
            self._prune_locked()
            if len(self._sessions) >= self._max_viewers:
                return None
            session_id = uuid4().hex
            self._sessions[session_id] = time.monotonic()
            return session_id

    async def keepalive(self, session_id: str) -> bool:
        async with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id] = time.monotonic()
                return True
            return False

    async def release(self, session_id: str) -> None:
        async with self._lock:
            self._sessions.pop(session_id, None)

    def _prune_locked(self) -> None:
        now = time.monotonic()
        expired = [sid for sid, ts in self._sessions.items() if now - ts > self._ttl_seconds]
        for sid in expired:
            self._sessions.pop(sid, None)


class CameraService:
    """Resolve camera access for the active printer and manage proxy/WebRTC streams."""

    def __init__(self, settings: Settings, state_orchestrator: StateOrchestrator) -> None:
        self._settings = settings
        self._state_orchestrator = state_orchestrator
        self._engine: BambuCameraEngine | None = None
        self._started = False
        self._go2rtc_process: asyncio.subprocess.Process | None = None
        self._go2rtc_config_path: Path | None = None
        self._go2rtc_log_tasks: list[asyncio.Task[None]] = []
        self.sessions = WebRTCSessionManager(max_viewers=2)
        self._go2rtc_monitor_task: asyncio.Task[None] | None = None
        self._go2rtc_monitor_backoff = Backoff(base_delay=2.0, factor=1.5, max_delay=30.0)

    async def start(self) -> None:
        if self._started:
            return
        with request_context("bg:camera"):
            self._started = True
            if self._should_start_proxy():
                await self._start_proxy()
            else:
                logger.info("Camera service started without proxy stream")
            if self._should_start_go2rtc():
                await self.start_go2rtc()
                self._start_go2rtc_monitor()

    async def stop(self) -> None:
        if not self._started:
            return
        with request_context("bg:camera"):
            self._started = False
            await self._stop_proxy()
            await self._stop_go2rtc_monitor()
            await self.stop_go2rtc()
            logger.info("Camera service stopped")

    def get_access(self) -> list[CameraAccess]:
        accesses = self.build_access(self._settings)
        if any(access.source == "external" for access in accesses):
            executable = self._resolve_go2rtc_path()
            if not executable or not executable.exists():
                logger.warning("go2rtc binary missing; external camera disabled")
                return [access for access in accesses if access.source != "external"]
        return accesses

    @staticmethod
    def build_access(settings: Settings) -> list[CameraAccess]:
        accesses: list[CameraAccess] = []
        if settings.external_camera_url:
            accesses.append(
                CameraAccess(
                    mode="direct",
                    url="/api/camera/webrtc/offer",
                    source="external",
                    stream_type="webrtc",
                )
            )
        if CameraService._supports_internal_proxy(settings):
            accesses.append(
                CameraAccess(
                    mode="proxy",
                    url="/api/camera",
                    source="internal",
                    stream_type="image",
                )
            )
        return accesses

    @staticmethod
    def _supports_internal_proxy(settings: Settings) -> bool:
        model = (settings.printer_model or "").lower()
        return "a1" in model

    def _should_start_proxy(self) -> bool:
        return any(access.mode == "proxy" for access in self.get_access())

    def _should_start_go2rtc(self) -> bool:
        return bool(self._settings.external_camera_url)

    async def _start_proxy(self) -> None:
        if self._engine:
            with request_context("bg:camera"):
                await self._engine.start()
            return
        from app.core.bambu_camera import BambuCameraEngine

        async def _handle_frame(frame: str) -> None:
            await self._state_orchestrator.update_camera_frame(
                self._settings.printer_id,
                frame,
            )

        async def _handle_status(status: CameraStatus, reason: str | None) -> None:
            await self._state_orchestrator.set_camera_status(
                self._settings.printer_id,
                status,
                reason,
            )

        with request_context("bg:camera"):
            self._engine = BambuCameraEngine(
                self._settings,
                _handle_frame,
                on_status_change=_handle_status,
            )
            await self._engine.start()

    async def _stop_proxy(self) -> None:
        if not self._engine:
            return
        await self._engine.stop()
        self._engine = None

    def set_reconnect_paused(self, paused: bool) -> None:
        if not self._engine:
            return
        self._engine.set_reconnect_paused(paused)

    def is_go2rtc_running(self) -> bool:
        return self._go2rtc_process is not None and self._go2rtc_process.returncode is None

    async def start_go2rtc(self) -> None:
        if self.is_go2rtc_running():
            return
        executable = self._resolve_go2rtc_path()
        if not executable or not executable.exists():
            logger.warning("go2rtc binary not found: %s", executable)
            return
        config_path = self._write_go2rtc_config()
        if not config_path:
            return
        args = [str(executable), "-config", str(config_path)]
        logger.info("Starting go2rtc: %s", " ".join(args))
        use_pipe = self._settings.go2rtc_log_output or self._settings.log_level.upper() == "DEBUG"
        stdout = asyncio.subprocess.PIPE if use_pipe else asyncio.subprocess.DEVNULL
        stderr = asyncio.subprocess.PIPE if use_pipe else asyncio.subprocess.DEVNULL
        self._go2rtc_process = await asyncio.create_subprocess_exec(
            *args,
            stdout=stdout,
            stderr=stderr,
        )
        if use_pipe and self._go2rtc_process:
            tasks: list[asyncio.Task[None]] = []
            tasks.append(
                asyncio.create_task(
                    self._stream_go2rtc_output(self._go2rtc_process.stdout, "stdout")
                )
            )
            tasks.append(
                asyncio.create_task(
                    self._stream_go2rtc_output(self._go2rtc_process.stderr, "stderr")
                )
            )
            self._go2rtc_log_tasks = tasks
        logger.info("go2rtc started")

    async def stop_go2rtc(self) -> None:
        if not self._go2rtc_process:
            return
        if self._go2rtc_process.returncode is None:
            self._go2rtc_process.terminate()
            try:
                await asyncio.wait_for(self._go2rtc_process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._go2rtc_process.kill()
                await self._go2rtc_process.wait()
        for task in self._go2rtc_log_tasks:
            task.cancel()
        self._go2rtc_log_tasks = []
        self._go2rtc_process = None
        logger.info("go2rtc stopped")

    def _start_go2rtc_monitor(self) -> None:
        if self._go2rtc_monitor_task or not self._should_start_go2rtc():
            return
        task = asyncio.create_task(self._run_go2rtc_monitor(), name="go2rtc-monitor")
        self._go2rtc_monitor_task = monitor_task(
            task,
            name="go2rtc-monitor",
            logger=logger,
        )

    async def _stop_go2rtc_monitor(self) -> None:
        if not self._go2rtc_monitor_task:
            return
        self._go2rtc_monitor_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._go2rtc_monitor_task
        self._go2rtc_monitor_task = None
        self._go2rtc_monitor_backoff.reset()

    async def _run_go2rtc_monitor(self) -> None:
        with request_context("bg:go2rtc-monitor"):
            while self._started and self._should_start_go2rtc():
                if not self.is_go2rtc_running():
                    try:
                        await self.start_go2rtc()
                    except Exception as exc:  # noqa: BLE001
                        delay = self._go2rtc_monitor_backoff.next_delay()
                        logger.warning(
                            "go2rtc monitor restart failed: %s (retrying in %.1fs)",
                            exc,
                            delay,
                        )
                        await asyncio.sleep(delay)
                        continue
                    self._go2rtc_monitor_backoff.reset()
                try:
                    await asyncio.sleep(5)
                except asyncio.CancelledError:
                    return

    async def restart_go2rtc(self) -> None:
        await self.stop_go2rtc()
        await self.start_go2rtc()

    def _resolve_go2rtc_path(self) -> Path | None:
        configured = (self._settings.go2rtc_path or "").strip()
        if not configured:
            return None
        candidate = Path(configured)
        if not candidate.is_absolute():
            candidate = self._project_root() / candidate
        if os.name == "nt" and candidate.suffix.lower() != ".exe":
            candidate = candidate.with_suffix(".exe")
        return candidate

    def _write_go2rtc_config(self) -> Path | None:
        if not self._settings.external_camera_url:
            return None
        config_path = self._project_root() / "data" / "go2rtc.yaml"
        config_path.parent.mkdir(parents=True, exist_ok=True)
        stream_url = self._settings.external_camera_url.replace('"', '\\"')
        config_text = "\n".join(
            [
                "api:",
                f"  listen: \"127.0.0.1:{self._settings.go2rtc_port}\"",
                "rtsp:",
                "  listen: \"127.0.0.1:8554\"",
                "streams:",
                f"  external: \"{stream_url}\"",
                "",
            ]
        )
        config_path.write_text(config_text, encoding="utf-8")
        self._go2rtc_config_path = config_path
        return config_path

    def _project_root(self) -> Path:
        return Path(__file__).resolve().parents[2]

    def build_go2rtc_webrtc_url(self, source: str | None = None) -> str:
        stream = "external" if source != "internal" else "internal"
        query = urllib.parse.urlencode({"src": stream})
        return f"http://127.0.0.1:{self._settings.go2rtc_port}/api/webrtc?{query}"

    async def request_webrtc_answer(self, offer_sdp: str, source: str | None = None) -> str:
        if not self.is_go2rtc_running():
            await self.start_go2rtc()
        url = self.build_go2rtc_webrtc_url(source)

        def _send_offer() -> str:
            request = urllib.request.Request(
                url,
                data=offer_sdp.encode("utf-8"),
                headers={"Content-Type": "text/plain"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=8) as response:
                return response.read().decode("utf-8")

        return await asyncio.to_thread(_send_offer)

    async def _stream_go2rtc_output(
        self,
        stream: Optional[asyncio.StreamReader],
        label: str,
    ) -> None:
        if not stream:
            return
        while True:
            try:
                line = await stream.readline()
            except asyncio.CancelledError:
                return
            if not line:
                return
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                logger.debug("go2rtc %s: %s", label, text)
