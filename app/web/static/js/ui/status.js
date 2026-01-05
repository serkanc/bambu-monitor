import { applyStatusPayload } from '../domain/status_payload.js';

const globalProxy =
    typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : {};

const initStatus = () => {
    const global = globalProxy;
    const appContext = global.appContext || (global.appContext = {});
    appContext.components = appContext.components || {};
    const components = appContext.components;
    const masterStore = appContext.stores?.core || null;
    const apiService = appContext.services?.api || null;
    const masterApi = apiService || null;
    const services = appContext.services || {};
    const statusService = services.status || null;
    if (!masterStore || !masterApi) {
        components.statusMonitor = components.statusMonitor || { init: () => {} };
        return components.statusMonitor;
    }

    const state = {
        statusInterval: null,
        unsubscribe: null,
        lastPrinterId: null,
        pollingEnabled: true,
    };

    const POLL_INTERVAL_MS = 3000;

    const getActivePrinterId = (nextState) => {
        const storePrinterId =
            nextState?.selectedPrinterId ||
            nextState?.currentPrinterId ||
            nextState?.currentPrinter?.id ||
            null;
        return storePrinterId || masterApi?.getActivePrinterId?.() || null;
    };

    const startStatusInterval = () => {
        if (!state.pollingEnabled) {
            return;
        }
        if (state.statusInterval) {
            return;
        }
        triggerStatusRefresh();
        state.statusInterval = setInterval(triggerStatusRefresh, POLL_INTERVAL_MS);
    };

    const stopStatusInterval = () => {
        if (!state.statusInterval) {
            return;
        }
        clearInterval(state.statusInterval);
        state.statusInterval = null;
    };

    const refreshStatus = async () => {
        if (!masterApi?.fetchWithPrinter && !statusService?.fetchStatus) {
            console.warn('Status refresh skipped: API client unavailable');
            return;
        }
        const modalGate = masterStore?.getState?.().ui?.modalGate?.active;
        if (modalGate && modalGate !== 'printSetup') {
            return;
        }
        try {
            const payload = statusService?.fetchStatus
                ? await statusService.fetchStatus()
                : await masterApi.fetchWithPrinter('/api/status');
            const printerId =
                masterStore?.getState?.()?.selectedPrinterId ||
                masterStore?.getState?.()?.currentPrinterId ||
                masterStore?.getState?.()?.currentPrinter?.id ||
                masterApi?.getActivePrinterId?.() ||
                null;
            if (printerId) {
                masterStore?.setState?.({ lastStatusPrinterId: printerId });
            }
            applyStatusPayload(masterStore, payload);
            if (components.printSetup) {
                if (typeof components.printSetup.buildAmsMappingUI === 'function') {
                    components.printSetup.buildAmsMappingUI();
                }
                if (typeof components.printSetup.refreshPrinterStatus === 'function') {
                    components.printSetup.refreshPrinterStatus();
                }
            }
        } catch (error) {
            console.error('Status update failed:', error);
            if (masterStore) {
                masterStore.updateOnlineStatus?.(false);
            }
        }
    };

    const triggerStatusRefresh = () => {
        refreshStatus().catch(() => null);
    };

    const handleStoreChange = (nextState) => {
        const printerId = getActivePrinterId(nextState);
        if (!printerId) {
            state.lastPrinterId = null;
            stopStatusInterval();
            return;
        }

        if (state.lastPrinterId !== printerId) {
            state.lastPrinterId = printerId;
            if (components.statusPanel && typeof components.statusPanel.resetCache === 'function') {
                components.statusPanel.resetCache();
            }
        }

        startStatusInterval();
    };

    const subscribeToStore = () => {
        if (state.unsubscribe || typeof masterStore?.subscribe !== 'function') {
            if (!state.unsubscribe) {
                console.warn('Store unavailable; StatusMonitor will run without subscription');
                startStatusInterval();
            }
            return;
        }
        state.unsubscribe = masterStore.subscribe(handleStoreChange);
        const initialState = typeof masterStore.getState === 'function' ? masterStore.getState() : null;
        if (initialState) {
            handleStoreChange(initialState);
        }
    };

    const handleVisibilityChange = () => {
        if (typeof document === 'undefined') {
            return;
        }
        if (document.hidden) {
            stopStatusInterval();
            return;
        }
        const snapshot = typeof masterStore.getState === 'function' ? masterStore.getState() : null;
        handleStoreChange(snapshot);
    };

    const StatusMonitor = {
        setPollingEnabled(enabled) {
            state.pollingEnabled = Boolean(enabled);
            if (!state.pollingEnabled) {
                stopStatusInterval();
            } else {
                const snapshot = typeof masterStore.getState === 'function' ? masterStore.getState() : null;
                handleStoreChange(snapshot);
            }
        },
        init() {
            if (state.unsubscribe || state.statusInterval) {
                return;
            }

            subscribeToStore();
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', handleVisibilityChange);
            }

            if (components.cameraUI && typeof components.cameraUI.init === 'function') {
                components.cameraUI.init();
            }

            if (components.filesUpdater && typeof components.filesUpdater.init === 'function') {
                components.filesUpdater.init();
            }
        },
    };

    components.statusMonitor = StatusMonitor;
    return StatusMonitor;
};

export { initStatus };
export default initStatus;
