import json
import re
import io
import zipfile
import shutil
import hashlib
from pathlib import Path
from urllib.request import urlopen, Request

# ==================================================
# PATHS
# ==================================================
BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data" / "filament"
CACHE_DIR = DATA_DIR / "cache"

DATA_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

OUT_FILE = DATA_DIR / "filaments_full.json"
VERSION_FILE = CACHE_DIR / ".repo_version"

# ==================================================
# SOURCE
# ==================================================
ZIP_URL = "https://github.com/bambulab/BambuStudio/archive/refs/heads/master.zip"
FILAMENT_PATH = "resources/profiles/BBL/filament/"


# ==================================================
# HELPERS
# ==================================================
def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def extract_setting_id(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("setting_id", "filament_settings_id") and isinstance(v, str):
                return v
            r = extract_setting_id(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = extract_setting_id(v)
            if r:
                return r
    return None


def extract_nozzle_range(obj):
    low, high = None, None
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "nozzle_temperature_range_low":
                low = int(v[0]) if isinstance(v, list) else int(v)
            elif k == "nozzle_temperature_range_high":
                high = int(v[0]) if isinstance(v, list) else int(v)
            else:
                r_low, r_high = extract_nozzle_range(v)
                low = low or r_low
                high = high or r_high
    elif isinstance(obj, list):
        for v in obj:
            r_low, r_high = extract_nozzle_range(v)
            low = low or r_low
            high = high or r_high
    return low, high


# ==================================================
# GITHUB CACHE
# ==================================================
def ensure_cache():
    print("[INFO] Checking GitHub ZIP content hash...")

    with urlopen(ZIP_URL, timeout=60) as r:
        zip_bytes = r.read()

    remote_hash = compute_sha256(zip_bytes)
    local_hash = VERSION_FILE.read_text().strip() if VERSION_FILE.exists() else None

    if local_hash == remote_hash and list(CACHE_DIR.rglob("*.json")):
        print("[CACHE] Up to date (SHA256 match).")
        return

    print("[CACHE] Updating cache (ZIP changed)...")
    for f in CACHE_DIR.glob("**/*.json"):
        f.unlink()

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for name in z.namelist():
            if name.endswith(".json") and FILAMENT_PATH in name:
                rel = Path(name).relative_to(f"BambuStudio-master/{FILAMENT_PATH}")
                target = CACHE_DIR / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(name) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)

    VERSION_FILE.write_text(remote_hash)
    print(f"[CACHE] Extracted {len(list(CACHE_DIR.rglob('*.json')))} JSON files.")


# ==================================================
# MAIN BUILD
# ==================================================
def main():
    ensure_cache()

    print("[INFO] Reading JSON profiles...")
    files = list(CACHE_DIR.rglob("*.json"))
    raw_profiles = {}
    for f in files:
        try:
            data = json.loads(f.read_text("utf-8"))
            name = data.get("name")
            if name:
                raw_profiles[name] = data
        except Exception as e:
            print(f"[WARN] Failed to load {f.name}: {e}")

    print(f"[INFO] Loaded {len(raw_profiles)} preset profiles.")

    def resolve(name, visited=None):
        if visited is None:
            visited = set()
        if name in visited:
            return {}
        visited.add(name)
        data = raw_profiles.get(name)
        if not data:
            return {}

        parent = data.get("inherits")
        resolved = {}
        if parent:
            resolved.update(resolve(parent, visited))
        resolved.update(data)
        return resolved

    output = {}
    print("[INFO] Resolving and grouping presets...")

    for name, base in raw_profiles.items():
        if base.get("instantiation", "true") == "false":
            continue

        resolved = resolve(name)
        if not resolved:
            continue

        alias = resolved.get("alias") or resolved.get("name")
        setting_id = extract_setting_id(resolved)
        nozzle_min, nozzle_max = extract_nozzle_range(resolved)
        filament_id = resolved.get("filament_id")
        filament_type = resolved.get("filament_type")
        compatible = resolved.get("compatible_printers", [])

        if not setting_id or not filament_id or not filament_type:
            continue

        variant = {
            "name": resolved.get("name"),
            "compatible_printers": compatible,
            "setting_id": setting_id,
            "tray_info_idx": filament_id,
            "tray_type": filament_type,
            "nozzle_temp_min": nozzle_min,
            "nozzle_temp_max": nozzle_max,
        }

        if alias not in output:
            output[alias] = {"alias": alias, "visible": True, "variants": []}

        output[alias]["variants"].append(variant)

    print(f"[INFO] Final alias groups: {len(output)}")

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)

    print(
        f"[DONE] JSON written: {OUT_FILE} ({sum(len(v['variants']) for v in output.values())} variants)"
    )


if __name__ == "__main__":
    main()
