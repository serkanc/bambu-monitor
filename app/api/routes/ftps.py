"""FTPS file explorer endpoints (clean version)."""
import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from app.api.dependencies import DeviceContext, get_active_device_context
from app.core.config import get_app_config
from app.core.exceptions import BadRequestError, CancelledError
from app.schemas import FileListingResponse, FileOperationResponse
from app.core.bambu_ftp import FTPError, FTPResponseError
from app.services.utils.ftps_uploader import UploadCancelledError
from app.services.utils.errors import normalize_ftp_error
from app.services.utils.print_job_cache import PrintJobCache

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/files", response_model=FileListingResponse, summary="List files in a directory")
async def list_files(
	path: str = Query("/", description="Directory path to list"),
	context: DeviceContext = Depends(get_active_device_context),
) -> FileListingResponse:
	ftps_service = context.require_ftps()
	try:
		payload = await ftps_service.list_files_with_navigation(path)
	except asyncio.CancelledError:
		logger.info("FTPS list_files request cancelled")
		raise CancelledError("File listing operation cancelled")
	return FileListingResponse.parse_obj(payload)


@router.get("/files/download")
async def download_file(
	file_path: str = Query(...),
	context: DeviceContext = Depends(get_active_device_context),
):
	"""Download a binary file."""
	ftps_service = context.require_ftps()
	try:
		filename = file_path.split("/")[-1] or "download"
		size = await ftps_service.get_remote_file_size(file_path)
		async def stream():
			try:
				async for chunk in ftps_service.stream_file(file_path):
					yield chunk
			except asyncio.CancelledError:
				logger.info("Download stream cancelled by client: %s", file_path)
				return
		headers = {
			"Content-Disposition": f'attachment; filename="{filename}"',
		}
		if size is not None:
			headers["X-File-Size"] = str(size)
		return StreamingResponse(
			stream(),
			media_type="application/octet-stream",
			headers=headers,
		)

	except ValueError as exc:
		logger.warning("Download validation error: %s", exc)
		raise BadRequestError(str(exc)) from exc
	except Exception as e:
		logger.warning("Download error: %s", e)
		raise normalize_ftp_error(e)

@router.post(
	"/files/create-folder",
	response_model=FileOperationResponse,
	summary="Create a new folder",
)
async def create_folder(
	path: str = Form(..., description="Parent directory path"),
	folder_name: str = Form(..., description="New folder name"),
	context: DeviceContext = Depends(get_active_device_context),
):
	ftps_service = context.require_ftps()
	if not folder_name.strip():
		raise BadRequestError("Folder name cannot be empty")

	try:
		success = await ftps_service.create_folder(path, folder_name)
		if not success:
			raise BadRequestError("Folder creation failed. Check path or permissions.")

		base_path = (path or "/").strip() or "/"
		trimmed = base_path.rstrip("/") if base_path != "/" else "/"
		created_path = f"{trimmed}/{folder_name}".replace("//", "/")
		return FileOperationResponse(
			success=True,
			message=f"Folder '{folder_name}' created successfully",
			path=created_path,
		)

	except Exception as e:
		logger.warning("Create-folder error: %s", e)
		raise normalize_ftp_error(e, fallback="Internal server error during folder creation")

@router.delete("/files/delete", response_model=FileOperationResponse, summary="Delete a file or empty directory")
async def delete_file(
	path: str = Query(..., description="Absolute FTPS path"),
	context: DeviceContext = Depends(get_active_device_context),
):
	ftps_service = context.require_ftps()
	if not path or path == "/":
		raise BadRequestError("Cannot delete root directory")
	
	try:
		success = await ftps_service.delete(path)
		if not success:
			raise BadRequestError("Delete failed")
		
		return FileOperationResponse(
			success=True,
			message="Deleted successfully",
			deleted_path=path,
		)
		
	except ConnectionError as exc:
		raise BadRequestError("Permission denied") from exc
	except Exception as exc:
		raise normalize_ftp_error(exc, fallback="Internal server error")


@router.post("/files/rename", response_model=FileOperationResponse, summary="Rename a file or directory")
async def rename_file(
	path: str = Form(..., description="Absolute FTPS path to rename"),
	new_name: str = Form(..., description="New basename"),
	context: DeviceContext = Depends(get_active_device_context),
):
	ftps_service = context.require_ftps()
	if not path or path == "/":
		raise BadRequestError("Root directory cannot be renamed")
	new_name_clean = (new_name or "").strip()
	if not new_name_clean:
		raise BadRequestError("New name cannot be empty")

	try:
		success = await ftps_service.rename(path, new_name_clean)
		if not success:
			raise BadRequestError("Rename operation failed")
		return FileOperationResponse(
			success=True,
			message=f"Renamed to '{new_name_clean}'",
			filename=new_name_clean,
		)

	except ValueError as exc:
		raise BadRequestError(str(exc)) from exc
	except ConnectionError as exc:
		raise normalize_ftp_error(exc, fallback="FTPS service unavailable") from exc
	except asyncio.CancelledError:
		logger.info("FTPS rename request cancelled")
		raise CancelledError("Rename operation cancelled")
	except FTPResponseError as exc:
		raise normalize_ftp_error(exc) from exc
	except FTPError as exc:
		raise normalize_ftp_error(exc) from exc


@router.post("/files/upload", response_model=FileOperationResponse, summary="Upload a file to FTPS")
async def upload_file(
	file: UploadFile = File(..., description="File to upload"),
	path: str = Form("/", description="Target directory path"),
	context: DeviceContext = Depends(get_active_device_context),
):
	"""Upload a file to the specified FTPS directory."""
	ftps_service = context.require_ftps()

	allowed_extensions = {".gcode", ".3mf"}

	try:
		if not file.filename:
			raise BadRequestError("Invalid file")

		ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
		if ext not in allowed_extensions:
			raise BadRequestError(
				f"File type not allowed. Allowed types: {', '.join(allowed_extensions)}"
			)

		config = get_app_config()
		cache_upload_enabled = bool(config.cache_upload_enabled)
		should_cache = cache_upload_enabled and ext == ".3mf"
		cache = PrintJobCache(Path("data/print-cache"))
		cache_path = None

		if should_cache:
			cache_path, _ = cache.get_paths(context.printer_id, file.filename)
			cache_path.parent.mkdir(parents=True, exist_ok=True)
			temp_path = cache_path.with_suffix(cache_path.suffix + ".tmp")
			with temp_path.open("wb") as handle:
				while True:
					chunk = await file.read(1024 * 1024)
					if not chunk:
						break
					handle.write(chunk)
			temp_path.replace(cache_path)
			success = await ftps_service.upload_path(cache_path, path)
		else:
			success = await ftps_service.upload_stream(file.file, file.filename, path)

		if not success:
			if should_cache and cache_path:
				try:
					if cache_path.exists():
						cache_path.unlink()
				except Exception:
					pass
				try:
					meta_path = cache_path.parent / f"{cache_path.name}.meta.json"
					if meta_path.exists():
						meta_path.unlink()
				except Exception:
					pass
			raise BadRequestError("File upload failed")

		if should_cache and cache_path:
			try:
				listing = await ftps_service.list_files_with_navigation(path)
				entries = listing.get("files") or []
				entry = next(
					(
						item
						for item in entries
						if not item.get("is_directory") and item.get("name") == file.filename
					),
					None,
				)
				if entry:
					await cache.write_meta(
						context.printer_id,
						file.filename,
						entry.get("modified", ""),
						entry.get("size", ""),
						entry.get("path", ""),
					)
			except Exception:
				logger.warning("Failed to update cache metadata after upload", exc_info=True)

		return FileOperationResponse(
			success=True,
			message="File uploaded successfully",
			filename=file.filename,
			path=path,
		)

	except BadRequestError:
		raise
	except UploadCancelledError as exc:
		raise CancelledError(str(exc) or "Upload cancelled") from exc
	except Exception as e:
		logger.warning("Upload error: %s", e)
		raise normalize_ftp_error(e, fallback="Internal server error during upload")
	finally:
		try:
			await file.close()
		except Exception:
			pass


@router.get("/files/upload/status", summary="Current upload status")
async def upload_status(context: DeviceContext = Depends(get_active_device_context)):
	return context.require_ftps().get_upload_status()


@router.post("/files/upload/cancel", response_model=FileOperationResponse, summary="Cancel active upload")
async def cancel_upload(context: DeviceContext = Depends(get_active_device_context)):
	cancelled = await context.require_ftps().cancel_upload()
	if not cancelled:
		raise BadRequestError("No active upload to cancel")
	return FileOperationResponse(success=True, message="Upload cancellation requested")
