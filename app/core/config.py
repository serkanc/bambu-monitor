"""Application configuration management."""
import json
import os
import secrets
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

DEFAULT_USERNAME = "bblp"
DEFAULT_MQTT_PORT = 8883
DEFAULT_FTP_PORT = 990
DEFAULT_CAM_PORT = 6000
DEFAULT_CAM_DEVICE_ID = "bblp"


class PrinterConfig(BaseModel):
    """Printer configuration model."""

    id: str = Field(..., description="Unique printer identifier")
    printer_ip: str = Field(..., description="IP address of the printer")
    access_code: str = Field(..., description="Printer access code/password")
    serial: str = Field(..., description="Printer serial number for MQTT topics")
    model: str = Field(..., description="Printer model name or code")
    external_camera_url: Optional[str] = Field(
        default=None,
        description="External RTSP/RTPS camera URL",
    )


class AppConfig(BaseModel):
    """Application-level configuration model."""
    model_config = {"extra": "ignore"}

    host: str = Field("0.0.0.0", description="Application bind address")
    port: int = Field(5000, description="Application bind port")
    log_level: str = Field("INFO", description="Root logging level")
    pushall_interval: int = Field(60, description="MQTT pushall command interval in seconds")
    cam_interval: int = Field(2, description="Seconds between two camera frames")
    go2rtc_port: int = Field(5010, description="go2rtc HTTP API port")
    go2rtc_path: str = Field("bin/go2rtc", description="Path to go2rtc binary")
    go2rtc_log_output: bool = Field(False, description="Enable go2rtc stdout/stderr logging")
    api_token: Optional[str] = Field(
        default=None,
        description="Optional API token for authenticated requests",
    )
    admin_token: Optional[str] = Field(
        default=None,
        description="Admin token used for privileged operations",
    )
    admin_allowlist: list[str] = Field(
        default_factory=list,
        description="Optional list of allowed admin IPs",
    )
    admin_password_hash: Optional[str] = Field(
        default=None,
        description="PBKDF2 hash of the admin login password",
    )
    session_secret: Optional[str] = Field(
        default=None,
        description="Secret used to sign UI sessions",
    )
    auth_enabled: bool = Field(
        default=True,
        description="Enable or disable API auth enforcement",
    )
    debug_enabled: bool = Field(
        default=True,
        description="Enable or disable debug endpoints",
    )
    cache_upload_enabled: bool = Field(
        default=False,
        description="Store uploaded 3MF files inside print-cache",
    )


class ConfigSettings(BaseModel):
    """Optional metadata stored alongside printer definitions."""

    default_printer_id: str | None = Field(
        None,
        description="Identifier of the printer that should be considered default",
    )


class ConfigFile(BaseModel):
    """Root configuration file structure."""

    app_settings: AppConfig
    printers: list[PrinterConfig]
    settings: ConfigSettings = Field(default_factory=ConfigSettings)


class NoPrintersConfigured(RuntimeError):
    """Signalling that app.json contains no printer definitions."""


class Settings(BaseSettings):
    """Resolved application settings used by FastAPI dependencies."""

    printer_id: str = Field(..., description="Identifier of the active printer")
    printer_ip: str = Field(..., description="IP address of the selected printer")
    access_code: str = Field(..., description="Printer access code/password")
    serial: str = Field(..., description="Printer serial number for MQTT topics")
    printer_model: str = Field(..., description="Selected printer model name")
    external_camera_url: Optional[str] = Field(
        default=None,
        description="External RTSP/RTPS camera URL",
    )

    printer_username: str = Field(DEFAULT_USERNAME, description="Printer username")
    mqtt_port: int = Field(DEFAULT_MQTT_PORT, description="MQTT port exposed by the printer")
    ftp_port: int = Field(DEFAULT_FTP_PORT, description="FTP Secure port exposed by the printer")
    cam_port: int = Field(DEFAULT_CAM_PORT, description="Camera streaming TCP port")
    cam_device_id: str = Field(DEFAULT_CAM_DEVICE_ID, description="Camera device identifier")

    pushall_interval: int = Field(60, description="MQTT pushall command interval in seconds")
    cam_interval: int = Field(2, description="Seconds between two camera frames")
    host: str = Field("0.0.0.0", description="Application bind address")
    port: int = Field(5000, description="Application bind port")
    log_level: str = Field("INFO", description="Root logging level")
    go2rtc_port: int = Field(5010, description="go2rtc HTTP API port")
    go2rtc_path: str = Field("bin/go2rtc", description="Path to go2rtc binary")
    go2rtc_log_output: bool = Field(False, description="Enable go2rtc stdout/stderr logging")


def _get_config_file_path() -> Path:
    """Get the absolute path to app.json configuration file."""
    project_root = Path(__file__).parent.parent.parent
    config_path = project_root / "app.json"

    return config_path


def _default_config() -> ConfigFile:
    return ConfigFile(app_settings=AppConfig(), printers=[], settings=ConfigSettings())


def _persist_config(config: ConfigFile, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            delete=False,
            dir=path.parent,
            suffix=".tmp",
        ) as tmp_file:
            json.dump(config.model_dump(mode="json"), tmp_file, indent=2, ensure_ascii=False)
            tmp_name = Path(tmp_file.name)
        os.replace(tmp_name, path)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Failed to persist configuration to {path}: {exc}") from exc


def _ensure_config_file() -> Path:
    path = _get_config_file_path()
    if path.exists():
        return path

    _persist_config(_default_config(), path)
    return path


def _load_config_from_json() -> ConfigFile:
    """Load and parse configuration from app.json file (blocking, use at startup)."""
    config_path = _ensure_config_file()

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config_data = json.load(f)
        config = ConfigFile(**config_data)
        updated = False
        if not config.app_settings.api_token:
            config.app_settings.api_token = secrets.token_urlsafe(32)
            updated = True
        if not config.app_settings.admin_token:
            config.app_settings.admin_token = secrets.token_urlsafe(32)
            updated = True
        if not config.app_settings.session_secret:
            config.app_settings.session_secret = secrets.token_urlsafe(32)
            updated = True
        if updated:
            _write_config_to_json(config)
        return config
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in {config_path}: {e}")
    except Exception as e:
        raise RuntimeError(f"Error loading configuration from {config_path}: {e}")


def _write_config_to_json(config: ConfigFile) -> None:
    """Persist the provided configuration back to app.json."""

    config_path = _ensure_config_file()
    _persist_config(config, config_path)


async def _load_config_from_json_async() -> ConfigFile:
    """Load and parse configuration from app.json file (async, use in endpoints)."""
    import aiofiles

    config_path = _get_config_file_path()

    try:
        async with aiofiles.open(config_path, "r", encoding="utf-8") as f:
            content = await f.read()
        config_data = json.loads(content)
        config = ConfigFile(**config_data)
        updated = False
        if not config.app_settings.api_token:
            config.app_settings.api_token = secrets.token_urlsafe(32)
            updated = True
        if not config.app_settings.admin_token:
            config.app_settings.admin_token = secrets.token_urlsafe(32)
            updated = True
        if not config.app_settings.session_secret:
            config.app_settings.session_secret = secrets.token_urlsafe(32)
            updated = True
        if updated:
            _write_config_to_json(config)
        return config
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in {config_path}: {e}")
    except Exception as e:
        raise RuntimeError(f"Error loading configuration from {config_path}: {e}")


def list_printer_definitions() -> list[PrinterConfig]:
    """Return all printer definitions from configuration."""

    config = _load_config_from_json()
    return config.printers


def get_default_printer_id() -> str | None:
    """Return the configured default printer identifier, if any."""

    config = _load_config_from_json()
    return config.settings.default_printer_id


def has_printers() -> bool:
    """Return True when at least one printer exists in the configuration."""

    config = _load_config_from_json()
    return bool(config.printers)


async def list_printer_definitions_async() -> list[PrinterConfig]:
    """Async helper returning all printer definitions."""

    config = await _load_config_from_json_async()
    return config.printers


def set_default_printer(printer_id: str) -> ConfigFile:
    """Persist a specific printer identifier as the default selection."""

    config = _load_config_from_json()
    if not any(printer.id == printer_id for printer in config.printers):
        raise ValueError(f"Printer with id '{printer_id}' not found in app.json")

    config.settings.default_printer_id = printer_id
    _write_config_to_json(config)
    get_settings.cache_clear()
    return config


def _select_printer(
    config: ConfigFile,
    *,
    printer_id: str | None = None,
    printer_index: int = 0,
) -> PrinterConfig:
    """Select a printer either by id or by index."""

    if not config.printers:
        raise NoPrintersConfigured("No printers configured in app.json")

    if printer_id is not None:
        for printer in config.printers:
            if printer.id == printer_id:
                return printer
        raise ValueError(f"Printer with id '{printer_id}' not found in app.json")

    if not 0 <= printer_index < len(config.printers):
        raise ValueError(
            f"Printer index {printer_index} out of range. "
            f"Available printers: {len(config.printers)}"
        )

    return config.printers[printer_index]


def _create_settings_from_config(
    config: ConfigFile,
    *,
    printer_id: str | None = None,
    printer_index: int = 0,
) -> Settings:
    """Create Settings object from configuration file using the selected printer."""

    default_id = config.settings.default_printer_id
    target_id = printer_id or default_id
    selected_printer: PrinterConfig | None = None

    if target_id is not None:
        try:
            selected_printer = _select_printer(
                config,
                printer_id=target_id,
                printer_index=printer_index,
            )
        except ValueError:
            if printer_id is not None:
                raise

    if selected_printer is None:
        selected_printer = _select_printer(config, printer_index=printer_index)

    app_config = config.app_settings

    return Settings(
        printer_id=selected_printer.id,
        printer_ip=selected_printer.printer_ip,
        access_code=selected_printer.access_code,
        serial=selected_printer.serial,
        printer_model=selected_printer.model,
        external_camera_url=selected_printer.external_camera_url,
        pushall_interval=app_config.pushall_interval,
        cam_interval=app_config.cam_interval,
        host=app_config.host,
        port=app_config.port,
        log_level=app_config.log_level,
        go2rtc_port=app_config.go2rtc_port,
        go2rtc_path=app_config.go2rtc_path,
        go2rtc_log_output=app_config.go2rtc_log_output,
    )


@lru_cache(maxsize=None)
def get_settings(printer_id: str | None = None, printer_index: int = 0) -> Settings:
    """Return a cached Settings instance (blocking, use at startup only)."""

    config = _load_config_from_json()
    return _create_settings_from_config(config, printer_id=printer_id, printer_index=printer_index)


async def get_settings_async(printer_id: str | None = None, printer_index: int = 0) -> Settings:
    """Async helper to fetch settings without blocking."""

    config = await _load_config_from_json_async()
    return _create_settings_from_config(config, printer_id=printer_id, printer_index=printer_index)


def get_app_config() -> AppConfig:
    """Return application-wide settings regardless of printer definitions."""

    config = _load_config_from_json()
    return config.app_settings


def update_app_config(
    *,
    api_token: Optional[str] = None,
    admin_token: Optional[str] = None,
    admin_password_hash: Optional[str] = None,
    session_secret: Optional[str] = None,
    auth_enabled: Optional[bool] = None,
    admin_allowlist: Optional[list[str]] = None,
    cache_upload_enabled: Optional[bool] = None,
) -> AppConfig:
    """Update application settings stored in app.json."""

    config = _load_config_from_json()
    app_settings = config.app_settings
    if api_token is not None:
        app_settings.api_token = api_token
    if admin_token is not None:
        app_settings.admin_token = admin_token
    if admin_password_hash is not None:
        app_settings.admin_password_hash = admin_password_hash
    if session_secret is not None:
        app_settings.session_secret = session_secret
    if auth_enabled is not None:
        app_settings.auth_enabled = auth_enabled
    if admin_allowlist is not None:
        app_settings.admin_allowlist = admin_allowlist
    if cache_upload_enabled is not None:
        app_settings.cache_upload_enabled = bool(cache_upload_enabled)
    config.app_settings = app_settings
    _write_config_to_json(config)
    return app_settings


def is_setup_required() -> bool:
    """Return True when the setup wizard should be shown."""

    config = _load_config_from_json()
    if not config.printers:
        return True
    if not config.app_settings.admin_password_hash:
        return True
    return False


def is_password_setup_required() -> bool:
    """Return True when admin password must be set before adding printers."""

    config = _load_config_from_json()
    if not config.app_settings.admin_password_hash:
        return True
    return False


def get_settings_if_available(printer_id: str | None = None, printer_index: int = 0) -> Optional[Settings]:
    """Return settings if there is at least one printer configured."""

    config = _load_config_from_json()
    if not config.printers:
        return None
    return _create_settings_from_config(config, printer_id=printer_id, printer_index=printer_index)


def register_printer(printer: PrinterConfig) -> PrinterConfig:
    """Persist a new printer definition to app.json."""

    config = _load_config_from_json()
    if any(existing.id == printer.id for existing in config.printers):
        raise ValueError(f"Printer with id '{printer.id}' already exists")
    if any(existing.serial == printer.serial for existing in config.printers):
        raise ValueError(f"Printer with serial '{printer.serial}' already exists")

    config.printers.append(printer)
    if not config.settings.default_printer_id:
        config.settings.default_printer_id = printer.id
    _write_config_to_json(config)
    get_settings.cache_clear()
    return printer


def update_printer(printer_id: str, updated: PrinterConfig) -> PrinterConfig:
    """Update an existing printer definition while keeping its identifier stable."""

    config = _load_config_from_json()
    index = next((idx for idx, entry in enumerate(config.printers) if entry.id == printer_id), None)
    if index is None:
        raise ValueError(f"Printer with id '{printer_id}' not found")

    if updated.id != printer_id and any(entry.id == updated.id for entry in config.printers):
        raise ValueError(f"Printer with id '{updated.id}' already exists")

    if any(entry.serial == updated.serial and entry.id != printer_id for entry in config.printers):
        raise ValueError(f"Printer with serial '{updated.serial}' already exists")

    config.printers[index] = updated
    if config.settings.default_printer_id == printer_id:
        config.settings.default_printer_id = updated.id
    _write_config_to_json(config)
    get_settings.cache_clear()
    return updated


def remove_printer(printer_id: str) -> ConfigFile:
    """Remove a printer from configuration and persist changes."""

    config = _load_config_from_json()
    remaining = [printer for printer in config.printers if printer.id != printer_id]
    if len(remaining) == len(config.printers):
        raise ValueError(f"Printer with id '{printer_id}' not found")

    config.printers = remaining
    if config.settings.default_printer_id == printer_id:
        config.settings.default_printer_id = remaining[0].id if remaining else None
    _write_config_to_json(config)
    get_settings.cache_clear()
    return config
