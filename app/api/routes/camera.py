"""Camera endpoints."""
from fastapi import APIRouter, Depends

from app.api.dependencies import DeviceContext, get_device_context, get_service_registry
from app.core.config import NoPrintersConfigured, get_settings_async
from app.core.exceptions import BadGatewayError, NotFoundError, TooManyRequestsError
from app.schemas import (
    CameraAccessResponse,
    CameraFrameResponse,
    WebRTCAnswerResponse,
    WebRTCOfferRequest,
    WebRTCSessionRequest,
)
from app.services.camera_service import CameraService
from app.services.registry import ServiceRegistry

router = APIRouter()


@router.get("/camera", response_model=CameraFrameResponse, summary="Retrieve latest camera frame")
async def read_camera_frame(
    context: DeviceContext = Depends(get_device_context),
) -> CameraFrameResponse:
    return CameraFrameResponse(
        frame=context.state.camera_frame,
        updated_at=context.state.updated_at,
    )


@router.get("/camera/access", response_model=CameraAccessResponse, summary="Resolve camera access")
async def read_camera_access(
    context: DeviceContext = Depends(get_device_context),
) -> CameraAccessResponse:
    target_id = context.printer_id
    if context.is_active and context.camera_service:
        return CameraAccessResponse(cameras=context.camera_service.get_access())

    try:
        settings = await get_settings_async(printer_id=target_id)
    except (NoPrintersConfigured, ValueError) as exc:
        raise NotFoundError(str(exc)) from exc
    return CameraAccessResponse(cameras=CameraService.build_access(settings))


@router.post(
    "/camera/webrtc/offer",
    response_model=WebRTCAnswerResponse,
    summary="Create a WebRTC answer for the active camera stream",
)
async def create_webrtc_offer(
    payload: WebRTCOfferRequest,
    registry: ServiceRegistry = Depends(get_service_registry),
) -> WebRTCAnswerResponse:
    camera_service = registry.camera_service
    if not camera_service:
        raise NotFoundError("Camera service not available")
    session_id = await camera_service.sessions.claim()
    if not session_id:
        raise TooManyRequestsError("Max viewers reached")
    try:
        answer_sdp = await camera_service.request_webrtc_answer(payload.sdp, payload.source)
    except Exception as exc:  # noqa: BLE001
        await camera_service.sessions.release(session_id)
        raise BadGatewayError(f"Failed to negotiate WebRTC: {exc}") from exc
    return WebRTCAnswerResponse(sdp=answer_sdp, session_id=session_id)


@router.post(
    "/camera/webrtc/keepalive",
    summary="Keep a WebRTC viewer session alive",
)
async def keepalive_webrtc(
    payload: WebRTCSessionRequest,
    registry: ServiceRegistry = Depends(get_service_registry),
) -> dict[str, str]:
    camera_service = registry.camera_service
    if not camera_service:
        raise NotFoundError("Camera service not available")
    ok = await camera_service.sessions.keepalive(payload.session_id)
    if not ok:
        raise NotFoundError("Session not found")
    return {"status": "ok"}


@router.post(
    "/camera/webrtc/release",
    summary="Release a WebRTC viewer session",
)
async def release_webrtc(
    payload: WebRTCSessionRequest,
    registry: ServiceRegistry = Depends(get_service_registry),
) -> dict[str, str]:
    camera_service = registry.camera_service
    if not camera_service:
        raise NotFoundError("Camera service not available")
    await camera_service.sessions.release(payload.session_id)
    return {"status": "ok"}
