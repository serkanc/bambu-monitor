"""CLI entry-point for running the FastAPI application."""
from __future__ import annotations

import asyncio
import sys

if sys.platform == "win32":
    # Selector loop is needed on Windows so aiomqtt can register readers/writers.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

def selector_loop_factory(use_subprocess: bool = False) -> asyncio.AbstractEventLoop:
    """Always use the selector loop so add_reader/add_writer stay available."""
    return asyncio.SelectorEventLoop()

import uvicorn

from app.core.config import NoPrintersConfigured, get_app_config, get_settings


def main() -> None:
    """Run the ASGI application using uvicorn."""
    try:
        settings = get_settings()
    except NoPrintersConfigured:
        settings = get_app_config()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        timeout_graceful_shutdown=2,
        #ssl_keyfile="key.pem",
        #ssl_certfile="cert.pem",
        reload=False,
        access_log=False,
        loop=selector_loop_factory,
    )


if __name__ == "__main__":
    main()
