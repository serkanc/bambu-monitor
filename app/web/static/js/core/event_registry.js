import { ensureAppContext } from './registry.js';

const EVENT_KEYS = Object.freeze({
    CAMERA: 'camera',
    CAMERA_VIEWER: 'cameraViewer',
    CONTROLS: 'controls',
    PRINTER_SELECTOR: 'printerSelector',
    FILE_EXPLORER: 'fileExplorer',
    PRINT_SETUP: 'printSetup',
    STATUS_PANEL: 'statusPanel',
    TRANSFER_OVERLAY: 'transferOverlay',
});

const EVENT_PHASE = Object.freeze({
    COMPONENT: 'component',
    DOCUMENT: 'document',
});

const initEventRegistry = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const appContext = ensureAppContext(global);
    const events = appContext.events || (appContext.events = {});
    const registered = new Map();
    const boundHandlers = new Set();

    const normalizeHandlers = (handlers = {}) => ({
        component: typeof handlers.component === 'function' ? handlers.component : null,
        document: typeof handlers.document === 'function' ? handlers.document : null,
    });

    const register = (eventKey, handlers) => {
        if (!eventKey) {
            return;
        }
        const normalized = normalizeHandlers(handlers);
        registered.set(eventKey, normalized);
    };

    const invokeEventHandler = (eventKey, phase) => {
        const key = `${eventKey}:${phase}`;
        if (boundHandlers.has(key)) {
            return false;
        }
        const entry = registered.get(eventKey);
        if (!entry) {
            return false;
        }
        const handler = entry[phase];
        if (typeof handler !== 'function') {
            return false;
        }
        try {
            const result = handler();
            if (result === false) {
                return false;
            }
            boundHandlers.add(key);
        } catch (error) {
            console.error('Event binding failed', error);
        }
        return true;
    };

    const bindEvents = (phase) => {
        let bound = false;
        Object.values(EVENT_KEYS).forEach((eventKey) => {
            bound = invokeEventHandler(eventKey, phase) || bound;
        });
        return bound;
    };

    const bindComponentEvents = () => bindEvents(EVENT_PHASE.COMPONENT);
    const bindDocumentEvents = () => bindEvents(EVENT_PHASE.DOCUMENT);
    const bindAllEvents = () => bindComponentEvents() || bindDocumentEvents();

    events.keys = EVENT_KEYS;
    events.register = register;

    const registry = {
        keys: EVENT_KEYS,
        phases: EVENT_PHASE,
        register,
        bindEvent: (eventKey, phase) => {
            if (!eventKey) {
                return false;
            }
            if (!phase) {
                return (
                    invokeEventHandler(eventKey, EVENT_PHASE.COMPONENT) ||
                    invokeEventHandler(eventKey, EVENT_PHASE.DOCUMENT)
                );
            }
            return invokeEventHandler(eventKey, phase);
        },
        bindComponentEvents,
        bindDocumentEvents,
        bindAllEvents,
    };

    appContext.eventRegistry = registry;
    return registry;
};

export { EVENT_KEYS, EVENT_PHASE, initEventRegistry };
export default initEventRegistry;
