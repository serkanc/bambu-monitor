"""Printer control endpoints."""
from fastapi import APIRouter, Depends, status
import re

from app.api.dependencies import DeviceContext, get_active_device_context, get_print_job_service
from app.core.exceptions import BadRequestError, InternalError, ServiceUnavailableError
from pathlib import Path

from app.schemas import (
    AmsFilamentCommandRequest,
    AmsMaterialSettingRequest,
    ChamberLightRequest,
    FeatureToggleRequest,
    NozzleAccessoryRequest,
    PrinterCommandRequest,
    SkipObjectsRequest,
    SimpleMessage,
)
from app.services.control_command_service import ControlCommandService
from app.services.utils.feature_command_builder import FeatureCommandBuilder
from app.services.print_job_service import PrintJobService

router = APIRouter()


@router.post(
    "/pushall",
    response_model=SimpleMessage,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger pushall command",
)
async def trigger_pushall(
    context: DeviceContext = Depends(get_active_device_context),
) -> SimpleMessage:
    mqtt = context.require_mqtt()
    try:
        await mqtt.send_pushall()
        return SimpleMessage(success=True, message="PushAll command sent")
    except RuntimeError as exc:
        raise ServiceUnavailableError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise InternalError(str(exc)) from exc


@router.post(
    "/command",
    response_model=SimpleMessage,
    summary="Send raw printer command",
)
async def send_printer_command(
    payload: PrinterCommandRequest,
    context: DeviceContext = Depends(get_active_device_context),
) -> SimpleMessage:
    mqtt = context.require_mqtt()
    try:
        await mqtt.send_print_command(payload.command, payload.param)
        return SimpleMessage(success=True, message="Command sent")
    except RuntimeError as exc:
        raise ServiceUnavailableError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise InternalError(str(exc)) from exc


@router.post(
    "/chamber-light",
    response_model=SimpleMessage,
    summary="Set chamber light state",
)
async def set_chamber_light(
    payload: ChamberLightRequest,
    context: DeviceContext = Depends(get_active_device_context),
) -> SimpleMessage:
    mqtt = context.require_mqtt()
    try:
        await mqtt.set_chamber_light(payload.mode.lower())
        return SimpleMessage(success=True, message=f"Chamber light set to {payload.mode}")
    except ValueError as exc:
        raise BadRequestError(str(exc)) from exc
    except RuntimeError as exc:
        raise ServiceUnavailableError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise InternalError(str(exc)) from exc


@router.post(
    "/ams/filament",
    response_model=SimpleMessage,
    summary="Load or unload AMS slot filament",
)
async def control_ams_filament(
    payload: AmsFilamentCommandRequest,
    context: DeviceContext = Depends(get_active_device_context),
) -> SimpleMessage:
    """Send AMS load/unload command to the active printer."""
    mqtt = context.require_mqtt()
    try:
        command_payload = ControlCommandService.build_ams_filament_command(payload)
        await mqtt.send_project_print(command_payload)
        action_label = "Load" if payload.action == "load" else "Unload"
        return SimpleMessage(success=True, message=f"{action_label} command sent")
    except RuntimeError as exc:
        raise ServiceUnavailableError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise InternalError(str(exc)) from exc


@router.post(
    "/features/toggle",
    response_model=SimpleMessage,
    summary="Toggle feature flags",
)
async def toggle_feature(
    payload: FeatureToggleRequest,
    context: DeviceContext = Depends(get_active_device_context),
) -> SimpleMessage:
    """Send feature toggle command to the active printer."""
    mqtt = context.require_mqtt()
    try:
        command_payload = FeatureCommandBuilder.build_payload(
            payload.key,
            payload.enabled,
            payload.sequence_id,
            payload.peer_enabled,
        )
        await mqtt.send_project_print(command_payload)
        return SimpleMessage(success=True, message="Feature toggle command sent")
    except ValueError as exc:
        raise BadRequestError(str(exc)) from exc
    except RuntimeError as exc:
        raise ServiceUnavailableError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise InternalError(str(exc)) from exc


@router.post(
    "/accessories/nozzle",
    response_model=SimpleMessage,
    summary="Set nozzle accessories (type/diameter)",
)
async def set_nozzle_accessories(
    payload: NozzleAccessoryRequest,
    context: DeviceContext = Depends(get_active_device_context),
) -> SimpleMessage:
    """Send nozzle accessory change command to the active printer."""
    mqtt = context.require_mqtt()
    try:
        command_payload = ControlCommandService.build_nozzle_accessory_payload(payload)
        await mqtt.send_project_print(command_payload)
        return SimpleMessage(success=True, message="Nozzle settings updated")
    except RuntimeError as exc:
        raise ServiceUnavailableError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise InternalError(str(exc)) from exc


@router.post(
    "/ams/material",
    response_model=SimpleMessage,
    summary="Update AMS filament settings",
)
async def set_ams_material(
    payload: AmsMaterialSettingRequest,
    context: DeviceContext = Depends(get_active_device_context),
) -> SimpleMessage:
    """Send AMS filament setting + calibration selection commands."""
    mqtt = context.require_mqtt()
    try:
        nozzle_diameter = ControlCommandService.normalize_nozzle_diameter(
            context.state.print.nozzle_diameter
        )
        first_payload, second_payload = ControlCommandService.build_ams_material_payloads(
            payload,
            nozzle_diameter,
        )

        await mqtt.send_project_print(first_payload)
        await mqtt.send_project_print(second_payload)
        return SimpleMessage(success=True, message="AMS filament settings sent")
    except ValueError as exc:
        raise BadRequestError(str(exc)) from exc
    except RuntimeError as exc:
        raise ServiceUnavailableError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise InternalError(str(exc)) from exc


@router.post(
    "/skip-objects",
    response_model=SimpleMessage,
    summary="Skip objects during active print",
)
async def skip_objects(
    payload: SkipObjectsRequest,
    context: DeviceContext = Depends(get_active_device_context),
    print_job_service: PrintJobService = Depends(get_print_job_service),
) -> SimpleMessage:
    mqtt = context.require_mqtt()

    obj_list = [obj for obj in payload.obj_list if isinstance(obj, int)]
    if not obj_list:
        raise BadRequestError("obj_list must include at least one object id")

    current_skipped = set(context.state.print.skipped_objects or [])
    new_targets = [obj for obj in obj_list if obj not in current_skipped]
    if not new_targets:
        raise BadRequestError("All selected objects are already skipped")

    file_name = context.state.print.file
    if not file_name:
        raise BadRequestError("Active print file is unavailable")
    file_name = Path(file_name).name

    if not await print_job_service.has_cached_extract_for_remote(context.printer_id, file_name):
        raise BadRequestError("Print cache missing or does not match the active file")

    def _resolve_plate(metadata: dict, gcode_file: str) -> dict | None:
        plates = metadata.get("plates") if isinstance(metadata, dict) else None
        if not isinstance(plates, list) or not plates:
            return None
        plate_files = metadata.get("plate_files") if isinstance(metadata, dict) else None
        file_name_local = Path(gcode_file or "").name
        if isinstance(plate_files, list) and file_name_local:
            for idx, plate_file in enumerate(plate_files):
                if not plate_file:
                    continue
                candidate = Path(str(plate_file)).name
                if candidate.lower() == file_name_local.lower():
                    return plates[idx] if idx < len(plates) else None
        match = re.search(r"plate[_-]?(\d+)", file_name_local, re.IGNORECASE)
        if match:
            try:
                plate_index = int(match.group(1))
            except ValueError:
                plate_index = None
            if plate_index is not None:
                for idx, plate in enumerate(plates):
                    raw_index = plate.get("index") or plate.get("metadata", {}).get("index")
                    try:
                        normalized = int(raw_index)
                    except (TypeError, ValueError):
                        normalized = idx + 1
                    if normalized == plate_index:
                        return plate
                fallback_idx = plate_index - 1
                if 0 <= fallback_idx < len(plates):
                    return plates[fallback_idx]
        default_index = metadata.get("default_plate_index") if isinstance(metadata, dict) else None
        if isinstance(default_index, int) and 0 <= default_index < len(plates):
            return plates[default_index]
        return plates[0] if plates else None

    metadata = await print_job_service.get_cached_metadata_result(context.printer_id, file_name)
    if metadata:
        plate = _resolve_plate(metadata, context.state.print.file)
        if plate:
            objects = plate.get("objects") if isinstance(plate, dict) else None
            if not isinstance(objects, list) or not objects:
                raise BadRequestError("Skip objects unavailable for this plate")
            object_ids = [
                obj.get("identify_id")
                for obj in objects
                if isinstance(obj, dict) and isinstance(obj.get("identify_id"), int)
            ]
            total_objects = len(object_ids)
            if total_objects <= 1:
                raise BadRequestError("Skip objects requires at least two objects")
            if total_objects > 64:
                raise BadRequestError("Skip objects limited to 64 objects per plate")
            skipped_set = {obj for obj in (context.state.print.skipped_objects or []) if isinstance(obj, int)}
            skipped_count = len([obj_id for obj_id in object_ids if obj_id in skipped_set])
            remaining = total_objects - skipped_count
            if remaining <= 1:
                raise BadRequestError("Only one object remains; skipping is disabled")
            remaining_after = remaining - len(new_targets)
            if remaining_after < 1:
                raise BadRequestError("At least one object must remain after skipping")

    command_payload = ControlCommandService.build_skip_objects_payload(
        SkipObjectsRequest(obj_list=new_targets, sequence_id=payload.sequence_id)
    )
    try:
        await mqtt.send_project_print(command_payload)
        return SimpleMessage(success=True, message="Skip objects command sent")
    except RuntimeError as exc:
        raise ServiceUnavailableError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise InternalError(str(exc)) from exc
