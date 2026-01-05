import { ensureAppContext } from './registry.js';

const globalProxy =
    typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : {};

const initStateStream = () => {
    const global = globalProxy;
    const appContext = ensureAppContext(global);
    appContext.components = appContext.components || {};
    const store = appContext.stores?.core || null;
    const service = appContext.services?.stateStream || null;
    const stateStreamActions = appContext.actions?.stateStream || null;

    if (!store || !service) {
        const fallback = appContext.components.stateStream || { init: () => {}, stop: () => {} };
        appContext.components.stateStream = fallback;
        return fallback;
    }

    const state = {
        unsubscribe: null,
        lastPrinterId: null,
        statusUnsubscribe: null,
        eventUnsubscribe: null,
    };

    const resolvePrinterId = (snapshot) => {
        return (
            snapshot?.selectedPrinterId ||
            snapshot?.currentPrinterId ||
            snapshot?.currentPrinter?.id ||
            appContext.api?.getActivePrinterId?.() ||
            null
        );
    };

    const handleStoreChange = (snapshot) => {
        const printerId = resolvePrinterId(snapshot);
        if (printerId && printerId !== state.lastPrinterId) {
            state.lastPrinterId = printerId;
            service.setPrinterId(printerId);
        }
    };

    const applyStreamEvent = (eventName, data) => {
        if (!stateStreamActions) {
            return;
        }
        if (eventName === 'snapshot') {
            stateStreamActions.applySnapshot?.(data);
            return;
        }
        if (eventName === 'diff') {
            stateStreamActions.applyDiff?.(data?.changes || {});
        }
    };

    const bindServiceListeners = () => {
        if (!state.statusUnsubscribe) {
            state.statusUnsubscribe = service.onStatusChange?.((connected) => {
                appContext.flags = appContext.flags || {};
                appContext.flags.stateStreamConnected = connected;
                appContext.components?.statusMonitor?.setPollingEnabled?.(!connected);
                if (connected && typeof document !== 'undefined') {
                    document.dispatchEvent(new CustomEvent('state-stream-connected'));
                }
            }) || null;
        }
        if (!state.eventUnsubscribe) {
            state.eventUnsubscribe = service.onEvent?.(applyStreamEvent) || null;
        }
    };

    const init = () => {
        if (state.unsubscribe || !store?.subscribe) {
            bindServiceListeners();
            service.start();
            return;
        }
        state.unsubscribe = store.subscribe(handleStoreChange);
        const initialSnapshot = store.getState?.();
        handleStoreChange(initialSnapshot);
        bindServiceListeners();
        service.start();
    };

    const stop = () => {
        service.stop();
        if (state.unsubscribe) {
            state.unsubscribe();
            state.unsubscribe = null;
        }
        if (state.statusUnsubscribe) {
            state.statusUnsubscribe();
            state.statusUnsubscribe = null;
        }
        if (state.eventUnsubscribe) {
            state.eventUnsubscribe();
            state.eventUnsubscribe = null;
        }
    };

    const StateStream = { init, stop };
    appContext.components.stateStream = StateStream;
    return StateStream;
};

export { initStateStream };
export default initStateStream;
