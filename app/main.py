"""FastAPI application entrypoint."""
from __future__ import annotations

from contextlib import asynccontextmanager
import time
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.datastructures import MutableHeaders
from starlette.requests import Request

from app.api.error_handlers import register_exception_handlers
from app.api.router import api_router
from app.core.config import (
    AppConfig,
    NoPrintersConfigured,
    Settings,
    get_app_config,
    get_settings,
)
from app.core.logging import configure_logging
from app.core.metrics import metrics
from app.core.request_context import clear_request_id, set_request_id
from app.core.exceptions import UnauthorizedError
from app.services import ServiceRegistry
from app.web.routes import router as web_router

settings: Settings | None
try:
    settings = get_settings()
except NoPrintersConfigured:
    settings = None

app_config: AppConfig = get_app_config()
log_config = settings or app_config
logger = configure_logging(log_config)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown of background services."""

    registry = ServiceRegistry(settings)
    app.state.services = registry

    await registry.startup()
    try:
        yield
    finally:
        await registry.shutdown()


app = FastAPI(
    title="Bambu Printer Monitor API",
    description="Async API for monitoring Bambu Lab printers",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    SessionMiddleware,
    secret_key=app_config.session_secret or "dev-secret",
    same_site="lax",
)

class RequestIdMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        path = scope.get("path") or ""
        request_id = request.headers.get("X-Request-ID") or uuid4().hex
        set_request_id(request_id)
        start = time.perf_counter()
        status_code = 500

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 500)
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            clear_request_id()

        duration_ms = int((time.perf_counter() - start) * 1000)
        if status_code < 400:
            metric_name = f"api.{path}"
            metrics.record(metric_name, ok=True, duration_ms=duration_ms)
            overrides = self._metric_threshold_overrides(path)
            if metrics.should_alert(metric_name, **overrides):
                logger.warning("Metric alert for %s (slow or error rate)", metric_name)

    @classmethod
    def _metric_threshold_overrides(cls, path: str) -> dict[str, int]:
        return {
            "/api/state/stream": {"avg_ms": 10_000},
        }.get(path, {})


class AuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        live_config = get_app_config()
        token = live_config.api_token
        if not token or not live_config.auth_enabled:
            await self.app(scope, receive, send)
            return

        path = request.url.path or ""
        if not path.startswith("/api"):
            await self.app(scope, receive, send)
            return
        if (
            path in {"/api/health", "/api/printjob/plate-preview"}
            or path.startswith("/api/admin")
            or path.startswith("/api/auth")
        ):
            await self.app(scope, receive, send)
            return
        if path.startswith("/api/debug"):
            if "session" in request.scope:
                session = request.session or {}
                if session.get("admin_logged_in"):
                    await self.app(scope, receive, send)
                    return

        auth_header = request.headers.get("authorization", "")
        api_key = request.headers.get("x-api-key", "")
        provided = ""
        if auth_header.lower().startswith("bearer "):
            provided = auth_header[7:].strip()
        elif api_key:
            provided = api_key.strip()
        if not provided:
            await JSONResponse(status_code=401, content={"detail": "Missing API token"})(
                scope, receive, send
            )
            return
        if provided != token:
            await JSONResponse(status_code=401, content={"detail": "Invalid API token"})(
                scope, receive, send
            )
            return
        await self.app(scope, receive, send)


app.add_middleware(AuthMiddleware)
app.add_middleware(RequestIdMiddleware)

static_dir = Path(__file__).resolve().parent / "web" / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

app.include_router(web_router)
app.include_router(api_router)
register_exception_handlers(app)
