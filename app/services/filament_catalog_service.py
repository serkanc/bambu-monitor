"""Service exposing the filament catalog (filtered per active printer)."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List

from app.schemas import FilamentCatalogItem

logger = logging.getLogger(__name__)

_NOZZLE_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(?:mm\s*)?nozzle")
_MODEL_ALIASES = {
    "x1c": "x1 carbon",
    "x1 carbon": "x1 carbon",
    "x1e": "x1e",
    "x1": "x1",
    "p1p": "p1p",
    "p1s": "p1s",
    "a1": "a1",
    "a1 mini": "a1 mini",
    "p2s": "p2s",
    "h2c": "h2c",
    "h2s": "h2s",
}


class FilamentCatalogService:
    """Load and filter filament metadata from the bundled JSON file."""

    def __init__(self, *, base_path: Path | None = None) -> None:
        project_root = Path(__file__).resolve().parents[2]
        data_dir = project_root / "data" / "filament"
        self._base_path = base_path or data_dir / "filaments_full.json"
        self._custom_path = data_dir / "custom_filament.json"
        self._lock = asyncio.Lock()
        self._catalog: List[dict[str, Any]] = []
        self._custom_catalog: Dict[str, dict[str, Any]] = {}
        self._load_catalog()

    def _load_catalog(self) -> None:
        self._catalog = self._parse_raw(self._read_file(self._base_path))
        self._custom_catalog = self._parse_custom(self._read_custom(self._custom_path))

    def _read_file(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            with path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except Exception as exc:
            logger.warning("Could not read filament catalog %s: %s", path, exc)
            return {}
        if not isinstance(raw, dict):
            logger.warning("Unexpected filament catalog format in %s", path)
            return {}
        return raw

    def _read_custom(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            with path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except Exception as exc:
            logger.warning("Could not read custom filament catalog %s: %s", path, exc)
            return {}
        return raw if isinstance(raw, dict) else {"items": raw}

    def _parse_raw(self, raw: dict[str, Any]) -> List[dict[str, Any]]:
        parsed: List[dict[str, Any]] = []
        for key, value in raw.items():
            if not isinstance(value, dict):
                continue
            alias = value.get("alias") or key
            variants = value.get("variants")
            if not isinstance(variants, list):
                continue
            for variant in variants:
                if not isinstance(variant, dict):
                    continue
                setting_id = variant.get("setting_id")
                tray_info_idx = variant.get("tray_info_idx")
                tray_type = self._normalize_tray_type(variant.get("tray_type"))
                if not setting_id or not tray_info_idx or not tray_type:
                    continue
                parsed.append(
                    {
                        "alias": str(alias),
                        "compatible_printers": self._normalize_compatible_list(
                            variant.get("compatible_printers"),
                        ),
                        "setting_id": str(setting_id),
                        "tray_info_idx": str(tray_info_idx),
                        "tray_type": tray_type,
                        "nozzle_temp_min": self._to_int(variant.get("nozzle_temp_min")),
                        "nozzle_temp_max": self._to_int(variant.get("nozzle_temp_max")),
                    }
                )
        return parsed

    def _parse_custom(self, raw: dict[str, Any]) -> Dict[str, dict[str, Any]]:
        items = raw.get("items") if isinstance(raw, dict) else raw
        parsed: Dict[str, dict[str, Any]] = {}
        if isinstance(items, dict):
            entries = list(items.values())
        elif isinstance(items, list):
            entries = items
        else:
            return parsed
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            tray_info_idx = entry.get("tray_info_idx")
            setting_id = entry.get("setting_id") or ""
            alias = entry.get("alias")
            tray_type = self._normalize_tray_type(entry.get("tray_type"))
            if not tray_info_idx or not alias or not tray_type:
                continue
            parsed[str(tray_info_idx)] = {
                "alias": str(alias),
                "setting_id": str(setting_id),
                "tray_info_idx": str(tray_info_idx),
                "tray_type": tray_type,
                "nozzle_temp_min": self._to_int(entry.get("nozzle_temp_min")),
                "nozzle_temp_max": self._to_int(entry.get("nozzle_temp_max")),
            }
        return parsed

    @staticmethod
    def _normalize_tray_type(value: Any) -> List[str]:
        if isinstance(value, list):
            return [str(item) for item in value if item]
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        return []

    @staticmethod
    def _normalize_compatible_list(value: Any) -> List[str]:
        if isinstance(value, list):
            return [str(item) for item in value if item]
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        return []

    @staticmethod
    def _to_int(value: Any) -> int | None:
        try:
            if value is None or value == "":
                return None
            return int(float(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _normalize_text(value: str | None) -> str:
        return re.sub(r"\s+", " ", str(value or "").strip().lower())

    @classmethod
    def _normalize_model(cls, model: str | None) -> str:
        normalized = cls._normalize_text(model)
        if normalized.startswith("bambu lab "):
            normalized = normalized[len("bambu lab ") :]
        if normalized.startswith("bambu "):
            normalized = normalized[len("bambu ") :]
        normalized = cls._normalize_text(normalized)
        return _MODEL_ALIASES.get(normalized, normalized)

    @classmethod
    def _extract_nozzle(cls, value: str | None) -> float | None:
        normalized = cls._normalize_text(value)
        match = _NOZZLE_PATTERN.search(normalized)
        if not match:
            return None
        try:
            return float(match.group(1))
        except ValueError:
            return None

    @staticmethod
    def _strip_nozzle(value: str | None) -> str:
        normalized = FilamentCatalogService._normalize_text(value)
        normalized = _NOZZLE_PATTERN.sub("", normalized)
        return FilamentCatalogService._normalize_text(normalized)

    @staticmethod
    def _strip_alias(value: str | None) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""
        parts = re.split(r"\s*@bbl\b", raw, flags=re.IGNORECASE)
        return parts[0].strip() if parts else raw

    @classmethod
    def _split_alias(cls, value: str | None) -> tuple[str | None, str | None]:
        cleaned = cls._strip_alias(value)
        if not cleaned:
            return None, None
        parts = cleaned.split()
        if not parts:
            return None, None
        brand = parts[0]
        material = " ".join(parts[1:]).strip() or None
        return brand, material

    @classmethod
    def _matches_printer(
        cls,
        compatible_printers: Iterable[str],
        printer_model: str | None,
        nozzle_diameter: float | None,
    ) -> bool:
        model_key = cls._normalize_model(printer_model)
        if not model_key:
            return False
        for entry in compatible_printers:
            normalized = cls._normalize_text(entry)
            if not normalized:
                continue
            compat_nozzle = cls._extract_nozzle(normalized)
            compat_model = cls._normalize_model(cls._strip_nozzle(normalized))
            if compat_model != model_key:
                continue
            if nozzle_diameter is None:
                return True
            if compat_nozzle is None:
                continue
            if abs(compat_nozzle - nozzle_diameter) < 0.01:
                return True
        return False

    @classmethod
    def parse_nozzle_diameter(cls, value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
        text = str(value).strip()
        if not text or text == "?":
            return None
        try:
            return float(text)
        except ValueError:
            match = re.search(r"(\d+(?:\.\d+)?)", text)
            if match:
                try:
                    return float(match.group(1))
                except ValueError:
                    return None
        return None

    def get_catalog(
        self,
        *,
        printer_model: str | None,
        nozzle_diameter: float | None,
    ) -> List[FilamentCatalogItem]:
        results: List[FilamentCatalogItem] = []
        for entry in self._catalog:
            if not self._matches_printer(
                entry.get("compatible_printers", []),
                printer_model,
                nozzle_diameter,
            ):
                continue
            brand, material = self._split_alias(entry.get("alias"))
            results.append(
                FilamentCatalogItem(
                    alias=self._strip_alias(entry.get("alias")),
                    brand=brand,
                    material=material,
                    setting_id=entry.get("setting_id", ""),
                    tray_info_idx=entry.get("tray_info_idx", ""),
                    tray_type=entry.get("tray_type", []),
                    nozzle_temp_min=entry.get("nozzle_temp_min"),
                    nozzle_temp_max=entry.get("nozzle_temp_max"),
                    is_custom=False,
                )
            )
        merged: Dict[str, FilamentCatalogItem] = {
            item.tray_info_idx: item for item in results if item.tray_info_idx
        }
        for entry in self._custom_catalog.values():
            brand, material = self._split_alias(entry.get("alias"))
            item = FilamentCatalogItem(
                alias=str(entry.get("alias", "")),
                brand=brand,
                material=material,
                setting_id=str(entry.get("setting_id", "")),
                tray_info_idx=str(entry.get("tray_info_idx", "")),
                tray_type=entry.get("tray_type", []),
                nozzle_temp_min=entry.get("nozzle_temp_min"),
                nozzle_temp_max=entry.get("nozzle_temp_max"),
                is_custom=True,
            )
            merged[item.tray_info_idx] = item
        return list(merged.values())

    async def reload(self) -> None:
        async with self._lock:
            self._load_catalog()

    async def add_custom_filament(self, entry: dict[str, Any]) -> FilamentCatalogItem:
        tray_info_idx = entry.get("tray_info_idx")
        setting_id = entry.get("setting_id") or ""
        alias = entry.get("alias")
        tray_type = self._normalize_tray_type(entry.get("tray_type"))
        if not tray_info_idx or not alias or not tray_type:
            raise ValueError("alias, tray_info_idx, tray_type are required")
        record = {
            "alias": str(alias),
            "setting_id": str(setting_id),
            "tray_info_idx": str(tray_info_idx),
            "tray_type": tray_type,
            "nozzle_temp_min": self._to_int(entry.get("nozzle_temp_min")),
            "nozzle_temp_max": self._to_int(entry.get("nozzle_temp_max")),
        }
        async with self._lock:
            self._custom_catalog[record["tray_info_idx"]] = record
            await asyncio.to_thread(self._persist_custom)
        brand, material = self._split_alias(record.get("alias"))
        return FilamentCatalogItem(**record, brand=brand, material=material, is_custom=True)

    def list_custom_filaments(self) -> List[FilamentCatalogItem]:
        results: List[FilamentCatalogItem] = []
        for entry in self._custom_catalog.values():
            brand, material = self._split_alias(entry.get("alias"))
            results.append(
                FilamentCatalogItem(
                    **entry,
                    brand=brand,
                    material=material,
                    is_custom=True,
                )
            )
        return results

    async def delete_custom_filament(self, tray_info_idx: str) -> None:
        if not tray_info_idx:
            raise ValueError("tray_info_idx is required")
        async with self._lock:
            if tray_info_idx not in self._custom_catalog:
                raise KeyError(tray_info_idx)
            self._custom_catalog.pop(tray_info_idx, None)
            await asyncio.to_thread(self._persist_custom)

    def _persist_custom(self) -> None:
        self._custom_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"items": list(self._custom_catalog.values())}
        with self._custom_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
