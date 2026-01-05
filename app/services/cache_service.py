"""Helpers for managing print-cache storage on disk."""
from __future__ import annotations

import asyncio
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CacheStats:
    total_bytes: int
    file_count: int
    folder_count: int


@dataclass(frozen=True)
class CacheCleanResult:
    removed_bytes: int
    removed_files: int
    removed_folders: int
    removed_bundles: int


class PrintCacheService:
    """Manage print-cache size reporting and cleanup."""

    def __init__(self, base_dir: Path | str) -> None:
        self._base_dir = Path(base_dir)

    async def get_stats(self) -> CacheStats:
        return await asyncio.to_thread(self._collect_stats)

    async def clean(self, *, older_than_seconds: float) -> CacheCleanResult:
        cutoff = time.time() - max(older_than_seconds, 0)
        return await asyncio.to_thread(self._clean_sync, cutoff)

    def _collect_stats(self) -> CacheStats:
        total_bytes = 0
        file_count = 0
        folder_count = 0
        base = self._base_dir
        if not base.exists():
            return CacheStats(total_bytes=0, file_count=0, folder_count=0)
        for root, dirs, files in os.walk(base):
            folder_count += len(dirs)
            for name in files:
                try:
                    total_bytes += (Path(root) / name).stat().st_size
                    file_count += 1
                except FileNotFoundError:
                    continue
        return CacheStats(
            total_bytes=total_bytes,
            file_count=file_count,
            folder_count=folder_count,
        )

    def _clean_sync(self, cutoff_ts: float) -> CacheCleanResult:
        removed_bytes = 0
        removed_files = 0
        removed_folders = 0
        removed_bundles = 0
        base = self._base_dir
        if not base.exists():
            return CacheCleanResult(0, 0, 0, 0)

        for printer_dir in base.iterdir():
            if not printer_dir.is_dir():
                continue
            removed = self._clean_printer_dir(printer_dir, cutoff_ts)
            removed_bytes += removed.removed_bytes
            removed_files += removed.removed_files
            removed_folders += removed.removed_folders
            removed_bundles += removed.removed_bundles

        return CacheCleanResult(
            removed_bytes=removed_bytes,
            removed_files=removed_files,
            removed_folders=removed_folders,
            removed_bundles=removed_bundles,
        )

    def _clean_printer_dir(self, printer_dir: Path, cutoff_ts: float) -> CacheCleanResult:
        removed_bytes = 0
        removed_files = 0
        removed_folders = 0
        removed_bundles = 0

        for entry in list(printer_dir.iterdir()):
            if entry.is_file() and entry.suffix.lower() == ".3mf":
                extract_dir = printer_dir / entry.stem
                ref_path = extract_dir if extract_dir.exists() else entry
                if self._is_older_than(ref_path, cutoff_ts):
                    removed = self._remove_bundle(entry, extract_dir)
                    removed_bytes += removed.removed_bytes
                    removed_files += removed.removed_files
                    removed_folders += removed.removed_folders
                    removed_bundles += 1

        for entry in list(printer_dir.iterdir()):
            if entry.is_file() and entry.suffix.lower() != ".3mf":
                if entry.name.endswith(".meta.json"):
                    continue
                if self._is_older_than(entry, cutoff_ts):
                    removed = self._remove_file_with_meta(entry)
                    removed_bytes += removed.removed_bytes
                    removed_files += removed.removed_files
                    removed_bundles += 1

        for entry in list(printer_dir.iterdir()):
            if entry.is_dir():
                candidate = printer_dir / f"{entry.name}.3mf"
                if candidate.exists():
                    continue
                if self._is_older_than(entry, cutoff_ts):
                    removed = self._remove_orphan_dir(entry)
                    removed_bytes += removed.removed_bytes
                    removed_files += removed.removed_files
                    removed_folders += removed.removed_folders
                    removed_bundles += 1

        for entry in list(printer_dir.iterdir()):
            if entry.is_file() and entry.name.endswith(".meta.json"):
                base_name = entry.name[:-len(".meta.json")]
                candidate = printer_dir / base_name
                candidate_dir = printer_dir / Path(base_name).stem
                if candidate.exists() or candidate_dir.exists():
                    continue
                if self._is_older_than(entry, cutoff_ts):
                    removed = self._remove_meta(entry)
                    removed_bytes += removed.removed_bytes
                    removed_files += removed.removed_files

        return CacheCleanResult(
            removed_bytes=removed_bytes,
            removed_files=removed_files,
            removed_folders=removed_folders,
            removed_bundles=removed_bundles,
        )

    def _remove_bundle(self, file_path: Path, extract_dir: Path) -> CacheCleanResult:
        removed_bytes = 0
        removed_files = 0
        removed_folders = 0
        removed = self._remove_file_with_meta(file_path)
        removed_bytes += removed.removed_bytes
        removed_files += removed.removed_files
        removed_bundles = 1
        if extract_dir.exists():
            size, files, folders = self._remove_dir(extract_dir)
            removed_bytes += size
            removed_files += files
            removed_folders += folders
        return CacheCleanResult(
            removed_bytes=removed_bytes,
            removed_files=removed_files,
            removed_folders=removed_folders,
            removed_bundles=removed_bundles,
        )

    def _remove_orphan_dir(self, extract_dir: Path) -> CacheCleanResult:
        removed_bytes, removed_files, removed_folders = self._remove_dir(extract_dir)
        meta_path = extract_dir.parent / f"{extract_dir.name}.3mf.meta.json"
        removed = self._remove_meta(meta_path)
        return CacheCleanResult(
            removed_bytes=removed_bytes + removed.removed_bytes,
            removed_files=removed_files + removed.removed_files,
            removed_folders=removed_folders,
            removed_bundles=1,
        )

    def _remove_file_with_meta(self, file_path: Path) -> CacheCleanResult:
        removed_bytes = 0
        removed_files = 0
        if file_path.exists():
            try:
                removed_bytes += file_path.stat().st_size
            except FileNotFoundError:
                pass
            try:
                file_path.unlink()
                removed_files += 1
            except FileNotFoundError:
                pass
        meta_path = file_path.parent / f"{file_path.name}.meta.json"
        removed = self._remove_meta(meta_path)
        return CacheCleanResult(
            removed_bytes=removed_bytes + removed.removed_bytes,
            removed_files=removed_files + removed.removed_files,
            removed_folders=0,
            removed_bundles=1,
        )

    def _remove_meta(self, meta_path: Path) -> CacheCleanResult:
        removed_bytes = 0
        removed_files = 0
        if meta_path.exists():
            try:
                removed_bytes += meta_path.stat().st_size
            except FileNotFoundError:
                pass
            try:
                meta_path.unlink()
                removed_files += 1
            except FileNotFoundError:
                pass
        return CacheCleanResult(
            removed_bytes=removed_bytes,
            removed_files=removed_files,
            removed_folders=0,
            removed_bundles=0,
        )

    def _remove_dir(self, path: Path) -> tuple[int, int, int]:
        total_bytes = 0
        file_count = 0
        folder_count = 0
        for root, dirs, files in os.walk(path):
            folder_count += len(dirs)
            for name in files:
                file_path = Path(root) / name
                try:
                    total_bytes += file_path.stat().st_size
                    file_count += 1
                except FileNotFoundError:
                    continue
        try:
            shutil.rmtree(path, ignore_errors=True)
            folder_count += 1
        except Exception:
            pass
        return total_bytes, file_count, folder_count

    def _is_older_than(self, path: Path, cutoff_ts: float) -> bool:
        try:
            return path.stat().st_mtime <= cutoff_ts
        except FileNotFoundError:
            return False
