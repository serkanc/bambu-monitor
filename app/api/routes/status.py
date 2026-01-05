"""Printer status endpoints."""
from fastapi import APIRouter, Depends, Query, status

from app.api.dependencies import get_printer_config_service
from app.schemas import (
    CreatePrinterRequest,
    CreatePrinterResponse,
    DeletePrinterResponse,
    PrinterInfoResponse,
    PrinterListItem,
    SelectPrinterRequest,
    StatusResponse,
)
from app.services.printer_config_service import PrinterConfigService

router = APIRouter()


@router.get("/status", response_model=StatusResponse, summary="Retrieve printer status")
async def read_status(
    printer_id: str | None = Query(default=None),
    service: PrinterConfigService = Depends(get_printer_config_service),
) -> StatusResponse:
    return await service.read_status(printer_id)


@router.get(
    "/status/current-printer",
    response_model=PrinterInfoResponse,
    summary="Get current printer configuration",
)
async def get_current_printer(
    service: PrinterConfigService = Depends(get_printer_config_service),
) -> PrinterInfoResponse:
    return service.get_current_printer()


@router.get(
    "/status/printers",
    response_model=list[PrinterListItem],
    summary="List configured printers",
)
async def list_printers(
    service: PrinterConfigService = Depends(get_printer_config_service),
) -> list[PrinterListItem]:
    return await service.list_printers()


@router.post(
    "/status/printers/verify",
    response_model=CreatePrinterResponse,
    summary="Verify printer credentials before registration",
    status_code=status.HTTP_200_OK,
)
async def verify_printer(
    payload: CreatePrinterRequest,
    service: PrinterConfigService = Depends(get_printer_config_service),
) -> CreatePrinterResponse:
    return await service.verify_printer(payload)


@router.put(
    "/status/printers/{printer_id}",
    response_model=CreatePrinterResponse,
    summary="Update an existing printer definition",
)
async def update_printer_endpoint(
    printer_id: str,
    payload: CreatePrinterRequest,
    service: PrinterConfigService = Depends(get_printer_config_service),
) -> CreatePrinterResponse:
    return await service.update_printer(printer_id, payload)


@router.post(
    "/status/printers",
    response_model=CreatePrinterResponse,
    summary="Register a new printer",
    status_code=status.HTTP_201_CREATED,
)
async def register_printer_endpoint(
    payload: CreatePrinterRequest,
    service: PrinterConfigService = Depends(get_printer_config_service),
) -> CreatePrinterResponse:
    return await service.register_printer(payload)


@router.delete(
    "/status/printers/{printer_id}",
    response_model=DeletePrinterResponse,
    summary="Remove a printer from configuration",
)
async def delete_printer(
    printer_id: str,
    service: PrinterConfigService = Depends(get_printer_config_service),
) -> DeletePrinterResponse:
    return await service.delete_printer(printer_id)


@router.post(
    "/status/select-printer",
    response_model=PrinterInfoResponse,
    summary="Switch active printer",
)
async def select_printer(
    payload: SelectPrinterRequest,
    service: PrinterConfigService = Depends(get_printer_config_service),
) -> PrinterInfoResponse:
    return await service.select_printer(payload)


@router.post(
    "/status/printers/{printer_id}/default",
    response_model=PrinterInfoResponse,
    summary="Set the default printer",
)
async def set_default_printer_endpoint(
    printer_id: str,
    service: PrinterConfigService = Depends(get_printer_config_service),
) -> PrinterInfoResponse:
    return service.set_default_printer(printer_id)
