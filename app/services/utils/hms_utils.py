"""
HMS ve Error Code lookup helpers.

- data/hms/data/hms_en_*.json dosyalari lazy-load + RAM cache
- HMS ve Error code lookup O(1) dictionary
- Runtime'da disk I/O yok (ilk call haric)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# FORMAT / NORMALIZE HELPERS
# ----------------------------------------------------------------------

def format_timestamp(ts):
    """Convert timestamp to readable format."""
    if not ts:
        return "-"

    try:
        num = int(float(ts))

        # Unix timestamp (seconds)
        if 1_000_000_000 < num < 10_000_000_000:
            return datetime.fromtimestamp(num).strftime("%Y-%m-%d %H:%M:%S")
        # Milliseconds
        elif 10_000_000_000 < num < 100_000_000_000:
            return datetime.fromtimestamp(num / 1000).strftime("%Y-%m-%d %H:%M:%S")
        else:
            return str(ts)

    except (ValueError, TypeError):
        return str(ts) if ts is not None else "-"


def int_to_hex_groups(value, default: str = "-") -> str:
    """
    Convert integer to hex string in XXXX-XXXX-XXXX-XXXX format.
    Error codes naturally end up as XXXX-XXXX.
    """
    if value is None:
        return default

    try:
        num = int(value)
        hex_str = f"{num:X}"

        # pad to multiple of 4
        hex_str = hex_str.zfill((len(hex_str) + 3) // 4 * 4)
        return "-".join(
            hex_str[i : i + 4] for i in range(0, len(hex_str), 4)
        )

    except (ValueError, TypeError):
        return str(value) if value is not None else default


def normalize_code(code: str) -> str:
    """
    Normalize incoming HMS / Error code to dashed uppercase form.

    Examples:
        '03002b0000020001' -> '0300-2B00-0002-0001'
        '0a010003'         -> '0A01-0003'
    """
    if not code:
        return ""

    cleaned = (
        code.upper()
        .replace("HMS_", "")
        .replace("_", "")
        .replace("-", "")
        .strip()
    )

    if not cleaned:
        return ""

    # split every 4 chars
    groups = [cleaned[i : i + 4] for i in range(0, len(cleaned), 4)]
    return "-".join(groups)


# ----------------------------------------------------------------------
# DATA LOADING (LAZY + CACHED)
# ----------------------------------------------------------------------

DEFAULT_HMS_DEVICE_TYPE = "22E"


def _get_hms_data_dir() -> Path:
    base_dir = Path(__file__).resolve().parents[3]
    return base_dir / "data" / "hms" / "data"


def _normalize_lookup_code(code: str) -> str:
    if not code:
        return ""
    return (
        str(code)
        .upper()
        .replace("HMS_", "")
        .replace("_", "")
        .replace("-", "")
        .strip()
    )


def _device_type_from_serial(serial: Optional[str]) -> Optional[str]:
    if not serial:
        return None
    serial = str(serial).strip()
    if len(serial) < 3:
        return None
    return serial[:3].upper()


@lru_cache(maxsize=None)
def _load_device_tables(device_type: str) -> Tuple[Dict[str, dict], Dict[str, dict]]:
    data_dir = _get_hms_data_dir()
    filename = f"hms_en_{device_type}.json"
    path = data_dir / filename
    if not path.exists():
        logger.warning("HMS device file not found: %s", path)
        return {}, {}

    try:
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as exc:
        logger.warning("Failed to load %s: %s", path, exc)
        return {}, {}

    payload = payload.get("data", payload)
    hms_items = payload.get("device_hms", {}).get("en", [])
    err_items = payload.get("device_error", {}).get("en", [])

    def _map_entries(items: list[dict]) -> Dict[str, dict]:
        result: Dict[str, dict] = {}
        if not isinstance(items, list):
            return result
        for item in items:
            if not isinstance(item, dict):
                continue
            code = _normalize_lookup_code(item.get("ecode", ""))
            if not code:
                continue
            result[code] = {"description": item.get("intro") or ""}
        return result

    return _map_entries(hms_items), _map_entries(err_items)


def _get_tables_for_serial(
    serial: Optional[str],
    device_type: Optional[str] = None,
) -> Tuple[Dict[str, dict], Dict[str, dict]]:
    data_dir = _get_hms_data_dir()
    candidate = device_type or _device_type_from_serial(serial)
    if candidate:
        candidate_file = data_dir / f"hms_en_{candidate}.json"
        if candidate_file.exists():
            return _load_device_tables(candidate)
    return _load_device_tables(DEFAULT_HMS_DEVICE_TYPE)


# ----------------------------------------------------------------------
# HMS LOOKUP
# ----------------------------------------------------------------------

def resolve_hms(
    code: str,
    *,
    serial: Optional[str] = None,
    device_type: Optional[str] = None,
) -> Optional[dict]:
    if not code:
        return None

    code = _normalize_lookup_code(code)
    if not code:
        return None

    hms_data, _ = _get_tables_for_serial(serial, device_type=device_type)
    return hms_data.get(code)



def get_hms_description(
    code: str,
    model: Optional[str] = None,
    *,
    serial: Optional[str] = None,
    device_type: Optional[str] = None,
) -> Optional[str]:
    """
    Return HMS description text.

    model:
        Optional printer model (X1, P1P, etc.).
        If provided and models are present, tries to match.
    """
    entry = resolve_hms(code, serial=serial, device_type=device_type)
    if not entry:
        return None

    desc = entry.get("description")
    if not desc:
        return None

    return str(desc)


# ----------------------------------------------------------------------
# ERROR CODE LOOKUP
# ----------------------------------------------------------------------

def resolve_error(
    code: str,
    *,
    serial: Optional[str] = None,
    device_type: Optional[str] = None,
) -> Optional[dict]:
    """
    Resolve error code to full entry.

    Returns:
        {
          "description": str
        }
    """
    if not code:
        return None

    code = _normalize_lookup_code(code)
    if not code:
        return None

    _, err_data = _get_tables_for_serial(serial, device_type=device_type)
    return err_data.get(code)



def get_error_description(
    code: str,
    *,
    serial: Optional[str] = None,
    device_type: Optional[str] = None,
) -> Optional[str]:
    """Return error code description text."""
    entry = resolve_error(code, serial=serial, device_type=device_type)
    if not entry:
        return None

    desc = entry.get("description")
    return str(desc) if desc else None
