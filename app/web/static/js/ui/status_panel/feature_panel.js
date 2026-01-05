const createFeaturePanel = ({ documentRef, actions, selectors, masterStore, showToast, getSnapshot }) => {
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    const featureToggleGridAms = doc ? doc.getElementById('feature-toggle-grid-ams') : null;
    const featureToggleGridPrinter = doc ? doc.getElementById('feature-toggle-grid-printer') : null;
    const featureStatusGrid = doc ? doc.getElementById('feature-status-grid') : null;
    const featureSdcardGrid = doc ? doc.getElementById('feature-sdcard-grid') : null;

    const escapeHtml =
        doc?.defaultView?.appContext?.utils?.format?.escapeHtml ||
        ((text) => {
            const element = doc ? doc.createElement('div') : null;
            if (!element) {
                return String(text ?? '');
            }
            element.textContent = text ?? '';
            return element.innerHTML;
        });
    const escapeAttribute =
        doc?.defaultView?.appContext?.utils?.format?.escapeAttribute ||
        ((value) => {
            const raw = value === undefined || value === null ? '' : String(value);
            return raw
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        });

    const formatBooleanLabel = (value, truthy = 'On', falsy = 'Off') => (value ? truthy : falsy);

    const featureLabelOverrides = {
        X_AXIS_AT_HOME: 'X Axis Home',
        Y_AXIS_AT_HOME: 'Y Axis Home',
        Z_AXIS_AT_HOME: 'Z Axis Home',
        IS_220V_VOLTAGE: '220V Voltage',
        STEP_LOSS_RECOVERY: 'Step Loss Recovery',
        CAMERA_RECORDING: 'Camera Recording',
        AMS_DETECT_REMAIN: 'AMS Detect Remain',
        AMS_AUTO_REFILL: 'AMS Auto Refill',
        FLOW_CALIBRATION: 'Flow Calibration',
        PA_CALIBRATION: 'PA Calibration',
        MOTOR_NOISE_CALIBRATION: 'Motor Noise Calibration',
        USER_PRESET: 'User Preset',
        AGORA: 'Agora',
        FILAMENT_TANGLE_DETECT: 'Filament Tangle Detect',
        NOZZLE_BLOB_DETECTION: 'Nozzle Blob Detection',
        UPGRADE_KIT: 'Upgrade Kit',
        AIR_PRINT_DETECTION: 'Air Print Detection',
        PROMPT_SOUND: 'Prompt Sound',
        BUILDPLATE_MARKER_DETECTOR: 'Buildplate Marker Detector',
        AMS_ON_STARTUP: 'Update AMS On Startup',
    };

    const amsToggleKeys = new Set([
        'AMS_DETECT_REMAIN',
        'AMS_AUTO_REFILL',
        'AMS_ON_STARTUP',
        'FILAMENT_TANGLE_DETECT',
    ]);

    const printerToggleKeys = new Set([
        'STEP_LOSS_RECOVERY',
        'CAMERA_RECORDING',
        'NOZZLE_BLOB_DETECTION',
        'UPGRADE_KIT',
        'AIR_PRINT_DETECTION',
        'PROMPT_SOUND',
        'BUILDPLATE_MARKER_DETECTOR',
    ]);

    const featurePanelExcludes = new Set([
        'X_AXIS_AT_HOME',
        'Y_AXIS_AT_HOME',
        'Z_AXIS_AT_HOME',
    ]);

    const sdcardStateLabels = {
        NO_SDCARD: 'No SD Card',
        HAS_SDCARD_NORMAL: 'SD Card OK',
        HAS_SDCARD_ABNORMAL: 'SD Card Error',
        HAS_SDCARD_READONLY: 'SD Card Read-only',
    };

    const formatFeatureLabel = (value) => {
        if (!value) {
            return '-';
        }
        const raw = String(value).trim();
        if (!raw) {
            return '-';
        }
        const override = featureLabelOverrides[raw];
        if (override) {
            return override;
        }
        return raw
            .replace(/_/g, ' ')
            .toLowerCase()
            .replace(/\b\w/g, (letter) => letter.toUpperCase());
    };

    const toDomId = (value) =>
        String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

    const isNil = (value) => value === null || value === undefined;

    const renderFeatureToggle = (feature) => {
        const key = feature?.key;
        if (!key) {
            return '';
        }
        const label = formatFeatureLabel(key);
        const domId = toDomId(key);
        const isOn = Boolean(feature.enabled);
        const classes = ['feature-toggle'];
        if (isOn) {
            classes.push('is-on');
        }
        return `
            <button
                type="button"
                class="${classes.join(' ')}"
                id="feature-toggle-${escapeAttribute(domId)}"
                data-feature-key="${escapeAttribute(key)}"
                data-feature-supported="${feature.supported ? 'true' : 'false'}"
                data-feature-enabled="${isOn ? 'true' : 'false'}"
                aria-pressed="${isOn ? 'true' : 'false'}"
            >
                <span class="feature-toggle-label">${escapeHtml(label)}</span>
                <span class="feature-toggle-switch" aria-hidden="true"></span>
            </button>
        `;
    };

    const renderFeatureStatus = (feature) => {
        const key = feature?.key;
        if (!key) {
            return '';
        }
        const label = formatFeatureLabel(key);
        const supported = feature.supported;
        const enabled = feature.enabled;
        let isOn = false;
        let valueLabel = '-';
        if (!isNil(enabled)) {
            isOn = Boolean(enabled);
            valueLabel = formatBooleanLabel(isOn, 'On', 'Off');
        } else if (!isNil(supported)) {
            isOn = Boolean(supported);
            valueLabel = isOn ? 'Supported' : 'Not supported';
        }
        const dotClass = isOn ? 'is-on' : 'is-off';
        return `
            <div class="status-item feature-status-item" data-feature-key="${escapeAttribute(key)}">
                <span class="status-item-icon feature-dot ${dotClass}"></span>
                <div class="status-item-content">
                    <span>${escapeHtml(label)}</span>
                    <strong>${escapeHtml(valueLabel)}</strong>
                </div>
            </div>
        `;
    };

    const getFeatureEnabled = (features, key) => {
        if (!Array.isArray(features)) {
            return null;
        }
        const match = features.find((entry) => entry && entry.key === key);
        if (!match || isNil(match.enabled)) {
            return null;
        }
        return Boolean(match.enabled);
    };

    const getFeatureToggleValue = (snapshot, key) => {
        if (!key) {
            return null;
        }
        const printStatus = snapshot?.printStatus || {};
        const base = getFeatureEnabled(printStatus.feature_toggles, key);
        if (selectors?.statusPanel?.getFeatureToggleValue) {
            const pending = selectors.statusPanel.getFeatureToggleValue(snapshot, key, Date.now());
            if (pending !== null && pending !== undefined) {
                return Boolean(pending);
            }
        }
        if (base === null) {
            return null;
        }
        return Boolean(base);
    };

    const updateFeatureToggleButton = (button, enabled) => {
        if (!button) {
            return;
        }
        const isOn = Boolean(enabled);
        button.classList.toggle('is-on', isOn);
        button.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        button.dataset.featureEnabled = isOn ? 'true' : 'false';
    };

    const toggleFeatureControl = async (button) => {
        if (!button || typeof actions?.statusPanel?.toggleFeature !== 'function') {
            return;
        }
        const key = button.dataset.featureKey;
        if (!key) {
            return;
        }
        const snapshot = getSnapshot();
        if (!snapshot?.online) {
            showToast('Printer must be online to toggle features', 'error');
            return;
        }
        const currentEnabled = button.dataset.featureEnabled === 'true';
        const nextEnabled = !currentEnabled;
        masterStore?.setFeatureTogglePending?.(key, nextEnabled, 5000);
        updateFeatureToggleButton(button, nextEnabled);
        button.disabled = true;
        try {
            const payload = {
                key,
                enabled: nextEnabled,
                sequence_id: '0',
            };
            if (key === 'AMS_DETECT_REMAIN' || key === 'AMS_ON_STARTUP') {
                const peerKey = key === 'AMS_DETECT_REMAIN' ? 'AMS_ON_STARTUP' : 'AMS_DETECT_REMAIN';
                const peerEnabled = getFeatureToggleValue(snapshot, peerKey);
                payload.peer_enabled = Boolean(peerEnabled);
            }
            await actions.statusPanel.toggleFeature({ ...payload });
            showToast(`${formatFeatureLabel(key)} ${nextEnabled ? 'enabled' : 'disabled'}`, 'success');
        } catch (error) {
            console.error('Feature toggle failed', error);
            masterStore?.clearFeatureTogglePending?.(key);
            const currentValue = getFeatureToggleValue(getSnapshot(), key);
            updateFeatureToggleButton(button, currentValue);
            showToast('Failed to toggle feature', 'error');
        } finally {
            button.disabled = !getSnapshot()?.online;
        }
    };

    const updateFeaturePanel = (features, snapshot) => {
        if (!featureToggleGridAms && !featureToggleGridPrinter && !featureStatusGrid) {
            return;
        }
        const entries = Array.isArray(features) ? features : [];
        const amsToggles = [];
        const printerToggles = [];
        const statusItems = [];
        const safeSnapshot = snapshot || getSnapshot();

        entries.forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }
            const key = entry.key;
            if (!key) {
                return;
            }
            if (featurePanelExcludes.has(key)) {
                return;
            }
            const supported = entry.supported;
            const enabled = entry.enabled;
            const supportedMissing = isNil(supported);
            const enabledMissing = isNil(enabled);

            if (!enabledMissing && (supported === true || supportedMissing) && amsToggleKeys.has(key)) {
                const effectiveEnabled = getFeatureToggleValue(safeSnapshot, key);
                amsToggles.push({ ...entry, enabled: effectiveEnabled ?? Boolean(enabled) });
                return;
            }

            if (!enabledMissing && (supported === true || supportedMissing) && printerToggleKeys.has(key)) {
                const effectiveEnabled = getFeatureToggleValue(safeSnapshot, key);
                printerToggles.push({ ...entry, enabled: effectiveEnabled ?? Boolean(enabled) });
                return;
            }

            if (!supportedMissing && enabledMissing) {
                statusItems.push(entry);
                return;
            }

            if (supportedMissing && !enabledMissing) {
                statusItems.push(entry);
            }
        });

        if (featureToggleGridAms) {
            featureToggleGridAms.innerHTML = amsToggles.length
                ? amsToggles.map(renderFeatureToggle).join('')
                : '<div class="feature-empty">No supported AMS toggles.</div>';
        }

        if (featureToggleGridPrinter) {
            featureToggleGridPrinter.innerHTML = printerToggles.length
                ? printerToggles.map(renderFeatureToggle).join('')
                : '<div class="feature-empty">No supported printer toggles.</div>';
        }

        if (featureStatusGrid) {
            featureStatusGrid.innerHTML = statusItems.length
                ? statusItems.map(renderFeatureStatus).join('')
                : '<div class="feature-empty">No feature data.</div>';
        }
    };

    const updateSdcardFeature = (sdcardState) => {
        if (!featureSdcardGrid) {
            return;
        }
        const rawValue = sdcardState ? String(sdcardState).toUpperCase() : '';
        const label = sdcardStateLabels[rawValue] || 'Unknown';
        const classes = ['status-item', 'feature-sdcard-item'];
        if (rawValue === 'HAS_SDCARD_ABNORMAL') {
            classes.push('is-error');
        } else if (rawValue === 'HAS_SDCARD_READONLY') {
            classes.push('is-warning');
        }
        featureSdcardGrid.innerHTML = `
            <div class="${classes.join(' ')}">
                <span class="status-item-icon feature-sdcard-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" role="img" focusable="false" aria-hidden="true">
                        <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.6"/>
                        <path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.6"/>
                        <rect x="8" y="13" width="8" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
                    </svg>
                </span>
                <div class="status-item-content">
                    <span>SD Card</span>
                    <strong>${escapeHtml(label)}</strong>
                </div>
            </div>
        `;
    };

    const axisHomeTargets = {
        X_AXIS_AT_HOME: 'axis-home-x',
        Y_AXIS_AT_HOME: 'axis-home-y',
        Z_AXIS_AT_HOME: 'axis-home-z',
    };

    const updateAxisHomeIndicators = (features) => {
        Object.entries(axisHomeTargets).forEach(([key, elementId]) => {
            const element = doc ? doc.getElementById(elementId) : null;
            if (!element) {
                return;
            }
            const enabled = getFeatureEnabled(features, key);
            element.classList.toggle('is-on', enabled === true);
        });
    };

    const bindEvents = () => {
        if (featureToggleGridAms && !featureToggleGridAms.dataset.listenerAttached) {
            featureToggleGridAms.addEventListener('click', (event) => {
                const button = event.target.closest('.feature-toggle');
                if (!button || !featureToggleGridAms.contains(button)) {
                    return;
                }
                toggleFeatureControl(button);
            });
            featureToggleGridAms.dataset.listenerAttached = 'true';
        }

        if (featureToggleGridPrinter && !featureToggleGridPrinter.dataset.listenerAttached) {
            featureToggleGridPrinter.addEventListener('click', (event) => {
                const button = event.target.closest('.feature-toggle');
                if (!button || !featureToggleGridPrinter.contains(button)) {
                    return;
                }
                toggleFeatureControl(button);
            });
            featureToggleGridPrinter.dataset.listenerAttached = 'true';
        }
    };

    return {
        updateFeaturePanel,
        updateSdcardFeature,
        updateAxisHomeIndicators,
        getFeatureToggleValue,
        bindEvents,
    };
};

export { createFeaturePanel };
export default createFeaturePanel;
