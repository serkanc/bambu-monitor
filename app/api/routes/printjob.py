from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from app.api.dependencies import get_print_job_service, get_state_manager
from app.core.exceptions import NotFoundError
from app.services.print_job_service import PrintJobService
from app.services.state_manager import StateManager

router = APIRouter(prefix="/printjob", tags=["printjob"])

@router.post("/prepare")
async def prepare_print_job(
    printer_id: str,
    filename: str,
    service: PrintJobService = Depends(get_print_job_service),
):
    """
    Starts preparing the print job:
    - (future) Download file if needed
    - (future) Extract 3mf
    - (future) Parse metadata
    - (future) Return print setup info
    """
    return await service.prepare_file(printer_id, filename)


@router.post("/cancel")
async def cancel_print_job(
    printer_id: str,
    service: PrintJobService = Depends(get_print_job_service),
):
    """
    Cancels the in-progress job (download/extraction).
    """
    return await service.cancel(printer_id)

@router.get("/status")
async def get_status(
    printer_id: str,
    service: PrintJobService = Depends(get_print_job_service),
):
    return service.get_job_status(printer_id)

@router.post("/execute")
async def execute_print_job(
    printer_id: str,
    params: dict,
    service: PrintJobService = Depends(get_print_job_service)
):
    return await service.execute_print(printer_id, params)


@router.get("/plate-preview")
async def get_plate_preview(
    printer_id: str,
    filename: str,
    path: str,
    service: PrintJobService = Depends(get_print_job_service),
):
    preview_path = service.get_plate_preview_path(printer_id, filename, path)
    if not preview_path:
        raise NotFoundError("Preview not found")
    return FileResponse(preview_path)


@router.get("/skip-metadata")
async def get_skip_metadata(
    printer_id: str,
    filename: str,
    service: PrintJobService = Depends(get_print_job_service),
    state_manager: StateManager = Depends(get_state_manager),
):
    result = await service.get_cached_metadata_result(printer_id, filename)
    if not result:
        raise NotFoundError("Skip metadata unavailable")
    await state_manager.set_skip_object_state(printer_id, result.get("skip_object"))
    return result
