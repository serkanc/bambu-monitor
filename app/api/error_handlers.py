"""Shared FastAPI exception handlers."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.status import HTTP_422_UNPROCESSABLE_CONTENT, HTTP_500_INTERNAL_SERVER_ERROR

from app.core.exceptions import DomainError
from app.core.metrics import metrics


def register_exception_handlers(app: FastAPI) -> None:
    """Attach global exception handlers to the FastAPI app."""

    logger = logging.getLogger("printer_monitor")

    @app.exception_handler(DomainError)
    async def handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
        payload: dict[str, Any] = {"detail": exc.detail, "error": exc.error_code}
        if exc.extra:
            payload["meta"] = exc.extra
        if exc.status_code >= 500:
            logger.error(
                "Request failed (%s %s): %s",
                request.method,
                request.url.path,
                exc.detail,
                exc_info=exc.__cause__ or exc,
            )
        else:
            logger.warning(
                "Request failed (%s %s): %s",
                request.method,
                request.url.path,
                exc.detail,
            )
        metric_name = f"api.{request.url.path}"
        metrics.record(metric_name, ok=False, duration_ms=0)
        if metrics.should_alert(metric_name):
            logger.warning("Metric alert for %s (slow or error rate)", metric_name)
        return JSONResponse(status_code=exc.status_code, content=payload)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        logger.warning("Validation error (%s %s): %s", request.method, request.url.path, exc.errors())
        return JSONResponse(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": exc.errors()},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        metric_name = f"api.{request.url.path}"
        metrics.record(metric_name, ok=False, duration_ms=0)
        if metrics.should_alert(metric_name):
            logger.warning("Metric alert for %s (slow or error rate)", metric_name)
        return JSONResponse(
            status_code=HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal server error"},
        )
