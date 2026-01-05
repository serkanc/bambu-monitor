from __future__ import annotations

import asyncio
import json
import logging
import re
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Optional
from urllib.parse import quote, urlparse

from app.core.exceptions import ServiceUnavailableError
from app.models import LastSentProjectFile
from app.services.ftps_service import FTPSService
from app.services.mqtt_service import MQTTService
from app.services.utils.print_job_cache import PrintJobCache
from app.services.utils.printjob_utils import (
	extract_plate_index_from_name,
	parse_gcode_header,
	parse_model_settings,
	parse_slice_metadata,
)
from app.services.utils.task_queue import TaskQueue

if TYPE_CHECKING:
	from app.services.state_orchestrator import StateOrchestrator

logger = logging.getLogger(__name__)


class PrintJobService:
	def __init__(
		self,
		ftps_service: FTPSService | None,
		mqtt_service: MQTTService | None,
		state_orchestrator: "StateOrchestrator" | None = None,
	):
		self._ftps_service = ftps_service
		self._mqtt_service = mqtt_service
		self._active_jobs: dict[str, asyncio.Task] = {}
		self._prepare_queue = TaskQueue(name="printjob-prepare", concurrency=1)
		self.cache_dir = Path("data/print-cache")
		self.cache_dir.mkdir(parents=True, exist_ok=True)
		self._cache = PrintJobCache(self.cache_dir)
		self._last_sent_project_files: dict[str, LastSentProjectFile] = {}
		self._last_sent_project_files_lock = asyncio.Lock()
		self._state_orchestrator = state_orchestrator

		# Print job progress / status state
		self._job_state: dict[str, dict] = {}
		self._job_state_lock = asyncio.Lock()

	def _require_ftps_service(self) -> FTPSService:
		if not self._ftps_service:
			raise ServiceUnavailableError("FTPS service unavailable")
		return self._ftps_service

	def _require_mqtt_service(self) -> MQTTService:
		if not self._mqtt_service:
			raise ServiceUnavailableError("MQTT service unavailable")
		return self._mqtt_service

	# ----------------------------------------
	# Public API
	# ----------------------------------------

	async def prepare_file(self, printer_id: str, filename: str):
		# If an older job exists for this printer, cancel it.
		logger.info(f"Preparing print job for printer {printer_id}, file {filename}")		
		old = self._active_jobs.get(printer_id)
		if old and not old.done():
			old.cancel()

		# Create a new task.
		task = await self._prepare_queue.submit(
			lambda: self._run_prepare_job(printer_id, filename)
		)
		self._active_jobs[printer_id] = task

		return {"status": "started"}

	async def execute_print(self, printer_id: str, params: dict):
		payload = {
			"print": {
				"sequence_id": "0",
				"command": "project_file",
				"url": params["url"],  # e.g. ftp:///MyFile.3mf
				"param": params["plate"],  # e.g. Metadata/plate_1.gcode
				"bed_leveling": params.get("bed_leveling", False),
				"flow_cali": params.get("flow_cali", False),
				"timelapse": params.get("timelapse", False),
				"use_ams": params.get("use_ams", True),
				"ams_mapping": params.get("ams_mapping", []),
				"layer_inspect": params.get("layer_inspect", True),
				"vibration_cali": params.get("vibration_cali", True)
			}
		}
		logger.info(payload)

		await self._require_mqtt_service().send_project_print(payload)
		await self._set_last_sent_project_file(printer_id, payload["print"])

		return {"status": "sent"}

	async def cancel(self, printer_id: str):
		task = self._active_jobs.get(printer_id)
		if task and not task.done():
			task.cancel()
		return {"status": "cancelled"}

	def get_job_status(self, printer_id: str) -> dict:
		"""Status payload polled by the UI."""
		default = {
			"active": False,
			"status": "idle",
			"progress": 0,
			"step": "",
			"message": "",
			"filename": "",
			"file_path": "",
			"download_bytes": None,
			"download_total": None,
		}
		return self._job_state.get(printer_id, default)

	async def shutdown(self) -> None:
		for task in self._active_jobs.values():
			if not task.done():
				task.cancel()
		if self._active_jobs:
			await asyncio.gather(*self._active_jobs.values(), return_exceptions=True)
		self._active_jobs.clear()
		await self._prepare_queue.stop()

	async def get_last_sent_project_file(self, printer_id: str) -> dict | None:
		if not printer_id:
			return None
		async with self._last_sent_project_files_lock:
			record = self._last_sent_project_files.get(printer_id)
			if not record:
				return None
			return record.dict()

	async def _set_last_sent_project_file(self, printer_id: str, payload: dict) -> None:
		if not printer_id or not isinstance(payload, dict):
			return
		if payload.get("command") != "project_file":
			return
		url = str(payload.get("url") or "")
		record = {
			"command": "project_file",
			"url": url,
			"file": self._extract_url_filename(url),
			"param": payload.get("param"),
			"bed_leveling": payload.get("bed_leveling"),
			"flow_cali": payload.get("flow_cali"),
			"timelapse": payload.get("timelapse"),
			"use_ams": payload.get("use_ams"),
			"ams_mapping": payload.get("ams_mapping"),
			"layer_inspect": payload.get("layer_inspect"),
			"vibration_cali": payload.get("vibration_cali"),
			"sent_at": datetime.utcnow().isoformat(),
		}
		try:
			last_sent = LastSentProjectFile(**record)
		except Exception:
			return
		async with self._last_sent_project_files_lock:
			self._last_sent_project_files[printer_id] = last_sent

		if self._state_orchestrator:
			await self._state_orchestrator.set_last_sent_project_file(printer_id, last_sent)

	@staticmethod
	def _extract_url_filename(url: str | None) -> str | None:
		if not url:
			return None
		try:
			parsed = urlparse(url)
			path = parsed.path or ""
		except ValueError:
			path = str(url)
		name = PurePosixPath(path).name if path else PurePosixPath(str(url)).name
		return name or None

	# ----------------------------------------
	# Internal job runner
	# ----------------------------------------

	async def _run_prepare_job(self, printer_id: str, filename: str):
		display_name = ""
		try:
			display_name, target_path = self._normalize_job_input(filename)
			remote_path, parent_remote_path = self._resolve_remote_path(target_path)
		except ValueError as exc:
			await self._set_job_state(
				printer_id,
				active=False,
				status="error",
				step="Error",
				message=str(exc),
				filename=display_name,
				file_path="",
			)
			return

		try:
			await self._set_job_state(
				printer_id,
				active=True,
				status="running",
				progress=0,
				step="Preparing print file...",
				filename=display_name,
				file_path=remote_path,
				download_bytes=None,
				download_total=None,
			)

			await self._set_job_state(
				printer_id,
				progress=20,
				step="Checking cache...",
			)

			try:
				file_info, cache_path, cache_valid = await self._lookup_or_cache_remote_file(
					printer_id,
					display_name,
					remote_path,
					parent_remote_path,
				)
			except FileNotFoundError as exc:
				await self._set_job_state(
					printer_id,
					active=False,
					status="error",
					step="Error",
					message=str(exc),
					filename=display_name,
					file_path="",
				)
				return
			except RuntimeError as exc:
				await self._set_job_state(
					printer_id,
					active=False,
					status="error",
					step="Error",
					message=str(exc),
					filename=display_name,
					file_path="",
				)
				return

			file_path = cache_path
			if cache_valid:
				await self._set_job_state(
					printer_id,
					progress=40,
					step="Using cached file",
					download_bytes=None,
					download_total=None,
				)
			else:
				downloaded_path = await self._download_remote_file(
					printer_id,
					display_name,
					remote_path,
					file_info,
				)
				if not downloaded_path:
					return
				file_path = downloaded_path

			await self._set_job_state(
				printer_id,
				progress=70,
				step="File ready (not yet extracted)",
			)

			file_path, _ = self._cache.get_paths(printer_id, display_name)

			await self._set_job_state(
				printer_id,
				progress=75,
				step="Extracting 3MF archive...",
			)

			extract_dir = await self._extract_3mf_bundle(printer_id, file_path)
			if not extract_dir:
				return

			await self._set_job_state(
				printer_id,
				progress=85,
				step="Parsing slice metadata...",
			)

			slice_info = parse_slice_metadata(printer_id, extract_dir)
			model_settings = parse_model_settings(printer_id, extract_dir)

			plate_path, plate_files = self._detect_plate_files(printer_id, extract_dir)
			if not plate_path:
				await self._set_job_state(
					printer_id,
					active=False,
					status="error",
					step="Error",
					message="Plate gcode file not found in 3MF",
				)
				return

			plate_gcodes = self._load_plate_gcodes(printer_id, extract_dir, plate_files)

			default_plate_idx = extract_plate_index_from_name(plate_path.name) or 1
			gcode_summary = plate_gcodes.get(default_plate_idx) or parse_gcode_header(
				printer_id, plate_path
			)

			normalized_plate_files = [
				name if name.startswith("Metadata/") else f"Metadata/{name}"
				for name in plate_files
			]
			plate_preview_map = self._build_plate_preview_map(extract_dir, normalized_plate_files)

			await self._finalize_prepare_state(
				printer_id=printer_id,
				filename=display_name,
				slice_info=slice_info,
				plate_path=plate_path,
				plate_files=normalized_plate_files,
				plate_gcodes=plate_gcodes,
				gcode_summary=gcode_summary,
				remote_path=remote_path,
				plate_preview_map=plate_preview_map,
				model_settings=model_settings,
				extract_dir=extract_dir,
			)

		except asyncio.CancelledError:
			await self._set_job_state(
				printer_id,
				active=False,
				status="cancelled",
				message="Cancelled by user",
				step="Cancelled",
				download_bytes=None,
				download_total=None,
			)
			raise
		except Exception as exc:
			logger.exception("Print job prepare failed: %s", exc)
			await self._set_job_state(
				printer_id,
				active=False,
				status="error",
				message=str(exc),
				step="Error",
				download_bytes=None,
				download_total=None,
			)
			raise

	def _normalize_job_input(self, filename: str) -> tuple[str, PurePosixPath]:
		raw_identifier = (filename or "").strip()
		raw_identifier = raw_identifier.replace("\\", "/")
		if raw_identifier.lower().startswith("ftp://"):
			raw_identifier = raw_identifier[6:]
		display_name = Path(raw_identifier).name if raw_identifier else ""
		if not display_name:
			raise ValueError("Invalid file name")
		target_path = PurePosixPath("/" + raw_identifier.lstrip("/"))
		return display_name, target_path

	def _resolve_remote_path(self, target_path: PurePosixPath) -> tuple[str, str]:
		if ".." in target_path.parts:
			raise ValueError("Invalid file path")
		remote_path = target_path.as_posix()
		parent_remote_path = target_path.parent.as_posix()
		if not parent_remote_path or parent_remote_path == ".":
			parent_remote_path = "/"
		if remote_path in {"", "/"}:
			raise ValueError("Invalid file path")
		return remote_path, parent_remote_path

	async def _lookup_or_cache_remote_file(
		self,
		printer_id: str,
		display_name: str,
		remote_path: str,
		parent_remote_path: str,
	) -> tuple[dict, Path, bool]:
		try:
			listing = await self._require_ftps_service().list_files_with_navigation(
				parent_remote_path
			)
		except Exception as exc:
			logger.warning("Failed to list files for cache lookup: %s", exc)
			raise RuntimeError("Unable to read printer storage") from exc

		if not listing.get("is_connected") or listing.get("is_fallback"):
			raise RuntimeError("Printer storage unavailable")

		files = listing.get("files") or []
		file_info = next(
			(
				entry
				for entry in files
				if not entry.get("is_directory")
				and (
					entry.get("path") == remote_path
					or (not entry.get("path") and entry.get("name") == display_name)
				)
			),
			None,
		)

		if not file_info:
			raise FileNotFoundError("File not found on printer")

		cache_path, _ = self._cache.get_paths(printer_id, display_name)
		cache_valid = await self._cache.is_valid(
			printer_id,
			display_name,
			file_info.get("modified", ""),
			file_info.get("size", ""),
			remote_path,
		)
		return file_info, cache_path, cache_valid

	async def _download_remote_file(
		self,
		printer_id: str,
		display_name: str,
		remote_path: str,
		file_info: dict,
	) -> Path | None:
		downloaded_path = await self._download_file(printer_id, remote_path)
		if not downloaded_path:
			return None
		await self._cache.write_meta(
			printer_id,
			display_name,
			file_info.get("modified", ""),
			file_info.get("size", ""),
			remote_path,
		)
		return downloaded_path

	async def _extract_3mf_bundle(self, printer_id: str, file_path: Path) -> Path | None:
		return await self._extract_3mf(printer_id, file_path)

	def _detect_plate_files(self, printer_id: str, extract_dir: Path) -> tuple[Path | None, list[str]]:
		plate_path = self._detect_plate_file(printer_id, extract_dir)
		plate_files = self._list_plate_files(extract_dir)
		if not plate_files and plate_path:
			plate_files = [plate_path.name]
		return plate_path, plate_files

	async def _finalize_prepare_state(
		self,
		printer_id: str,
		filename: str,
		slice_info: dict,
		plate_path: Path,
		plate_files: list[str],
		plate_gcodes: dict[int, dict],
		gcode_summary: dict,
		remote_path: str,
		plate_preview_map: dict[int, str],
		model_settings: dict,
		extract_dir: Path,
	) -> None:
		result = self._build_prepare_result(
			printer_id=printer_id,
			filename=filename,
			slice_info=slice_info,
			plate_path=plate_path,
			plate_files=plate_files,
			plate_gcodes=plate_gcodes,
			gcode_summary=gcode_summary,
			file_path=remote_path,
			plate_preview_map=plate_preview_map,
			model_settings=model_settings,
			extract_dir=extract_dir,
		)
		await self._set_job_state(
			printer_id,
			progress=100,
			status="completed",
			step="Ready for print setup",
			active=False,
			metadata_result=result,
			file_path=remote_path,
		)

	# ----------------------------------------
	# Download helper
	# ----------------------------------------

	async def _download_file(self, printer_id: str, remote_path: str) -> Optional[Path]:
		"""
		Download a file via FTPSService.stream_binary_file and write to cache.
		Remove the temp file on cancel.
		"""
		filename = Path(remote_path).name
		file_path, _ = self._cache.get_paths(printer_id, filename)
		temp_path = file_path.with_suffix(".tmp")

		ftps = self._require_ftps_service()

		stream = await ftps.stream_binary_file(remote_path)
		if stream is None:
			await self._set_job_state(
				printer_id,
				active=False,
				status="error",
				message="Download failed",
				step="Error",
				download_bytes=None,
				download_total=None,
			)
			return None

		remote_size = await ftps.get_remote_file_size(remote_path)
		total_bytes = remote_size if isinstance(remote_size, int) and remote_size >= 0 else None

		await self._set_job_state(
			printer_id,
			step="Downloading from printer",
			progress=40,
			download_bytes=0,
			download_total=total_bytes,
		)

		loop = asyncio.get_running_loop()
		last_update = 0.0
		downloaded = 0

		try:
			with temp_path.open("wb") as fh:
				async for chunk in stream:
					if not chunk:
						continue
					fh.write(chunk)
					downloaded += len(chunk)
					now = loop.time()
					should_emit = now - last_update >= 0.25
					is_complete = total_bytes is not None and downloaded >= total_bytes
					if should_emit or is_complete:
						payload = {
							"download_bytes": downloaded,
							"download_total": total_bytes,
							"step": "Downloading from printer",
						}
						if total_bytes:
							progress = 40 + int(
								min(downloaded / max(total_bytes, 1), 1.0) * 20
							)
							payload["progress"] = min(progress, 60)
						await self._set_job_state(printer_id, **payload)
						last_update = now

			if hasattr(stream, "aclose"):
				try:
					await stream.aclose()
				except Exception:
					pass

			temp_path.replace(file_path)

			await self._set_job_state(
				printer_id,
				progress=60,
				step="Download complete",
				download_bytes=None,
				download_total=None,
			)

			return file_path

		except asyncio.CancelledError:
			if temp_path.exists():
				temp_path.unlink()
			if hasattr(stream, "aclose"):
				try:
					await stream.aclose()
				except Exception:
					pass
			await self._set_job_state(
				printer_id,
				download_bytes=None,
				download_total=None,
			)
			raise
		except Exception as exc:
			logger.warning("Download failed for %s: %s", remote_path, exc)
			if temp_path.exists():
				temp_path.unlink()
			if hasattr(stream, "aclose"):
				try:
					await stream.aclose()
				except Exception:
					pass
			await self._set_job_state(
				printer_id,
				active=False,
				status="error",
				message="Download failed",
				step="Error",
				download_bytes=None,
				download_total=None,
			)
			return None

	# ----------------------------------------
	# Job state helpers
	# ----------------------------------------

	async def _set_job_state(self, printer_id: str, **kwargs):
		async with self._job_state_lock:
			default = {
				"active": False,
				"status": "idle",
				"progress": 0,
				"step": "",
				"message": "",
				"filename": "",
				"file_path": "",
				"download_bytes": None,
				"download_total": None,
			}
			state = self._job_state.get(printer_id, default)
			state.update(kwargs)
			self._job_state[printer_id] = state

	async def _extract_3mf(self, printer_id: str, file_path: Path) -> Path | None:
		"""
		Extract the 3MF archive into a folder with the same stem.
		Set error state if the Metadata folder is missing.
		"""
		try:
			extract_dir = file_path.with_suffix("")  # Strip .3mf to get folder name.
			extract_dir.mkdir(parents=True, exist_ok=True)

			with zipfile.ZipFile(file_path, "r") as zf:
				zf.extractall(extract_dir)

			metadata_dir = extract_dir / "Metadata"
			if not metadata_dir.exists():
				await self._set_job_state(
					printer_id,
					status="error",
					step="Error",
					message="Metadata folder missing in 3MF file",
					active=False,
				)
				return None

			return extract_dir

		except asyncio.CancelledError:
			raise
		except zipfile.BadZipFile:
			logger.warning("3MF extract skipped (not a zip): %s", file_path)
			await self._set_job_state(
				printer_id,
				status="error",
				step="Error",
				message="Invalid 3MF file (not a zip)",
				active=False,
			)
			return None
		except Exception as exc:
			logger.exception("Failed to extract 3MF: %s", exc)
			await self._set_job_state(
				printer_id,
				status="error",
				step="Error",
				message=f"3MF extract failed: {exc}",
				active=False,
			)
			return None
	
	def _detect_plate_file(self, printer_id: str, extract_dir: Path) -> Path | None:
		metadata_dir = extract_dir / "Metadata"

		# Prefer plate_1.gcode first.
		default_plate = metadata_dir / "plate_1.gcode"
		if default_plate.exists():
			return default_plate

		# Otherwise, find the first .gcode under Metadata.
		try:
			for child in metadata_dir.iterdir():
				if child.is_file() and child.suffix.lower() == ".gcode":
					return child
		except FileNotFoundError:
			pass

		logger.warning("No plate gcode found in %s", metadata_dir)
		return None
	
	def _list_plate_files(self, extract_dir: Path) -> list[str]:
		metadata_dir = extract_dir / "Metadata"
		if not metadata_dir.exists():
			return []

		try:
			files = [
				child.name
				for child in metadata_dir.iterdir()
				if child.is_file() and child.suffix.lower() == ".gcode"
			]
		except FileNotFoundError:
			return []

		def sort_key(name: str):
			match = re.search(r"(\d+)", name)
			return (int(match.group(1)) if match else 9999, name.lower())

		return sorted(files, key=sort_key)

	def _build_plate_preview_map(self, extract_dir: Path, plate_files: list[str]) -> dict[int, str]:
		metadata_dir = extract_dir / "Metadata"
		if not metadata_dir.exists():
			return {}

		preview_map: dict[int, str] = {}
		for offset, file_name in enumerate(plate_files, start=1):
			name_only = Path(file_name).name
			preview_rel = self._find_preview_file(metadata_dir, name_only)
			if not preview_rel:
				continue
			plate_index = extract_plate_index_from_name(name_only) or offset
			preview_map[plate_index] = preview_rel
		return preview_map

	def get_plate_preview_path(self, printer_id: str, filename: str, relative_path: str) -> Path | None:
		if not relative_path:
			return None
		file_path, _ = self._cache.get_paths(printer_id, filename)
		extract_dir = file_path.with_suffix("")
		if not extract_dir.exists():
			return None

		safe_rel = relative_path.strip().lstrip("/").replace("\\", "/")
		if not safe_rel:
			return None
		target_rel = Path(safe_rel)
		if target_rel.is_absolute() or ".." in target_rel.parts:
			return None
		target_path = extract_dir / target_rel
		if not target_path.exists():
			return None
		return target_path

	def _find_preview_file(self, metadata_dir: Path, gcode_name: str) -> str | None:
		stem = Path(gcode_name).stem
		candidate = metadata_dir / f"{stem}.png"
		if not candidate.exists():
			return None
		try:
			relative = candidate.relative_to(metadata_dir.parent).as_posix()
		except ValueError:
			relative = candidate.name
		return relative

	def _load_plate_gcodes(
		self, printer_id: str, extract_dir: Path, plate_files: list[str]
	) -> dict[int, dict]:
		metadata_dir = extract_dir / "Metadata"
		result: dict[int, dict] = {}
		for idx, file_name in enumerate(plate_files, start=1):
			plate_path = metadata_dir / file_name
			summary = parse_gcode_header(printer_id, plate_path)
			plate_index = extract_plate_index_from_name(file_name) or idx
			result[plate_index] = summary
		return result
	
	def _build_prepare_result(
		self,
		printer_id: str,
		filename: str,
		slice_info: dict,
		plate_path: Path,
		plate_files: list[str],
		plate_gcodes: dict[int, dict],
		gcode_summary: dict,
		file_path: str,
		plate_preview_map: dict[int, str],
		model_settings: dict,
		extract_dir: Path,
	) -> dict:
		"""
		Build a single JSON payload for PrintSetupUI.
		"""
		plates = slice_info.get("plates", [])
		model_plate_map: dict[int, dict[str, str]] = {}
		if isinstance(model_settings, dict):
			for entry in model_settings.get("plates", []):
				index_value = entry.get("index")
				try:
					index_int = int(index_value) if index_value is not None else None
				except (TypeError, ValueError):
					index_int = None
				if index_int is None:
					continue
				metadata = entry.get("metadata")
				if not isinstance(metadata, dict):
					continue
				model_plate_map[index_int] = metadata
		if model_plate_map:
			for idx, plate in enumerate(plates):
				plate_index = plate.get("index")
				if plate_index is None:
					plate_index = idx + 1
				metadata = plate.get("metadata") or {}
				model_meta = model_plate_map.get(plate_index)
				if model_meta:
					plate["metadata"] = {**model_meta, **metadata}
		max_filament_id = 0

		for idx, plate in enumerate(plates):
			filaments = plate.get("filaments") or []
			for fil in filaments:
				fil_id = fil.get("id")
				if isinstance(fil_id, int) and fil_id > max_filament_id:
					max_filament_id = fil_id

			plate_index = plate.get("index")
			if plate_index is None:
				plate_index = idx + 1
			gcode_for_plate = plate_gcodes.get(plate_index)
			if gcode_for_plate:
				plate["gcode"] = gcode_for_plate

		# Default plate is the first plate for now.
		default_plate_index = 0 if plates else None

		normalized_plate_files = plate_files

		preview_urls = []
		for idx, plate in enumerate(plates):
			plate_index = plate.get("index")
			if plate_index is None:
				plate_index = idx + 1
			preview_rel = plate_preview_map.get(plate_index)
			if preview_rel:
				preview_urls.append(self._build_preview_url(printer_id, filename, preview_rel))
			else:
				preview_urls.append(None)

		skip_object = self._build_skip_object_payload(
			printer_id=printer_id,
			filename=filename,
			remote_path=file_path,
			extract_dir=extract_dir,
			slice_info=slice_info,
			model_settings=model_settings,
		)

		return {
			"filename": filename,
			"printer_id": printer_id,
			"file_path": file_path,
			"plate_file": str(plate_path.name),
			"plate_path": str(plate_path),
			"plate_files": normalized_plate_files,
			"plate_preview_urls": preview_urls,
			"plates": plates,
			"max_filament_id": max_filament_id,
			"default_plate_index": default_plate_index,
			"gcode": gcode_summary,
			"skip_object": skip_object,
		}

	def _build_preview_url(self, printer_id: str, filename: str, relative_path: str) -> str:
		safe_printer = quote(printer_id, safe="")
		safe_filename = quote(filename, safe="")
		safe_path = quote(relative_path, safe="/")
		return f"/api/printjob/plate-preview?printer_id={safe_printer}&filename={safe_filename}&path={safe_path}"

	def has_cached_extract(self, printer_id: str, filename: str) -> bool:
		if not filename:
			return False
		candidate = Path(filename).name
		if self._resolve_cached_bundle(printer_id, candidate):
			return True
		return self._has_cached_plate_gcode(printer_id, candidate)

	async def has_cached_extract_for_remote(self, printer_id: str, filename: str) -> bool:
		remote_entry = await self._fetch_remote_entry(printer_id, filename)
		if not remote_entry:
			return False
		remote_name = remote_entry.get("name") or ""
		if not self._cache_meta_matches_entry(printer_id, remote_name, remote_entry):
			return False
		return self._resolve_cached_bundle(printer_id, remote_name) is not None

	async def get_cached_metadata_result(self, printer_id: str, filename: str) -> dict | None:
		remote_entry = await self._fetch_remote_entry(printer_id, filename)
		if not remote_entry:
			return None
		remote_name = remote_entry.get("name") or ""
		if not self._cache_meta_matches_entry(printer_id, remote_name, remote_entry):
			return None

		resolved = self._resolve_cached_bundle(printer_id, remote_name)
		if not resolved:
			return None
		display_name, file_path, extract_dir, meta = resolved

		slice_info = parse_slice_metadata(printer_id, extract_dir)
		model_settings = parse_model_settings(printer_id, extract_dir)

		plate_path, plate_files = self._detect_plate_files(printer_id, extract_dir)
		if not plate_path or not plate_files:
			return None

		plate_gcodes = self._load_plate_gcodes(printer_id, extract_dir, plate_files)
		default_plate_idx = extract_plate_index_from_name(plate_path.name) or 1
		gcode_summary = plate_gcodes.get(default_plate_idx) or parse_gcode_header(
			printer_id, plate_path
		)
		normalized_plate_files = [
			name if name.startswith("Metadata/") else f"Metadata/{name}"
			for name in plate_files
		]
		plate_preview_map = self._build_plate_preview_map(extract_dir, normalized_plate_files)
		remote_path = ""
		if isinstance(meta, dict):
			remote_path = meta.get("path") or ""

		return self._build_prepare_result(
			printer_id=printer_id,
			filename=display_name,
			slice_info=slice_info,
			plate_path=plate_path,
			plate_files=normalized_plate_files,
			plate_gcodes=plate_gcodes,
			gcode_summary=gcode_summary,
			file_path=remote_path,
			plate_preview_map=plate_preview_map,
			model_settings=model_settings,
			extract_dir=extract_dir,
		)

	async def get_cached_metadata_result_local(self, printer_id: str, filename: str) -> dict | None:
		if not filename:
			return None
		resolved = self._resolve_cached_bundle(printer_id, filename)
		if not resolved:
			return None
		display_name, file_path, extract_dir, meta = resolved

		slice_info = parse_slice_metadata(printer_id, extract_dir)
		model_settings = parse_model_settings(printer_id, extract_dir)

		plate_path, plate_files = self._detect_plate_files(printer_id, extract_dir)
		if not plate_path or not plate_files:
			return None

		plate_gcodes = self._load_plate_gcodes(printer_id, extract_dir, plate_files)
		default_plate_idx = extract_plate_index_from_name(plate_path.name) or 1
		gcode_summary = plate_gcodes.get(default_plate_idx) or parse_gcode_header(
			printer_id, plate_path
		)
		normalized_plate_files = [
			name if name.startswith("Metadata/") else f"Metadata/{name}"
			for name in plate_files
		]
		plate_preview_map = self._build_plate_preview_map(extract_dir, normalized_plate_files)
		remote_path = ""
		if isinstance(meta, dict):
			remote_path = meta.get("path") or ""

		return self._build_prepare_result(
			printer_id=printer_id,
			filename=display_name,
			slice_info=slice_info,
			plate_path=plate_path,
			plate_files=normalized_plate_files,
			plate_gcodes=plate_gcodes,
			gcode_summary=gcode_summary,
			file_path=remote_path,
			plate_preview_map=plate_preview_map,
			model_settings=model_settings,
			extract_dir=extract_dir,
		)

	def _has_cached_plate_gcode(self, printer_id: str, filename: str) -> bool:
		if not filename:
			return False
		base_dir = self.cache_dir / printer_id
		if not base_dir.exists():
			return False
		try:
			for child in base_dir.iterdir():
				if not child.is_dir():
					continue
				metadata_dir = child / "Metadata"
				if not metadata_dir.exists():
					continue
				if (metadata_dir / filename).exists():
					return True
		except FileNotFoundError:
			return False
		return False

	def _build_skip_object_payload(
		self,
		printer_id: str,
		filename: str,
		remote_path: str,
		extract_dir: Path,
		slice_info: dict,
		model_settings: dict,
	) -> dict:
		meta_ok = self._cache_meta_matches(printer_id, filename, remote_path)
		plates = slice_info.get("plates", []) if isinstance(slice_info, dict) else []
		pick_map = self._build_pick_file_map(model_settings, plates)
		plate_status = []

		if not plates:
			return {
				"available": False,
				"reason": "slice_info_missing",
				"plates": plate_status,
			}

		for idx, plate in enumerate(plates):
			plate_index = plate.get("index")
			if plate_index is None:
				plate_index = idx + 1
			metadata = plate.get("metadata") or {}
			enabled_raw = str(metadata.get("label_object_enabled", "")).strip().lower()
			label_enabled = enabled_raw in {"1", "true", "yes"}
			objects = plate.get("objects") or []

			pick_rel = self._normalize_relative_path(pick_map.get(plate_index))
			pick_path = extract_dir / pick_rel if pick_rel else None
			pick_exists = bool(pick_path and pick_path.exists())
			pick_url = self._build_preview_url(printer_id, filename, pick_rel) if pick_exists else None

			reason = None
			if not meta_ok:
				reason = "cache_meta_missing"
			elif not label_enabled:
				reason = "label_object_disabled"
			elif not pick_exists:
				reason = "pick_file_missing"
			elif not objects:
				reason = "objects_missing"

			plate_status.append(
				{
					"index": plate_index,
					"available": reason is None,
					"reason": reason,
					"pick_path": pick_rel,
					"pick_url": pick_url,
				}
			)

		default_plate_index = 0
		primary = plate_status[default_plate_index] if plate_status else None
		return {
			"available": bool(primary and primary.get("available")),
			"reason": None if (primary and primary.get("available")) else (primary or {}).get("reason"),
			"plates": plate_status,
		}

	def _cache_meta_matches(self, printer_id: str, filename: str, remote_path: str) -> bool:
		file_path, meta_path = self._cache.get_paths(printer_id, filename)
		if not file_path.exists() or not meta_path.exists():
			return False
		try:
			meta = json.loads(meta_path.read_text())
		except Exception:
			return False
		if meta.get("name") != filename:
			return False
		if remote_path and meta.get("path") != remote_path:
			return False
		if not meta.get("modified") or not meta.get("size"):
			return False
		return True

	def _build_pick_file_map(self, model_settings: dict, plates: list[dict]) -> dict[int, str]:
		pick_map: dict[int, str] = {}
		for plate in model_settings.get("plates", []) if isinstance(model_settings, dict) else []:
			index = plate.get("index")
			pick_file = (plate.get("metadata") or {}).get("pick_file")
			if isinstance(index, int) and pick_file:
				pick_map[index] = pick_file

		for idx, plate in enumerate(plates):
			plate_index = plate.get("index")
			if plate_index is None:
				plate_index = idx + 1
			if isinstance(plate_index, int) and plate_index not in pick_map:
				pick_map[plate_index] = f"Metadata/pick_{plate_index}.png"

		return pick_map

	def _normalize_relative_path(self, value: str | None) -> str | None:
		if not value:
			return None
		safe_rel = value.strip().lstrip("/").replace("\\", "/")
		if not safe_rel:
			return None
		target_rel = Path(safe_rel)
		if target_rel.is_absolute() or ".." in target_rel.parts:
			return None
		return safe_rel

	def _resolve_cached_bundle(
		self, printer_id: str, filename: str
	) -> tuple[str, Path, Path, dict | None] | None:
		if not filename:
			return None
		candidate = Path(filename).name
		candidates = [candidate]
		lower = candidate.lower()
		if not lower.endswith(".3mf"):
			candidates.append(f"{candidate}.3mf")

		seen: set[str] = set()
		for name in candidates:
			if name in seen:
				continue
			seen.add(name)
			file_path, meta_path = self._cache.get_paths(printer_id, name)
			if not file_path.exists() or not meta_path.exists():
				continue
			try:
				meta = json.loads(meta_path.read_text())
			except Exception:
				meta = None
			extract_dir = file_path.with_suffix("")
			metadata_dir = extract_dir / "Metadata"
			if metadata_dir.exists():
				display_name = meta.get("name") if isinstance(meta, dict) else None
				return display_name or name, file_path, extract_dir, meta
		return None

	def _cache_meta_matches_entry(
		self, printer_id: str, filename: str, entry: dict
	) -> bool:
		if not filename or not entry:
			return False
		file_path, meta_path = self._cache.get_paths(printer_id, filename)
		if not file_path.exists() or not meta_path.exists():
			return False
		modified = entry.get("modified") or ""
		size = entry.get("size") or ""
		remote_path = entry.get("path") or ""
		if not modified or not size or not remote_path:
			return False
		try:
			meta = json.loads(meta_path.read_text())
		except Exception:
			return False
		if meta.get("name") != filename:
			return False
		if meta.get("modified") != modified:
			return False
		if meta.get("size") != size:
			return False
		if meta.get("path") != remote_path:
			return False
		return True

	async def _fetch_remote_entry(self, printer_id: str, filename: str) -> dict | None:
		if not filename or not self._ftps_service:
			return None
		raw = str(filename).strip().replace("\\", "/")
		if raw.lower().startswith("ftp://"):
			raw = raw[6:]
		raw = raw.lstrip("/")
		if not raw:
			return None
		if "/" in raw:
			parent, base = raw.rsplit("/", 1)
		else:
			parent, base = "", raw
		if not base:
			return None
		parent_path = f"/{parent}" if parent else "/"
		candidates = [base]
		if not base.lower().endswith(".3mf"):
			candidates.append(f"{base}.3mf")

		listing = await self._ftps_service.list_files_with_navigation(parent_path)
		if not listing.get("is_connected") or listing.get("is_fallback"):
			return None
		files = listing.get("files") or []
		for name in candidates:
			for entry in files:
				if entry.get("is_directory"):
					continue
				if entry.get("name") == name:
					return entry
		return None
	

