"""Utilities for monitoring background asyncio tasks."""
from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Awaitable, Callable, Sequence

Logger = logging.Logger


def monitor_task(task: asyncio.Task, *, name: str, logger: Logger, on_error: Callable[[BaseException], None] | None = None) -> asyncio.Task:
    """Attach a callback to log unexpected task termination."""

    def _callback(finished: asyncio.Task) -> None:
        with contextlib.suppress(asyncio.CancelledError):
            exc = finished.exception()
            if exc is None:
                return
            logger.error("Background task %s crashed: %s", name, exc, exc_info=exc)
            if on_error:
                on_error(exc)

    task.add_done_callback(_callback)
    return task


class LifecycleManager:
    """Shared lifecycle helper for starting/stopping async services."""

    def __init__(self, *, name: str, logger: Logger) -> None:
        self._name = name
        self._logger = logger
        self._started = False
        self._tracked: list[asyncio.Task] = []

    async def start(self, steps: Sequence[Callable[[], Awaitable[None]]]) -> None:
        if self._started:
            return
        self._started = True
        if not steps:
            return
        await asyncio.gather(*(step() for step in steps))

    async def stop(self, steps: Sequence[Callable[[], Awaitable[None]]]) -> None:
        if not self._started:
            return
        self._started = False
        if not steps:
            return
        results = await asyncio.gather(*(step() for step in steps), return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException):
                self._logger.error("%s stop failed: %s", self._name, result, exc_info=result)

    def track_task(
        self,
        task: asyncio.Task,
        *,
        name: str,
        on_error: Callable[[BaseException], None] | None = None,
    ) -> None:
        self._tracked.append(monitor_task(task, name=name, logger=self._logger, on_error=on_error))

    async def cancel_tracked(self) -> None:
        if not self._tracked:
            return
        for task in self._tracked:
            task.cancel()
        await asyncio.gather(*self._tracked, return_exceptions=True)
        self._tracked = []
