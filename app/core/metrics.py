"""Minimal metrics collector for operational visibility."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import time
from typing import Deque, Dict


@dataclass
class MetricPoint:
    ok: bool
    duration_ms: int


class MetricsCollector:
    def __init__(self, window_size: int = 200) -> None:
        self._window_size = window_size
        self._points: Dict[str, Deque[MetricPoint]] = {}
        self._last_alert: Dict[str, float] = {}

    def record(self, name: str, *, ok: bool, duration_ms: int) -> None:
        bucket = self._points.setdefault(name, deque(maxlen=self._window_size))
        bucket.append(MetricPoint(ok=ok, duration_ms=duration_ms))

    def snapshot(self) -> dict:
        payload: dict[str, dict] = {}
        for name, points in self._points.items():
            if not points:
                continue
            total = len(points)
            errors = sum(1 for p in points if not p.ok)
            avg = int(sum(p.duration_ms for p in points) / total)
            payload[name] = {
                "count": total,
                "errors": errors,
                "error_rate": round(errors / total, 3),
                "avg_ms": avg,
            }
        return payload

    def should_alert(
        self,
        name: str,
        *,
        error_rate: float = 0.2,
        avg_ms: int = 2000,
        min_interval_s: int = 60,
    ) -> bool:
        bucket = self._points.get(name)
        if not bucket:
            return False
        total = len(bucket)
        if total < 5:
            return False
        errors = sum(1 for p in bucket if not p.ok)
        avg = int(sum(p.duration_ms for p in bucket) / total)
        if (errors / total) < error_rate and avg < avg_ms:
            return False
        now = time.time()
        last = self._last_alert.get(name, 0.0)
        if now - last < min_interval_s:
            return False
        self._last_alert[name] = now
        return True


metrics = MetricsCollector()
