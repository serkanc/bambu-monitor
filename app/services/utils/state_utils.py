"""Helper utilities for state parsing routines."""
from __future__ import annotations

from typing import Any, List, Optional


def bits_to_bool(value: Any) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value) > 0
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return int(raw, 16) > 0
        except ValueError:
            try:
                return int(raw) > 0
            except ValueError:
                return None
    return None


def normalize_str(value: Any, default: str = "0") -> str:
    if value is None:
        return default
    return str(value)


def parse_slot_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        base = 10
        if any(ch in "abcdefABCDEF" for ch in raw):
            base = 16
        try:
            return int(raw, base)
        except ValueError:
            try:
                return int(raw)
            except ValueError:
                return None
    return None


def decode_tray_bits(bits_value: Any, slot_count: int = 4) -> List[bool]:
    parsed = parse_slot_int(bits_value)
    if parsed is None:
        return []
    return [bool((parsed >> idx) & 1) for idx in range(slot_count)]
