import json
from pathlib import Path
from urllib.request import urlopen

# --------------------------------------------------
# PATHS
# tools/filament/filament_get.py -> project root
# --------------------------------------------------
BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data" / "filament"
DATA_DIR.mkdir(parents=True, exist_ok=True)

OUT_FILE = DATA_DIR / "filaments_merged.json"

BASE_URL = (
    "https://raw.githubusercontent.com/bambulab/BambuStudio/master/"
    "resources/profiles/BBL/filament"
)

URL_COLOR_CODES = f"{BASE_URL}/filaments_color_codes.json"

# --------------------------------------------------
# MATERIAL RULES
# --------------------------------------------------
MATERIAL_MAP = {
    "PLA": "PLA",
    "ABS": "ABS",
    "PETG": "PETG",
    "ASA": "ASA",
    "TPU": "TPU",
    "PC": "PC",
    "PA": "PA",
    "PET-CF": "PET",
    "PPS-CF": "PPS",
}


# --------------------------------------------------
# HELPERS
# --------------------------------------------------
def fetch_json(url: str) -> dict:
    with urlopen(url) as r:
        return json.loads(r.read().decode("utf-8"))


def infer_material(text: str) -> str:
    # Support her zaman öncelikli
    if "Support" in text or "PVA" in text:
        return "SUPPORT"

    for key, value in MATERIAL_MAP.items():
        if key in text:
            return value

    return "OTHER"


def clean_name(display_name: str, material: str) -> str:
    name = display_name.replace("Bambu", "").strip()

    if material and material not in ("OTHER", "SUPPORT"):
        name = name.replace(material, "").strip()

    name = name.replace("-CF", " CF").replace("-GF", " GF").replace("  ", " ").strip()

    return name if name else "Standard"


def normalize_hex(hex_color: str) -> str:
    return hex_color[:7].upper()


# --------------------------------------------------
# BUILD
# --------------------------------------------------
def build():
    raw = fetch_json(URL_COLOR_CODES)

    merged: dict[str, dict] = {}

    for item in raw.get("data", []):
        code = item.get("fila_id")
        fila_type = item.get("fila_type", "")

        if not code or not fila_type:
            continue

        display_name = f"Bambu {fila_type}"
        material = infer_material(fila_type)

        colors = [
            normalize_hex(c) for c in item.get("fila_color", []) if c.startswith("#")
        ]

        if code not in merged:
            merged[code] = {
                "code": code,
                "brand": "Bambu",
                "generic": False,
                "material": material,
                "name": clean_name(display_name, material),
                "display_name": display_name,
                "colors": [],
            }

        merged[code]["colors"].extend(colors)

    # deduplicate + sort colors
    for v in merged.values():
        v["colors"] = sorted(set(v["colors"]))

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    print(f"OK -> {OUT_FILE} ({len(merged)} items)")


if __name__ == "__main__":
    build()
