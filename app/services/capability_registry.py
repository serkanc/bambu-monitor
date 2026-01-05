"""Static registry describing printer and AMS feature flags."""
from __future__ import annotations

from typing import Any, Mapping

from app.models import AmsUnitCapabilities, PrinterCapabilities


def _normalize(value: str | None) -> str:
    return str(value or "").strip().lower()


PRINTER_FIELD_OVERRIDES: Mapping[str, dict[str, Any]] = {
    "bambu lab a1": {
        "print": {
            "chamber_temp": False,
            "fan_gear": False,
            "layer_inspect": False,
        },
    },
}

AMS_FIELD_OVERRIDES: Mapping[str, dict[str, Any]] = {
    "ams lite": {
        "trays": {
            "remain": False,
        },
        "unit": {
            "humidity": False,
            "temp": False,
        },
    },
}


def resolve_printer_capabilities(model_name: str | None) -> PrinterCapabilities:
    """Return capability flags for the provided printer model."""

    normalized = _normalize(model_name)
    overrides = PRINTER_FIELD_OVERRIDES.get(normalized)
    return PrinterCapabilities(
        model=model_name,
        fields=overrides.copy() if overrides else {},
    )


def resolve_ams_capabilities(product_name: str | None) -> AmsUnitCapabilities:
    """Return capability flags for a given AMS product."""

    normalized = _normalize(product_name)
    overrides = AMS_FIELD_OVERRIDES.get(normalized)
    return AmsUnitCapabilities(
        product_name=product_name,
        fields=overrides.copy() if overrides else {},
    )
