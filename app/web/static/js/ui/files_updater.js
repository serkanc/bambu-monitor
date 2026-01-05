const globalProxy =
    typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : {};

const state = {
    unsubscribe: null,
    lastPrinterId: null,
    initialized: false,
    intervalId: null,
};

const dispatchFileExplorerEvent = (eventName, detail = {}) => {
    if (typeof document === 'undefined' || !eventName) {
        return;
    }
    document.dispatchEvent(new CustomEvent(eventName, { detail }));
};

const triggerRefresh = () => {
    const masterStore = globalProxy.appContext?.stores?.core || null;
    const modalGate = masterStore?.getState?.().ui?.modalGate?.active;
    if (modalGate) {
        return;
    }
    dispatchFileExplorerEvent('file-explorer-refresh');
};

const resetHome = () => {
    dispatchFileExplorerEvent('file-explorer-reset-home');
};

const stopInterval = () => {
    if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
    }
};

const handleVisibilityChange = () => {
    if (typeof document === 'undefined') {
        return;
    }
    if (document.hidden) {
        stopInterval();
        return;
    }
    const masterStore = globalProxy.appContext?.stores?.core || null;
    const snapshot = typeof masterStore?.getState === 'function' ? masterStore.getState() : null;
    if (snapshot) {
        handleStoreChange(snapshot);
    }
};

const startInterval = () => {
    if (state.intervalId) {
        return;
    }
    triggerRefresh();
    state.intervalId = setInterval(triggerRefresh, 30000);
};

const handlePrinterChange = (nextPrinterId) => {
    if (!nextPrinterId) {
        stopInterval();
        return;
    }

    if (state.lastPrinterId && state.lastPrinterId !== nextPrinterId) {
        resetHome();
    }

    state.lastPrinterId = nextPrinterId;
    startInterval();
};

const handleStoreChange = (nextState) => {
    const printerId = nextState?.selectedPrinterId || null;
    if (!printerId) {
        return;
    }
    handlePrinterChange(printerId);
};

const destroyFilesUpdater = () => {
    stopInterval();
    if (typeof state.unsubscribe === 'function') {
        state.unsubscribe();
        state.unsubscribe = null;
    }
    state.initialized = false;
    state.lastPrinterId = null;
};

const ensureFilesUpdaterApi = (appContext) => {
    appContext.components = appContext.components || {};
    if (!appContext.components.filesUpdater) {
        appContext.components.filesUpdater = {
            init: initFilesUpdater,
            destroy: destroyFilesUpdater,
        };
    }
    return appContext.components.filesUpdater;
};

const initFilesUpdater = () => {
    const appContext = globalProxy.appContext || (globalProxy.appContext = {});
    const api = ensureFilesUpdaterApi(appContext);
    const masterStore = appContext.stores?.core || null;
    if (!masterStore || typeof masterStore.subscribe !== 'function') {
        console.warn('FilesUpdater init: master store unavailable');
        api.destroy = () => {};
        return api;
    }

    if (state.initialized) {
        api.destroy = destroyFilesUpdater;
        return api;
    }
    state.initialized = true;

    state.unsubscribe = masterStore.subscribe(handleStoreChange);
    const initialState = typeof masterStore.getState === 'function' ? masterStore.getState() : null;
    if (initialState) {
        handleStoreChange(initialState);
    }
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    api.destroy = destroyFilesUpdater;
    return api;
};

export { initFilesUpdater };
export default initFilesUpdater;
