"""Utility helpers for caching print job files and metadata."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path


class PrintJobCache:
    """Manage cached print job files and metadata on disk."""

    def __init__(self, base_dir: Path) -> None:
        self._base_dir = base_dir

    def get_paths(self, printer_id: str, filename: str) -> tuple[Path, Path]:
        base = self._base_dir / printer_id
        base.mkdir(parents=True, exist_ok=True)
        return base / filename, base / f"{filename}.meta.json"

    async def is_valid(
        self,
        printer_id: str,
        filename: str,
        modified: str,
        size: str,
        remote_path: str,
    ) -> bool:
        file_path, meta_path = self.get_paths(printer_id, filename)

        if not file_path.exists() or not meta_path.exists():
            return False

        try:
            meta = json.loads(meta_path.read_text())
        except Exception:
            return False

        if meta.get("modified") != modified:
            return False
        if meta.get("size") != size:
            return False
        if meta.get("name") != filename:
            return False
        if remote_path and meta.get("path") != remote_path:
            return False

        return True

    async def write_meta(
        self,
        printer_id: str,
        filename: str,
        modified: str,
        size: str,
        remote_path: str,
    ) -> None:
        _, meta_path = self.get_paths(printer_id, filename)
        meta = {
            "name": filename,
            "modified": modified,
            "size": size,
            "path": remote_path,
        }
        meta_json = json.dumps(meta)
        await asyncio.to_thread(meta_path.write_text, meta_json)
