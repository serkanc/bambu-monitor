import createApiService from './api.js';

const createPrinterService = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const api = createApiService(global);

    return {
        fetchPrinters() {
            return api.getPrinters();
        },
        request(path, options = {}) {
            return api.request(path, options);
        },
        getEvents(params = {}) {
            return api.getEvents(params);
        },
        clearEvents(params = {}) {
            return api.clearEvents(params);
        },
    };
};

export { createPrinterService };
export default createPrinterService;
