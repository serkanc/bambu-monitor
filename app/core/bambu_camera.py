"""Low-level camera engine for Bambu internal streams."""
import asyncio
import base64
import contextlib
import logging
import ssl
import struct
import time
from typing import Awaitable, Callable, Optional

import cv2
import numpy as np

from app.core.config import Settings
from app.models import CameraStatus

logger = logging.getLogger(__name__)


class BambuCameraEngine:
    """Maintain a persistent connection with the printer camera."""

    DEFAULT_STALL_THRESHOLD = 3

    def __init__(
        self,
        settings: Settings,
        on_frame: Optional[Callable[[str], Awaitable[None]]] = None,
        on_status_change: Optional[Callable[[CameraStatus, Optional[str]], Awaitable[None]]] = None,
        stall_threshold: int = DEFAULT_STALL_THRESHOLD,
    ) -> None:
        self._settings = settings
        self._on_frame = on_frame
        self._is_streaming = False
        self._current_task: Optional[asyncio.Task[None]] = None
        self._reconnect_paused = False
        self._on_status_change = on_status_change
        self._status = CameraStatus.STOPPED
        self._status_reason: Optional[str] = None
        self._stall_threshold = max(1, stall_threshold)
        self._stall_count = 0
        self._last_frame_ts = 0.0

    def set_reconnect_paused(self, paused: bool) -> None:
        self._reconnect_paused = bool(paused)

    async def _update_status(self, status: CameraStatus, reason: Optional[str] = None) -> None:
        if self._status == status and self._status_reason == reason:
            return
        self._status = status
        self._status_reason = reason
        if not self._on_status_change:
            return
        try:
            await self._on_status_change(status, reason)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Camera status callback failed: %s", exc)

    async def _handle_stall(self, reason: str) -> None:
        if self._stall_count >= self._stall_threshold:
            await self._update_status(CameraStatus.RECONNECTING, reason)
        else:
            await self._update_status(CameraStatus.STALL_WARNING, reason)

    async def start(self) -> None:
        """Start the camera loop if not already running."""
        if self._is_streaming:
            return

        await self._update_status(CameraStatus.CONNECTING, "camera loop starting")
        self._is_streaming = True
        self._current_task = asyncio.create_task(self._camera_loop())
        logger.info("Bambu camera engine started")

    async def stop(self) -> None:
        """Stop the camera loop."""
        self._is_streaming = False
        if self._current_task:
            self._current_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._current_task
            self._current_task = None
        await self._update_status(CameraStatus.STOPPED, "camera loop stopped")
        logger.info("Bambu camera engine stopped")

    async def _camera_loop(self) -> None:
        auth_data = self._build_auth_data()

        while self._is_streaming:
            self._stall_count = 0
            self._last_frame_ts = 0.0
            try:
                await self._connect_and_stream(auth_data)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Camera loop error: %s", exc)
                await self._update_status(CameraStatus.RECONNECTING, f"camera loop error: {exc}")

            if self._is_streaming:
                while self._is_streaming and self._reconnect_paused:
                    await asyncio.sleep(1)
                if not self._is_streaming:
                    break
                logger.info("Camera reconnecting in 5 seconds...")
                await asyncio.sleep(5)

    def _build_auth_data(self) -> bytes:
        data = bytearray()
        data += struct.pack("<I", 0x40)
        data += struct.pack("<I", 0x3000)
        data += struct.pack("<I", 0)
        data += struct.pack("<I", 0)

        device_id_bytes = self._settings.cam_device_id.encode("ascii")
        data.extend(device_id_bytes)
        data.extend(b"\x00" * (32 - len(device_id_bytes)))

        access_code_bytes = self._settings.access_code.encode("ascii")
        data.extend(access_code_bytes)
        data.extend(b"\x00" * (32 - len(access_code_bytes)))

        return bytes(data)

    async def _connect_and_stream(self, auth_data: bytes) -> None:
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE

        logger.info("Connecting to camera at %s:%s", self._settings.printer_ip, self._settings.cam_port)

        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(
                    self._settings.printer_ip,
                    self._settings.cam_port,
                    ssl=ssl_context,
                ),
                timeout=10,
            )
        except asyncio.TimeoutError:
            logger.warning("Camera connection timeout")
            await self._update_status(CameraStatus.RECONNECTING, "Camera connection timeout")
            await self._publish_placeholder_frame("Camera connection timeout")
            return
        except (ConnectionRefusedError, ConnectionResetError, OSError) as exc:
            logger.warning("Camera connection failed (device might be offline): %s", exc)
            await self._update_status(CameraStatus.RECONNECTING, "Camera not reachable")
            await self._publish_placeholder_frame("Camera not reachable")
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning("Camera connection error: %s", exc)
            await self._update_status(CameraStatus.RECONNECTING, "Camera error")
            await self._publish_placeholder_frame("Camera error")
            return

        try:
            writer.write(auth_data)
            await writer.drain()

            auth_response = await asyncio.wait_for(reader.read(16), timeout=5.0)
            logger.debug("Camera auth response: %s", auth_response.hex())

            writer.write(auth_data)
            await writer.drain()

            logger.info("Camera authentication successful, starting stream")
            await self._update_status(CameraStatus.CONNECTING, "Camera authenticated")
            await self._stream_frames(reader)
        finally:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
            await self._publish_placeholder_frame("Camera disconnected")

    async def _stream_frames(self, reader: asyncio.StreamReader) -> None:
        buffer = bytearray()
        start_marker, end_marker = b"\xff\xd8", b"\xff\xd9"
        frame_count = 0
        last_frame_time = 0.0

        while self._is_streaming:
            try:
                chunk = await asyncio.wait_for(reader.read(8192), timeout=10.0)
            except asyncio.TimeoutError:
                self._stall_count += 1
                reason = f"Camera read timeout ({self._stall_count}/{self._stall_threshold})"
                logger.warning(reason)
                await self._handle_stall(reason)
                await self._publish_placeholder_frame("Camera read timeout")
                if self._stall_count >= self._stall_threshold:
                    break
                continue

            if not chunk:
                logger.warning("Camera stream ended")
                await self._update_status(CameraStatus.RECONNECTING, "Camera stream ended")
                await self._publish_placeholder_frame("Camera stream ended")
                break

            buffer.extend(chunk)
            start_index = buffer.find(start_marker)
            end_index = buffer.find(end_marker)

            if start_index != -1 and end_index != -1 and end_index > start_index:
                current_time = time.time()
                if current_time - last_frame_time < self._settings.cam_interval:
                    buffer = buffer[end_index + 2 :]
                    continue

                frame_bytes = bytes(buffer[start_index : end_index + 2])
                buffer = buffer[end_index + 2 :]

                await self._process_frame(frame_bytes)
                frame_count += 1
                last_frame_time = current_time

                if self._stall_count > 0:
                    self._stall_count = 0
                await self._update_status(CameraStatus.STREAMING, "Camera streaming")

                if frame_count == 1:
                    logger.info("First camera frame processed successfully")
                elif frame_count % 10 == 0:
                    logger.debug("Processed %s camera frames", frame_count)

    async def _process_frame(self, jpg_data: bytes) -> None:
        loop = asyncio.get_running_loop()

        def decode() -> Optional[np.ndarray]:
            return cv2.imdecode(np.frombuffer(jpg_data, dtype=np.uint8), cv2.IMREAD_COLOR)

        frame = await loop.run_in_executor(None, decode)
        if frame is None:
            return

        def encode() -> Optional[bytes]:
            success, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            return encoded.tobytes() if success else None

        encoded_bytes = await loop.run_in_executor(None, encode)
        if not encoded_bytes:
            return

        b64_frame = base64.b64encode(encoded_bytes).decode("utf-8")
        if self._on_frame:
            await self._on_frame(b64_frame)

    async def _publish_placeholder_frame(self, reason: str | None = None) -> None:
        if reason:
            logger.debug("Publishing camera placeholder due to: %s", reason)
        message = "Camera connection failed"
        frame_height, frame_width = 360, 640
        canvas = np.zeros((frame_height, frame_width, 3), dtype=np.uint8)
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.9
        thickness = 2
        text_size, _ = cv2.getTextSize(message, font, font_scale, thickness)
        text_x = max((frame_width - text_size[0]) // 2, 10)
        text_y = (frame_height + text_size[1]) // 2
        cv2.putText(canvas, message, (text_x, text_y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
        success, encoded = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not success:
            return
        b64_frame = base64.b64encode(encoded.tobytes()).decode("utf-8")
        if self._on_frame:
            await self._on_frame(b64_frame)
