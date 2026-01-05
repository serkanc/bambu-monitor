# bambu-monitor

bambu-monitor is a web-based monitoring and management app for **Bambu Lab** 3D printers.
The project is developed and tested primarily with the **Bambu Lab A1** and is expected
to work with:
- **Bambu Lab A1 Mini**
- **Bambu Lab P1S**

Support for other Bambu Lab models can be added by extending the service and API layers.

---

## Features (Current)
- Local web UI (server-rendered HTML, CSS, JavaScript)
- FastAPI backend with async request handling
- Modular service architecture and clear separation of concerns
- Printer state, events, and print job flows
- File browser with upload/download and print actions
- Print setup modal with plate selection and metadata
- Print cache for prepared files and metadata

## Features (Planned / Intended)
- Real-time monitoring enhancements
- Camera preview and streaming improvements
- Filament and AMS management expansion
- Print history and automation tooling
- Wider device support

---

## Project Structure

```
bambu-monitor/
  app/
    api/        # API routes and dependencies
    services/   # Business logic
    core/       # Core configuration and helpers
    templates/  # Jinja2 HTML templates
    static/     # CSS and JavaScript files
  data/         # Runtime data (print-cache, etc.)
  main.py       # Application entry point
  app.json      # Application configuration
```

---

## Requirements
- Python **3.10+**
- pip

---

## Installation

### Windows
```powershell
git clone https://github.com/serkanc/bambu-monitor.git
cd bambu-monitor

python -m venv venv
venv\Scripts\activate

pip install -r requirements.txt
```

### Linux / macOS
```bash
git clone https://github.com/serkanc/bambu-monitor.git
cd bambu-monitor

python3 -m venv venv
source venv/bin/activate

pip install -r requirements.txt
```

---

## Running the Application

### Windows
```powershell
venv\Scripts\activate
python main.py
```

### Linux / macOS
```bash
source venv/bin/activate
python main.py
```

Open your browser:
```
http://localhost:5000
```

---

## Configuration

Settings are stored in `app.json`. You can configure:
- Printer IP, access code, serial, and model
- App host/port
- Tokens and auth settings

Example (trimmed):
```json
{
  "app_settings": {
    "host": "0.0.0.0",
    "port": 5000,
    "auth_enabled": true,
    "admin_allowlist": []
  },
  "printers": [
    {
      "id": "My Printer",
      "printer_ip": "192.168.1.50",
      "access_code": "00000000",
      "serial": "03919A3B0000000",
      "model": "Bambu Lab A1",
      "external_camera_url": null
    }
  ]
}
```

---


## External Camera (go2rtc)

go2rtc is optional and only needed if you set an external camera URL.
If you do not use an external camera, you can skip this.

Download go2rtc from:
https://github.com/AlexxIT/go2rtc/releases

Pick the build for your OS/CPU:
- Windows: download `go2rtc_windows_amd64.exe`
- macOS: download `go2rtc_darwin_amd64` or `go2rtc_darwin_arm64`
- Linux x86_64: download `go2rtc_linux_amd64`
- Raspberry Pi (ARM): download `go2rtc_linux_arm` (or arm64 if needed)

Place the binary at `bin/go2rtc` (rename if needed), or set `go2rtc_path` in `app.json`:
```json
{
  "app_settings": {
    "go2rtc_path": "bin/go2rtc_linux_arm"
  }
}
```

If the binary is missing, the app will log a warning and simply disable the external camera.

## Security & Auth
- Admin login is required to access settings.
- Admin allowlist can restrict access to specific IPs.
- Rotate tokens in the settings panel if a credential is exposed.

---

## Troubleshooting
- Can’t connect: verify printer IP, access code, and network.
- No data in UI: check printer selection and online status.
- Upload fails: only `.3mf` and `.gcode` are accepted.

---

## Supported Printers
- Bambu Lab A1 (primary target)
- Bambu Lab A1 Mini (expected to work)
- Bambu Lab P1S (expected to work)

---

## AI Notice
This repository was created with AI-assisted development and reviewed by a human developer.

---

## License
MIT
