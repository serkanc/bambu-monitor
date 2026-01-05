"""Print job parsing helpers."""
import logging
import re
import xml.etree.ElementTree as ET
from pathlib import Path

logger = logging.getLogger(__name__)


def parse_slice_metadata(printer_id: str, extract_dir: Path) -> dict:
    """Parse Metadata/slice_info.config for plate and filament details."""
    config_path = extract_dir / "Metadata" / "slice_info.config"
    result: dict = {"plates": []}

    if not config_path.exists():
        logger.warning("slice_info.config not found at %s", config_path)
        return result

    try:
        tree = ET.parse(config_path)
        root = tree.getroot()

        for plate_el in root.findall("plate"):
            plate_meta: dict[str, str] = {}
            for meta_el in plate_el.findall("metadata"):
                key = meta_el.get("key")
                value = meta_el.get("value")
                if key:
                    plate_meta[key] = value

            filaments = []
            for fil_el in plate_el.findall("filament"):
                filaments.append(
                    {
                        "id": int(fil_el.get("id", "0")),
                        "tray_info_idx": fil_el.get("tray_info_idx") or "",
                        "type": fil_el.get("type") or "",
                        "color": fil_el.get("color") or "",
                        "used_m": float(fil_el.get("used_m", "0") or 0),
                        "used_g": float(fil_el.get("used_g", "0") or 0),
                    }
                )

            warnings = []
            for warn_el in plate_el.findall("warning"):
                warnings.append(
                    {
                        "msg": warn_el.get("msg") or "",
                        "level": warn_el.get("level") or "",
                        "error_code": warn_el.get("error_code") or "",
                    }
                )

            objects = []
            for obj_el in plate_el.findall("object"):
                identify_id = obj_el.get("identify_id")
                try:
                    identify_id_int = int(identify_id) if identify_id is not None else None
                except ValueError:
                    identify_id_int = None
                skipped_raw = (obj_el.get("skipped") or "").strip().lower()
                objects.append(
                    {
                        "identify_id": identify_id_int,
                        "name": obj_el.get("name") or "",
                        "skipped": skipped_raw == "true",
                    }
                )

            index_value = plate_meta.get("index")
            try:
                index_int = int(index_value) if index_value is not None else None
            except ValueError:
                index_int = None

            result["plates"].append(
                {
                    "index": index_int,
                    "metadata": plate_meta,
                    "filaments": filaments,
                    "warnings": warnings,
                    "objects": objects,
                }
            )

        return result

    except Exception as exc:
        logger.warning("Failed to parse slice_info.config: %s", exc)
        return result


def parse_gcode_header(printer_id: str, plate_path: Path) -> dict:
    """Parse HEADER_BLOCK and filament lines in the plate gcode."""
    summary: dict = {
        "estimated_time_s": None,
        "model_printing_time_s": None,
        "total_layer_number": None,
        "total_filament_weight_g": None,
        "filament_ids": [],
        "filament_settings": [],
    }

    if not plate_path.exists():
        logger.warning("Plate gcode file does not exist: %s", plate_path)
        return summary

    def _parse_time_to_seconds(text: str) -> int | None:
        pattern = r"(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?"
        m = re.search(pattern, text)
        if not m:
            return None
        h = int(m.group(1) or 0)
        m_ = int(m.group(2) or 0)
        s = int(m.group(3) or 0)
        return h * 3600 + m_ * 60 + s

    try:
        with plate_path.open("r", encoding="utf-8", errors="ignore") as f:
            lines = []
            for _ in range(300):
                line = f.readline()
                if not line:
                    break
                lines.append(line.rstrip("\n"))

        in_header = False
        for line in lines:
            stripped = line.strip()

            if "HEADER_BLOCK_START" in stripped:
                in_header = True
                continue
            if "HEADER_BLOCK_END" in stripped:
                in_header = False
                continue

            if in_header and stripped.startswith(";"):
                content = stripped.lstrip(";").strip()

                if content.startswith("model printing time:"):
                    parts = content.split(";")
                    if len(parts) >= 1 and "model printing time:" in parts[0]:
                        t_text = parts[0].split("model printing time:")[-1].strip()
                        summary["model_printing_time_s"] = _parse_time_to_seconds(t_text)
                    if len(parts) >= 2 and "total estimated time:" in parts[1]:
                        t_text = parts[1].split("total estimated time:")[-1].strip()
                        summary["estimated_time_s"] = _parse_time_to_seconds(t_text)

                elif content.startswith("total layer number:"):
                    try:
                        value = content.split("total layer number:")[-1].strip()
                        summary["total_layer_number"] = int(value)
                    except ValueError:
                        pass

                elif content.startswith("total filament weight"):
                    try:
                        value = content.split(":")[-1].strip()
                        summary["total_filament_weight_g"] = float(value)
                    except ValueError:
                        pass

            if stripped.startswith("; filament_ids"):
                try:
                    value = stripped.split("=", 1)[1].strip()
                    summary["filament_ids"] = [
                        part.strip() for part in value.split(";") if part.strip()
                    ]
                except Exception:
                    pass

            if stripped.startswith("; filament_settings_id"):
                try:
                    value = stripped.split("=", 1)[1].strip()
                    raw = value.strip()
                    if raw.startswith(";"):
                        raw = raw[1:].strip()
                    matches = re.findall(r'"([^\"]+)"', raw)
                    summary["filament_settings"] = matches
                except Exception:
                    pass

        return summary

    except Exception as exc:
        logger.warning("Failed to parse gcode header: %s", exc)
        return summary


def extract_plate_index_from_name(filename: str) -> int | None:
    if not filename:
        return None
    match = re.search(r"plate_(\d+)", filename)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return None
    return None


def parse_model_settings(printer_id: str, extract_dir: Path) -> dict:
    """Parse Metadata/model_settings.config for plate file mappings."""
    config_path = extract_dir / "Metadata" / "model_settings.config"
    result: dict = {"plates": []}

    if not config_path.exists():
        logger.warning("model_settings.config not found at %s", config_path)
        return result

    try:
        tree = ET.parse(config_path)
        root = tree.getroot()

        for plate_el in root.findall("plate"):
            plate_meta: dict[str, str] = {}
            for meta_el in plate_el.findall("metadata"):
                key = meta_el.get("key")
                value = meta_el.get("value")
                if key:
                    plate_meta[key] = value

            index_value = plate_meta.get("plater_id")
            try:
                index_int = int(index_value) if index_value is not None else None
            except ValueError:
                index_int = None

            result["plates"].append(
                {
                    "index": index_int,
                    "metadata": plate_meta,
                }
            )

        return result

    except Exception as exc:
        logger.warning("Failed to parse model_settings.config: %s", exc)
        return result
