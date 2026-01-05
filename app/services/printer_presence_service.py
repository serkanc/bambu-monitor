"""Background watchers that keep all printer states warm.

Each configured printer gets its own lightweight MQTT watcher. These
watchers pull status updates even when a printer is not the currently
selected device, and forward every payload through the shared state
orchestrator so that event hooks, debug tools and the UI can rely on
cached state for all printers without opening additional MQTT/FTP sessions.
event hooks, debug tools and the UI can rely on cached state for all
printers without opening additional MQTT/FTP sessions.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import ssl
from datetime import datetime
from typing import Awaitable, Callable, Dict, Optional

from aiomqtt import Client, MqttError
from pydantic import BaseModel

from app.core.config import PrinterConfig, Settings, list_printer_definitions
from app.core.request_context import clear_request_id, request_context, set_request_id
from app.core.tasks import monitor_task
from app.services.state_orchestrator import StateOrchestrator
from app.services.state_repository import StateRepository
from app.services.utils.backoff import Backoff

logger = logging.getLogger(__name__)


class PrinterPresenceState(BaseModel):
	"""Simple state snapshot for a printer."""

	online: bool = False
	last_seen: Optional[datetime] = None
	last_error: Optional[str] = None


class PrinterPresenceService:
	"""Maintain a lightweight MQTT watcher per printer to populate caches."""

	def __init__(
		self,
		settings: Settings,
		repository: StateRepository,
		orchestrator: StateOrchestrator,
		heartbeat_timeout: float = 10.0,
		reconnect_delay: float = 5.0,
	) -> None:
		self._settings = settings
		self._repository = repository
		self._orchestrator = orchestrator
		self._heartbeat_timeout = heartbeat_timeout
		self._reconnect_delay = reconnect_delay
		self._states: Dict[str, PrinterPresenceState] = {}
		self._watchers: Dict[str, PrinterCacheWatcher] = {}
		self._lock = asyncio.Lock()
		self._is_running = False

	async def start(self) -> None:
		if self._is_running:
			return

		with request_context("bg:presence"):
			printers = list_printer_definitions()
			if not printers:
				logger.warning("No printers configured; presence service will remain idle")
				return

			async with self._lock:
				if self._is_running:
					return

				self._watchers.clear()

				for printer in printers:
					self._states.setdefault(printer.id, PrinterPresenceState())
					watcher = self._build_watcher(printer)
					self._watchers[printer.id] = watcher

				self._is_running = True

			await asyncio.gather(*(watcher.start() for watcher in self._watchers.values()))
			logger.info("Printer presence service started for %s printers", len(self._watchers))

	async def stop(self) -> None:
		async with self._lock:
			if not self._is_running:
				return
			self._is_running = False

		await asyncio.gather(*(watcher.stop() for watcher in self._watchers.values()), return_exceptions=True)
		logger.info("Printer presence service stopped")

	async def _update_state(
		self,
		printer_id: str,
		*,
		online: bool,
		last_seen: Optional[datetime] = None,
		error: Optional[str] = None,
	) -> None:
		async with self._lock:
			state = self._states.setdefault(printer_id, PrinterPresenceState())
			state.online = online
			if last_seen is not None:
				state.last_seen = last_seen
			if online:
				state.last_error = None
			elif error is not None:
				state.last_error = error

	async def list_states(self) -> Dict[str, PrinterPresenceState]:
		async with self._lock:
			snapshot = {printer_id: state.copy(deep=True) for printer_id, state in self._states.items()}

		active_id = self._repository.get_active_printer_id()
		if active_id:
			active_state = snapshot.setdefault(active_id, PrinterPresenceState())
			try:
				state = await self._repository.get_state(active_id)
			except Exception:  # noqa: BLE001
				return snapshot
			active_state.online = state.printer_online
			if state.printer_online:
				active_state.last_seen = datetime.utcnow()
				active_state.last_error = None
		return snapshot

	async def get_state(self, printer_id: str) -> Optional[PrinterPresenceState]:
		async with self._lock:
			state = self._states.get(printer_id)
			return state.copy(deep=True) if state else None

	async def add_printer(self, printer: PrinterConfig) -> None:
		"""Start tracking a newly added printer."""

		async with self._lock:
			self._states.setdefault(printer.id, PrinterPresenceState())
			watcher = self._build_watcher(printer)
			self._watchers[printer.id] = watcher
			should_start = self._is_running

		if should_start:
			await watcher.start()

	async def remove_printer(self, printer_id: str) -> None:
		"""Stop tracking a printer and discard cached state."""

		async with self._lock:
			watcher = self._watchers.pop(printer_id, None)
			self._states.pop(printer_id, None)
		if watcher:
			await watcher.stop()
		await self._repository.reset(printer_id)

	def _build_watcher(self, printer: PrinterConfig) -> "PrinterCacheWatcher":
		return PrinterCacheWatcher(
			printer=printer,
			username=self._settings.printer_username,
			mqtt_port=self._settings.mqtt_port,
			repository=self._repository,
			orchestrator=self._orchestrator,
			heartbeat_timeout=self._heartbeat_timeout,
			reconnect_delay=self._reconnect_delay,
			update_callback=self._update_state,
		)


class PrinterCacheWatcher:
	"""Single MQTT watcher responsible for keeping one printer's cache warm."""

	def __init__(
		self,
		*,
		printer: PrinterConfig,
		username: str,
		mqtt_port: int,
		repository: StateRepository,
		orchestrator: StateOrchestrator,
		heartbeat_timeout: float,
		reconnect_delay: float,
		update_callback: Callable[..., Awaitable[None]],
	) -> None:
		self._printer = printer
		self._username = username
		self._mqtt_port = mqtt_port
		self._repository = repository
		self._orchestrator = orchestrator
		self._heartbeat_timeout = heartbeat_timeout
		self._reconnect_delay = reconnect_delay
		self._update_callback = update_callback
		self._task: Optional[asyncio.Task[None]] = None
		self._running = False
		self._heartbeat_sent = False
		self._backoff = Backoff(base_delay=reconnect_delay, max_delay=max(reconnect_delay, 30.0))

	async def start(self) -> None:
		if self._task:
			return
		self._running = True
		self._task = monitor_task(
			asyncio.create_task(self._run(), name=f"presence-{self._printer.id}"),
			name=f"presence-{self._printer.id}",
			logger=logger,
			on_error=self._handle_task_crash,
		)

	async def stop(self) -> None:
		self._running = False
		if self._task:
			self._task.cancel()
			with contextlib.suppress(asyncio.CancelledError):
				await self._task
			self._task = None

	async def _run(self) -> None:
		set_request_id(f"bg:presence:{self._printer.id}")
		try:
			ssl_context = ssl.create_default_context()
			ssl_context.check_hostname = False
			ssl_context.verify_mode = ssl.CERT_NONE
			topic = f"device/{self._printer.serial}/report"
			request_topic = f"device/{self._printer.serial}/request"

			while self._running:
				if self._repository.is_active_printer(self._printer.id):
					await asyncio.sleep(self._reconnect_delay)
					continue

				try:
					async with Client(
						hostname=self._printer.printer_ip,
						port=self._mqtt_port,
						username=self._username,
						password=self._printer.access_code,
						tls_context=ssl_context,
						timeout=10,
					) as client:
						await client.subscribe(topic)
						await client.publish(request_topic, json.dumps({"pushing": {"command": "pushall"}}))
						await client.publish(request_topic, json.dumps({"info": {"command": "get_version"}}))
						await self._mark_online()
						self._backoff.reset()
						self._heartbeat_sent = False

						messages = client.messages
						while self._running:
							if self._repository.is_active_printer(self._printer.id):
								await self._mark_offline("suspended (active printer)")
								break
							try:
								message = await asyncio.wait_for(messages.__anext__(), timeout=self._heartbeat_timeout)
							except asyncio.TimeoutError:
								if not self._heartbeat_sent:
									await self._send_heartbeat(client)
									continue
								await self._mark_offline("heartbeat timeout")
								break
							except StopAsyncIteration:
								break
							except asyncio.CancelledError:
								raise
							except Exception as exc:  # noqa: BLE001
								logger.warning("Presence watcher error for %s: %s", self._printer.id, exc)
								await self._mark_offline(str(exc))
								break
							else:
								self._heartbeat_sent = False
								if message.topic.matches(topic):
									await self._handle_payload(message.payload)
				except asyncio.CancelledError:
					raise
				except MqttError as exc:
					logger.debug("Presence watcher MQTT error for %s: %s", self._printer.id, exc)
					await self._mark_offline(str(exc))
				except Exception as exc:  # noqa: BLE001
					logger.exception("Presence watcher crashed for %s: %s", self._printer.id, exc)
					await self._mark_offline(str(exc))
				finally:
					if not self._running:
						break
					await asyncio.sleep(self._backoff.next_delay())
		finally:
			clear_request_id()

	async def _handle_payload(self, payload: bytes) -> None:
		try:
			data = json.loads(payload.decode("utf-8"))
		except Exception as exc:  # noqa: BLE001
			logger.debug("Failed to decode payload for %s: %s", self._printer.id, exc)
			return

		await self._orchestrator.update_print_data(self._printer.id, data)
		await self._mark_online()
		self._heartbeat_sent = False

	async def _mark_online(self) -> None:
		await self._update_callback(self._printer.id, online=True, last_seen=datetime.utcnow())
		if not self._repository.is_active_printer(self._printer.id):
			await self._orchestrator.set_printer_online(self._printer.id, True)

	async def _mark_offline(self, reason: str) -> None:
		await self._update_callback(self._printer.id, online=False, error=reason)
		if not self._repository.is_active_printer(self._printer.id):
			await self._orchestrator.set_printer_online(self._printer.id, False)
		self._heartbeat_sent = False

	async def _send_heartbeat(self, client: Client) -> None:
		request_topic = f"device/{self._printer.serial}/request"
		try:
			await client.publish(
				request_topic,
				json.dumps({"print": {"command": "heartbeat"}}),
			)
			self._heartbeat_sent = True
		except Exception as exc:  # noqa: BLE001
			logger.warning("Failed to send heartbeat for %s: %s", self._printer.id, exc)

	def _handle_task_crash(self, exc: BaseException) -> None:
		if not self._running:
			return
		logger.error("Presence watcher %s crashed, restarting", self._printer.id)
		self._task = None
		asyncio.create_task(self.start())
