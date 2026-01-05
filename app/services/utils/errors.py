"""Service error normalization helpers."""
from __future__ import annotations

from app.core.bambu_ftp import FTPError, FTPFileExistsError, FTPResponseError
from app.core.exceptions import (
    BadRequestError,
    CancelledError,
    ConflictError,
    DomainError,
    ServiceUnavailableError,
)
from app.services.utils.ftps_uploader import UploadCancelledError


def normalize_ftp_error(exc: Exception, *, fallback: str = "FTPS operation failed") -> DomainError:
    if isinstance(exc, UploadCancelledError):
        return CancelledError(str(exc) or CancelledError.default_detail)
    if isinstance(exc, FTPFileExistsError):
        return ConflictError(str(exc))
    if isinstance(exc, FTPResponseError):
        if exc.code == "550":
            return ConflictError(str(exc))
        if exc.code.startswith("4"):
            return ServiceUnavailableError(str(exc))
        if exc.code.startswith("5"):
            return BadRequestError(str(exc))
        return BadRequestError(str(exc))
    if isinstance(exc, FTPError):
        return ServiceUnavailableError(str(exc) or fallback)
    return ServiceUnavailableError(str(exc) or fallback)

