"""Filament catalog endpoints."""
from fastapi import APIRouter, Depends

from app.api.dependencies import (
    DeviceContext,
    get_device_context,
    get_filament_capture_service,
    get_filament_catalog_service,
)
from app.core.exceptions import BadRequestError, NotFoundError
from app.schemas import (
    SimpleMessage,
    CustomFilamentRequest,
    FilamentCatalogItem,
    FilamentCaptureCandidate,
)
from app.services.filament_capture_service import FilamentCaptureService
from app.services.filament_catalog_service import FilamentCatalogService

router = APIRouter(prefix="/filaments", tags=["filaments"])


@router.get(
    "/catalog",
    response_model=list[FilamentCatalogItem],
    summary="Retrieve merged filament catalog",
)
async def read_filament_catalog(
    service: FilamentCatalogService = Depends(get_filament_catalog_service),
    context: DeviceContext = Depends(get_device_context),
) -> list[FilamentCatalogItem]:
    """Return the filtered filament catalog for the active printer."""

    nozzle_value = FilamentCatalogService.parse_nozzle_diameter(
        context.state.print.nozzle_diameter
    )
    model = context.state.capabilities.model or context.registry.settings.printer_model
    return service.get_catalog(printer_model=model, nozzle_diameter=nozzle_value)


@router.get(
    "/custom/candidates",
    response_model=list[FilamentCaptureCandidate],
    summary="List captured custom filament candidates",
)
async def list_custom_candidates(
    capture_service: FilamentCaptureService = Depends(get_filament_capture_service),
    catalog_service: FilamentCatalogService = Depends(get_filament_catalog_service),
    context: DeviceContext = Depends(get_device_context),
) -> list[FilamentCaptureCandidate]:
    """Return unique captured filament settings by tray_info_idx."""

    target_id = context.printer_id
    if not target_id:
        return []

    nozzle_value = FilamentCatalogService.parse_nozzle_diameter(
        context.state.print.nozzle_diameter
    )
    model = context.state.capabilities.model or context.registry.settings.printer_model
    catalog = catalog_service.get_catalog(
        printer_model=model, nozzle_diameter=nozzle_value
    )
    return await capture_service.build_candidates(
        target_id,
        state=context.state,
        catalog=catalog,
    )


@router.get(
    "/custom",
    response_model=list[FilamentCatalogItem],
    summary="List saved custom filament definitions",
)
async def list_custom_filaments(
    service: FilamentCatalogService = Depends(get_filament_catalog_service),
) -> list[FilamentCatalogItem]:
    """Return saved custom filaments."""

    return service.list_custom_filaments()


@router.post(
    "/custom",
    response_model=FilamentCatalogItem,
    summary="Save a custom filament definition",
)
async def save_custom_filament(
    payload: CustomFilamentRequest,
    service: FilamentCatalogService = Depends(get_filament_catalog_service),
) -> FilamentCatalogItem:
    """Persist a custom filament entry."""

    try:
        return await service.add_custom_filament(payload.model_dump(mode="json"))
    except ValueError as exc:
        raise BadRequestError(str(exc)) from exc


@router.delete(
    "/custom/{tray_info_idx}",
    response_model=SimpleMessage,
    summary="Delete a custom filament definition",
)
async def delete_custom_filament(
    tray_info_idx: str,
    service: FilamentCatalogService = Depends(get_filament_catalog_service),
) -> SimpleMessage:
    """Delete a custom filament entry."""

    try:
        await service.delete_custom_filament(tray_info_idx)
        return SimpleMessage(success=True, message="Custom filament deleted")
    except KeyError:
        raise NotFoundError(f"Custom filament '{tray_info_idx}' not found")
    except ValueError as exc:
        raise BadRequestError(str(exc)) from exc
