import { ensureAppContext } from './registry.js';

const initCoreUtils = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const DEFAULT_TIMEOUT = 15000;
    const context = ensureAppContext(global);
    context.utils = context.utils || {
        format: {},
        dom: {},
        time: {},
        network: {},
    };

    const getAuthHeaders = () => {
        const token = global?.__APP_CONFIG__?.apiToken;
        if (!token) {
            return {};
        }
        return { Authorization: `Bearer ${token}` };
    };

    async function fetchJSON(url, options = {}) {
        const { timeout = DEFAULT_TIMEOUT, ...rest } = options;
        const controller = rest.signal ? null : new AbortController();
        const signal = rest.signal ?? controller.signal;
        const fetchOptions = {
            ...rest,
            signal,
            headers: {
                ...getAuthHeaders(),
                ...(rest.headers || {}),
            },
        };
        let timeoutId;

        if (!rest.signal && timeout > 0) {
            timeoutId = setTimeout(() => controller.abort(), timeout);
        }

        try {
            const response = await fetch(url, fetchOptions);
            if (!response.ok) {
                const payload = await safeReadPayload(response);
                const message =
                    payload?.detail ||
                    payload?.message ||
                    payload?.error ||
                    response.statusText ||
                    'HTTP error';
                const error = new Error(message);
                error.status = response.status;
                if (payload?.error || payload?.error_code) {
                    error.code = payload.error || payload.error_code;
                }
                if (payload?.meta) {
                    error.meta = payload.meta;
                }
                throw error;
            }

            if (isJsonResponse(response)) {
                return await response.json();
            }

            return {};
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request timed out');
            }
            throw error;
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    async function safeReadText(response) {
        try {
            return await response.text();
        } catch (error) {
            console.warn('Failed to read response text', error);
            return '';
        }
    }

    async function safeReadPayload(response) {
        if (isJsonResponse(response)) {
            try {
                return await response.json();
            } catch (error) {
                console.warn('Failed to read response json', error);
            }
        }
        const text = await safeReadText(response);
        return text ? { detail: text } : {};
    }

    function isJsonResponse(response) {
        const contentType = response.headers.get('content-type') || '';
        return contentType.includes('application/json');
    }

    context.utils.network = context.utils.network || {};
    context.utils.network.fetchJSON = fetchJSON;
    return context.utils.network;
};

export { initCoreUtils };
export default initCoreUtils;
