function bootstrapCameraModule(global) {
    const appContext = global.appContext || (global.appContext = {});
    appContext.components = appContext.components || {};
    const masterStore = appContext.stores?.core || null;
    const apiService = appContext.services?.api || null;
    const masterApi = apiService || null;

    const state = {
        intervalId: null,
        inFlight: false,
        unsubscribe: null,
        initialized: false,
        accessMode: null,
        accessUrl: null,
        accessType: null,
        accessSource: null,
        accessList: [],
        selectedSource: null,
        hasFrame: false,
        lastPrinterId: null,
    };

    const getActivePrinterId = () => {
        const storePrinterId =
            typeof masterStore?.getState === 'function'
                ? masterStore.getState().selectedPrinterId
                : null;
        if (typeof masterApi?.getActivePrinterId === 'function') {
            return masterApi.getActivePrinterId() ?? storePrinterId ?? null;
        }
        return storePrinterId ?? null;
    };

    const dispatchCameraEvent = (type, detail) => {
        if (typeof document === 'undefined') {
            return;
        }
        document.dispatchEvent(new CustomEvent(type, { detail }));
    };

    const storageKey = 'bambu.camera.source';
    const loadStoredSource = () => {
        try {
            return localStorage.getItem(storageKey);
        } catch (error) {
            return null;
        }
    };
    const saveStoredSource = (source) => {
        try {
            if (source) {
                localStorage.setItem(storageKey, source);
            } else {
                localStorage.removeItem(storageKey);
            }
        } catch (error) {
            return;
        }
    };

    const stopCameraInterval = () => {
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }
    };

    const fetchCameraFrame = async () => {
        if (!masterApi?.fetchWithPrinter) {
            throw new Error('API client unavailable');
        }
        return masterApi.fetchWithPrinter('/api/camera');
    };

    const fetchCameraAccess = async () => {
        if (!masterApi?.fetchWithPrinter) {
            throw new Error('API client unavailable');
        }
        return masterApi.fetchWithPrinter('/api/camera/access');
    };

    const normalizeAccessList = (payload) => {
        if (!payload) {
            return [];
        }
        if (Array.isArray(payload)) {
            return payload;
        }
        if (Array.isArray(payload.cameras)) {
            return payload.cameras;
        }
        return [];
    };

    const selectAccess = (accessList, preferredSource) => {
        if (!Array.isArray(accessList) || accessList.length === 0) {
            return null;
        }
        if (preferredSource) {
            const matched = accessList.find((item) => item?.source === preferredSource);
            if (matched) {
                return matched;
            }
        }
        const internal = accessList.find((item) => item?.source === 'internal');
        if (internal) {
            return internal;
        }
        return accessList[0];
    };

    const setActiveAccess = (access) => {
        state.accessMode = access?.mode || null;
        state.accessUrl = access?.url || null;
        state.accessType = access?.stream_type || null;
        state.accessSource = access?.source || null;
        if (access?.mode === 'direct' && access?.url) {
            dispatchCameraEvent('camera-access', access);
        } else if (access?.mode === 'proxy') {
            dispatchCameraEvent('camera-proxy', { source: access?.source || null });
        }
    };

    const performCameraUpdate = async () => {
        if (state.inFlight) {
            return;
        }
        if (state.accessMode && state.accessMode !== 'proxy') {
            return;
        }
        const printerId = getActivePrinterId();
        if (!printerId) {
            stopCameraInterval();
            dispatchCameraEvent('camera-placeholder', { message: 'Printer not selected' });
            return;
        }
        state.inFlight = true;
        try {
            const data = await fetchCameraFrame();
            if (data?.frame) {
                state.hasFrame = true;
                dispatchCameraEvent('camera-frame', { frame: data.frame });
            }
        } catch (error) {
            console.error('Camera update failed:', error);
            if (!state.hasFrame) {
                dispatchCameraEvent('camera-placeholder', { message: 'No Camera Feed Available' });
            }
        } finally {
            state.inFlight = false;
        }
    };

    const ensureCameraInterval = () => {
        if (state.intervalId) {
            return;
        }
        performCameraUpdate();
        state.intervalId = setInterval(() => performCameraUpdate(), 5000);
    };

    const refreshCameraAccess = async () => {
        const printerId = getActivePrinterId();
        if (!printerId) {
            stopCameraInterval();
            dispatchCameraEvent('camera-placeholder', { message: 'Printer not selected' });
            return;
        }
        try {
            const accessPayload = await fetchCameraAccess();
            const accessList = normalizeAccessList(accessPayload);
            state.accessList = accessList;
            const sources = accessList
                .map((item) => item?.source)
                .filter((item) => typeof item === 'string');
            if (sources.length && !sources.includes(state.selectedSource)) {
                state.selectedSource = sources.includes('internal') ? 'internal' : sources[0];
                saveStoredSource(state.selectedSource);
            }
            dispatchCameraEvent('camera-sources', {
                sources,
                selected: state.selectedSource,
            });
            const access = selectAccess(accessList, state.selectedSource);
            if (!access) {
                setActiveAccess(null);
                stopCameraInterval();
                dispatchCameraEvent('camera-placeholder', { message: 'No Camera Feed Available' });
                return;
            }
            setActiveAccess(access);
            if (access.mode === 'proxy') {
                if (!state.hasFrame) {
                    dispatchCameraEvent('camera-placeholder', { message: 'Waiting for Camera...' });
                }
                ensureCameraInterval();
            } else {
                stopCameraInterval();
            }
        } catch (error) {
            console.error('Camera access resolution failed:', error);
            setActiveAccess(null);
            stopCameraInterval();
            dispatchCameraEvent('camera-placeholder', { message: 'No Camera Feed Available' });
        }
    };

const handleStoreChange = () => {
    const printerId = getActivePrinterId();
    if (printerId) {
        if (printerId !== state.lastPrinterId) {
            state.lastPrinterId = printerId;
            state.hasFrame = false;
            refreshCameraAccess();
        }
    } else {
        setActiveAccess(null);
        stopCameraInterval();
        dispatchCameraEvent('camera-placeholder', { message: 'Printer not selected' });
    }
};

const handleVisibilityChange = () => {
    if (typeof document === 'undefined') {
        return;
    }
    if (document.hidden) {
        stopCameraInterval();
        return;
    }
    refreshCameraAccess();
};

const handleCameraRefresh = (event) => {
    const source = event?.detail?.source || null;
    if (source) {
        state.selectedSource = source;
        saveStoredSource(source);
    }
    state.hasFrame = false;
    refreshCameraAccess();
};

    const handleSourceChange = (event) => {
        const source = event?.detail?.source || null;
        state.selectedSource = source;
        saveStoredSource(source);
        state.hasFrame = false;
        refreshCameraAccess();
    };

    const handleConfigUpdate = (event) => {
        const activeId = getActivePrinterId();
        const updatedId = event?.detail?.printerId || null;
        if (updatedId && activeId && updatedId !== activeId) {
            return;
        }
        state.hasFrame = false;
        dispatchCameraEvent('camera-reset', { reason: 'config-updated' });
        refreshCameraAccess();
    };

    const destroyCameraUI = () => {
        stopCameraInterval();
        if (typeof state.unsubscribe === 'function') {
            state.unsubscribe();
            state.unsubscribe = null;
        }
        if (typeof document !== 'undefined') {
            document.removeEventListener('camera-source-change', handleSourceChange);
            document.removeEventListener('camera-refresh', handleCameraRefresh);
            document.removeEventListener('printer-config-updated', handleConfigUpdate);
        }
        state.initialized = false;
    };

    const initCameraUI = () => {
        if (state.initialized) {
            return {
                destroy: destroyCameraUI,
            };
        }
        if (!masterApi?.fetchWithPrinter) {
            console.warn('CameraUI init skipped: API client unavailable');
            return { destroy: destroyCameraUI };
        }
        state.initialized = true;
        state.selectedSource = loadStoredSource();
        state.lastPrinterId = null;
    if (typeof masterStore?.subscribe === 'function') {
        state.unsubscribe = masterStore.subscribe(handleStoreChange);
        handleStoreChange();
    } else {
        // Fallback if store missing: start interval immediately
        refreshCameraAccess();
    }
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return {
        destroy: destroyCameraUI,
    };
};

    const cameraUiApi = {
        init: initCameraUI,
    };
    appContext.components.cameraUI = cameraUiApi;

    const bindCameraDocumentEvents = () => {
    if (typeof document !== 'undefined') {
        document.addEventListener('camera-source-change', handleSourceChange);
        document.addEventListener('camera-refresh', handleCameraRefresh);
        document.addEventListener('printer-config-updated', handleConfigUpdate);
    }
};

    const events = appContext.events || {};
    const eventKey = events.keys?.CAMERA || 'camera';
    if (typeof events.register === 'function') {
        events.register(eventKey, { document: bindCameraDocumentEvents });
    } else {
        events.bindCameraDocumentEvents = bindCameraDocumentEvents;
    }
}

const globalProxy =
    typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : {};

let cameraUiInitialized = false;

let cameraUiInitScheduled = false;

const canInitializeCameraUI = () =>
    Boolean(
        globalProxy.document &&
            globalProxy.appContext?.stores?.core &&
            globalProxy.appContext?.services?.api,
    );

const scheduleCameraInit = () => {
    if (cameraUiInitScheduled) {
        return;
    }
    cameraUiInitScheduled = true;
    const retry = () => {
        cameraUiInitScheduled = false;
        initCameraUI();
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(retry);
    } else {
        setTimeout(retry, 16);
    }
};

const initCameraUI = () => {
    if (cameraUiInitialized) {
        return globalProxy.appContext?.components?.cameraUI || null;
    }
    if (!canInitializeCameraUI()) {
        scheduleCameraInit();
        return null;
    }
    bootstrapCameraModule(globalProxy);
    cameraUiInitialized = true;
    return globalProxy.appContext?.components?.cameraUI || null;
};

export { initCameraUI };
export default initCameraUI;
