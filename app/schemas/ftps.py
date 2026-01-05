"""Schemas for FTPS file explorer endpoints."""
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.control import SimpleMessage


class FileEntry(BaseModel):
    """Single file/folder entry representation."""

    model_config = ConfigDict(populate_by_name=True)

    name: str
    path: str
    is_directory: bool = Field(..., alias="is_directory")
    size: Optional[str] = None
    modified: Optional[str] = None


class FileListingResponse(BaseModel):
    """File explorer response."""

    files: List[FileEntry]
    current_path: str
    is_connected: bool
    file_count: int
    directory_count: int
    is_fallback: Optional[bool] = None


class FileDownloadResponse(BaseModel):
    """Response for file download requests."""

    filename: str
    content: str


class FileOperationResponse(SimpleMessage):
    """Standard response for FTPS file operations."""

    filename: Optional[str] = None
    path: Optional[str] = None
    deleted_path: Optional[str] = None
