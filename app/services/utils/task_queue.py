"""Simple async task queue with concurrency limits."""
from __future__ import annotations

import asyncio
from typing import Awaitable, Callable


class TaskQueue:
    def __init__(self, *, name: str, concurrency: int = 1) -> None:
        self._name = name
        self._concurrency = max(1, concurrency)
        self._queue: asyncio.Queue[tuple[Callable[[], Awaitable], asyncio.Future]] = asyncio.Queue()
        self._workers: list[asyncio.Task] = []
        self._running = False

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._workers = [
            asyncio.create_task(self._worker(), name=f"{self._name}-worker-{idx}")
            for idx in range(self._concurrency)
        ]

    async def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers = []

    async def submit(self, coro_fn: Callable[[], Awaitable]) -> asyncio.Future:
        if not self._running:
            await self.start()
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        await self._queue.put((coro_fn, future))
        return future

    async def _worker(self) -> None:
        while True:
            coro_fn, future = await self._queue.get()
            if future.cancelled():
                self._queue.task_done()
                continue
            task = asyncio.create_task(coro_fn())

            def _cancel_task(fut: asyncio.Future) -> None:
                if fut.cancelled() and not task.done():
                    task.cancel()

            future.add_done_callback(_cancel_task)

            try:
                result = await task
            except asyncio.CancelledError:
                if not future.done():
                    future.cancel()
            except Exception as exc:  # noqa: BLE001
                if not future.done():
                    future.set_exception(exc)
            else:
                if not future.done():
                    future.set_result(result)
            finally:
                self._queue.task_done()
