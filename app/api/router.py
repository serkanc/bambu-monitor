"""Root API router that aggregates all endpoint modules."""
from fastapi import APIRouter

from app.api.routes import (
    admin,
    auth,
    camera,
    control,
    debug,
    events,
    filaments,
    ftps,
    health,
    metrics,
    printjob,
    state_stream,
    status,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(status.router, tags=["status"])
api_router.include_router(camera.router, tags=["camera"])
api_router.include_router(ftps.router, prefix="/ftps", tags=["ftps"])
api_router.include_router(control.router, prefix="/control", tags=["control"])
api_router.include_router(health.router, tags=["health"])
api_router.include_router(metrics.router, tags=["metrics"])
api_router.include_router(admin.router, tags=["admin"])
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(debug.router, tags=["debug"])
api_router.include_router(printjob.router, tags=["printjob"])
api_router.include_router(filaments.router)
api_router.include_router(events.router, tags=["events"])
api_router.include_router(state_stream.router, tags=["state"])
