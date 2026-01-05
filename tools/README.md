# Tools

This folder contains one-off helper scripts used to generate data files
consumed by the backend and frontend.

## Filament Tools

Scripts:
- `filament_get.py`
- `filament_get_extended.py`

Outputs:
- `data/filament/` (filament metadata snapshots used by UI)

How it works:
- Scripts fetch and normalize filament data.
- Output files are written under `data/filament/`.
- If output looks stale, rerun the script.

## HMS Data

Scripts:
- `hms/get_hms_codes.py`

Outputs:
- `data/hms/data/hms_en_*.json`

How it works:
- Script downloads official HMS tables from BambuStudio GitHub.
- Output files are written under `data/hms/data/`.
- If output looks stale, rerun the script.

