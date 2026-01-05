"""MQTT service responsible for receiving printer updates.

The async tasks defined here (main loop, pushall refresher, heartbeat
handling) all run on the shared event loop alongside camera/FTP duties.
Timeouts such as ``_heartbeat_timeout`` and the reconnect delay act as
back-pressure to keep the loop responsive; whenever a task exceeds these
limits it logs the failure, marks the printer offline and schedules a
restart so other background jobs are not starved.
"""
import asyncio
import contextlib
import json
import logging
import ssl
import time
from typing import Optional

from aiomqtt import Client, MqttError

from app.core.config import Settings
from app.core.tasks import monitor_task
from app.core.request_context import request_context
from app.services.debug_service import DebugService
from app.services.state_orchestrator import StateOrchestrator
from app.services.utils.backoff import Backoff

logger = logging.getLogger(__name__)


class MQTTService:
	"""Maintain the MQTT connection and forward events to the state manager."""

	def __init__(
		self,
		settings: Settings,
		state_orchestrator: StateOrchestrator,
		debug_service: DebugService,
	) -> None:
		self._settings = settings
		self._state_orchestrator = state_orchestrator
		self._debug_service = debug_service
		self._is_running = False
		self._current_task: Optional[asyncio.Task[None]] = None
		self._client: Optional[Client] = None
		self._heartbeat_timeout = 10.0
		self._printer_id = settings.printer_id
		self._reconnect_backoff = Backoff(base_delay=5.0, max_delay=60.0)
		self._last_message_at: float = 0.0

	async def start(self) -> None:
		if self._is_running:
			return

		with request_context("bg:mqtt"):
			self._is_running = True
			self._current_task = monitor_task(
				asyncio.create_task(self._mqtt_loop()),
				name="mqtt-service",
				logger=logger,
				on_error=self._handle_task_crash,
			)
			logger.info("MQTT service started")

	async def stop(self) -> None:
		self._is_running = False
		if self._current_task:
			self._current_task.cancel()
			with contextlib.suppress(asyncio.CancelledError):
				await self._current_task
			self._current_task = None
		logger.info("MQTT service stopped")

	async def send_pushall(self) -> None:
		if not self._client:
			raise RuntimeError("MQTT client not connected")

		command = json.dumps({"pushing": {"command": "pushall"}})

		await self._client.publish(
			f"device/{self._settings.serial}/request",
			command,
		)
		logger.info("PushAll command sent")

	async def set_chamber_light(self, mode: str) -> None:
		if mode not in {"on", "off"}:
			raise ValueError("mode must be 'on' or 'off'")
		await self._require_client()

		payload = json.dumps({
			"system": {
				"command": "ledctrl",
				"led_node": "chamber_light",
				"led_mode": mode,
			}
		})

		await self._client.publish(
			f"device/{self._settings.serial}/request",
			payload,
		)
		logger.debug("Chamber light set to %s", mode)

	async def send_print_command(self, command: str, param: str) -> None:
		await self._require_client()

		payload = json.dumps(
			{
				"print": {
					"sequence_id": "0",
					"command": command,
					"param": param,
				}
			}
		)

		await self._client.publish(
			f"device/{self._settings.serial}/request",
			payload,
		)
		logger.debug("Print command sent: %s %s", command, param)

	async def send_project_print(self, payload: dict) -> None:
		"""Send full project_file print command to the printer."""
		await self._require_client()

		# payload is a dict, encode it as JSON
		json_str = json.dumps(payload)

		await self._client.publish(
			f"device/{self._settings.serial}/request",
			json_str,
		)

		logger.debug("Project print command sent: %s", json_str)

	async def _require_client(self) -> None:
		"""Ensure MQTT client is connected."""
		if not self._client:
			raise RuntimeError("MQTT client not connected")

	def is_connected(self) -> bool:
		if not self._client:
			return False
		if self._last_message_at <= 0:
			return True
		return (time.monotonic() - self._last_message_at) < (self._heartbeat_timeout * 2)

	async def _send_heartbeat_ping(self) -> None:
		"""Trigger a heartbeat request to verify the printer is responsive."""
		if not self._client:
			return

		await self._client.publish(
			f"device/{self._settings.serial}/request",
			json.dumps({"print": {"command": "heartbeat"}}),
		)

	def _handle_task_crash(self, exc: BaseException) -> None:
		if not self._is_running:
			return
		logger.error("MQTT service crashed, scheduling restart")
		self._is_running = False
		asyncio.create_task(self.start())
	
	async def _mqtt_loop(self) -> None:
		with request_context("bg:mqtt"):
			ssl_context = ssl.create_default_context()
			ssl_context.check_hostname = False
			ssl_context.verify_mode = ssl.CERT_NONE

			while self._is_running:
				try:
					async with Client(
						hostname=self._settings.printer_ip,
						port=self._settings.mqtt_port,
						username=self._settings.printer_username,
						password=self._settings.access_code,
						tls_context=ssl_context,
						timeout=10,
					) as client:
						self._client = client
						self._last_message_at = time.monotonic()
						self._reconnect_backoff.reset()
						await self._state_orchestrator.set_printer_online(self._printer_id, True)
						topic = f"device/{self._settings.serial}/report"
						await client.subscribe(topic)
						logger.info("MQTT connected and subscribed")

						await client.publish(
							f"device/{self._settings.serial}/request",
							json.dumps({"pushing": {"command": "pushall"}}),
						)
						await client.publish(
							f"device/{self._settings.serial}/request",
							json.dumps({"info": {"command": "get_version"}}),
						)

						pushall_task = asyncio.create_task(self._pushall_service(client))

						messages = client.messages
						while self._is_running:
							try:
								message = await asyncio.wait_for(
									messages.__anext__(),
									timeout=self._heartbeat_timeout,
								)
							except asyncio.TimeoutError:
								await self._send_heartbeat_ping()
								try:
									message = await asyncio.wait_for(
										messages.__anext__(),
										timeout=self._heartbeat_timeout,
									)
								except asyncio.TimeoutError:
									logger.warning(
										"MQTT heartbeat retry failed after heartbeat ping for printer %s",
										self._settings.printer_id,
									)
									await self._state_orchestrator.set_printer_online(self._printer_id, False)
									break
								except StopAsyncIteration:
									break
								except asyncio.CancelledError:
									raise
								except Exception as exc:  # noqa: BLE001
									logger.warning("MQTT message loop error: %s", exc)
									await self._state_orchestrator.set_printer_online(self._printer_id, False)
									break
							except StopAsyncIteration:
								break
							except asyncio.CancelledError:
								raise
							except Exception as exc:  # noqa: BLE001
								logger.warning("MQTT message loop error: %s", exc)
								await self._state_orchestrator.set_printer_online(self._printer_id, False)
								break

							if message.topic.matches(topic):
								await self._process_mqtt_message(message.payload)

						pushall_task.cancel()
						with contextlib.suppress(asyncio.CancelledError):
							await pushall_task
				except MqttError as exc:
					logger.warning("MQTT connection error: %s", exc)
					await self._state_orchestrator.set_printer_online(self._printer_id, False)
				except Exception as exc:  # noqa: BLE001
					logger.warning("MQTT unexpected error: %s", exc)
					await self._state_orchestrator.set_printer_online(self._printer_id, False)
				finally:
					self._client = None
					self._last_message_at = 0.0

				if self._is_running:
					delay = self._reconnect_backoff.next_delay()
					logger.info("MQTT reconnecting in %s seconds...", delay)
					await asyncio.sleep(delay)

	async def _pushall_service(self, client: Client) -> None:
		while self._is_running:
			try:
				await client.publish(
					f"device/{self._settings.serial}/request",
					json.dumps({"pushing": {"command": "pushall"}}),
				)
				await asyncio.sleep(self._settings.pushall_interval)
			except Exception as exc:  # noqa: BLE001
				logger.warning("Pushall failed: %s - Forcing reconnection", exc)
			
				# Notify the main loop to force a reconnect
				# 1) Cancel this task
				# 2) Force the async context to exit
				try:
					# Close the underlying transport
					if hasattr(client, '_client'):
						client._client.disconnect()
				except Exception:
					pass
				return  # End the task
	async def _process_mqtt_message(self, payload: bytes) -> None:
		try:
			self._last_message_at = time.monotonic()
			await self._debug_service.add_message(self._printer_id, payload)
			payload_str = payload.decode("utf-8")
			data = json.loads(payload_str)

			await self._state_orchestrator.update_print_data(self._printer_id, data)
		except Exception as exc:  # noqa: BLE001
			logger.warning("MQTT message processing error: %s", exc)
