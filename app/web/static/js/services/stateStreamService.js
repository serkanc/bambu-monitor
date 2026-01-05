import createApiService from './api.js';

const createStateStreamService = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const getContext = () => global?.appContext || {};
    const apiService = createApiService(global);
    const decoder = new TextDecoder('utf-8');
    const state = {
        controller: null,
        buffer: '',
        reconnectTimer: null,
        reconnectAttempts: 0,
        running: false,
        activePrinterId: null,
        connected: false,
        statusListeners: new Set(),
        sessionId: 0,
    };

    const getApiClient = () => getContext().api || null;
    const getHooks = () => getContext().serviceHooks || {};
    const eventListeners = new Set();

    const buildStreamUrl = () => {
        const api = getApiClient();
        const printerId = state.activePrinterId || api?.getActivePrinterId?.() || null;
        const url = api?.buildRequestUrl
            ? new URL(api.buildRequestUrl('/api/state/stream', { skipPrinterId: true }))
            : new URL('/api/state/stream', global.location?.origin || 'http://localhost');
        if (printerId) {
            url.searchParams.set('printer_id', printerId);
        }
        return url.toString();
    };

    const parseEventBlock = (block) => {
        if (!block) {
            return null;
        }
        const lines = block.split('\n');
        let eventName = 'message';
        const dataLines = [];
        lines.forEach((line) => {
            if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
            }
        });
        if (!dataLines.length) {
            return null;
        }
        const rawData = dataLines.join('\n');
        let data = rawData;
        try {
            data = JSON.parse(rawData);
        } catch (error) {
            data = rawData;
        }
        return { eventName, data };
    };

    const notifyEvent = (eventName, data) => {
        const hooks = getHooks();
        eventListeners.forEach((listener) => {
            try {
                listener(eventName, data);
            } catch (error) {
                console.warn('stateStream event listener failed', error);
            }
        });
        hooks.onStateEvent?.(eventName, data);
    };

    const notifyStatus = (connected) => {
        state.connected = connected;
        state.statusListeners.forEach((listener) => {
            try {
                listener(connected);
            } catch (error) {
                console.warn('stateStream status listener failed', error);
            }
        });
    };

    const scheduleReconnect = () => {
        if (!state.running) {
            return;
        }
        if (state.reconnectTimer) {
            return;
        }
        state.reconnectAttempts += 1;
        const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 15000);
        state.reconnectTimer = setTimeout(() => {
            state.reconnectTimer = null;
            connect().catch(() => null);
        }, delay);
    };

    const resetReconnect = () => {
        state.reconnectAttempts = 0;
        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
        }
    };

    const connect = async () => {
        const apiClient = getApiClient();
        const hooks = getHooks();
        if (!state.running || !apiClient) {
            return;
        }
        if (!state.activePrinterId) {
            state.activePrinterId = apiClient.getActivePrinterId?.() || null;
        }
        if (!state.activePrinterId) {
            return;
        }
        if (state.controller) {
            state.controller.abort();
        }
        const sessionId = (state.sessionId += 1);
        const controller = new AbortController();
        state.controller = controller;
        try {
            const response = await apiService.request(buildStreamUrl(), {
                headers: {
                    Accept: 'text/event-stream',
                },
                signal: controller.signal,
                cache: 'no-store',
                skipPrinterId: true,
            });
            if (sessionId !== state.sessionId) {
                return;
            }
            if (!response.ok || !response.body) {
                throw new Error(`State stream failed: ${response.status}`);
            }
            resetReconnect();
            notifyStatus(true);
            state.buffer = '';
            const reader = response.body.getReader();
            while (state.running && sessionId === state.sessionId) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                if (!value) {
                    continue;
                }
                state.buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
                let splitIndex = state.buffer.indexOf('\n\n');
                while (splitIndex !== -1) {
                    const block = state.buffer.slice(0, splitIndex);
                    state.buffer = state.buffer.slice(splitIndex + 2);
                    const parsed = parseEventBlock(block);
                    if (parsed && parsed.eventName !== 'ping') {
                        notifyEvent(parsed.eventName, parsed.data);
                    }
                    splitIndex = state.buffer.indexOf('\n\n');
                }
            }
            if (sessionId !== state.sessionId) {
                return;
            }
            notifyStatus(false);
            scheduleReconnect();
        } catch (error) {
            if (sessionId !== state.sessionId) {
                return;
            }
            if (error?.name !== 'AbortError') {
                hooks.onError?.(error, { name: 'stateStream.connect' });
            }
            notifyStatus(false);
            scheduleReconnect();
        }
    };

    const start = () => {
        if (state.running) {
            return;
        }
        state.running = true;
        connect().catch(() => null);
    };

    const stop = () => {
        state.running = false;
        if (state.controller) {
            state.controller.abort();
            state.controller = null;
        }
        notifyStatus(false);
        resetReconnect();
    };

    const setPrinterId = (printerId) => {
        if (!printerId || printerId === state.activePrinterId) {
            return;
        }
        state.activePrinterId = printerId;
        if (state.running) {
            connect().catch(() => null);
        }
    };

    return {
        start,
        stop,
        setPrinterId,
        onEvent(callback) {
            if (typeof callback !== 'function') {
                return () => {};
            }
            eventListeners.add(callback);
            return () => eventListeners.delete(callback);
        },
        onStatusChange(callback) {
            if (typeof callback !== 'function') {
                return () => {};
            }
            state.statusListeners.add(callback);
            callback(state.connected);
            return () => state.statusListeners.delete(callback);
        },
    };
};

export { createStateStreamService };
export default createStateStreamService;
