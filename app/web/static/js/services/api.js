import initAppClient from '../api/appClient.js';

const getApi = (global) => global?.appContext?.api || null;

const resolveHooks = (global) => global?.appContext?.serviceHooks || {};

const runWithMetrics = async (fnName, fn, hooks = {}) => {
    const startedAt = Date.now();
    try {
        const result = await fn();
        hooks.onMetric?.({
            name: fnName,
            durationMs: Date.now() - startedAt,
            ok: true,
        });
        return result;
    } catch (error) {
        hooks.onMetric?.({
            name: fnName,
            durationMs: Date.now() - startedAt,
            ok: false,
            error: error?.message || String(error),
        });
        hooks.onError?.(error, { name: fnName });
        throw error;
    }
};

const withRetry = async (fn, options = {}) => {
    const retries = Number(options.retries || 0);
    const delayMs = Number(options.delayMs || 0);
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await fn(attempt);
        } catch (error) {
            lastError = error;
            if (attempt >= retries) {
                throw lastError;
            }
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
    throw lastError;
};

const createApiService = (global = typeof window !== 'undefined' ? window : globalThis) => {
    let api = getApi(global);
    const hooks = resolveHooks(global);

    const resolveApi = (fnName) => {
        if (!api) {
            api = getApi(global);
        }
        if (!api && typeof initAppClient === 'function') {
            api = initAppClient(global);
        }
        if (!api) {
            throw new Error(`API client unavailable (${fnName})`);
        }
        return api;
    };

    return {
        request(path, options = {}) {
            const client = resolveApi('request');
            if (typeof client.request !== 'function') {
                throw new Error('API client unavailable');
            }
            return runWithMetrics(
                'api.request',
                () => withRetry(() => client.request(path, options), options.retry),
                hooks,
            );
        },
        fetchWithPrinter(path, options = {}) {
            const client = resolveApi('fetchWithPrinter');
            if (typeof client.fetchWithPrinter !== 'function') {
                throw new Error('API client unavailable');
            }
            return runWithMetrics(
                'api.fetchWithPrinter',
                () => withRetry(() => client.fetchWithPrinter(path, options), options.retry),
                hooks,
            );
        },
        postWithPrinter(path, payload, options = {}) {
            const client = resolveApi('postWithPrinter');
            if (typeof client.postWithPrinter !== 'function') {
                throw new Error('API client unavailable');
            }
            return runWithMetrics(
                'api.postWithPrinter',
                () => withRetry(() => client.postWithPrinter(path, payload, options), options.retry),
                hooks,
            );
        },
        getPrinters() {
            const client = resolveApi('getPrinters');
            if (typeof client.getPrinters === 'function') {
                return runWithMetrics('api.getPrinters', () => client.getPrinters(), hooks);
            }
            if (typeof client.fetchJSON === 'function') {
                return runWithMetrics('api.getPrinters', () => client.fetchJSON('/api/status/printers'), hooks);
            }
            throw new Error('API client unavailable');
        },
        fetchJSON(path, options = {}) {
            const client = resolveApi('fetchJSON');
            if (typeof client.fetchJSON !== 'function') {
                throw new Error('API client unavailable');
            }
            return runWithMetrics(
                'api.fetchJSON',
                () => withRetry(() => client.fetchJSON(path, options), options.retry),
                hooks,
            );
        },
        getEvents(params = {}) {
            const client = resolveApi('getEvents');
            if (typeof client.getEvents !== 'function') {
                throw new Error('API client unavailable');
            }
            return runWithMetrics(
                'api.getEvents',
                () => withRetry(() => client.getEvents(params), params.retry),
                hooks,
            );
        },
        clearEvents(params = {}) {
            const client = resolveApi('clearEvents');
            if (typeof client.clearEvents !== 'function') {
                throw new Error('API client unavailable');
            }
            return runWithMetrics(
                'api.clearEvents',
                () => withRetry(() => client.clearEvents(params), params.retry),
                hooks,
            );
        },
        sendAmsFilamentCommand(payload) {
            const client = resolveApi('sendAmsFilamentCommand');
            if (typeof client.sendAmsFilamentCommand !== 'function') {
                throw new Error('API client unavailable');
            }
            return runWithMetrics(
                'api.sendAmsFilamentCommand',
                () => withRetry(() => client.sendAmsFilamentCommand(payload), payload?.retry),
                hooks,
            );
        },
        getActivePrinterId() {
            if (!api) {
                return null;
            }
            if (typeof api.getActivePrinterId === 'function') {
                return api.getActivePrinterId();
            }
            return null;
        },
    };
};

export { createApiService };
export default createApiService;
