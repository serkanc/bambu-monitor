# app/services/utils/types.py
from typing import TypedDict, Optional

class FileEntry(TypedDict):
    name: str
    size: str
    modified: str
    path: str
    type: str
    is_directory: bool

class DirectoryListing(TypedDict):
    files: list[FileEntry]
    current_path: str
    is_connected: bool
    file_count: int
    directory_count: int
    is_fallback: Optional[bool]