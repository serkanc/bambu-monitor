import createPrintErrorModal from './status_panel/print_error_modal.js';
import createAmsPanel from './status_panel/ams_panel.js';
import createFeaturePanel from './status_panel/feature_panel.js';
import createNozzleModal from './status_panel/nozzle_modal.js';
import createAmsMaterialModal from './status_panel/ams_material_modal.js';
import createCustomFilamentModal from './status_panel/custom_filament_modal.js';

const globalObject =
    typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : {};
const statusPanelApi = {
    resetCache: () => {},
};

const initStatusPanel = () => {
    if (typeof document === 'undefined') {
        return statusPanelApi;
    }
    const global = globalObject;
    const appContext = global.appContext || (global.appContext = {});
    appContext.components = appContext.components || {};
    appContext.components.statusPanel = statusPanelApi;
    const masterStore = appContext.stores?.core || null;
    const domUtils = appContext.utils || {};
    const masterUtils = domUtils;
    const services = appContext.services || {};
    const selectors = appContext.selectors || {};
    const showToast =
        domUtils.dom && typeof domUtils.dom.showToast === 'function'
            ? domUtils.dom.showToast
            : (message) => console.log(message);

    const statusConstants = masterStore?.constants?.status || {};
    const defaultStateLabels = {
        FINISH: 'Finished',
        SLICING: 'Slicing',
        RUNNING: 'Running',
        PAUSE: 'Paused',
        INIT: 'Initializing',
        FAILED: 'Failed',
        IDLE: 'Idle',
        UNKNOWN: 'Unknown',
    };
    const stateLabels = statusConstants.labels || defaultStateLabels;
    const unknownStateCode = statusConstants.codes?.UNKNOWN || 'UNKNOWN';
    const getStateLabel = (value) => {
        if (!value) {
            return '-';
        }
        const key = String(value).toUpperCase();
        return stateLabels[key] || defaultStateLabels[key] || key;
    };
    const busyStates =
        statusConstants.busyStates || ['RUNNING', 'SLICING', 'PAUSE', 'PREPARE', 'INIT'];
    const printerBusyStateSet = new Set(
        busyStates.map((value) =>
            typeof value === 'string' ? value.toUpperCase() : value,
        ),
    );
    const cameraLightToggle = document.getElementById('camera-light-toggle');
    const stageTooltipList = document.getElementById('print-stage-list');
    const printStageTooltip = document.getElementById('print-stage-tooltip');
    const timelapseToggle = document.getElementById('status-timelapse-toggle');
    const printAgainButton = document.getElementById('print-again-btn');
    const getSnapshot = () => (typeof masterStore?.getState === 'function' ? masterStore.getState() : {});
    const getUiState = () => getSnapshot().ui?.statusPanel || {};
    const setUiState = (partial) => masterStore?.setStatusPanelUiState?.(partial);
    const getPrintErrorState = () => {
        const ui = getUiState();
        return {
            lastDisplayed: ui.lastDisplayedPrintErrorCode ?? null,
            lastAcknowledged: ui.lastAcknowledgedPrintErrorCode ?? null,
        };
    };
    const setPrintErrorState = (partial) => setUiState(partial);
    const getCapabilities = () => getSnapshot().capabilities || {};
    const getPrintStatus = () => getSnapshot().printStatus || {};
    const getOnlineStatus = () => Boolean(getSnapshot().online);
    const getAmsData = () => getSnapshot().ams || null;
    const getExternalSpool = () => getSnapshot().externalSpool || null;

    const actionModule = appContext.actions?.statusPanel;
    const statusService = services.status;
    const apiService = services.api || null;
    const statusPanelActions = {
        toggleFeature:
            actionModule?.toggleFeature ||
            statusService?.toggleFeature?.bind(statusService),
        triggerAmsCommand:
            actionModule?.triggerAmsCommand ||
            statusService?.triggerAmsCommand?.bind(statusService),
        toggleChamberLight:
            actionModule?.toggleChamberLight ||
            statusService?.toggleChamberLight?.bind(statusService),
        setNozzleAccessory:
            actionModule?.setNozzleAccessory ||
            statusService?.setNozzleAccessory?.bind(statusService),
        setAmsMaterial:
            actionModule?.setAmsMaterial ||
            statusService?.setAmsMaterial?.bind(statusService),
    };
    const printSetupActions = appContext.actions?.printSetup || null;

    const printErrorModal = createPrintErrorModal({
        documentRef: document,
        getPrintErrorState,
        setPrintErrorState,
    });
    const featurePanel = createFeaturePanel({
        documentRef: document,
        actions: { statusPanel: statusPanelActions },
        selectors,
        masterStore,
        showToast,
        getSnapshot,
    });
    const amsPanel = createAmsPanel({
        documentRef: document,
        actions: { statusPanel: statusPanelActions },
        selectors,
        showToast,
        getSnapshot,
        getUiState,
        setUiState,
        printerBusyStateSet,
    });
    const uiActions = appContext.actions?.ui;
    const amsMaterialModal = createAmsMaterialModal({
        documentRef: document,
        selectors,
        getSnapshot,
        showToast,
        uiActions,
        filamentActions: appContext.actions?.filamentCatalog || null,
    });
    const customFilamentModal = createCustomFilamentModal({
        documentRef: document,
        actions: appContext.actions || {},
        showToast,
        uiActions,
    });
    const nozzleModal = createNozzleModal({
        documentRef: document,
        actions: { statusPanel: statusPanelActions },
        showToast,
        getSnapshot,
        uiActions,
    });

    const normalizeTrayColor = (value) => {
        if (!value) {
            return null;
        }
        const raw = String(value).trim().replace('#', '');
        if (/^[0-9a-fA-F]{6}$/.test(raw)) {
            return `${raw}FF`.toUpperCase();
        }
        if (/^[0-9a-fA-F]{8}$/.test(raw)) {
            return raw.toUpperCase();
        }
        return null;
    };

    const getGlobalSlotId = (amsId, trayId) => {
        const amsValue = Number(amsId);
        const trayValue = Number(trayId);
        if (!Number.isFinite(amsValue) || !Number.isFinite(trayValue)) {
            return null;
        }
        return amsValue * 4 + trayValue;
    };

    const resolveSlotIds = (slot) => {
        if (slot?.slotKind === 'external') {
            return {
                amsId: 0,
                trayId: 254,
                slotId: 254,
            };
        }
        const amsId = Number(slot?.amsId);
        const trayId = Number(slot?.slotId);
        if (!Number.isFinite(amsId) || !Number.isFinite(trayId)) {
            return null;
        }
        const slotId = getGlobalSlotId(amsId, trayId);
        if (slotId === null) {
            return null;
        }
        return { amsId, trayId, slotId };
    };

    const handleAmsMaterialConfirm = async (event) => {
        const detail = event?.detail || {};
        const slot = detail.slot || {};
        const slotIds = resolveSlotIds(slot);
        if (!slotIds) {
            showToast('AMS slot info is invalid.', 'error');
            return;
        }
        const { amsId, trayId, slotId } = slotIds;
        const filament = detail.filament || {};
        const trayInfoIdx = filament.tray_info_idx || '';
        if (!trayInfoIdx) {
            showToast('Filament data is incomplete.', 'error');
            return;
        }
        const settingId = filament.setting_id || trayInfoIdx;
        const trayColor = normalizeTrayColor(detail.color);
        if (!trayColor) {
            showToast('Color selection is invalid.', 'error');
            return;
        }
        const nozzleMin = Number(filament.nozzle_temp_min);
        const nozzleMax = Number(filament.nozzle_temp_max);
        if (!Number.isFinite(nozzleMin) || !Number.isFinite(nozzleMax)) {
            showToast('Nozzle temperature values are missing.', 'error');
            return;
        }
        const action = statusPanelActions?.setAmsMaterial;
        if (typeof action !== 'function') {
            showToast('AMS settings cannot be sent.', 'error');
            return;
        }
        try {
            await action({
                ams_id: amsId,
                slot_id: slotId,
                tray_id: trayId,
                setting_id: settingId,
                tray_info_idx: trayInfoIdx,
                tray_type: filament.tray_type,
                nozzle_temp_min: Math.round(nozzleMin),
                nozzle_temp_max: Math.round(nozzleMax),
                tray_color: trayColor,
            });
            showToast('AMS filament settings sent.', 'success');
        } catch (error) {
            console.error('AMS material update failed', error);
            showToast(error?.message || 'Failed to send AMS filament settings.', 'error');
        }
    };

    const escapeHtml =
        masterUtils.format?.escapeHtml ||
        ((text) => {
            const element = document.createElement('div');
            element.textContent = text ?? '';
            return element.innerHTML;
        });
    const escapeAttribute =
        masterUtils.format?.escapeAttribute ||
        ((value) => {
            const raw = value === undefined || value === null ? '' : String(value);
            return raw
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        });

    const formatTemperature = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) {
            return value ?? '-';
        }
        if (num >= 100 || Number.isInteger(num)) {
            return num.toFixed(0);
        }
        return num.toFixed(1);
    };

    const formatDegC = (value) => `${formatTemperature(value)}\u00B0C`;
    const formatNozzleTypeLabel = (value) => {
        if (!value) {
            return '-';
        }
        const key = String(value).toLowerCase();
        if (key === 'stainless_steel') {
            return 'Stainless Steel';
        }
        if (key === 'hardened_steel') {
            return 'Hardened Steel';
        }
        return value;
    };


    const writeText = (elementId, value) => {
        const element = document.getElementById(elementId);
        if (!element) {
            return;
        }
        const newValue = value ?? '-';
        if (element.textContent === newValue) {
            return;
        }
        element.textContent = newValue;
    };

    const formatCameraStatusLabel = (value, fallback = '-') => {
        if (!value) {
            return fallback;
        }
        const normalized = String(value).replace(/_/g, ' ').trim();
        if (!normalized) {
            return fallback;
        }
        return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).toLowerCase()}`;
    };

    const formatFtpStatusLabel = (value, fallback = '-') => {
        if (value === null || value === undefined) {
            return fallback;
        }
        const normalized = String(value).replace(/_/g, ' ').trim();
        if (!normalized) {
            return fallback;
        }
        const lowerCased = normalized.toLowerCase();
        return `${lowerCased.charAt(0).toUpperCase()}${lowerCased.slice(1)}`;
    };

    const serverStartDateFormatter =
        typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
            ? new Intl.DateTimeFormat('tr-TR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
              })
            : null;

    const formatServerStartTooltip = (isoString) => {
        if (!isoString) {
            return '';
        }
        const parsed = new Date(isoString);
        if (!Number.isFinite(parsed.getTime())) {
            return '';
        }
        const formatted = serverStartDateFormatter
            ? serverStartDateFormatter.format(parsed)
            : parsed.toLocaleString();
        return `Started: ${formatted}`;
    };

    const formatRemainingTimeLabel = (minutes) => {
        const numeric = Number(minutes);
        if (!Number.isFinite(numeric)) {
            return '-';
        }
        const totalMinutes = Math.max(0, Math.round(numeric));
        const days = Math.floor(totalMinutes / 1440);
        const remainder = totalMinutes % 1440;
        const hours = Math.floor(remainder / 60);
        const mins = remainder % 60;
        const formatUnit = (value, singular) =>
            `${value} ${singular}${value !== 1 ? 's' : ''}`;
        if (days) {
            const parts = [];
            if (hours) {
                parts.push(formatUnit(hours, 'hour'));
            }
            if (mins) {
                parts.push(formatUnit(mins, 'minute'));
            }
            if (parts.length) {
                return `${formatUnit(days, 'day')}, ${parts.join(' ')}`;
            }
            return formatUnit(days, 'day');
        }
        if (hours) {
            return `${formatUnit(hours, 'hour')} ${formatUnit(mins, 'minute')}`;
        }
        return `${formatUnit(mins, 'minute')}`;
    };

    const updateServerStatus = (snapshot) => {
        const ftpValue = formatFtpStatusLabel(snapshot?.ftpStatus, 'Disconnected');
        writeText('server-status-ftp', ftpValue);

        const cameraValue = formatCameraStatusLabel(snapshot?.cameraStatus, 'Stopped');
        writeText('server-status-camera', cameraValue);
        const cameraElement = document.getElementById('server-status-camera');
        if (cameraElement) {
            const reason = snapshot?.cameraStatusReason ?? '';
            if (reason) {
                cameraElement.setAttribute('title', reason);
            } else {
                cameraElement.removeAttribute('title');
            }
        }

        const go2rtcState = snapshot?.go2rtcRunning;
        const go2rtcLabel =
            go2rtcState === null
                ? 'Unknown'
                : go2rtcState
                    ? 'Running'
                    : 'Stopped';
        writeText('server-status-go2rtc', go2rtcLabel);

        const serverInfo = snapshot?.serverInfo || {};
        writeText('server-status-uptime', serverInfo?.uptime ?? '-');
        const uptimeElement = document.getElementById('server-status-uptime');
        if (uptimeElement) {
            const tooltip = formatServerStartTooltip(serverInfo?.start_time);
            if (tooltip) {
                uptimeElement.setAttribute('title', tooltip);
            } else {
                uptimeElement.removeAttribute('title');
            }
        }
    };

    const setFeatureVisibility = (featureName, visible) => {
        document.querySelectorAll(`[data-feature="${featureName}"]`).forEach((element) => {
            if (!Object.prototype.hasOwnProperty.call(element.dataset, 'featureOriginalDisplay')) {
                element.dataset.featureOriginalDisplay = element.style.display || '';
            }
            element.hidden = !visible;
            element.setAttribute('aria-hidden', visible ? 'false' : 'true');
            element.style.display = visible
                ? element.dataset.featureOriginalDisplay || ''
                : 'none';
        });
    };

    const applyFeatureVisibility = (features) => {
        if (!features || typeof features !== 'object') {
            return;
        }
        Object.keys(features).forEach((featureName) => {
            setFeatureVisibility(featureName, Boolean(features[featureName]));
        });
    };

    const hasFieldCapability = (capabilityObj, section, key) => {
        if (!section || !key) {
            return true;
        }
        const sectionFields = capabilityObj?.fields?.[section];
        if (!sectionFields) {
            return true;
        }
        if (!Object.prototype.hasOwnProperty.call(sectionFields, key)) {
            return true;
        }
        return sectionFields[key] !== false;
    };

    const hasPrinterCapability = (section, key) => {
        if (typeof masterStore?.hasCapability === 'function') {
            return masterStore.hasCapability(section, key);
        }
        return hasFieldCapability(getCapabilities(), section, key);
    };

    const hasAmsCapability = (unit, section, key) => hasFieldCapability(unit?.capabilities, section, key);

    const updatePrintError = (error) => {
        const container = document.getElementById('print-error');
        if (container) {
            container.innerHTML = '';
            container.style.display = 'none';
        }
        printErrorModal.updatePrintError(error);
    };

    const updateHMSErrors = (errors) => {
        const container = document.getElementById('hms-errors');
        if (!container) return;

        if (!Array.isArray(errors) || errors.length === 0) {
            container.innerHTML = '<div class="hms-empty">No HMS errors</div>';
            return;
        }

        container.innerHTML = `
            <p><b>HMS Records</b></p>
            ${errors
                .map(
                    (entry) => `
                <div class="hms-error">
                    <b>${escapeHtml(entry.code)}</b><br/>
                    ${escapeHtml(entry.description || '')}
                    ${
                        entry.timestamp && entry.timestamp !== '-'
                            ? `<div class="hms-ts">${escapeHtml(entry.timestamp)}</div>`
                            : ''
                    }
                </div>
            `,
                )
                .join('')}
        `;
    };

    const updateStatusIndicator = (isOnline) => {
        const indicator = document.getElementById('status-indicator');
        if (!indicator) {
            return;
        }

        indicator.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
        indicator.className = isOnline ? 'status-online' : 'status-offline';
    };

    const resolveChamberLightMode = (snapshot) => {
        if (selectors.statusPanel?.getChamberLight) {
            return selectors.statusPanel.getChamberLight(snapshot, Date.now());
        }
        const printStatus = snapshot?.printStatus || {};
        return printStatus.chamber_light === 'on' ? 'on' : 'off';
    };

    const updateCameraLightToggle = (snapshot) => {
        if (!cameraLightToggle) {
            return;
        }
        const safeSnapshot = snapshot || getSnapshot();
        const mode = resolveChamberLightMode(safeSnapshot) === 'on' ? 'on' : 'off';
        const isOnline = Boolean(safeSnapshot?.online);
        cameraLightToggle.classList.toggle('is-active', mode === 'on');
        cameraLightToggle.setAttribute('aria-pressed', mode === 'on' ? 'true' : 'false');
        cameraLightToggle.setAttribute(
            'aria-label',
            mode === 'on' ? 'Turn chamber light off' : 'Turn chamber light on',
        );
        cameraLightToggle.disabled = !isOnline;
    };

    const updateTimelapseToggle = (enabled) => {
        if (!timelapseToggle) {
            return;
        }
        const isOn = Boolean(enabled);
        timelapseToggle.classList.toggle('is-on', isOn);
        timelapseToggle.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        const label = timelapseToggle.querySelector('.status-toggle-label');
        if (label) {
            label.textContent = isOn ? 'On' : 'Off';
        }
    };

    let printAgainPayload = null;

    const handlePrintAgain = async () => {
        const snapshot = getSnapshot();
        if (!printAgainPayload) {
            showToast('Print command not available.', 'error');
            return;
        }
        if (!snapshot?.online) {
            showToast('Printer must be online to print again.', 'error');
            return;
        }
        const sender = printSetupActions?.executePrint || apiService?.request;
        if (typeof sender !== 'function') {
            showToast('API client unavailable.', 'error');
            return;
        }
        if (printAgainButton) {
            printAgainButton.disabled = true;
        }
        try {
            if (printSetupActions?.executePrint) {
                await printSetupActions.executePrint(printAgainPayload);
            } else {
                await apiService.request('/api/printjob/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(printAgainPayload),
                });
            }
            showToast('Print command sent.', 'success');
        } catch (error) {
            console.error('Print again failed', error);
            showToast(error?.message || 'Failed to send print command.', 'error');
        } finally {
            const nextSnapshot = getSnapshot();
            updatePrinterDetails(nextSnapshot);
        }
    };

    const toggleCameraLight = async () => {
        const snapshot = getSnapshot();
        if (!cameraLightToggle || typeof statusPanelActions?.toggleChamberLight !== 'function') {
            return;
        }
        if (!snapshot?.online) {
            showToast('Printer must be online to toggle chamber light', 'error');
            return;
        }
        const currentMode = resolveChamberLightMode(snapshot);
        const nextMode = currentMode === 'on' ? 'off' : 'on';
        masterStore?.setStatusPanelPendingValue?.('chamberLight', nextMode, 5000);
        updateCameraLightToggle(getSnapshot());
        cameraLightToggle.disabled = true;
        try {
            await statusPanelActions.toggleChamberLight(nextMode);
            showToast(`Chamber light ${nextMode === 'on' ? 'turned on' : 'turned off'}.`, 'success');
        } catch (error) {
            showToast('Failed to toggle chamber light', 'error');
            masterStore?.clearStatusPanelPending?.('chamberLight');
            updateCameraLightToggle(getSnapshot());
        } finally {
            cameraLightToggle.disabled = !getSnapshot()?.online;
        }
    };

    const updatePrintProgress = (percentValue) => {
        const fill = document.getElementById('print-progress-fill');
        const safePercent = Number.isFinite(percentValue) ? Math.max(0, Math.min(percentValue, 100)) : 0;
        writeText('print-status-percent', `${Math.round(safePercent)}%`);
        if (fill) {
            fill.style.width = `${safePercent}%`;
        }
    };

    const updateStageTimeline = (labels, currentLabel) => {
        if (!stageTooltipList) {
            return;
        }
        const timelineEntries = Array.isArray(labels)
            ? labels.map((label) => (label === undefined || label === null ? '-' : String(label)))
            : [];
        const highlightLabel =
            currentLabel && currentLabel !== '-' ? String(currentLabel) : null;
        if (!timelineEntries.length && !highlightLabel) {
            stageTooltipList.innerHTML = '<div class="print-stage-tooltip-row">No data</div>';
            return;
        }
        const highlightIndex = highlightLabel ? timelineEntries.lastIndexOf(highlightLabel) : -1;
        const rows = timelineEntries.map((entry, index) => {
            const classes = ['print-stage-tooltip-row'];
            if (highlightIndex !== -1 && index === highlightIndex) {
                classes.push('is-current');
            }
            return `<div class="${classes.join(' ')}">${escapeHtml(entry)}</div>`;
        });
        if (highlightIndex === -1 && highlightLabel) {
            rows.push(
                `<div class="print-stage-tooltip-row is-current"><strong>${escapeHtml(
                    highlightLabel,
                )}</strong></div>`,
            );
        }
        stageTooltipList.innerHTML = rows.join('');
    };

    const formatBooleanLabel = (value, truthy = 'On', falsy = 'Off') =>
        value ? truthy : falsy;

    const formatPrintTypeLabel = (value) => {
        if (!value) {
            return '-';
        }
        const normalized = String(value).toLowerCase();
        return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
    };

    const defaultSpeedLabels = {
        '1': 'Silent',
        '2': 'Standard',
        '3': 'Sport',
        '4': 'Ludicrous',
    };

    const getSpeedLabels = () => masterStore?.constants?.speedModes?.levelToLabel || defaultSpeedLabels;

    const formatSpeedLevel = (value) => {
        if (value === undefined || value === null || value === '') {
            return '-';
        }
        const labels = getSpeedLabels();
        const key = String(value);
        return labels[key] ?? key;
    };

    const updatePrinterDetails = (snapshot) => {
        const printStatus = snapshot?.printStatus || {};
        const featureVisibility = {
            'print.chamber_temp': hasPrinterCapability('print', 'chamber_temp'),
            'print.fan_gear': hasPrinterCapability('print', 'fan_gear'),
        };
        applyFeatureVisibility(featureVisibility);
        const showChamberTemp = featureVisibility['print.chamber_temp'];
        const showFanGear = featureVisibility['print.fan_gear'];
        const gcodeRaw = printStatus.gcode_state ?? unknownStateCode;
        const gcodeKey = typeof gcodeRaw === 'string' ? gcodeRaw.toUpperCase() : gcodeRaw;
        const isRunning = gcodeKey === 'RUNNING';
        const isPreparing = gcodeKey === 'PREPARE';
        writeText('print-status-state', getStateLabel(gcodeRaw));

        writeText('print-status-file', printStatus.gcode_file || '-');

        const stageLabels = Array.isArray(printStatus.stage_labels) ? printStatus.stage_labels : [];
        const stageCurrentLabel = printStatus.stage_current_label ?? '-';
        const preparePercent = printStatus.gcode_file_prepare_percent ?? null;
        const preparePercentLabel =
            typeof preparePercent === 'number' && !Number.isNaN(preparePercent) ? ` %${preparePercent}` : '';
        const printStatusLabel = isRunning
            ? stageCurrentLabel || '-'
            : isPreparing
                ? `Preparing${preparePercentLabel}`
                : 'Idle';
        writeText('print-stage-current', printStatusLabel);
        if (isRunning) {
            updateStageTimeline(stageLabels, stageCurrentLabel);
        } else if (stageTooltipList) {
            stageTooltipList.innerHTML = '';
        }
        if (printStageTooltip) {
            printStageTooltip.style.display = isRunning ? '' : 'none';
        }
        writeText('printer-firmware-value', printStatus.firmware || '-');

        const percent = Number(printStatus.percent) || 0;
        updatePrintProgress(percent);

        writeText('print-status-layer', printStatus.layer || '0/0');

        const remainingLabel = formatRemainingTimeLabel(printStatus.remaining_time ?? 0);
        writeText('print-status-remaining', remainingLabel);

        writeText('print-status-finish', printStatus.finish_time || '-');

        const nozzleTemp = printStatus.nozzle_temp ?? 0;
        const nozzleTarget = printStatus.nozzle_target ?? nozzleTemp;
        writeText('status-nozzle-info', `${formatDegC(nozzleTemp)} / ${formatDegC(nozzleTarget)}`);

        const bedTemp = printStatus.bed_temp ?? 0;
        const bedTarget = printStatus.bed_target ?? bedTemp;
        writeText('status-bed-info', `${formatDegC(bedTemp)} / ${formatDegC(bedTarget)}`);

        const chamberTemp = printStatus.chamber_temp ?? 0;
        if (showChamberTemp) {
            writeText('status-chamber-temp', formatDegC(chamberTemp));
        }

        const fanGear = printStatus.fan_gear ?? 0;
        if (showFanGear) {
            writeText('status-fan-gear', fanGear);
        }

        writeText('status-heatbreak-fan', printStatus.heatbreak_fan_speed ?? '-');
        writeText('status-cooling-fan', printStatus.cooling_fan_speed ?? '-');

        const effectiveChamberLight = selectors.statusPanel?.getChamberLight
            ? selectors.statusPanel.getChamberLight(snapshot, Date.now())
            : printStatus.chamber_light === 'on'
                ? 'on'
                : 'off';
        writeText('status-chamber-light', formatBooleanLabel(effectiveChamberLight === 'on', 'On', 'Off'));
        updateCameraLightToggle(snapshot);

        const speedLevel = printStatus.speed_level ?? '-';
        const speedMagnitude = printStatus.speed_magnitude ?? '-';
        const speedLabel =
            speedMagnitude !== '-' && speedMagnitude !== null && speedMagnitude !== undefined
                ? `${formatSpeedLevel(speedLevel)} (${speedMagnitude}%)`
                : formatSpeedLevel(speedLevel);
        writeText('print-status-speed-mode', speedLabel);
        updateTimelapseToggle(printStatus.timelapse_enabled);
        writeText('print-status-type', formatPrintTypeLabel(printStatus.print_type));
        if (printAgainButton) {
            const printAgainState = printStatus.print_again || {};
            printAgainPayload = printAgainState.visible ? printAgainState.payload ?? null : null;
            printAgainButton.hidden = !printAgainState.visible;
            printAgainButton.disabled = !printAgainState.enabled;
        } else {
            printAgainPayload = null;
        }

        writeText('hardware-nozzle-type', formatNozzleTypeLabel(printStatus.nozzle_type));
        writeText('hardware-nozzle-diameter', printStatus.nozzle_diameter || '-');
        writeText('hardware-wifi-signal', printStatus.wifi_signal ?? '-');

        const sdcardState =
            typeof printStatus.sdcard_present === 'boolean'
                ? formatBooleanLabel(printStatus.sdcard_present, 'Present', 'Missing')
                : '-';
        writeText('hardware-sdcard', sdcardState);

        const homeFlagFeatures = Array.isArray(printStatus.home_flag_features)
            ? printStatus.home_flag_features
            : [];
        const featureToggles = Array.isArray(printStatus.feature_toggles)
            ? printStatus.feature_toggles
            : homeFlagFeatures;
        featurePanel.updateFeaturePanel(featureToggles, snapshot);
        featurePanel.updateAxisHomeIndicators(homeFlagFeatures);
        featurePanel.updateSdcardFeature(printStatus.sdcard_state ?? null);

        writeText('updated-at', printStatus.updated_at ?? snapshot?.updatedAt ?? '-');

        updatePrintError(printStatus.print_error || null);
        updateHMSErrors(snapshot?.hmsErrors || []);
        amsPanel.updateAmsActionButtons(snapshot);
    };

    const resetCache = () => {
        printErrorModal.resetCache();
    };

    let lastRenderKey = '';
    let lastTabKey = '';
    const buildRenderKey = (snapshot) => {
        const printStatus = snapshot?.printStatus || {};
        const online = snapshot?.online ? '1' : '0';
        const updatedAt = printStatus.updated_at ?? snapshot?.updatedAt ?? '';
        const gcodeState = printStatus.gcode_state ?? '';
        const percent = printStatus.percent ?? '';
        const stageLabel = printStatus.stage_current_label ?? '';
        const stageLabels = Array.isArray(printStatus.stage_labels)
            ? printStatus.stage_labels.join('|')
            : '';
        const errorCode = printStatus.print_error?.code ?? '';
        const hmsCount = Array.isArray(snapshot?.hmsErrors) ? snapshot.hmsErrors.length : 0;
        const amsUnits = Array.isArray(snapshot?.ams?.ams_units) ? snapshot.ams.ams_units : [];
        const amsSignature = amsUnits
            .map((unit) => {
                const trayKey = (unit?.trays || [])
                    .map((tray) => `${tray?.id ?? ''}:${tray?.color ?? ''}:${tray?.material ?? ''}:${tray?.remain ?? ''}`)
                    .join('|');
                return `${unit?.id ?? ''}:${trayKey}`;
            })
            .join('#');
        const amsRevision = [
            snapshot?.ams?.tray_now ?? '',
            snapshot?.ams?.tray_tar ?? '',
            snapshot?.ams?.active_tray_index ?? '',
            amsSignature,
        ].join('|');
        const lastSent = snapshot?.lastSentProjectFile || {};
        const lastSentFile = lastSent.file || lastSent.url || '';
        const printAgainState = snapshot?.printStatus?.print_again || {};
        const printAgainUrl = printAgainState.payload?.url || '';
        return [
            online,
            updatedAt,
            gcodeState,
            percent,
            stageLabel,
            stageLabels,
            errorCode,
            hmsCount,
            amsRevision,
            printAgainState.visible ? '1' : '0',
            printAgainState.enabled ? '1' : '0',
            printAgainUrl,
            lastSentFile,
        ].join('#');
    };

    const renderActivePrinterTab = (tabName) => {
        const nextTab = tabName || 'status';
        const buttons = document.querySelectorAll('.printer-tab');
        const panels = document.querySelectorAll('.printer-tab-panel');
        buttons.forEach((button) => {
            const isActive = button.dataset.tab === nextTab;
            button.classList.toggle('is-active', isActive);
        });
        panels.forEach((panel) => {
            const isActive = panel.dataset.panel === nextTab;
            panel.hidden = !isActive;
        });
    };

    const renderFromStore = (snapshot) => {
        if (!snapshot) {
            return;
        }
        updateServerStatus(snapshot);
        if (snapshot?.ui?.modalGate?.active) {
            return;
        }
        const nextKey = buildRenderKey(snapshot);
        if (nextKey !== lastRenderKey) {
            lastRenderKey = nextKey;
            updatePrinterDetails(snapshot);
            amsPanel.updateAMSInfo(snapshot);
            amsPanel.updateExternalSpool(getExternalSpool(), snapshot);
            amsPanel.bindAmsSlotInteractions();
            amsPanel.updateHardwareAmsStatus(getAmsData(), Boolean(snapshot.online));
            updateStatusIndicator(Boolean(snapshot.online));
        }
        const activeTab = selectors.statusPanel?.getActiveTab
            ? selectors.statusPanel.getActiveTab(snapshot)
            : getUiState().activeTab || 'status';
        if (activeTab !== lastTabKey) {
            lastTabKey = activeTab;
            renderActivePrinterTab(activeTab);
        }
    };

    let storeUnsubscribe = null;
    const subscribeToStore = () => {
        if (storeUnsubscribe || typeof masterStore?.subscribe !== 'function') {
            return;
        }
        storeUnsubscribe = masterStore.subscribe((snapshot) => renderFromStore(snapshot));
        const initialSnapshot = typeof masterStore.getState === 'function' ? masterStore.getState() : null;
        if (initialSnapshot) {
            renderFromStore(initialSnapshot);
        }
    };

    const setActivePrinterTab = (tabName) => {
        const nextTab = tabName || 'status';
        const currentTab = getUiState().activeTab || 'status';
        if (nextTab !== currentTab) {
            setUiState({ activeTab: nextTab });
        }
    };

    amsPanel.updateAmsActionButtons(getSnapshot());
    if (cameraLightToggle) {
        updateCameraLightToggle(getSnapshot());
    }

    const bindStatusPanelEvents = () => {
        printErrorModal.bindEvents();

        featurePanel.bindEvents();
        amsPanel.bindEvents();
        const nozzleTypeEl = document.getElementById('hardware-nozzle-type');
        const nozzleDiameterEl = document.getElementById('hardware-nozzle-diameter');
        [nozzleTypeEl, nozzleDiameterEl].forEach((element) => {
            if (!element) {
                return;
            }
            element.classList.add('hardware-clickable');
            element.setAttribute('role', 'button');
            element.setAttribute('tabindex', '0');
            element.addEventListener('click', () => nozzleModal.open());
            element.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    nozzleModal.open();
                }
            });
        });
        if (cameraLightToggle) {
            cameraLightToggle.addEventListener('click', toggleCameraLight);
        }
        if (printAgainButton) {
            printAgainButton.addEventListener('click', handlePrintAgain);
        }

        const buttons = document.querySelectorAll('.printer-tab');
        if (!buttons.length) {
            return;
        }
        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                const tabName = button.dataset.tab || 'status';
                setActivePrinterTab(tabName);
            });
        });
        const currentTab = selectors.statusPanel?.getActiveTab
            ? selectors.statusPanel.getActiveTab(getSnapshot())
            : getUiState().activeTab || 'status';
        setActivePrinterTab(currentTab);
    };

    const bindStatusPanelDocumentEvents = () => {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                bindStatusPanelEvents();
                subscribeToStore();
                amsMaterialModal.bindDocumentEvents();
                global.addEventListener('ams-material-confirm', handleAmsMaterialConfirm);
                global.addEventListener('ams-custom-filament', (event) => {
                    customFilamentModal.open(event?.detail?.slot);
                });
                global.addEventListener('custom-filament-saved', async (event) => {
                    const trayInfoIdx = event?.detail?.tray_info_idx || null;
                    const slotMeta = event?.detail?.slot || null;
                    if (typeof appContext.actions?.filamentCatalog?.refreshCatalog === 'function') {
                        await appContext.actions.filamentCatalog.refreshCatalog();
                    }
                    if (slotMeta) {
                        amsMaterialModal.open(slotMeta, { preselectTrayInfoIdx: trayInfoIdx });
                    }
                });
                global.addEventListener('custom-filament-deleted', async (event) => {
                    const slotMeta = event?.detail?.slot || null;
                    if (typeof appContext.actions?.filamentCatalog?.refreshCatalog === 'function') {
                        await appContext.actions.filamentCatalog.refreshCatalog();
                    }
                    if (slotMeta) {
                        amsMaterialModal.open(slotMeta);
                    }
                });
            });
        } else {
            bindStatusPanelEvents();
            subscribeToStore();
            amsMaterialModal.bindDocumentEvents();
            global.addEventListener('ams-material-confirm', handleAmsMaterialConfirm);
            global.addEventListener('ams-custom-filament', (event) => {
                customFilamentModal.open(event?.detail?.slot);
            });
            global.addEventListener('custom-filament-saved', async (event) => {
                const trayInfoIdx = event?.detail?.tray_info_idx || null;
                const slotMeta = event?.detail?.slot || null;
                if (typeof appContext.actions?.filamentCatalog?.refreshCatalog === 'function') {
                    await appContext.actions.filamentCatalog.refreshCatalog();
                }
                if (slotMeta) {
                    amsMaterialModal.open(slotMeta, { preselectTrayInfoIdx: trayInfoIdx });
                }
            });
            global.addEventListener('custom-filament-deleted', async (event) => {
                const slotMeta = event?.detail?.slot || null;
                if (typeof appContext.actions?.filamentCatalog?.refreshCatalog === 'function') {
                    await appContext.actions.filamentCatalog.refreshCatalog();
                }
                if (slotMeta) {
                    amsMaterialModal.open(slotMeta);
                }
            });
        }
    };

    const events = appContext.events || {};
    const eventKey = events.keys?.STATUS_PANEL || 'statusPanel';
    if (typeof events.register === 'function') {
        events.register(eventKey, {
            component: bindStatusPanelEvents,
            document: bindStatusPanelDocumentEvents,
        });
    } else {
        events.bindStatusPanelEvents = bindStatusPanelEvents;
        events.bindStatusPanelDocumentEvents = bindStatusPanelDocumentEvents;
    }

    statusPanelApi.resetCache = resetCache;
    appContext.components.statusPanel = statusPanelApi;
    return statusPanelApi;
};

export { initStatusPanel };
export default initStatusPanel;
