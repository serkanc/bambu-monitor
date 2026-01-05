"""Common exception helpers for the backend services."""
from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base exception for application specific errors."""

    status_code = 500
    error_code = "app_error"
    default_detail = "An unexpected error occurred."

    def __init__(self, detail: str | None = None, *, extra: dict[str, Any] | None = None) -> None:
        super().__init__(detail or self.default_detail)
        self.detail = detail or self.default_detail
        self.extra = extra or {}


class ServiceError(AppError):
    """Raised when a background service crashes."""

    error_code = "service_error"

    def __init__(self, service_name: str, detail: str | None = None, *, extra: dict[str, Any] | None = None) -> None:
        self.service_name = service_name
        message = detail or f"{service_name} failed"
        payload = {"service": service_name}
        if extra:
            payload.update(extra)
        super().__init__(message, extra=payload)


class DomainError(AppError):
    """Normalized domain error surfaced to API handlers."""


class BadRequestError(DomainError):
    status_code = 400
    error_code = "bad_request"
    default_detail = "Invalid request."


class UnauthorizedError(DomainError):
    status_code = 401
    error_code = "unauthorized"
    default_detail = "Unauthorized."


class ForbiddenError(DomainError):
    status_code = 403
    error_code = "forbidden"
    default_detail = "Forbidden."


class NotFoundError(DomainError):
    status_code = 404
    error_code = "not_found"
    default_detail = "Resource not found."


class ConflictError(DomainError):
    status_code = 409
    error_code = "conflict"
    default_detail = "Request conflict."


class CancelledError(DomainError):
    status_code = 499
    error_code = "cancelled"
    default_detail = "Operation cancelled."


class ServiceUnavailableError(DomainError):
    status_code = 503
    error_code = "service_unavailable"
    default_detail = "Service unavailable."


class TooManyRequestsError(DomainError):
    status_code = 429
    error_code = "too_many_requests"
    default_detail = "Too many requests."


class BadGatewayError(DomainError):
    status_code = 502
    error_code = "bad_gateway"
    default_detail = "Upstream service failed."


class InternalError(DomainError):
    status_code = 500
    error_code = "internal_error"
    default_detail = "Internal server error."
