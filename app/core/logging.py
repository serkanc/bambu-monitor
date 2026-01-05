"""Logging utilities for the Bambu printer monitor application."""
import logging
import sys

from app.core.config import AppConfig, Settings
from app.core.request_context import get_request_id


def configure_logging(
    settings: Settings | AppConfig, *,
    logger_name: str = "printer_monitor",
) -> logging.Logger:
    """Configure the root logger and return the application logger.

    Args:
        settings: Application settings containing log-level information.
        logger_name: Name of the logger to retrieve.

    Returns:
        Configured logger instance.
    """

    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)

    logging.basicConfig(
        level=log_level,
        format=(
            "%(asctime)s - %(name)s - %(levelname)s - "
            "[%(filename)s:%(lineno)d] - request_id=%(request_id)s - %(message)s"
        ),
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )

    old_factory = logging.getLogRecordFactory()

    def record_factory(*args, **kwargs) -> logging.LogRecord:
        record = old_factory(*args, **kwargs)
        record.request_id = get_request_id() or "system"
        return record

    logging.setLogRecordFactory(record_factory)

    logger = logging.getLogger(logger_name)
    logger.setLevel(log_level)
    
    #noisy = logging.getLogger("python_multipart")
    #noisy.setLevel(logging.INFO)
    #logging.getLogger("app.services.state_assembler").setLevel(logging.DEBUG)
    #logging.getLogger("app.core.bambu_ftp").setLevel(logging.DEBUG)
    
    logger.debug("Logging configured with level %s", logging.getLevelName(log_level))
    return logger
