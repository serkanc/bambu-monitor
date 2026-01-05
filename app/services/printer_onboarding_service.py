"""Utility service that verifies printers via MQTT get_version command."""
from __future__ import annotations

import asyncio
import json
import logging
import ssl
from dataclasses import dataclass
from typing import Any, List

from aiomqtt import Client, MqttError

logger = logging.getLogger(__name__)


@dataclass
class DeviceModule:
    """Representation of a module entry returned by get_version."""

    name: str
    product_name: str | None
    sw_ver: str | None
    visible: bool | None


@dataclass
class DeviceProbeResult:
    """Structured response returned by PrinterOnboardingService."""

    product_name: str
    firmware: str | None
    modules: List[DeviceModule]


class PrinterOnboardingService:
    """Connect to a printer via MQTT and fetch metadata using get_version."""

    def __init__(
        self,
        *,
        username: str,
        mqtt_port: int,
        timeout: float = 12.0,
    ) -> None:
        self._username = username
        self._mqtt_port = mqtt_port
        self._timeout = timeout

    async def probe_printer(
        self,
        *,
        printer_ip: str,
        access_code: str,
        serial: str,
    ) -> DeviceProbeResult:
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE

        report_topic = f"device/{serial}/report"
        request_topic = f"device/{serial}/request"
        command_payload = json.dumps({
            "info": {
                "command": "get_version",
                "sequence_id": "2023",
                "param": "",
            }
        })

        try:
            async with Client(
                hostname=printer_ip,
                port=self._mqtt_port,
                username=self._username,
                password=access_code,
                tls_context=ssl_context,
                timeout=10,
            ) as client:
                await client.subscribe(report_topic)
                await client.publish(request_topic, command_payload)

                info_block: dict[str, Any] | None = None
                messages = client.messages

                while True:
                    message = await asyncio.wait_for(messages.__anext__(), timeout=self._timeout)
                    if not message.topic.matches(report_topic):
                        continue
                    payload = json.loads(message.payload.decode("utf-8"))
                    info = payload.get("info")
                    if info and info.get("command") == "get_version":
                        info_block = info
                        break

                if not info_block:
                    raise RuntimeError("get_version response not received")

                modules_raw = info_block.get("module", [])
                modules: List[DeviceModule] = []
                for module in modules_raw:
                    if isinstance(module, dict):
                        modules.append(DeviceModule(
                            name=str(module.get("name", "")),
                            product_name=module.get("product_name"),
                            sw_ver=module.get("sw_ver"),
                            visible=module.get("visible"),
                        ))

                product_name = self._extract_product_name(modules)
                firmware = self._extract_firmware(modules)

                return DeviceProbeResult(product_name=product_name, firmware=firmware, modules=modules)
        except (asyncio.TimeoutError, MqttError) as exc:
            raise RuntimeError(f"Printer MQTT verification failed: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Unexpected error while verifying printer: {exc}") from exc

    @staticmethod
    def _extract_product_name(modules: List[DeviceModule]) -> str:
        for module in modules:
            if module.name.lower() == "ota":
                if module.product_name:
                    return module.product_name
        for module in modules:
            if module.product_name:
                return module.product_name
        return "Bilinmeyen Model"

    @staticmethod
    def _extract_firmware(modules: List[DeviceModule]) -> str | None:
        for module in modules:
            if module.name.lower() == "ota":
                return module.sw_ver
        for module in modules:
            if module.sw_ver:
                return module.sw_ver
        return None
