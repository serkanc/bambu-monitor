"""Helper functions for FTPS service formatting."""
from datetime import datetime


def format_size(size_bytes: int) -> str:
    if size_bytes == 0:
        return "0 B"

    units = ["B", "KB", "MB", "GB"]
    index = 0
    size = float(size_bytes)

    while size >= 1024 and index < len(units) - 1:
        size /= 1024.0
        index += 1

    return f"{size:.1f} {units[index]}"


def format_date(date_str: str) -> str:
    try:
        if len(date_str) == 14:
            dt = datetime.strptime(date_str, "%Y%m%d%H%M%S")
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        return date_str
    except Exception:  # noqa: BLE001
        return "Unknown"


def get_parent_path(current_path: str) -> str:
    if current_path == "/":
        return "/"

    clean_path = current_path.rstrip("/")
    parts = clean_path.split("/")
    parent = "/".join(parts[:-1])
    return f"/{parent}" if parent else "/"
