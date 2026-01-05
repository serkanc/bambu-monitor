"""Download HMS tables from BambuStudio GitHub repo."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen

BASE_URL = "https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/hms"
INDEX_URL = "https://api.github.com/repos/bambulab/BambuStudio/contents/resources/hms"
DEFAULT_FILES = (
    "hms_en_22E.json",
    "hms_en_31B.json",
    "hms_en_093.json",
    "hms_en_094.json",
    "hms_en_239.json",
)


def download_file(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "bambu-monitor/1.0"})
    with urlopen(request, timeout=20) as response:
        return response.read()


def list_hms_files() -> list[str]:
    request = Request(INDEX_URL, headers={"User-Agent": "bambu-monitor/1.0"})
    with urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    names = [item.get("name", "") for item in payload if isinstance(item, dict)]
    return sorted(name for name in names if name.startswith("hms_en_") and name.endswith(".json"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Download HMS json files.")
    parser.add_argument(
        "--output",
        default=str(Path(__file__).resolve().parents[2] / "data" / "hms" / "data"),
        help="Output directory for hms_en_*.json files",
    )
    parser.add_argument(
        "--files",
        nargs="*",
        default=None,
        help="Optional list of filenames to download",
    )
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.files:
        files = list(args.files)
    else:
        try:
            files = list_hms_files()
        except Exception:
            files = list(DEFAULT_FILES)

    if not files:
        raise SystemExit("No HMS files resolved")

    for filename in files:
        url = f"{BASE_URL}/{filename}"
        payload = download_file(url)
        # Validate JSON before writing
        json.loads(payload.decode("utf-8"))
        (output_dir / filename).write_bytes(payload)
        print(f"Downloaded {filename}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
