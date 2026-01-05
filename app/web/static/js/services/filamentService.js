import createApiService from './api.js';

const createFilamentService = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const api = createApiService(global);

    return {
        fetchCatalog() {
            return api.fetchWithPrinter('/api/filaments/catalog');
        },
        fetchCustomCandidates() {
            return api.fetchWithPrinter('/api/filaments/custom/candidates');
        },
        fetchCustomFilaments() {
            return api.fetchWithPrinter('/api/filaments/custom');
        },
        saveCustomFilament(payload) {
            return api.postWithPrinter('/api/filaments/custom', payload);
        },
        deleteCustomFilament(trayInfoIdx) {
            const encoded = encodeURIComponent(trayInfoIdx);
            return api.request(`/api/filaments/custom/${encoded}`, {
                method: 'DELETE',
            });
        },
    };
};

export { createFilamentService };
export default createFilamentService;
