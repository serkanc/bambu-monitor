import bindMovementPanel from './controls/movement_panel.js';
import bindTemperaturePanel from './controls/temperature_panel.js';
import bindExtruderPanel from './controls/extruder_panel.js';
import bindSpeedPanel from './controls/speed_panel.js';

const globalObject =
    typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : {};

let controlsInitialized = false;
let controlsInstance = null;

const initControls = () => {
    if (controlsInitialized) {
        return controlsInstance;
    }
    if (typeof document === 'undefined') {
        return null;
    }
    const global = globalObject;
    const appContext = global.appContext || (global.appContext = {});
    appContext.components = appContext.components || {};
    const components = appContext.components;
    const masterStore = appContext.stores?.core || null;
    if (!masterStore) {
        return null;
    }
    const masterUtils = appContext.utils || {};
    const services = appContext.services || {};
    const selectors = appContext.selectors || {};
    const actionControls = appContext.actions?.controls;
    const showToast = masterUtils.dom?.showToast || ((msg) => alert(msg));

    const statusConstants = masterStore?.constants?.status || {};
    const statusCodes = statusConstants.codes || {};
    const normalizeStateCode = (value) => {
        if (!value) {
            return '';
        }
        return String(value).toUpperCase();
    };
    const activeStateSet = new Set(
        (statusConstants.activeStates || ['RUNNING', 'SLICING', 'PAUSE']).map((code) => normalizeStateCode(code)),
    );
    const busyStates =
        statusConstants.busyStates || ['RUNNING', 'SLICING', 'PAUSE', 'PREPARE', 'INIT'];
    const printerBusyStateSet = new Set(busyStates.map((code) => normalizeStateCode(code)));
    const pauseCode = normalizeStateCode(statusCodes.PAUSE || 'PAUSE');
    const toInt = (value) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) ? parsed : null;
    };
    const parsePlateIndexFromFile = (value) => {
        if (!value) {
            return null;
        }
        const fileName = String(value).split(/[\\/]/).pop() || '';
        const match = fileName.match(/plate[_-]?(\d+)/i);
        if (!match) {
            return null;
        }
        const parsed = parseInt(match[1], 10);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const normalizePlateIndex = (plate, fallbackIndex) => {
        const raw = plate?.index ?? plate?.metadata?.index;
        const parsed = parseInt(raw, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
        if (Number.isFinite(fallbackIndex)) {
            return fallbackIndex + 1;
        }
        return null;
    };
    const resolvePlateSelection = (metadata, snapshot) => {
        const plates = Array.isArray(metadata?.plates) ? metadata.plates : [];
        if (!plates.length) {
            return { plate: null, plateIndex: null, plateArrayIndex: null };
        }
        const gcodeFile = snapshot?.printStatus?.gcode_file || '';
        const normalizedName = String(gcodeFile).split(/[\\/]/).pop() || '';
        if (normalizedName) {
            const plateFiles = Array.isArray(metadata?.plate_files) ? metadata.plate_files : [];
            const plateFileIndex = plateFiles.findIndex((plateFile) => {
                if (!plateFile) {
                    return false;
                }
                const candidate = String(plateFile).split(/[\\/]/).pop() || '';
                return candidate.toLowerCase() === normalizedName.toLowerCase();
            });
            if (plateFileIndex >= 0) {
                const plate = plates[plateFileIndex] || null;
                return {
                    plate,
                    plateIndex: normalizePlateIndex(plate, plateFileIndex),
                    plateArrayIndex: plateFileIndex,
                };
            }
            const parsedIndex = parsePlateIndexFromFile(normalizedName);
            if (parsedIndex != null) {
                const foundIndex = plates.findIndex(
                    (plate, idx) => normalizePlateIndex(plate, idx) === parsedIndex,
                );
                const fallbackIndex =
                    foundIndex >= 0 ? foundIndex : parsedIndex - 1 >= 0 ? parsedIndex - 1 : 0;
                const plateIndexSafe =
                    fallbackIndex >= 0 && fallbackIndex < plates.length ? fallbackIndex : 0;
                const plate = plates[plateIndexSafe] || null;
                return {
                    plate,
                    plateIndex: normalizePlateIndex(plate, plateIndexSafe),
                    plateArrayIndex: plateIndexSafe,
                };
            }
        }
        const defaultIndex = Number.isInteger(metadata?.default_plate_index)
            ? metadata.default_plate_index
            : 0;
        const safeIndex = defaultIndex >= 0 && defaultIndex < plates.length ? defaultIndex : 0;
        const plate = plates[safeIndex] || null;
        return {
            plate,
            plateIndex: normalizePlateIndex(plate, safeIndex),
            plateArrayIndex: safeIndex,
        };
    };
    const meetsSkipObjectConstraints = (metadata, snapshot) => {
        const selection = resolvePlateSelection(metadata, snapshot);
        const plate = selection.plate;
        if (!plate) {
            return true;
        }
        const objects = Array.isArray(plate.objects) ? plate.objects : [];
        const totalObjects = objects.length;
        if (totalObjects <= 1 || totalObjects > 64) {
            return false;
        }
        const skippedList = Array.isArray(snapshot?.printStatus?.skipped_objects)
            ? snapshot.printStatus.skipped_objects
            : [];
        const skippedSet = new Set();
        skippedList.forEach((item) => {
            const id = toInt(item);
            if (id != null) {
                skippedSet.add(id);
            }
        });
        const objectIds = objects
            .map((obj) => toInt(obj?.identify_id))
            .filter((id) => id != null);
        const skippedCount = objectIds.filter((id) => skippedSet.has(id)).length;
        const remaining = totalObjects - skippedCount;
        return remaining > 1;
    };
    const getSkipObjectsAvailability = (snapshot) => {
        const skipState = snapshot?.printStatus?.skip_object_state;
        if (skipState) {
            return Boolean(skipState.available);
        }
        const metadata = snapshot?.ui?.printSetup?.metadata || null;
        const skipMeta = metadata?.skip_object || null;
        if (!skipMeta) {
            return true;
        }
        const plates = Array.isArray(skipMeta.plates) ? skipMeta.plates : [];
        if (!plates.length) {
            if (!skipMeta.available) {
                return false;
            }
            return meetsSkipObjectConstraints(metadata, snapshot);
        }
        const selection = resolvePlateSelection(metadata, snapshot);
        const plateIndex = selection.plateIndex;
        if (plateIndex != null) {
            const plate = plates.find((entry) => Number(entry.index) === plateIndex);
            if (plate) {
                if (!plate.available) {
                    return false;
                }
                return meetsSkipObjectConstraints(metadata, snapshot);
            }
        }
        if (!plates.some((plate) => Boolean(plate?.available))) {
            return false;
        }
        return meetsSkipObjectConstraints(metadata, snapshot);
    };
    const getIsPrinterBusy = (snapshot) => {
        if (selectors?.statusPanel?.isPrinterBusy) {
            return selectors.statusPanel.isPrinterBusy(snapshot);
        }
        const status = normalizeStateCode(snapshot?.printStatus?.gcode_state || '');
        return printerBusyStateSet.has(status);
    };
    const setControlsUiState = (partial) => {
        if (actionControls?.setUiState) {
            actionControls.setUiState(partial);
            return;
        }
        masterStore?.setControlsUiState?.(partial);
    };
    const setControlsBaseValue = (key, value) => {
        if (actionControls?.setBaseValue) {
            actionControls.setBaseValue(key, value);
            return;
        }
        masterStore?.setControlsBaseValue?.(key, value);
    };
    const setControlsPendingValue = (key, value, ttlMs) => {
        if (actionControls?.setPendingValue) {
            actionControls.setPendingValue(key, value, ttlMs);
            return;
        }
        masterStore?.setControlsPendingValue?.(key, value, ttlMs);
    };
    const clearControlsPending = (key) => {
        if (actionControls?.clearPending) {
            actionControls.clearPending(key);
            return;
        }
        masterStore?.clearControlsPending?.(key);
    };

    const getControlActions = () => {
        const serviceControls = services.controls;
        return {
            postCommand:
                actionControls?.postCommand ||
                serviceControls?.postCommand?.bind(serviceControls),
            setChamberLight:
                actionControls?.setChamberLight ||
                serviceControls?.setChamberLight?.bind(serviceControls),
            mirrorPrintControlState: actionControls?.mirrorPrintControlState,
        };
    };

    const buildFallbackSpeedModes = () => {
        const modeToLevel = {
            silent: '1',
            standard: '2',
            sport: '3',
            ludicrous: '4',
        };
        const levelToMode = Object.keys(modeToLevel).reduce((acc, mode) => {
            acc[modeToLevel[mode]] = mode;
            return acc;
        }, {});
        return {
            modeToLevel,
            levelToMode,
        };
    };

    const speedModeConstants = masterStore?.constants?.speedModes || buildFallbackSpeedModes();
    const speedModeToLevel = speedModeConstants.modeToLevel;
    const speedLevelToMode = speedModeConstants.levelToMode;

    const DEFAULT_PENDING_TTL = 5000;

    class PrinterControls {
        constructor() {
            this.controlTabButtons = [];
            this.controlPanels = [];
            this.unsubscribeStore = null;
            this.pauseResumeBtn = null;
            this.cancelBtn = null;
            this.skipObjectsBtn = null;
            this.pauseIconEl = null;
            this.pauseLabelEl = null;
            this._lastRenderKey = '';

            this.cacheDom();
            this.subscribeToStore();
        }

        cacheDom() {
            this.movementSteps = document.getElementById('movement-steps');
            this.stepButtons = this.movementSteps ? Array.from(this.movementSteps.querySelectorAll('button')) : [];
            this.movementControlButtons = Array.from(
                document.querySelectorAll('.control-panel[data-panel="movement"] .control-btn'),
            );

            this.speedModes = document.getElementById('speed-modes');
            this.speedButtons = this.speedModes ? Array.from(this.speedModes.querySelectorAll('.speed-btn')) : [];
            this.speedMagnitudeLabel = document.getElementById('control-speed-percent');

            this.extruderSteps = document.getElementById('extruder-steps');
            this.extruderButtons = this.extruderSteps ? Array.from(this.extruderSteps.querySelectorAll('button')) : [];
            this.extruderStepButtons = this.extruderSteps
                ? Array.from(this.extruderSteps.querySelectorAll('.step-btn'))
                : [];

            this.lightButtons = Array.from(document.querySelectorAll('.toggle-group .toggle-btn'));
            this.temperatureButtons = Array.from(
                document.querySelectorAll('.control-panel[data-panel="temperatures"] .apply-btn'),
            );
            this.nozzleInput = document.getElementById('set-nozzle-temp');
            this.bedInput = document.getElementById('set-bed-temp');
            this.pauseResumeBtn = document.getElementById('pause-resume-btn');
            this.cancelBtn = document.getElementById('cancel-btn');
            this.skipObjectsBtn = document.getElementById('skip-objects-btn');
            this.pauseIconEl = this.pauseResumeBtn?.querySelector('.control-icon') || null;
            this.pauseLabelEl = this.pauseResumeBtn?.querySelector('.control-label') || null;
        }

        async sendCommand(url, payload) {
            const controlActions = getControlActions();
            if (url === '/api/control/command' && typeof controlActions.postCommand === 'function') {
                return controlActions.postCommand(payload);
            }
            if (url === '/api/control/chamber-light' && typeof controlActions.setChamberLight === 'function') {
                return controlActions.setChamberLight(payload?.mode);
            }
            throw new Error('API client unavailable');
        }

        applyState(state) {
            if (!state) {
                return;
            }

            if (state.speed_level !== undefined && state.speed_level !== null) {
                setControlsBaseValue('speedLevel', state.speed_level);
            }
            if (state.speed_magnitude !== undefined && state.speed_magnitude !== null) {
                this.setSpeedMagnitude(state.speed_magnitude);
            }

            if (typeof state.chamber_light === 'string' && state.chamber_light) {
                setControlsBaseValue('chamberLight', state.chamber_light);
            }
        }

        setChamberLight(mode, { source = 'backend' } = {}) {
            if (!mode) {
                return;
            }
            const effectiveMode = mode === 'on' ? 'on' : 'off';
            this.lightButtons.forEach((btn) => {
                const shouldBeActive =
                    (effectiveMode === 'on' && btn.dataset.action === 'light-on') ||
                    (effectiveMode !== 'on' && btn.dataset.action === 'light-off');
                btn.classList.toggle('active', shouldBeActive);
            });
        }

        setSpeedLevel(level, { source = 'backend' } = {}) {
            const numericLevel = Number(level);
            if (!Number.isFinite(numericLevel)) {
                return;
            }
            const mode = speedLevelToMode[String(numericLevel)];
            if (!mode) {
                return;
            }
            this.highlightSpeedMode(mode);
        }



        highlightSpeedMode(mode) {
            const normalized = String(mode || '');
        this.speedButtons.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.mode === normalized);
        });
        }

        setSpeedMagnitude(value) {
            if (!this.speedMagnitudeLabel) {
                return;
            }
            if (value === null || value === undefined || value === '' || value === '-') {
                this.speedMagnitudeLabel.textContent = '-';
                return;
            }
            const numeric = Number(value);
            const display = Number.isFinite(numeric) ? `${numeric}%` : `${value}%`;
            this.speedMagnitudeLabel.textContent = display;
        }

        subscribeToStore() {
            if (!masterStore || typeof masterStore.subscribe !== 'function') {
                return;
            }
            this.unsubscribeStore = masterStore.subscribe((snapshot) => {
                if (snapshot?.ui?.modalGate?.active) {
                    return;
                }
                this.syncBusyTabState(snapshot);
                const renderKey = this.buildRenderKey(snapshot);
                if (renderKey !== this._lastRenderKey) {
                    this._lastRenderKey = renderKey;
                    this.renderFromState(snapshot);
                }
            });
        }

        buildRenderKey(snapshot) {
            const now = Date.now();
            const chamberLight = selectors.controls?.getChamberLight
                ? selectors.controls.getChamberLight(snapshot, now)
                : snapshot?.printStatus?.chamber_light ?? '';
            const speedLevel = selectors.controls?.getSpeedLevel
                ? selectors.controls.getSpeedLevel(snapshot, now)
                : snapshot?.printStatus?.speed_level ?? '';
            const speedMagnitude = snapshot?.printStatus?.speed_magnitude ?? '';
            const activeTab = selectors.controls?.getActiveTab
                ? selectors.controls.getActiveTab(snapshot)
                : snapshot?.ui?.controls?.activeTab || 'movement';
            const movementStep = selectors.controls?.getMovementStep
                ? selectors.controls.getMovementStep(snapshot)
                : snapshot?.ui?.controls?.movementStep ?? 1;
            const extruderStep = selectors.controls?.getExtruderStep
                ? selectors.controls.getExtruderStep(snapshot)
                : snapshot?.ui?.controls?.extruderStep ?? 10;
            const skipAvailable = getSkipObjectsAvailability(snapshot) ? 'skip' : 'noskip';
            const isBusy = getIsPrinterBusy(snapshot) ? 'busy' : 'idle';
            const gcodeState = normalizeStateCode(snapshot?.printStatus?.gcode_state || '');
            return [
                isBusy,
                gcodeState,
                chamberLight,
                speedLevel,
                speedMagnitude,
                skipAvailable,
                activeTab,
                movementStep,
                extruderStep,
            ].join('#');
        }

        renderFromState(snapshot) {
            const now = Date.now();
            const isBusy = getIsPrinterBusy(snapshot);
            const chamberLight = selectors.controls?.getChamberLight
                ? selectors.controls.getChamberLight(snapshot, now)
                : snapshot?.printStatus?.chamber_light;
            const speedLevel = selectors.controls?.getSpeedLevel
                ? selectors.controls.getSpeedLevel(snapshot, now)
                : snapshot?.printStatus?.speed_level;
            const speedMagnitude = snapshot?.printStatus?.speed_magnitude;
            const activeTab = selectors.controls?.getActiveTab
                ? selectors.controls.getActiveTab(snapshot)
                : snapshot?.ui?.controls?.activeTab || 'movement';
            const movementStep = selectors.controls?.getMovementStep
                ? selectors.controls.getMovementStep(snapshot)
                : snapshot?.ui?.controls?.movementStep ?? 1;
            const extruderStep = selectors.controls?.getExtruderStep
                ? selectors.controls.getExtruderStep(snapshot)
                : snapshot?.ui?.controls?.extruderStep ?? 10;

            this.renderControlsBusy(isBusy, snapshot);
            if (chamberLight !== null && chamberLight !== undefined) {
                this.setChamberLight(chamberLight);
            }
            if (speedLevel !== null && speedLevel !== undefined) {
                this.setSpeedLevel(speedLevel);
            }
            if (speedMagnitude !== null && speedMagnitude !== undefined) {
                this.setSpeedMagnitude(speedMagnitude);
            }
            this.renderMovementStep(movementStep);
            this.renderExtruderStep(extruderStep);
            this.renderActiveControlTab(activeTab);
            this.renderPauseCancelControls(snapshot);
        }

        renderPauseCancelControls(snapshot) {
            if (!this.pauseResumeBtn || !this.cancelBtn) {
                return;
            }
            const status = normalizeStateCode(snapshot?.printStatus?.gcode_state || '');
            const isActive = activeStateSet.has(status);
            const isPaused = status === pauseCode;
            this.pauseResumeBtn.disabled = !isActive;
            this.cancelBtn.disabled = !isActive;
            if (this.skipObjectsBtn) {
                this.skipObjectsBtn.disabled = !isActive || !getSkipObjectsAvailability(snapshot);
            }
            if (this.pauseIconEl) {
                this.pauseIconEl.textContent = isPaused ? '>' : '||';
            }
            if (this.pauseLabelEl) {
                this.pauseLabelEl.textContent = isPaused ? 'Resume' : 'Pause';
            }
            this.pauseResumeBtn.classList.toggle('resume-state', isPaused);
        }

        renderControlsBusy(isBusy, snapshot) {
            const toggleDisabled = (elements) => {
                elements.forEach((element) => {
                    if (element) {
                        element.disabled = isBusy;
                    }
                });
            };
            toggleDisabled(this.stepButtons);
            toggleDisabled(this.movementControlButtons);
            toggleDisabled(this.temperatureButtons);
            toggleDisabled(this.extruderButtons);
            toggleDisabled(this.extruderStepButtons);
            const inputsToToggle = [this.nozzleInput, this.bedInput];
            toggleDisabled(inputsToToggle.filter(Boolean));
            this.controlTabButtons.forEach((btn) => {
                if (!btn) {
                    return;
                }
                const tab = btn.dataset.tab || '';
                if (tab === 'speed') {
                    btn.disabled = false;
                    return;
                }
                btn.disabled = isBusy;
            });

        }

        syncBusyTabState(snapshot) {
            const isBusy = getIsPrinterBusy(snapshot);
            const currentTab = selectors.controls?.getActiveTab
                ? selectors.controls.getActiveTab(snapshot)
                : snapshot?.ui?.controls?.activeTab || 'movement';
            const lastTab = selectors.controls?.getLastActiveTab
                ? selectors.controls.getLastActiveTab(snapshot)
                : snapshot?.ui?.controls?.lastActiveTab || 'movement';

            const shouldSwitchToSpeed = isBusy && currentTab !== 'speed';
            const shouldRestoreTab = !isBusy && currentTab === 'speed';

            if (shouldSwitchToSpeed) {
                setControlsUiState({ lastActiveTab: currentTab, activeTab: 'speed' });
                return;
            }

            if (shouldRestoreTab) {
                const targetTab = lastTab || 'movement';
                if (targetTab !== currentTab && targetTab !== 'speed') {
                    setControlsUiState({ activeTab: targetTab });
                }
            }
        }

        requestActiveControlTab(tabName) {
            if (!tabName) {
                return;
            }
            const snapshot = typeof masterStore?.getState === 'function' ? masterStore.getState() : null;
            const isBusy = getIsPrinterBusy(snapshot);
            const updates = { activeTab: tabName };
            if (!isBusy) {
                updates.lastActiveTab = tabName;
            }
            setControlsUiState(updates);
        }

        renderActiveControlTab(tabName) {
            if (!tabName) {
                return;
            }
            this.controlTabButtons.forEach((button) => {
                const isActive = button.dataset.tab === tabName;
                button.classList.toggle('is-active', isActive);
            });
            this.controlPanels.forEach((panel) => {
                const panelKey = panel.dataset.panel || '';
                panel.hidden = panelKey !== tabName;
            });
        }

        setMovementStep(step) {
            const value = Number(step);
            if (!Number.isFinite(value)) {
                return;
            }
            setControlsUiState({ movementStep: value });
        }

        setExtruderStep(step) {
            const value = Number(step);
            if (!Number.isFinite(value)) {
                return;
            }
            setControlsUiState({ extruderStep: value });
        }

        getMovementStep(snapshot) {
            if (selectors.controls?.getMovementStep) {
                return selectors.controls.getMovementStep(snapshot);
            }
            return snapshot?.ui?.controls?.movementStep ?? 1;
        }

        getExtruderStep(snapshot) {
            if (selectors.controls?.getExtruderStep) {
                return selectors.controls.getExtruderStep(snapshot);
            }
            return snapshot?.ui?.controls?.extruderStep ?? 10;
        }

        renderMovementStep(step) {
            this.stepButtons.forEach((btn) => {
                btn.classList.toggle('active', Number(btn.dataset.step) === Number(step));
            });
        }

        renderExtruderStep(step) {
            this.extruderStepButtons.forEach((btn) => {
                btn.classList.toggle('active', Number(btn.dataset.length) === Number(step));
            });
        }
    }
    const bindControlEvents = (controls) => {
        if (!controls) {
            return;
        }

        bindMovementPanel({
            controls,
            showToast,
            getSnapshot: () => (typeof masterStore?.getState === 'function' ? masterStore.getState() : null),
        });
        bindTemperaturePanel({ controls, showToast });
        bindSpeedPanel({
            controls,
            showToast,
            masterStore,
            selectors,
            speedModeToLevel,
            defaultPendingTtl: DEFAULT_PENDING_TTL,
        });
        bindExtruderPanel({
            controls,
            showToast,
            getSnapshot: () => (typeof masterStore?.getState === 'function' ? masterStore.getState() : null),
            documentRef: document,
        });

        if (controls.lightButtons.length) {
            controls.lightButtons.forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const mode = btn.dataset.action === 'light-on' ? 'on' : 'off';
                    const snapshot = typeof masterStore?.getState === 'function' ? masterStore.getState() : null;
                    const previousMode = selectors.controls?.getChamberLight
                        ? selectors.controls.getChamberLight(snapshot, Date.now())
                        : snapshot?.printStatus?.chamber_light;

                    setControlsPendingValue('chamberLight', mode, DEFAULT_PENDING_TTL);

                    try {
                        await controls.sendCommand('/api/control/chamber-light', { mode });
                        showToast(`Chamber light ${mode === 'on' ? 'turned on' : 'turned off'}.`, 'success');
                    } catch (error) {
                        showToast(`Light command failed: ${error.message}`, 'error');
                        clearControlsPending('chamberLight');
                    }
                });
            });
        }

        const controlActions = getControlActions();

        if (controls.pauseResumeBtn && controls.cancelBtn) {
            controls.pauseResumeBtn.addEventListener('click', async () => {
                const state = masterStore?.getState?.() || {};
                const st = normalizeStateCode(state.printStatus?.gcode_state || '');
                try {
                    if (st === pauseCode) {
                        if (controlActions.postCommand) {
                            await controlActions.postCommand({ command: 'resume', param: '' });
                        } else {
                            await controls.sendCommand('/api/control/command', { command: 'resume', param: '' });
                        }
                        showToast('Resumed', 'success');
                        controlActions.mirrorPrintControlState?.('resumed', 'resume');
                    } else {
                        if (controlActions.postCommand) {
                            await controlActions.postCommand({ command: 'pause', param: '' });
                        } else {
                            await controls.sendCommand('/api/control/command', { command: 'pause', param: '' });
                        }
                        showToast('Printing paused', 'success');
                        controlActions.mirrorPrintControlState?.('paused', 'pause');
                    }
                } catch (err) {
                    showToast(`Error: ${err.message}`, 'error');
                }
            });

            controls.cancelBtn.addEventListener('click', async () => {
                const confirmCancel =
                    typeof window !== 'undefined' && typeof window.confirm === 'function'
                        ? window.confirm('Are you sure you want to cancel the print job?')
                        : true;
                if (!confirmCancel) {
                    showToast('Cancel aborted', 'info');
                    return;
                }
                try {
                    if (controlActions.postCommand) {
                        await controlActions.postCommand({ command: 'stop', param: '' });
                    } else {
                        await controls.sendCommand('/api/control/command', { command: 'stop', param: '' });
                    }
                    showToast('Printing canceled', 'success');
                    controlActions.mirrorPrintControlState?.('canceled', 'stop');
                } catch (err) {
                    showToast(`Error: ${err.message}`, 'error');
                }
            });
        }

        if (controls.skipObjectsBtn) {
            controls.skipObjectsBtn.addEventListener('click', () => {
                const skipModal = components.skipObjectsModal || components.skipObjects || null;
                if (!skipModal || typeof skipModal.open !== 'function') {
                    showToast('Skip objects UI unavailable', 'error');
                    return;
                }
                skipModal.open();
            });
        }

        controls.controlTabButtons = Array.from(document.querySelectorAll('.control-tab'));
        controls.controlPanels = Array.from(document.querySelectorAll('.control-panel'));
        if (controls.controlTabButtons.length) {
            controls.controlTabButtons.forEach((button) => {
                button.addEventListener('click', () => {
                    const tabName = button.dataset.tab || 'movement';
                    controls.requestActiveControlTab(tabName);
                });
            });
            const snapshot = typeof masterStore?.getState === 'function' ? masterStore.getState() : null;
            if (snapshot) {
                controls.renderFromState(snapshot);
            }
        }
    };

    const bindControlsDocumentEvents = () => {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                controlsInstance = new PrinterControls();
                components.controls = controlsInstance;
                bindControlEvents(controlsInstance);
            });
            return;
        }
        controlsInstance = new PrinterControls();
        components.controls = controlsInstance;
        bindControlEvents(controlsInstance);
    };

    const events = appContext.events || {};
    const eventKey = events.keys?.CONTROLS || 'controls';
    if (typeof events.register === 'function') {
        events.register(eventKey, {
            component: bindControlEvents,
            document: bindControlsDocumentEvents,
        });
    } else {
        events.bindControlEvents = bindControlEvents;
        events.bindControlsDocumentEvents = bindControlsDocumentEvents;
    }

    controlsInitialized = true;
    return controlsInstance;
};

export { initControls };
export default initControls;
