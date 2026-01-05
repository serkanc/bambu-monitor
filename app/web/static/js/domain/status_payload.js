import { adaptStatusPayload } from './status_adapter.js';

const normalizeChamberLight = (value) => (value === 'on' ? 'on' : 'off');

const buildExternalSpoolFromPrint = (vtTray) => {
    if (!vtTray || typeof vtTray !== 'object') {
        return null;
    }
    const toInt = (value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
    const toColor = (value) => {
        if (!value) {
            return '000000FF';
        }
        const raw = String(value).replace(/^#/, '');
        if (/^[0-9A-Fa-f]{8}$/.test(raw)) {
            return raw;
        }
        if (/^[0-9A-Fa-f]{6}$/.test(raw)) {
            return `${raw}FF`;
        }
        return '000000FF';
    };
    return {
        id: vtTray.id ?? 0,
        color: toColor(vtTray.color),
        remain: toInt(vtTray.remain, 0),
        tray_info_idx: vtTray.tray_info_idx ?? '',
        material: vtTray.material ?? vtTray.tray_type ?? '',
        tray_type: vtTray.tray_type ?? '',
        nozzle_min: vtTray.nozzle_temp_min ?? vtTray.nozzle_min ?? '?',
        nozzle_max: vtTray.nozzle_temp_max ?? vtTray.nozzle_max ?? '?',
    };
};

const applyStatusPayload = (store, payload) => {
    if (!store) {
        return;
    }
    const normalized = adaptStatusPayload(payload);
    const printData = normalized.print || {};
    const online = Boolean(normalized.printer_online);
    const ftpStatus = normalized.ftps_status;
    const amsPayload = normalized.ams || null;
    const capabilities = normalized.capabilities || null;
    const cameraStatus = normalized.camera_status;
    const cameraStatusReason = normalized.camera_status_reason;
    const go2rtcRunning = normalized.go2rtc_running;
    const serverInfo = normalized.server_info;
    const lastSentProjectFile = normalized.last_sent_project_file;

    store.setCapabilities?.(capabilities);
    store.updateOnlineStatus?.(online);
    if (ftpStatus !== undefined) {
        store.setFtpStatus?.(ftpStatus);
    }
    store.updatePrintStatus?.(printData, normalized.updated_at);
    store.setHMSErrors?.(printData.hms_errors || []);
    store.setPrinterData?.(printData);
    store.setAmsData?.(amsPayload);

    const vtSpool = buildExternalSpoolFromPrint(printData?.vt_tray);
    const storeSpool =
        typeof store.getExternalSpool === 'function'
            ? store.getExternalSpool()
            : null;
    const externalSpool = amsPayload?.external_spool || vtSpool || storeSpool;
    store.setExternalSpoolData?.(externalSpool);

    if (printData?.chamber_light !== undefined) {
        const mode = normalizeChamberLight(printData.chamber_light);
        store.setControlsBaseValue?.('chamberLight', mode);
        store.setStatusPanelBaseValue?.('chamberLight', mode);
    }

    if (printData?.speed_level !== undefined || printData?.spd_lvl !== undefined) {
        const speedLevel = printData.speed_level ?? printData.spd_lvl;
        store.setControlsBaseValue?.('speedLevel', speedLevel);
    }

    if (Array.isArray(printData?.feature_toggles)) {
        printData.feature_toggles.forEach((entry) => {
            if (!entry || !entry.key) {
                return;
            }
            store.setFeatureToggleBase?.(entry.key, Boolean(entry.enabled));
        });
    }

    if (cameraStatus !== undefined) {
        store.setCameraStatus?.(cameraStatus);
    }
    if (cameraStatusReason !== undefined) {
        store.setCameraStatusReason?.(cameraStatusReason);
    }
    if (go2rtcRunning !== undefined) {
        store.setGo2rtcRunning?.(go2rtcRunning);
    }
    if (serverInfo !== undefined) {
        store.setServerInfo?.(serverInfo);
    }
    if (lastSentProjectFile !== undefined) {
        store.setLastSentProjectFile?.(lastSentProjectFile);
    }
};

export { adaptStatusPayload, normalizeChamberLight, buildExternalSpoolFromPrint, applyStatusPayload };
export default applyStatusPayload;
