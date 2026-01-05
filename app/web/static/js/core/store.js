import createPendingSelectors from '../store/selectors/pending.js';
import createStatusPanelSelectors from '../store/selectors/statusPanel.js';
import createControlsSelectors from '../store/selectors/controls.js';
import createPrinterSelectorSelectors from '../store/selectors/printerSelector.js';
import createFileExplorerSelectors from '../store/selectors/fileExplorer.js';
import createPrintSetupSelectors from '../store/selectors/printSetup.js';
import createTransferOverlaySelectors from '../store/selectors/transferOverlay.js';
import createFilamentCatalogSelectors from '../store/selectors/filamentCatalog.js';
import { applyStatusPayload, normalizeChamberLight } from '../domain/status_payload.js';
import { registerStoreModule, registerSelectorModule } from './registry.js';

const buildSpeedModeConstants = () => {
    const levelToLabel = {
        '1': 'Silent',
        '2': 'Standard',
        '3': 'Sport',
        '4': 'Ludicrous',
    };
    const modeToLevel = {
        silent: '1',
        standard: '2',
        sport: '3',
        ludicrous: '4',
    };
    const levelToMode = {};
    Object.entries(modeToLevel).forEach(([mode, level]) => {
        levelToMode[level] = mode;
    });
    return {
        levelToLabel,
        modeToLevel,
        levelToMode,
    };
};

const buildStatusConstants = () => {
    const codes = {
        FINISH: 'FINISH',
        SLICING: 'SLICING',
        RUNNING: 'RUNNING',
        PAUSE: 'PAUSE',
        PREPARE: 'PREPARE',
        INIT: 'INIT',
        FAILED: 'FAILED',
        IDLE: 'IDLE',
        UNKNOWN: 'UNKNOWN',
    };
    const labels = {
        [codes.FINISH]: 'Finished',
        [codes.SLICING]: 'Slicing',
        [codes.RUNNING]: 'Running',
        [codes.PAUSE]: 'Paused',
        [codes.PREPARE]: 'Preparing',
        [codes.INIT]: 'Initializing',
        [codes.FAILED]: 'Failed',
        [codes.IDLE]: 'Idle',
        [codes.UNKNOWN]: 'Unknown',
    };
    const activeStates = [codes.RUNNING, codes.SLICING, codes.PAUSE, codes.PREPARE];
    const printingStates = [codes.RUNNING, codes.SLICING, codes.PAUSE, codes.PREPARE];
    const busyStates = [codes.RUNNING, codes.SLICING, codes.PAUSE, codes.PREPARE, codes.INIT];
    return {
        codes,
        labels,
        activeStates,
        printingStates,
        busyStates,
    };
};

const normalizeServerInfo = (info) => {
    const defaults = {
        start_time: '-',
        server_time: '-',
        uptime: '-',
        uptime_seconds: 0,
    };
    if (!info || typeof info !== 'object') {
        return { ...defaults };
    }
    const normalized = { ...defaults };
    if (info.start_time) {
        normalized.start_time = info.start_time;
    }
    if (info.server_time) {
        normalized.server_time = info.server_time;
    }
    if (info.uptime) {
        normalized.uptime = info.uptime;
    }
    const uptimeSeconds =
        info.uptime_seconds !== undefined && info.uptime_seconds !== null
            ? Number(info.uptime_seconds)
            : NaN;
    if (Number.isFinite(uptimeSeconds)) {
        normalized.uptime_seconds = uptimeSeconds;
    }
    return normalized;
};

const createMasterStore = () => {
    const createPendingValueState = (initial = null) => ({
        base: initial,
        pending: null,
        expiresAt: 0,
    });

    let state = {
        selectedPrinterId: null,
        printStatus: {},
        hmsErrors: [],
        online: false,
        ftpStatus: 'disconnected',
        lastStatusPrinterId: null,
        serverOffline: false,
        updatedAt: null,
        lastPrintValues: {},
        printer: null,
        ams: null,
        cameraFrame: null,
        externalSpool: null,
        lastExternalSpool: null,
        capabilities: null,
        cameraStatus: 'STOPPED',
        cameraStatusReason: null,
        filamentCatalog: [],
        filamentCatalogUpdatedAt: null,
        go2rtcRunning: null,
        serverInfo: normalizeServerInfo(null),
        lastSentProjectFile: null,
        ui: {
            statusPanel: {
                activeTab: 'status',
                selectedSlot: null,
                chamberLight: createPendingValueState('off'),
                featureTogglePending: {},
                lastDisplayedPrintErrorCode: null,
                lastAcknowledgedPrintErrorCode: null,
            },
            controls: {
                activeTab: 'movement',
                lastActiveTab: 'movement',
                movementStep: 1,
                extruderStep: 10,
                chamberLight: createPendingValueState('off'),
                speedLevel: createPendingValueState(0),
            },
            printerSelector: {
                printers: [],
                selectedId: null,
                pendingId: null,
                isSwitching: false,
                isRefreshing: false,
                isAdding: false,
                userCollapsed: true,
                refreshIntervalMs: 5000,
                apiRetryScheduled: false,
                lastEmittedSelectionId: null,
                openStatusDetailId: null,
                printerUnreadMap: {},
                eventPanel: {
                    events: [],
                    seenEventIds: [],
                    unreadIds: [],
                    expandedIds: [],
                    synced: false,
                    isOpen: false,
                    isLoading: false,
                    lastFetchedAt: null,
                },
                isSetupMode: false,
                isVerified: false,
                verificationPayloadHash: null,
                isEditing: false,
                editingPrinterId: null,
                modalMode: 'add',
                modalSecondaryAction: 'close',
                editingPrinterAccessCode: '',
                initialPayload: null,
                canApplyWithoutVerify: false,
            },
            fileExplorer: {
                currentPath: '/',
                activeFile: null,
                isContextMenuOpen: false,
                contextMenuPosition: null,
                contextMenuFile: null,
                isModalOpen: false,
                isLoading: false,
                lastError: null,
                files: [],
            },
            printSetup: {
                isOpen: false,
                metadata: null,
                currentPlateIndex: 0,
                amsMapping: [],
                currentTrayMeta: [],
                currentFilamentGroups: [],
                typeMismatchMessages: [],
                nozzleWarningText: '',
                nozzleMismatch: false,
                plateMappings: {},
                autoAssignedPlates: {},
                plateFiles: [],
                plateFilamentIds: [],
                maxFilamentId: 0,
                platePreviewUrls: [],
                externalSlotValue: -2,
                externalFocusIndex: null,
                pendingFileURL: null,
                isSubmitting: false,
                lastError: null,
            },
            transferOverlay: {
                isVisible: false,
                mode: null,
                filename: null,
                statusText: '',
                progress: {
                    sent: 0,
                    total: null,
                    percent: 0,
                    indeterminate: false,
                },
                speedBps: null,
                etaSeconds: null,
                isCancellable: false,
                error: null,
            },
            modalGate: {
                active: null,
                updatedAt: null,
            },
        },
    };
    const constants = {
        speedModes: buildSpeedModeConstants(),
        status: buildStatusConstants(),
    };

    const listeners = new Set();

    const notify = () => {
        listeners.forEach((listener) => {
            try {
                listener({ ...state });
            } catch (error) {
                console.error('store listener failed', error);
            }
        });
    };

    const isValueProvided = (value) => value !== undefined && value !== null && value !== '';

    const getValue = (key, incoming, fallback) => {
        if (isValueProvided(incoming)) {
            state.lastPrintValues = {
                ...state.lastPrintValues,
                [key]: incoming,
            };
            return incoming;
        }

        if (Object.prototype.hasOwnProperty.call(state.lastPrintValues, key)) {
            return state.lastPrintValues[key];
        }

        if (fallback !== undefined) {
            state.lastPrintValues = {
                ...state.lastPrintValues,
                [key]: fallback,
            };
            return fallback;
        }

        return undefined;
    };

    const setState = (partial) => {
        state = { ...state, ...partial };
        notify();
    };

    const update = (path, updater) => {
        if (!path || typeof updater !== 'function') {
            return;
        }
        const segments = String(path).split('.').filter(Boolean);
        if (!segments.length) {
            return;
        }
        let current = state;
        for (let i = 0; i < segments.length; i += 1) {
            if (!current || typeof current !== 'object') {
                current = undefined;
                break;
            }
            current = current[segments[i]];
        }
        const nextValue = updater(current);
        if (nextValue === current) {
            return;
        }
        const nextState = { ...state };
        let cursor = nextState;
        let sourceCursor = state;
        for (let i = 0; i < segments.length - 1; i += 1) {
            const key = segments[i];
            const sourceValue = sourceCursor && typeof sourceCursor === 'object' ? sourceCursor[key] : undefined;
            const nextBranch = Array.isArray(sourceValue)
                ? [...sourceValue]
                : { ...(sourceValue || {}) };
            cursor[key] = nextBranch;
            cursor = nextBranch;
            sourceCursor = sourceValue;
        }
        cursor[segments[segments.length - 1]] = nextValue;
        state = nextState;
        notify();
    };

    const getState = () => ({ ...state });

    const subscribe = (listener) => {
        if (typeof listener !== 'function') {
            return () => {};
        }
        listeners.add(listener);
        listener({ ...state });
        return () => listeners.delete(listener);
    };

    const setSelectedPrinterId = (printerId) => {
        setState({ selectedPrinterId: printerId });
    };

    const setFilamentCatalog = (items) => {
        setState({
            filamentCatalog: Array.isArray(items) ? items : [],
            filamentCatalogUpdatedAt: new Date().toISOString(),
        });
    };

    const updateOnlineStatus = (isOnline) => {
        setState({ online: Boolean(isOnline) });
    };

    const setFtpStatus = (status) => {
        setState({ ftpStatus: status || 'disconnected' });
    };

    const setServerOffline = (isOffline) => {
        setState({ serverOffline: Boolean(isOffline) });
    };

    const setCameraStatus = (status) => {
        const normalized =
            typeof status === 'string' && status
                ? status.trim().toUpperCase()
                : status;
        setState({ cameraStatus: normalized || 'STOPPED' });
    };

    const setCameraStatusReason = (reason) => {
        setState({ cameraStatusReason: reason ?? null });
    };

    const setGo2rtcRunning = (value) => {
        if (value === null || value === undefined) {
            setState({ go2rtcRunning: null });
            return;
        }
        setState({ go2rtcRunning: Boolean(value) });
    };

    const setServerInfo = (info) => {
        setState({ serverInfo: normalizeServerInfo(info) });
    };

    const setLastSentProjectFile = (payload) => {
        if (!payload || typeof payload !== 'object') {
            setState({ lastSentProjectFile: null });
            return;
        }
        setState({ lastSentProjectFile: payload });
    };

    const updatePrintStatus = (printData, updatedAt) => {
        const incomingState =
            typeof printData.gcode_state === 'string' ? printData.gcode_state.toUpperCase() : printData.gcode_state;
        const incomingSkipped = Array.isArray(printData.skipped_objects)
            ? [...printData.skipped_objects]
            : Array.isArray(printData.s_obj)
                ? [...printData.s_obj]
                : undefined;

        const normalized = {
            gcode_state: getValue('gcode_state', incomingState, constants.status.codes.UNKNOWN),
            gcode_file: getValue('gcode_file', printData.file ?? printData.gcode_file, '-'),
            layer: getValue('layer', printData.layer, '0/0'),
            percent: getValue('percent', printData.percent, 0),
            nozzle_temp: getValue('nozzle_temp', printData.nozzle_temp, 0),
            nozzle_target: getValue('nozzle_target', printData.nozzle_target_temper, printData.nozzle_temp ?? 0),
            bed_temp: getValue('bed_temp', printData.bed_temp, 0),
            bed_target: getValue('bed_target', printData.bed_target_temper, printData.bed_temp ?? 0),
            chamber_temp: getValue('chamber_temp', printData.chamber_temp, 0),
            remaining_time: getValue('remaining_time', printData.remaining_time, 0),
            finish_time: getValue('finish_time', printData.finish_time, '-'),
            firmware: getValue('firmware', printData.firmware, '-'),
            nozzle_type: getValue('nozzle_type', printData.nozzle_type, '-'),
            nozzle_diameter: getValue('nozzle_diameter', printData.nozzle_diameter, '-'),
            wifi_signal: getValue('wifi_signal', printData.wifi_signal, '-'),
            fan_gear: getValue('fan_gear', printData.fan_gear, 0),
            heatbreak_fan_speed: getValue('heatbreak_fan_speed', printData.heatbreak_fan_speed, '-'),
            cooling_fan_speed: getValue('cooling_fan_speed', printData.cooling_fan_speed, '-'),
            updated_at: getValue('updated_at', updatedAt, '-'),
            chamber_light: getValue('chamber_light', printData.chamber_light, state.lastPrintValues.chamber_light ?? 'off'),
            timelapse_enabled: getValue(
                'timelapse_enabled',
                printData.timelapse_enabled,
                Boolean(state.lastPrintValues.timelapse_enabled ?? false),
            ),
            speed_level: getValue(
                'speed_level',
                printData.speed_level ?? printData.spd_lvl,
                state.lastPrintValues.speed_level ?? 0,
            ),
            speed_magnitude: getValue(
                'speed_magnitude',
                printData.speed_magnitude ?? printData.spd_mag,
                state.lastPrintValues.speed_magnitude ?? 0,
            ),
           print_error: printData.print_error || null,
            mc_print_sub_stage: getValue('mc_print_sub_stage', printData.mc_print_sub_stage, 0),
            hw_switch_state: getValue('hw_switch_state', printData.hw_switch_state, '-'),
            stg: getValue(
                'stg',
                Array.isArray(printData.stg) ? [...printData.stg] : undefined,
                state.lastPrintValues.stg ?? []
            ),
            stg_cur: getValue('stg_cur', printData.stg_cur, state.lastPrintValues.stg_cur ?? 0),
            stage_labels: getValue(
                'stage_labels',
                Array.isArray(printData.stage_labels) ? [...printData.stage_labels] : undefined,
                state.lastPrintValues.stage_labels ?? []
            ),
            stage_current_label: getValue(
                'stage_current_label',
                printData.stage_current_label,
                state.lastPrintValues.stage_current_label ?? '-'
            ),
            gcode_file_prepare_percent: getValue(
                'gcode_file_prepare_percent',
                printData.gcode_file_prepare_percent,
                state.lastPrintValues.gcode_file_prepare_percent ?? null
            ),
            print_type: getValue('print_type', printData.print_type, state.lastPrintValues.print_type ?? 'idle'),
            mc_print_line_number: getValue(
                'mc_print_line_number',
                printData.mc_print_line_number,
                state.lastPrintValues.mc_print_line_number ?? '0'
            ),
            mc_print_stage: getValue(
                'mc_print_stage',
                printData.mc_print_stage,
                state.lastPrintValues.mc_print_stage ?? 0
            ),
            home_flag_features: getValue(
                'home_flag_features',
                printData.home_flag_features,
                state.lastPrintValues.home_flag_features ?? [],
            ),
            feature_toggles: getValue(
                'feature_toggles',
                printData.feature_toggles,
                state.lastPrintValues.feature_toggles ?? [],
            ),
            sdcard_state: getValue(
                'sdcard_state',
                printData.sdcard_state,
                state.lastPrintValues.sdcard_state ?? null,
            ),
            sdcard_present: getValue(
                'sdcard_present',
                typeof printData.sdcard === 'boolean' ? printData.sdcard : undefined,
                typeof state.lastPrintValues.sdcard_present === 'boolean' ? state.lastPrintValues.sdcard_present : null,
            ),
            skipped_objects: getValue(
                'skipped_objects',
                incomingSkipped,
                state.lastPrintValues.skipped_objects ?? [],
            ),
            skip_object_state: getValue(
                'skip_object_state',
                printData.skip_object_state,
                state.lastPrintValues.skip_object_state ?? null,
            ),
            print_again: printData.print_again ?? null,
       };

        setState({ printStatus: normalized, updatedAt: normalized.updated_at });
    };

    const setHMSErrors = (errors) => {
        setState({ hmsErrors: Array.isArray(errors) ? errors : [] });
    };

    const setPrinterData = (data) => {
        setState({ printer: data });
    };

    const setAmsData = (data) => {
        setState({ ams: data });
    };

    const setExternalSpoolData = (data) => {
        if (!data) {
            return;
        }
        setState({ externalSpool: data, lastExternalSpool: data });
    };

    const getExternalSpool = () => state.externalSpool || state.lastExternalSpool;

    const setCapabilities = (capabilities) => {
        if (!capabilities) {
            setState({ capabilities: null });
            return;
        }
        setState({ capabilities });
    };

    const hasCapability = (section, key) => {
        if (!section || !key) {
            return true;
        }
        const sectionFields = state.capabilities?.fields?.[section];
        if (!sectionFields) {
            return true;
        }
        if (!Object.prototype.hasOwnProperty.call(sectionFields, key)) {
            return true;
        }
        return sectionFields[key] !== false;
    };

    const setUiState = (slice, partial) => {
        if (!slice || typeof partial !== 'object') {
            return;
        }
        update(`ui.${slice}`, (currentSlice) => ({
            ...(currentSlice || {}),
            ...partial,
        }));
    };

    const updatePendingValue = (pendingState, { base, pending, ttlMs, clearPending = false }) => {
        const next = { ...(pendingState || createPendingValueState(null)) };
        if (base !== undefined) {
            next.base = base;
        }
        if (clearPending) {
            next.pending = null;
            next.expiresAt = 0;
        }
        if (pending !== undefined) {
            next.pending = pending;
            next.expiresAt = Date.now() + (Number(ttlMs) || 0);
        }
        if (next.pending !== null && next.base !== null && next.pending === next.base) {
            next.pending = null;
            next.expiresAt = 0;
        }
        return next;
    };

    const setControlsUiState = (partial) => setUiState('controls', partial);
    const setStatusPanelUiState = (partial) => setUiState('statusPanel', partial);
    const setPrinterSelectorState = (partial) => setUiState('printerSelector', partial);
    const setFileExplorerState = (partial) => setUiState('fileExplorer', partial);
    const setPrintSetupUiState = (partial) => setUiState('printSetup', partial);
    const setTransferOverlayUiState = (partial) => setUiState('transferOverlay', partial);
    const setModalGateUiState = (partial) => setUiState('modalGate', partial);

    const setControlsPendingValue = (key, value, ttlMs) => {
        const pendingKey = key === 'chamberLight' || key === 'speedLevel' ? key : null;
        if (!pendingKey) {
            return;
        }
        const controls = state.ui?.controls || {};
        const next = updatePendingValue(controls[pendingKey], { pending: value, ttlMs });
        setControlsUiState({ [pendingKey]: next });
        const statusPanel = state.ui?.statusPanel || {};
        if (statusPanel[pendingKey]) {
            const statusNext = updatePendingValue(statusPanel[pendingKey], { pending: value, ttlMs });
            setStatusPanelUiState({ [pendingKey]: statusNext });
        }
    };

    const setControlsBaseValue = (key, value) => {
        const baseKey = key === 'chamberLight' || key === 'speedLevel' ? key : null;
        if (!baseKey) {
            return;
        }
        const controls = state.ui?.controls || {};
        const next = updatePendingValue(controls[baseKey], { base: value });
        setControlsUiState({ [baseKey]: next });
    };

    const clearControlsPending = (key) => {
        const pendingKey = key === 'chamberLight' || key === 'speedLevel' ? key : null;
        if (!pendingKey) {
            return;
        }
        const controls = state.ui?.controls || {};
        const next = updatePendingValue(controls[pendingKey], { clearPending: true });
        setControlsUiState({ [pendingKey]: next });
        const statusPanel = state.ui?.statusPanel || {};
        if (statusPanel[pendingKey]) {
            const statusNext = updatePendingValue(statusPanel[pendingKey], { clearPending: true });
            setStatusPanelUiState({ [pendingKey]: statusNext });
        }
    };

    const setStatusPanelPendingValue = (key, value, ttlMs) => {
        if (key !== 'chamberLight') {
            return;
        }
        const statusPanel = state.ui?.statusPanel || {};
        const next = updatePendingValue(statusPanel.chamberLight, { pending: value, ttlMs });
        setStatusPanelUiState({ chamberLight: next });
        const controls = state.ui?.controls || {};
        if (controls.chamberLight) {
            const controlsNext = updatePendingValue(controls.chamberLight, { pending: value, ttlMs });
            setControlsUiState({ chamberLight: controlsNext });
        }
    };

    const setStatusPanelBaseValue = (key, value) => {
        if (key !== 'chamberLight') {
            return;
        }
        const statusPanel = state.ui?.statusPanel || {};
        const next = updatePendingValue(statusPanel.chamberLight, { base: value });
        setStatusPanelUiState({ chamberLight: next });
    };

    const clearStatusPanelPending = (key) => {
        if (key !== 'chamberLight') {
            return;
        }
        const statusPanel = state.ui?.statusPanel || {};
        const next = updatePendingValue(statusPanel.chamberLight, { clearPending: true });
        setStatusPanelUiState({ chamberLight: next });
        const controls = state.ui?.controls || {};
        if (controls.chamberLight) {
            const controlsNext = updatePendingValue(controls.chamberLight, { clearPending: true });
            setControlsUiState({ chamberLight: controlsNext });
        }
    };

    const setFeatureTogglePending = (key, value, ttlMs) => {
        if (!key) {
            return;
        }
        const statusPanel = state.ui?.statusPanel || {};
        const pendingMap = statusPanel.featureTogglePending || {};
        const current = pendingMap[key];
        const next = updatePendingValue(current, { pending: value, ttlMs, base: current?.base });
        setStatusPanelUiState({
            featureTogglePending: {
                ...pendingMap,
                [key]: next,
            },
        });
    };

    const setFeatureToggleBase = (key, value) => {
        if (!key) {
            return;
        }
        const statusPanel = state.ui?.statusPanel || {};
        const pendingMap = statusPanel.featureTogglePending || {};
        const current = pendingMap[key];
        const next = updatePendingValue(current, { base: value });
        setStatusPanelUiState({
            featureTogglePending: {
                ...pendingMap,
                [key]: next,
            },
        });
    };

    const clearFeatureTogglePending = (key) => {
        if (!key) {
            return;
        }
        const statusPanel = state.ui?.statusPanel || {};
        const pendingMap = statusPanel.featureTogglePending || {};
        const current = pendingMap[key];
        const next = updatePendingValue(current, { clearPending: true });
        setStatusPanelUiState({
            featureTogglePending: {
                ...pendingMap,
                [key]: next,
            },
        });
    };

    const setNestedValue = (target, path, value) => {
        if (!target || !path) {
            return;
        }
        const segments = path.split('.');
        let node = target;
        for (let i = 0; i < segments.length - 1; i += 1) {
            const key = segments[i];
            if (!node[key] || typeof node[key] !== 'object' || Array.isArray(node[key])) {
                node[key] = {};
            }
            node = node[key];
        }
        node[segments[segments.length - 1]] = value;
    };

    const mergeDeep = (base, delta) => {
        if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
            return delta;
        }
        const output = Array.isArray(base) ? [...base] : { ...(base || {}) };
        Object.entries(delta).forEach(([key, value]) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                output[key] = mergeDeep(output[key], value);
            } else {
                output[key] = value;
            }
        });
        return output;
    };

    const applyPrintSideEffects = (printData) => {
        if (!printData || typeof printData !== 'object') {
            return;
        }
        if (printData.chamber_light !== undefined) {
            const mode = normalizeChamberLight(printData.chamber_light);
            setControlsBaseValue('chamberLight', mode);
            setStatusPanelBaseValue('chamberLight', mode);
        }
        if (printData.speed_level !== undefined || printData.spd_lvl !== undefined) {
            const speedLevel = printData.speed_level ?? printData.spd_lvl;
            setControlsBaseValue('speedLevel', speedLevel);
        }
        if (Array.isArray(printData.feature_toggles)) {
            printData.feature_toggles.forEach((entry) => {
                if (!entry || !entry.key) {
                    return;
                }
                setFeatureToggleBase(entry.key, Boolean(entry.enabled));
            });
        }
    };

    const applyStateSnapshot = (snapshot) => {
        const payload = snapshot?.state || snapshot;
        if (!payload || typeof payload !== 'object') {
            return;
        }
        if (snapshot?.printer_id) {
            setState({ lastStatusPrinterId: snapshot.printer_id });
        }
        applyStatusPayload(
            {
                updateOnlineStatus,
                setFtpStatus,
                updatePrintStatus,
                setHMSErrors,
                setPrinterData,
                setAmsData,
                setExternalSpoolData,
                getExternalSpool,
                setCapabilities,
                setControlsBaseValue,
                setStatusPanelBaseValue,
            setFeatureToggleBase,
            setCameraStatus,
            setCameraStatusReason,
            setGo2rtcRunning,
            setServerInfo,
            setLastSentProjectFile,
        },
        payload,
    );
        if (payload.camera_frame !== undefined) {
            setState({ cameraFrame: payload.camera_frame });
        }
    };

    const applyStateDiff = (changes) => {
        if (!changes || typeof changes !== 'object') {
            return;
        }
        const printDelta = {};
        const amsDelta = {};
        const capabilitiesDelta = {};
        let updatedAtValue;
        let printerOnlineValue;
        let printerOnlineProvided = false;
        let ftpStatusValue;
        let ftpStatusProvided = false;
        let cameraFrameValue;
        let cameraFrameProvided = false;
        let cameraStatusValue;
        let cameraStatusProvided = false;
        let cameraStatusReasonValue;
        let cameraStatusReasonProvided = false;
        let go2rtcRunningValue;
        let go2rtcRunningProvided = false;
        let serverInfoFullValue = null;
        let serverInfoProvided = false;
        let lastSentProjectFileValue;
        let lastSentProjectFileProvided = false;
        const serverInfoDelta = {};

        Object.entries(changes).forEach(([path, value]) => {
            if (path === 'printer_online') {
                printerOnlineProvided = true;
                printerOnlineValue = value;
                return;
            }
            if (path === 'ftps_status') {
                ftpStatusProvided = true;
                ftpStatusValue = value;
                return;
            }
            if (path === 'updated_at') {
                updatedAtValue = value;
                return;
            }
            if (path === 'camera_frame') {
                cameraFrameProvided = true;
                cameraFrameValue = value;
                return;
            }
            if (path === 'camera_status') {
                cameraStatusProvided = true;
                cameraStatusValue = value;
                return;
            }
            if (path === 'camera_status_reason') {
                cameraStatusReasonProvided = true;
                cameraStatusReasonValue = value;
                return;
            }
            if (path === 'go2rtc_running') {
                go2rtcRunningProvided = true;
                go2rtcRunningValue = value;
                return;
            }
            if (path === 'server_info') {
                serverInfoProvided = true;
                serverInfoFullValue = value;
                return;
            }
            if (path === 'last_sent_project_file') {
                lastSentProjectFileProvided = true;
                lastSentProjectFileValue = value;
                return;
            }
            if (path.startsWith('server_info.')) {
                setNestedValue(serverInfoDelta, path.slice(12), value);
                return;
            }
            if (path.startsWith('print.')) {
                setNestedValue(printDelta, path.slice(6), value);
                return;
            }
            if (path.startsWith('ams.')) {
                setNestedValue(amsDelta, path.slice(4), value);
                return;
            }
            if (path.startsWith('capabilities.')) {
                setNestedValue(capabilitiesDelta, path.slice(13), value);
            }
        });

        if (Object.keys(printDelta).length) {
            updatePrintStatus(printDelta, updatedAtValue ?? printDelta.updated_at);
            if (Object.prototype.hasOwnProperty.call(printDelta, 'hms_errors')) {
                setHMSErrors(printDelta.hms_errors || []);
            }
            setPrinterData(mergeDeep(state.printer, printDelta));
            applyPrintSideEffects(printDelta);
        } else if (updatedAtValue !== undefined) {
            updatePrintStatus({}, updatedAtValue);
        }

        if (Object.keys(amsDelta).length) {
            setAmsData(mergeDeep(state.ams, amsDelta));
            if (Object.prototype.hasOwnProperty.call(amsDelta, 'external_spool')) {
                setExternalSpoolData(amsDelta.external_spool);
            }
        }

        if (Object.keys(capabilitiesDelta).length) {
            setCapabilities(mergeDeep(state.capabilities, capabilitiesDelta));
        }

        if (printerOnlineProvided) {
            updateOnlineStatus(printerOnlineValue);
        }

        if (ftpStatusProvided) {
            setFtpStatus(ftpStatusValue);
        }

        if (cameraFrameProvided) {
            setState({ cameraFrame: cameraFrameValue });
        }

        if (cameraStatusProvided) {
            setCameraStatus(cameraStatusValue);
        }

        if (cameraStatusReasonProvided) {
            setCameraStatusReason(cameraStatusReasonValue);
        }

        if (go2rtcRunningProvided) {
            setGo2rtcRunning(go2rtcRunningValue);
        }

        if (serverInfoProvided || Object.keys(serverInfoDelta).length) {
            const nextServerInfo = serverInfoProvided
                ? serverInfoFullValue
                : mergeDeep(state.serverInfo, serverInfoDelta);
            setServerInfo(nextServerInfo);
        }

        if (lastSentProjectFileProvided) {
            setLastSentProjectFile(lastSentProjectFileValue);
        }
    };

    return {
        getState,
        setState,
        update,
        subscribe,
        setSelectedPrinterId,
        setFilamentCatalog,
        updateOnlineStatus,
        setFtpStatus,
        setServerOffline,
        setCameraStatus,
        setCameraStatusReason,
        setGo2rtcRunning,
        setServerInfo,
        setLastSentProjectFile,
        updatePrintStatus,
        setHMSErrors,
        getValue,
        isValueProvided,
        setPrinterData,
        setAmsData,
        setExternalSpoolData,
        getExternalSpool,
        setCapabilities,
        hasCapability,
        setUiState,
        setControlsUiState,
        setStatusPanelUiState,
        setPrinterSelectorState,
        setFileExplorerState,
        setPrintSetupUiState,
        setTransferOverlayUiState,
        setModalGateUiState,
        setControlsPendingValue,
        setControlsBaseValue,
        clearControlsPending,
        setStatusPanelPendingValue,
        setStatusPanelBaseValue,
        clearStatusPanelPending,
        setFeatureTogglePending,
        setFeatureToggleBase,
        clearFeatureTogglePending,
        applyStateSnapshot,
        applyStateDiff,
        constants,
        getConstants: () => constants,
    };
};

const initStore = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const store = createMasterStore();

    const applyLegacyInitialData = (() => {
        let isApplied = false;
        return () => {
            if (isApplied || typeof global === 'undefined') {
                return;
            }
            const payload = global.__INITIAL_DATA__;
            if (!payload || typeof payload !== 'object') {
                return;
            }
            const nextState = {};
            const assignField = (key) => {
                if (Object.prototype.hasOwnProperty.call(payload, key)) {
                    nextState[key] = payload[key];
                }
            };
            ['selectedPrinterId', 'printer', 'capabilities', 'ams', 'externalSpool'].forEach(assignField);
            if (payload.ui && typeof payload.ui === 'object') {
                const currentUi = typeof store.getState === 'function' ? store.getState().ui || {} : {};
                nextState.ui = { ...currentUi, ...payload.ui };
            }
            if (Object.keys(nextState).length) {
                store.setState(nextState);
            }
            isApplied = true;
            global.__INITIAL_DATA__ = null;
        };
    })();

    applyLegacyInitialData();
    if (typeof global !== 'undefined') {
        global.__applyInitialData__ = applyLegacyInitialData;
    }

    if (global) {
        const context = registerStoreModule(global, 'core', store);
        context.utils = context.utils || {};
        context.utils.capabilities = {
            has: (...args) => store.hasCapability(...args),
        };
        const pendingSelectors = createPendingSelectors();
        const selectorModules = {
            pending: pendingSelectors,
            statusPanel: createStatusPanelSelectors(pendingSelectors),
            controls: createControlsSelectors(pendingSelectors),
            printerSelector: createPrinterSelectorSelectors(),
            fileExplorer: createFileExplorerSelectors(),
            printSetup: createPrintSetupSelectors(),
            transferOverlay: createTransferOverlaySelectors(),
            filamentCatalog: createFilamentCatalogSelectors(),
        };
        registerSelectorModule(global, 'core', selectorModules);
    }
    return store;
};

export { createMasterStore, initStore };
export default initStore;
