"""
Improved FTPSService wrapper for BambuFtpClient
- Connection orchestration and reconnection handled entirely at service layer
- More defensive LIST parsing
- Safer remote path composition
- Binary detection for preview
- Folder name sanitization
- Minor logging and resource-safety improvements
"""

import asyncio
import inspect
import logging
import os
import re
import threading
import time
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import AsyncIterator, Optional, BinaryIO

from app.core.bambu_ftp import (
	BambuFtpClient,
	FTPFileExistsError,
	FTPResponseError,
	FTPError,
)
from app.core.config import Settings
from app.core.request_context import request_context
from app.services.utils.ftps_helpers import format_size, get_parent_path
from app.services.utils.ftps_uploader import upload_file_blocking, UploadCancelledError
from app.services.utils.backoff import Backoff
from app.services.utils.types import FileEntry, DirectoryListing
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class FTPSService:
	def __init__(self, settings: Settings):
		self._settings = settings
		self._client: Optional[BambuFtpClient] = None
		self._connection_lock = asyncio.Lock()
		self._last_connection_check: float = 0
		self._connection_check_interval = 30  # seconds

		self._reconnect_delay = 5  # seconds
		self._max_reconnect_attempts = None  # None = unlimited
		self._reconnect_attempts = 0
		self._is_reconnecting = False
		self._reconnect_task: Optional[asyncio.Task] = None
		self._reconnect_backoff = Backoff(base_delay=self._reconnect_delay, max_delay=60.0)
		self._reconnect_paused = False
		self._ftps_status = "disconnected"
		self._stable_connect_task: Optional[asyncio.Task] = None
		self._stable_connect_delay = 1.0
		self._on_connection_change = None

		self._upload_state = {
			"active": False,
			"status": "idle",
			"filename": None,
			"sent": 0,
			"total": None,
			"speed_bps": 0.0,
			"eta_seconds": None,
			"started_at": None,
			"updated_at": None,
			"message": "",
			"generation": 0,
		}
		self._upload_state_lock = threading.Lock()
		self._upload_cancel_event: Optional[threading.Event] = None
		self._upload_cancel_requested = False
		self._upload_future: Optional[asyncio.Future] = None
		self._upload_generation = 0
		self._started = False

	# -------------------------
	# lifecycle: connect/disconnect
	# -------------------------
	async def _connect_internal(self) -> bool:
		"""Internal connect logic without locking."""
		if self._client and self._client.is_connected():
			return True

		try:
			client = BambuFtpClient()
			client.on_connection_error = self._handle_client_connection_error
			await client.connect(self._settings.printer_ip, self._settings.ftp_port)
			await client.login(self._settings.printer_username, self._settings.access_code)
			self._client = client
			logger.info("FTPSService: connected to printer %s", self._settings.printer_ip)
			self._schedule_stable_connected()
			self._last_connection_check = time.time()
			self._reconnect_attempts = 0
			self._is_reconnecting = False
			self._reconnect_backoff.reset()
			return True
		except Exception as exc:
			logger.warning("FTPSService: connect/login failed: %s", exc)
			try:
				if self._client:
					await self._client.close()
			except Exception:
				pass
			self._client = None
			await self._notify_status("disconnected")

			if not self._is_reconnecting:
				self._start_reconnection()
			return False

	async def connect(self) -> bool:
		"""Public connect method with locking."""
		async with self._connection_lock:
			return await self._connect_internal()

	async def start(self) -> bool:
		"""Start FTPS connectivity if not already running."""
		if self._started:
			return True
		self._started = True
		with request_context("bg:ftps"):
			return await self.connect()

	def set_reconnect_paused(self, paused: bool) -> None:
		self._reconnect_paused = bool(paused)
		if self._reconnect_paused and self._reconnect_task and not self._reconnect_task.done():
			self._reconnect_task.cancel()
			self._reconnect_task = None
			self._is_reconnecting = False

	async def disconnect(self) -> None:
		"""Close client and stop worker gracefully."""
		async with self._connection_lock:
			if self._reconnect_task and not self._reconnect_task.done():
				self._reconnect_task.cancel()
				try:
					await self._reconnect_task
				except asyncio.CancelledError:
					pass
				self._reconnect_task = None

			if not self._client:
				return
			try:
				await self._client.close()
			except Exception as exc:
				logger.warning("FTPSService: error during disconnect: %s", exc)
			finally:
				self._client = None
				self._is_reconnecting = False
				logger.info("FTPSService: disconnected")
				await self._notify_status("disconnected")

	async def stop(self) -> None:
		"""Stop FTPS connectivity if running."""
		if not self._started:
			return
		with request_context("bg:ftps"):
			self._started = False
			await self.disconnect()

	def _start_reconnection(self):
		"""Start reconnection process in background task."""
		if self._is_reconnecting:
			return
		if self._reconnect_paused:
			logger.debug("FTPSService: reconnect paused")
			return

		logger.info("FTPSService: scheduling reconnection loop")
		asyncio.create_task(self._notify_status("reconnecting"))
		self._is_reconnecting = True
		self._reconnect_task = asyncio.create_task(self._reconnect_loop())

	async def _reconnect_loop(self):
		"""Background task to periodically attempt reconnection."""
		with request_context("bg:ftps"):
			logger.info("FTPSService: Starting reconnection loop...")

			while self._is_reconnecting:
				if (
					self._max_reconnect_attempts is not None
					and self._reconnect_attempts >= self._max_reconnect_attempts
				):
					logger.error(
						"FTPSService: Max reconnection attempts reached (%s), stopping reconnect loop",
						self._max_reconnect_attempts,
					)
					self._is_reconnecting = False
					break

				try:
					delay = self._reconnect_backoff.next_delay()
					logger.info("FTPSService: Reconnecting in %s seconds...", delay)
					await asyncio.sleep(delay)

					logger.info("FTPSService: Attempting to reconnect...")
					success = await self.connect()

					if success:
						logger.info("FTPSService: Reconnected successfully")
						self._is_reconnecting = False
						break
					else:
						self._reconnect_attempts += 1
						logger.warning(
							"FTPSService: Reconnection attempt %s failed",
							self._reconnect_attempts,
						)

				except asyncio.CancelledError:
					logger.info("FTPSService: Reconnection cancelled")
					break
				except Exception as exc:
					self._reconnect_attempts += 1
					logger.warning("FTPSService: Error in reconnection loop: %s", exc)

	async def _ensure_connected(self) -> bool:
		"""Smart connection check with TTL and single point of connect logic."""
		now = time.time()

		if (
			self._client
			and self._client.is_connected()
			and (now - self._last_connection_check) < self._connection_check_interval
		):
			return True
		if self._reconnect_paused:
			return False

		async with self._connection_lock:
			now = time.time()
			if (
				self._client
				and self._client.is_connected()
				and (now - self._last_connection_check) < self._connection_check_interval
			):
				return True

			if not self._client or not self._client.is_connected():
				if self._reconnect_paused:
					return False
				ok = await self._connect_internal()
				return ok

			try:
				await self._client.pwd()
				self._last_connection_check = time.time()
				return True
			except Exception:
				try:
					await self._client.close()
				except Exception:
					pass
				self._client = None
				return await self._connect_internal()

	async def _handle_client_connection_error(self) -> None:
		if not self._is_reconnecting:
			self._start_reconnection()
		await self._notify_status("disconnected")

	def _schedule_stable_connected(self) -> None:
		if self._stable_connect_task and not self._stable_connect_task.done():
			self._stable_connect_task.cancel()
		self._stable_connect_task = asyncio.create_task(self._set_connected_after_delay())

	async def _set_connected_after_delay(self) -> None:
		try:
			await asyncio.sleep(self._stable_connect_delay)
		except asyncio.CancelledError:
			return
		if self._client and self._client.is_connected():
			await self._notify_status("connected")

	def set_connection_listener(self, listener) -> None:
		self._on_connection_change = listener

	async def _notify_status(self, status: str) -> None:
		if self._ftps_status == status:
			return
		self._ftps_status = status
		if not self._on_connection_change:
			return
		try:
			result = self._on_connection_change(status)
			if inspect.isawaitable(result):
				await result
		except Exception:
			logger.debug("FTPSService: failed to notify connection state", exc_info=True)

	# -------------------------
	# Upload state helpers
	# -------------------------
	def _start_upload_state(
		self,
		filename: str,
		total: Optional[int],
		status: str = "running",
		message: str = "",
	) -> None:
		now = time.time()
		with self._upload_state_lock:
			self._upload_generation += 1
			self._upload_state = {
				"active": True,
				"status": status,
				"filename": filename,
				"sent": 0,
				"total": total,
				"speed_bps": 0.0,
				"eta_seconds": None,
				"started_at": now,
				"updated_at": now,
				"message": message or "",
				"generation": self._upload_generation,
			}

	def _update_upload_state(self, sent: int, total: Optional[int]) -> None:
		with self._upload_state_lock:
			state = dict(self._upload_state)
			if not state.get("active"):
				return
			now = time.time()
			started = state.get("started_at") or now
			elapsed = max(now - started, 1e-3)
			speed = sent / elapsed if sent and elapsed else 0.0
			eta = None
			if total and speed > 0 and total > sent:
				eta = max((total - sent) / speed, 0.0)
			state.update(
				{
					"sent": sent,
					"total": total if total is not None else state.get("total"),
					"speed_bps": speed,
					"eta_seconds": eta,
					"updated_at": now,
					"generation": state.get("generation", self._upload_generation),
				}
			)
			if state.get("status") == "preparing":
				state["status"] = "running"
				state["message"] = ""
			self._upload_state = state

	def _mark_upload_cancelling(self) -> None:
		with self._upload_state_lock:
			state = dict(self._upload_state)
			if not state.get("active"):
				return
			state["status"] = "cancelling"
			state["message"] = "Cancel in progress..."
			state["updated_at"] = time.time()
			self._upload_state = state

	def _finish_upload_state(self, status: str, message: Optional[str] = None) -> None:
		with self._upload_state_lock:
			state = dict(self._upload_state)
			if not state.get("active"):
				return
			state.update(
				{
					"active": False,
					"status": status,
					"message": message or state.get("message") or "",
					"updated_at": time.time(),
					"generation": state.get("generation", self._upload_generation),
				}
			)
			self._upload_state = state

	def get_upload_status(self) -> dict:
		with self._upload_state_lock:
			return dict(self._upload_state)

	async def cancel_upload(self) -> bool:
		if not self._upload_state.get("active"):
			self._upload_cancel_requested = True
			return True
		if not self._upload_cancel_event:
			self._upload_cancel_event = threading.Event()
		if not self._upload_cancel_event.is_set():
			self._upload_cancel_event.set()
			self._mark_upload_cancelling()
			return True
		return False
			
	# -------------------------
	# Public connection check method
	# -------------------------
	async def check_and_reconnect(self):
		"""Manually trigger connection check and reconnection if needed."""
		if not await self._ensure_connected() and not self._is_reconnecting:
			self._start_reconnection()

	# -------------------------
	# helpers
	# -------------------------
	def _normalize_path(self, path: str) -> str:
		raw = path or "/"
		clean = raw.strip() or "/"
		posix = PurePosixPath("/")
		target = posix.joinpath(PurePosixPath(clean.lstrip("/")))
		if ".." in target.parts:
			raise ValueError(f"Path traversal detected: {path}")
		result = target.as_posix()
		if len(result) > 1 and result.endswith("/"):
			result = result.rstrip("/")
		return result or "/"

	def _to_client_path(self, path: str) -> str:
		normalized = self._normalize_path(path)
		if normalized in {"/", ""}:
			return ""
		return normalized.lstrip("/")

	def _compose_remote_path(self, dir_path: str, filename: str) -> str:
		dir_path = self._normalize_path(dir_path)
		if dir_path == "/":
			remote = f"/{filename}"
		else:
			remote = f"{dir_path.rstrip('/')}/{filename}"
		remote = remote.replace("//", "/")
		return remote.lstrip("/")

	def _sanitize_folder_name(self, folder_name: str) -> str:
		safe_name = folder_name.strip().strip("/")
		safe_name = safe_name.replace("..", "")
		safe_name = re.sub(r"[\\:*?\"<>|]", "", safe_name)
		return safe_name.strip()

	def _parse_list_line(self, line: str, current_path: str) -> Optional[FileEntry]:
		line = line.strip()
		if not line:
			return None

		dos_match = re.match(
			r"^(\d{2})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})(AM|PM)\s+(<DIR>|\d+)\s+(.+)$",
			line,
		)
		if dos_match:
			month, day, year_suffix, time_part, ampm, size_or_dir, name = dos_match.groups()
			is_dir = size_or_dir == "<DIR>"
			size_value = 0
			if not is_dir:
				try:
					size_value = int(size_or_dir.replace(",", ""))
				except ValueError:
					size_value = 0
			year = int(year_suffix)
			year += 2000 if year < 70 else 1900
			try:
				modified_dt = datetime.strptime(
					f"{month}-{day}-{year} {time_part}{ampm}",
					"%m-%d-%Y %I:%M%p",
				)
				modified = modified_dt.strftime("%Y-%m-%d %H:%M")
			except ValueError:
				modified = ""
			entry_path = f"{current_path}/{name}".replace("//", "/")
			return {
				"name": name,
				"size": "-" if is_dir else format_size(size_value),
				"modified": modified,
				"path": entry_path,
				"type": "dir" if is_dir else "file",
				"is_directory": is_dir,
			}

		parts = line.split(maxsplit=8)
		if len(parts) >= 6:
			perms = parts[0]
			is_dir = perms.startswith("d")
			size_value = 0
			try:
				size_str = parts[4]
				size_value = int("".join(ch for ch in size_str if ch.isdigit()))
			except Exception:
				size_value = 0

			name = parts[8] if len(parts) > 8 and parts[8] else parts[-1]
			modified = ""
			if len(parts) >= 8:
				month = parts[5]
				day = parts[6]
				time_or_year = parts[7]
				current_year = datetime.now().year
				if ":" in time_or_year:
					modified = f"{month} {day} {current_year} {time_or_year}"
				elif len(time_or_year) == 4 and time_or_year.isdigit():
					modified = f"{month} {day} {time_or_year}"

			entry_path = f"{current_path}/{name}".replace("//", "/")
			return {
				"name": name,
				"size": "-" if is_dir else format_size(size_value),
				"modified": modified,
				"path": entry_path,
				"type": "dir" if is_dir else "file",
				"is_directory": is_dir,
			}

		name = line.strip()
		entry_path = f"{current_path}/{name}".replace("//", "/")
		return {
			"name": name,
			"size": "-",
			"modified": "",
			"path": entry_path,
			"type": "file",
			"is_directory": False,
		}

	# -------------------------
	# listing & reading
	# -------------------------
	async def list_files_with_navigation(self, path: str = "/") -> DirectoryListing:
		try:
			normalized_path = self._normalize_path(path)
		except ValueError as exc:
			logger.warning("FTPSService: invalid path for listing %s", exc)
			return await self._get_fallback_files_with_path("/")
		ok = await self._ensure_connected()
		if not ok or not self._client:
			if not self._is_reconnecting:
				self._start_reconnection()
			await self._notify_status("reconnecting")
			return await self._get_fallback_files_with_path(normalized_path)

		try:
			list_target = self._to_client_path(normalized_path)
			raw_lines = await self._client.list(list_target)
			await self._notify_status("connected")
			entries: list[FileEntry] = []
			if normalized_path != "/":
				entries.append(
					{
						"name": "..",
						"size": "-",
						"modified": "",
						"path": get_parent_path(normalized_path),
						"type": "dir",
						"is_directory": True,
					}
				)

			for line in raw_lines:
				entry = self._parse_list_line(line, normalized_path)
				if entry:
					entries.append(entry)

			files_sorted = sorted(
				entries,
				key=lambda item: (not item["is_directory"], item["name"].lower()),
			)
			return {
				"files": files_sorted,
				"current_path": normalized_path,
				"is_connected": True,
				"file_count": len([e for e in files_sorted if not e.get("is_directory")]),
				"directory_count": len(
					[e for e in files_sorted if e.get("is_directory") and e["name"] != ".."]
				),
				"is_fallback": False,
			}
		except FTPError as exc:
			logger.warning("FTPSService: list error %s", exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			await self._notify_status("reconnecting")
			return await self._get_fallback_files_with_path(normalized_path)
		except Exception as exc:
			logger.warning("FTPSService: unexpected list error %s", exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			await self._notify_status("reconnecting")
			return await self._get_fallback_files_with_path(normalized_path)

	async def _is_binary_preview(self, data: bytes) -> bool:
		"""Simple heuristic: check proportion of printable ASCII in sample slice."""
		if not data:
			return False
		sample = data[:512]
		if not sample:
			return False
		printable = 0
		for b in sample:
			if b in (9, 10, 13) or 32 <= b <= 126:
				printable += 1
		ratio = printable / len(sample)
		return ratio < 0.7

	async def get_file_content(self, file_path: str) -> Optional[str]:
		if not file_path:
			return None
		try:
			normalized_path = self._normalize_path(file_path)
		except ValueError as exc:
			logger.warning("FTPSService: invalid path for content %s", exc)
			return None
		if normalized_path.endswith("/"):
			return "This is a directory. Please select a file."

		ok = await self._ensure_connected()
		if not ok or not self._client:
			if not self._is_reconnecting:
				self._start_reconnection()
			return await self._get_fallback_file_content(normalized_path)

		try:
			client_path = self._to_client_path(normalized_path)
			data = await self._client.retr(client_path or normalized_path)
			if not data:
				return ""

			if await self._is_binary_preview(data):
				return "(Binary file - preview not available)"

			try:
				return data.decode("utf-8")
			except UnicodeDecodeError:
				return data.decode("latin-1", errors="ignore")
		except FTPError as exc:
			logger.warning("FTPSService: get_file_content error %s", exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			return await self._get_fallback_file_content(normalized_path)
		except Exception as exc:
			logger.warning("FTPSService: unexpected get_file_content error %s", exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			return await self._get_fallback_file_content(normalized_path)

	# -------------------------
	# create folder
	# -------------------------
	async def create_folder(self, path: str, folder_name: str) -> bool:
		"""Sanitize folder_name and create remote directory."""
		try:
			normalized = self._normalize_path(path)
		except ValueError as exc:
			logger.warning("FTPSService: invalid path for mkdir %s", exc)
			return False
		safe_name = self._sanitize_folder_name(folder_name)
		if not safe_name:
			logger.warning("FTPSService: create_folder - empty folder name after sanitization")
			return False

		full_path = f"{normalized}/{safe_name}".replace("//", "/")
		client_path = self._to_client_path(full_path)

		ok = await self._ensure_connected()
		if not ok or not self._client:
			logger.warning("FTPSService: create_folder - not connected")
			if not self._is_reconnecting:
				self._start_reconnection()
			return False
		try:
			await self._client.mkdir(client_path or full_path)
			return True
		except FTPError as exc:
			logger.warning("FTPSService: create_folder failed %s -> %s", client_path, exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			return False
		except Exception as exc:
			logger.warning("FTPSService: unexpected create_folder error %s -> %s", client_path, exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			return False

	async def rename(self, path: str, new_name: str) -> bool:
		"""Rename a file or folder within the same directory."""
		if not path:
			raise ValueError("Existing path is required")
		if not new_name or not new_name.strip():
			raise ValueError("New name cannot be empty")
		if "/" in new_name or "\\" in new_name:
			raise ValueError("New name cannot contain path separators")

		safe_name = self._sanitize_folder_name(new_name)
		if not safe_name:
			raise ValueError("New name is invalid")

		try:
			normalized = self._normalize_path(path)
		except ValueError as exc:
			logger.warning("FTPSService: invalid path for rename %s", exc)
			raise

		if normalized == "/":
			raise ValueError("Cannot rename root directory")

		dir_path = get_parent_path(normalized)
		source_remote = self._to_client_path(normalized)
		target_remote = self._compose_remote_path(dir_path, safe_name)

		ok = await self._ensure_connected()
		if not ok or not self._client:
			logger.warning("FTPSService: rename - not connected")
			if not self._is_reconnecting:
				self._start_reconnection()
			raise ConnectionError("FTPS is not connected")

		try:
			await self._client.rename(source_remote or normalized.lstrip("/"), target_remote)
			return True
		except FTPResponseError:
			logger.warning("FTPSService: rename failed %s -> %s", normalized, target_remote)
			if not self._is_reconnecting:
				self._start_reconnection()
			raise
		except FTPError as exc:
			logger.warning("FTPSService: rename failed %s -> %s: %s", normalized, target_remote, exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			raise

	# -------------------------
	# delete methods
	# -------------------------
	async def delete(self, path: str, recursive: bool = False) -> bool:
		"""
		Delete a file or empty directory.
		Note: recursive parameter is ignored for now.
		"""
		try:
			normalized_path = self._normalize_path(path)
		except ValueError as exc:
			logger.warning("FTPSService: invalid path for delete %s", exc)
			return False
		client_path = self._to_client_path(normalized_path)

		ok = await self._ensure_connected()
		if not ok or not self._client:
			logger.warning("FTPSService: delete - not connected")
			if not self._is_reconnecting:
				self._start_reconnection()
			return False

		try:
			await self._client.delete(client_path or normalized_path)
			return True
		except FTPResponseError as exc:
			if exc.code == "550":
				return False
			if not self._is_reconnecting:
				self._start_reconnection()
			raise
		except FTPError as exc:
			logger.warning("FTPSService: delete failed %s -> %s", client_path, exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			raise
		except Exception as exc:
			logger.warning("FTPSService: unexpected delete error %s -> %s", client_path, exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			raise

	# -------------------------
	# upload helpers
	# -------------------------
	async def upload_stream(
		self,
		stream: BinaryIO,
		filename: str,
		target_path: str,
		overwrite: bool = True,
		progress_callback=None,
	) -> bool:
		try:
			normalized_path = self._normalize_path(target_path)
		except ValueError as exc:
			logger.warning("FTPSService: invalid path for upload %s", exc)
			return False

		with self._upload_state_lock:
			self._upload_state = {
				"active": True,
				"status": "preparing",
				"filename": filename,
				"sent": 0,
				"total": None,
				"speed_bps": 0.0,
				"eta_seconds": None,
				"started_at": time.time(),
				"updated_at": time.time(),
				"message": "Preparing...",
				"generation": self._upload_generation + 1,
			}
			self._upload_generation += 1
		self._upload_cancel_event = threading.Event()

		full_remote = self._compose_remote_path(normalized_path, filename)
		ok = await self._ensure_connected()
		if not ok or not self._client:
			logger.error("FTPSService: upload_stream - not connected")
			if not self._is_reconnecting:
				self._start_reconnection()
			return False

		if self._upload_future and not self._upload_future.done():
			logger.warning("FTPSService: another upload is already running")
			return False

		if not overwrite:
			try:
				if await self._client.file_exists(full_remote):
					raise FTPFileExistsError(f"File exists: {full_remote}")
			except FTPFileExistsError:
				raise
			except FTPError as exc:
				logger.warning("FTPSService: pre-upload size check failed: %s", exc)
				return False

		upload_source: Optional[BinaryIO] = None
		local_size: Optional[int] = None
		try:
			self._start_upload_state(
				filename,
				None,
				status="preparing",
				message="Preparing file...",
			)

			upload_source, local_size = await self._prepare_upload_stream(stream)
			if self._upload_cancel_requested or (self._upload_cancel_event and self._upload_cancel_event.is_set()):
				self._upload_cancel_requested = False
				self._finish_upload_state("cancelled", "Upload cancelled")
				raise UploadCancelledError("Upload cancelled by user")
			if local_size is not None:
				logger.debug("FTPSService: upload source size %s bytes", local_size)
			else:
				logger.debug("FTPSService: upload source size unknown")
			self._update_upload_state(0, local_size)

			loop = asyncio.get_running_loop()

			def _progress(sent: int, total: Optional[int]):
				self._update_upload_state(sent, total)
				if progress_callback:
					self._schedule_progress(loop, progress_callback, sent, total)

			_progress(0, local_size)

			def _do_upload():
				return upload_file_blocking(
					host=self._settings.printer_ip,
					port=self._settings.ftp_port,
					username=self._settings.printer_username,
					password=self._settings.access_code,
					remote_path=full_remote,
					chunk_size=self._client.chunk_size if self._client else 64 * 1024,
					progress=_progress,
					timeout=self._client.timeout if self._client else 30.0,
					cancel_event=self._upload_cancel_event,
					file_obj=upload_source,
					file_size=local_size,
				)

			self._upload_future = loop.run_in_executor(None, _do_upload)
			sent = await self._upload_future

			self._finish_upload_state("completed", "Upload completed")
			if progress_callback and local_size is not None:
				self._schedule_progress(loop, progress_callback, local_size, local_size)

			logger.debug("FTPSService: upload completed %s (%s bytes)", full_remote, sent)
			await self._log_remote_size(full_remote, local_size)
			return True
		except FTPFileExistsError:
			self._finish_upload_state("error", "File already exists")
			raise
		except UploadCancelledError:
			self._finish_upload_state("cancelled", "Upload cancelled")
			raise
		except Exception as exc:
			self._finish_upload_state("error", str(exc))
			logger.warning("FTPSService: upload failed for %s: %s", full_remote, exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			return False
		finally:
			self._upload_future = None
			self._upload_cancel_event = None

	async def upload_path(
		self,
		source: Path,
		target_path: str,
		overwrite: bool = True,
		progress_callback=None,
	) -> bool:
		path_obj = Path(source)
		with path_obj.open("rb") as stream:
			return await self.upload_stream(
				stream,
				path_obj.name,
				target_path,
				overwrite=overwrite,
				progress_callback=progress_callback,
			)

	async def upload_bytes(
		self,
		data: bytes,
		filename: str,
		target_path: str,
		overwrite: bool = True,
		progress_callback=None,
	) -> bool:
		stream = BytesIO(data or b"")
		try:
			return await self.upload_stream(
				stream,
				filename,
				target_path,
				overwrite=overwrite,
				progress_callback=progress_callback,
			)
		finally:
			stream.close()

	async def _prepare_upload_stream(self, stream: BinaryIO) -> tuple[BinaryIO, Optional[int]]:
		def _prepare(file_obj: BinaryIO) -> tuple[BinaryIO, Optional[int]]:
			size: Optional[int] = None
			try:
				file_obj.seek(0)
			except Exception:
				pass
			try:
				file_obj.seek(0, os.SEEK_END)
				size = file_obj.tell()
				file_obj.seek(0)
			except Exception:
				try:
					file_obj.seek(0)
				except Exception:
					pass
			return file_obj, size

		return await asyncio.to_thread(_prepare, stream)

	def _schedule_progress(self, loop: asyncio.AbstractEventLoop, progress_callback, sent: int, total: Optional[int]) -> None:
		if not progress_callback:
			return

		def _runner():
			try:
				result = progress_callback(sent, total)
				if inspect.isawaitable(result):
					asyncio.create_task(result)
			except Exception:
				logger.debug("FTPSService: progress callback failed", exc_info=True)

		loop.call_soon_threadsafe(_runner)

	async def get_remote_file_size(self, remote_path: str) -> Optional[int]:
		try:
			normalized_path = self._normalize_path(remote_path)
		except ValueError:
			return None

		ok = await self._ensure_connected()
		if not ok or not self._client:
			return None

		try:
			client_path = self._to_client_path(normalized_path)
			return await self._client.file_size(client_path or normalized_path)
		except FTPError as exc:
			logger.warning("FTPSService: size lookup failed for %s: %s", remote_path, exc)
			return None
		except Exception as exc:
			logger.warning("FTPSService: unexpected size lookup error %s: %s", remote_path, exc)
			return None

	async def _log_remote_size(self, remote_path: str, local_size: Optional[int]) -> None:
		if not self._client:
			return
		try:
			remote_size = await self._client.file_size(remote_path)
		except FTPError as size_exc:
			logger.warning("FTPSService: remote size check failed for %s: %s", remote_path, size_exc)
			return
		except Exception as size_exc:
			logger.warning("FTPSService: unexpected remote size error %s: %s", remote_path, size_exc)
			return

		if remote_size is None:
			logger.debug("FTPSService: remote size unavailable for %s", remote_path)
			return

		if local_size is None:
			logger.debug("FTPSService: remote size for %s is %s bytes (local unknown)", remote_path, remote_size)
			return

		if remote_size != local_size:
			logger.warning(
				"FTPSService: size mismatch for %s (local=%s, remote=%s)",
				remote_path,
				local_size,
				remote_size,
			)
		else:
			logger.debug("FTPSService: size match for %s (%s bytes)", remote_path, local_size)

	async def download_binary(self, remote_path: str) -> Optional[bytes]:
		"""Binary file download."""
		if not remote_path:
			return None

		try:
			normalized_path = self._normalize_path(remote_path)
		except ValueError as exc:
			logger.warning("FTPSService: invalid path for binary download %s", exc)
			return None
		if normalized_path.endswith("/"):
			return None

		ok = await self._ensure_connected()
		if not ok or not self._client:
			if not self._is_reconnecting:
				self._start_reconnection()
			return None

		try:
			client_path = self._to_client_path(normalized_path)
			return await self._client.download(client_path or normalized_path)
		except FTPError as exc:
			logger.warning("FTPSService: binary download failed: %s", exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			return None
		except Exception as exc:
			logger.warning("FTPSService: unexpected binary download error: %s", exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			return None

	async def stream_binary_file(self, remote_path: str) -> Optional[AsyncIterator[bytes]]:
		"""Return an async iterator for a remote file download without buffering entire payload."""
		if not remote_path:
			return None

		try:
			normalized_path = self._normalize_path(remote_path)
		except ValueError as exc:
			logger.warning("FTPSService: invalid path for streaming download %s", exc)
			return None
		if normalized_path.endswith("/"):
			logger.warning("FTPSService: cannot stream a directory %s", remote_path)
			return None

		ok = await self._ensure_connected()
		if not ok or not self._client:
			if not self._is_reconnecting:
				self._start_reconnection()
			return None

		try:
			client_path = self._to_client_path(normalized_path)
			return await self._client.stream_download(client_path or normalized_path)
		except FTPError as exc:
			logger.warning("FTPSService: stream_binary_file failed: %s", exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			return None
		except Exception as exc:
			logger.warning("FTPSService: unexpected stream_binary_file error: %s", exc)
			if not self._is_reconnecting:
				self._start_reconnection()
			return None

	async def stream_file(self, remote_path: str) -> AsyncIterator[bytes]:
		"""Yield file content in chunks without loading entire payload into memory."""
		if not remote_path:
			raise ValueError("File path is required")

		try:
			normalized_path = self._normalize_path(remote_path)
		except ValueError as exc:
			logger.warning("FTPSService: invalid path for stream download %s", exc)
			fallback = await self._get_fallback_file_content("/")
			yield fallback.encode("utf-8")
			return
		if normalized_path.endswith("/"):
			raise ValueError("Cannot stream a directory")

		ok = await self._ensure_connected()
		if ok and self._client:
			client_path = self._to_client_path(normalized_path)
			try:
				stream_iter = await self._client.stream_download(client_path or normalized_path)
				async for chunk in stream_iter:
					yield chunk
				return
			except FTPError as exc:
				logger.warning("FTPSService: stream download failed %s -> %s", client_path, exc)
				if not self._is_reconnecting:
					self._start_reconnection()
			except Exception as exc:
				logger.warning("FTPSService: unexpected stream download error %s -> %s", client_path, exc)
				if not self._is_reconnecting:
					self._start_reconnection()

		fallback = await self._get_fallback_file_content(normalized_path)
		yield fallback.encode("utf-8")

	# -------------------------
	# Health check
	# -------------------------
	async def check_connection(self) -> dict:
		"""Check FTPS connection health."""
		try:
			if not self._client:
				return {
					"status": "disconnected",
					"connected": False,
					"is_reconnecting": self._is_reconnecting,
					"reconnect_attempts": self._reconnect_attempts,
				}

			await self._client.pwd()
			return {
				"status": "connected",
				"connected": True,
				"is_reconnecting": False,
				"printer_ip": self._settings.printer_ip,
				"timestamp": datetime.now().isoformat(),
			}
		except FTPError as e:
			logger.warning("Health check failed: %s", e)
			if not self._is_reconnecting:
				self._start_reconnection()
			return {
				"status": "error",
				"connected": False,
				"is_reconnecting": self._is_reconnecting,
				"reconnect_attempts": self._reconnect_attempts,
				"error": str(e),
				"timestamp": datetime.now().isoformat(),
			}
		except Exception as e:
			logger.error("Health check unexpected failure: %s", e)
			if not self._is_reconnecting:
				self._start_reconnection()
			return {
				"status": "error",
				"connected": False,
				"is_reconnecting": self._is_reconnecting,
				"reconnect_attempts": self._reconnect_attempts,
				"error": str(e),
				"timestamp": datetime.now().isoformat(),
			}

	# -------------------------
	# Fallback content (kept simple)
	# -------------------------
	async def _get_fallback_files_with_path(self, path: str) -> DirectoryListing:
		await asyncio.sleep(0)
		entries: list[FileEntry] = []
		if path != "/":
			entries.append(
				{
					"name": "..",
					"size": "-",
					"modified": "",
					"path": get_parent_path(path),
					"type": "dir",
					"is_directory": True,
				}
			)
		now = datetime.now()
		if path == "/":
			entries.extend(
				[
					{
						"name": "calibration.gcode",
						"size": "256.8 KB",
						"modified": (now - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S"),
						"path": "/calibration.gcode",
						"type": "file",
						"is_directory": False,
					},
					{
						"name": "test_cube.gcode",
						"size": "1.4 MB",
						"modified": (now - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S"),
						"path": "/test_cube.gcode",
						"type": "file",
						"is_directory": False,
					},
					{
						"name": "configs",
						"size": "-",
						"modified": (now - timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S"),
						"path": "/configs",
						"type": "dir",
						"is_directory": True,
					},
				]
			)
		else:
			folder_name = path.rstrip("/").split("/")[-1] or "files"
			entries.extend(
				[
					{
						"name": f"{folder_name}_sample.gcode",
						"size": "112.3 KB",
						"modified": (now - timedelta(minutes=45)).strftime("%Y-%m-%d %H:%M:%S"),
						"path": f"{path}/{folder_name}_sample.gcode",
						"type": "file",
						"is_directory": False,
					}
				]
			)
		files_sorted = sorted(
			entries,
			key=lambda item: (not item["is_directory"], item["name"].lower()),
		)
		return {
			"files": files_sorted,
			"current_path": path,
			"is_connected": False,
			"is_reconnecting": self._is_reconnecting,
			"file_count": len([e for e in files_sorted if not e.get("is_directory")]),
			"directory_count": len(
				[e for e in files_sorted if e.get("is_directory") and e["name"] != ".."]
			),
			"is_fallback": True,
		}

	async def _get_fallback_file_content(self, file_path: str) -> str:
		filename = file_path.split("/")[-1] or "file"
		ext = filename.lower().split(".")[-1] if "." in filename else ""
		if ext in {"gcode", "gc", "nc"}:
			return f"; {filename}\n; Offline sample\nG28\n"
		if ext in {"txt", "log", "json", "csv"}:
			return f"{filename}\nOffline preview\n"
		return f"{filename}\nUnavailable offline\n"


