import { ensureAppContext } from '../core/registry.js';

const createAppClient = (globalContext = window) => {
    const appContext = ensureAppContext(globalContext);
    const utils = appContext.utils || {};
    const networkFetchJSON = utils.network?.fetchJSON;
    const getAuthToken = () => globalContext.__APP_CONFIG__?.apiToken || null;
    const getAuthHeaders = () => {
        const token = getAuthToken();
        if (!token) {
            return {};
        }
        return { Authorization: `Bearer ${token}` };
    };
    const getActivePrinterId = () => {
        const selector = appContext.components?.printerSelector;
        if (selector && typeof selector.getSelectedPrinterId === 'function') {
            const selectedId = selector.getSelectedPrinterId();
            if (selectedId) {
                return selectedId;
            }
        }
        const store = appContext.stores?.core;
        if (store && typeof store.getState === 'function') {
            const snapshot = store.getState();
            return (
                snapshot?.selectedPrinterId ||
                snapshot?.currentPrinterId ||
                snapshot?.currentPrinter?.id ||
                null
            );
        }
        return null;
    };

    const buildRequestUrl = (path, { skipPrinterId = false } = {}) => {
        const url = new URL(path, window.location.origin);
        if (!skipPrinterId) {
            const printerId = getActivePrinterId();
            if (printerId) {
                url.searchParams.set('printer_id', printerId);
            }
        }
        return url.toString();
    };

    const safeReadText = async (response) => {
        try {
            return await response.text();
        } catch (error) {
            console.warn('Failed to read response text', error);
            return '';
        }
    };

    const isJsonResponse = (response) => {
        const contentType = response.headers.get('content-type') || '';
        return contentType.includes('application/json');
    };

    const request = async (path, options = {}) => {
        const { skipPrinterId = false, headers = {}, ...rest } = options;
        const requestUrl = buildRequestUrl(path, { skipPrinterId });
        const response = await fetch(requestUrl, {
            headers: {
                ...getAuthHeaders(),
                ...headers,
            },
            ...rest,
        });
        if (!response.ok) {
            const message = await safeReadText(response);
            const error = new Error(message || response.statusText || 'HTTP error');
            error.status = response.status;
            throw error;
        }
        return response;
    };

    const fetchWithPrinter = async (path, options = {}) => {
        const printerId = getActivePrinterId();
        if (!printerId) {
            throw new Error(
                'fetchWithPrinter called without active printer. This method must NOT be used for printer-independent endpoints.',
            );
        }
        const response = await request(path, options);
        if (options.rawResponse) {
            return response;
        }
        if (isJsonResponse(response)) {
            return response.json();
        }
        return {};
    };

    const postWithPrinter = async (path, payload, options = {}) => {
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        };
        return fetchWithPrinter(path, {
            ...options,
            method: 'POST',
            headers,
            body: payload ? JSON.stringify(payload) : options.body,
        });
    };

    const fetchJSON = async (url, options = {}) => {
        if (networkFetchJSON) {
            return networkFetchJSON(url, options);
        }
        const response = await fetch(url, {
            ...options,
            headers: {
                ...getAuthHeaders(),
                ...(options.headers || {}),
            },
        });
        if (!response.ok) {
            throw new Error(response.statusText || 'HTTP error');
        }
        return response.json();
    };

    const getPrinters = () => fetchJSON('/api/status/printers');

    const sendAmsFilamentCommand = (payload) =>
        postWithPrinter('/api/control/ams/filament', payload);

    const buildEventsPath = ({ printerId, limit } = {}) => {
        const url = new URL('/api/events', window.location.origin);
        if (printerId) {
            url.searchParams.set('printer_id', printerId);
        }
        if (limit) {
            url.searchParams.set('limit', limit);
        }
        return `${url.pathname}${url.search}`;
    };

    const getEvents = (params = {}) => fetchJSON(buildEventsPath(params), { headers: { Accept: 'application/json' } });

    const clearEvents = (params = {}) => {
        const path = buildEventsPath(params);
        return request(path, {
            method: 'DELETE',
            skipPrinterId: true,
        });
    };

    const client = {
        request,
        fetchWithPrinter,
        postWithPrinter,
        fetchJSON,
        buildRequestUrl,
        getActivePrinterId,
        getPrinters,
        sendAmsFilamentCommand,
        getEvents,
        clearEvents,
        getAuthHeaders,
    };

    return client;
};

const initAppClient = (globalContext = typeof window !== 'undefined' ? window : globalThis) => {
    const appClient = createAppClient(globalContext);
    const appContext = ensureAppContext(globalContext);
    appContext.api = appClient;
    return appClient;
};

export { createAppClient, initAppClient };
export default initAppClient;
