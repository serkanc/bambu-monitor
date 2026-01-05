from __future__ import annotations

import re
from typing import Any

from app.models import (
    LastSentProjectFile,
    PrintAgainState,
    PrintStatus,
    PrinterGCodeState,
    PrinterState,
)

_FILENAME_SPLIT_RE = re.compile(r'[\\/]')


def _extract_filename(value: str | None) -> str | None:
    if not value:
        return None
    parts = _FILENAME_SPLIT_RE.split(str(value))
    if not parts:
        return None
    candidate = parts[-1]
    return candidate or None


def build_print_again_payload(last_sent: LastSentProjectFile | None) -> dict[str, Any] | None:
    if not last_sent or last_sent.command != "project_file":
        return None

    payload: dict[str, Any] = {
        "url": last_sent.url,
        "plate": last_sent.param,
        "bed_leveling": last_sent.bed_leveling,
        "flow_cali": last_sent.flow_cali,
        "timelapse": last_sent.timelapse,
        "use_ams": last_sent.use_ams,
        "layer_inspect": last_sent.layer_inspect,
        "vibration_cali": last_sent.vibration_cali,
    }
    if last_sent.ams_mapping:
        payload["ams_mapping"] = list(last_sent.ams_mapping)

    filtered = {key: value for key, value in payload.items() if value is not None}
    if not filtered.get("url") or not filtered.get("plate"):
        return None
    return filtered


def evaluate_print_again_state(
    print_status: PrintStatus,
    last_sent: LastSentProjectFile | None,
    online: bool,
) -> PrintAgainState:
    finished_states = {
        PrinterGCodeState.FINISH,
        PrinterGCodeState.FAILED,
    }
    if print_status.gcode_state not in finished_states:
        return PrintAgainState(reason="print_in_progress")

    payload = build_print_again_payload(last_sent)
    if not payload:
        return PrintAgainState(reason="no_payload")

    sent_file = _extract_filename(last_sent.file) or _extract_filename(last_sent.url)
    current_file = _extract_filename(print_status.file)
    if not sent_file or not current_file or sent_file != current_file:
        return PrintAgainState(reason="file_mismatch")

    enabled = bool(online) and bool(payload)
    reason = None
    if not enabled:
        reason = "printer_offline" if not online else "disabled"

    return PrintAgainState(visible=True, enabled=enabled, payload=payload, reason=reason)


def update_print_again_state(state: PrinterState) -> None:
    state.print.print_again = evaluate_print_again_state(
        state.print, state.last_sent_project_file, state.printer_online
    )
