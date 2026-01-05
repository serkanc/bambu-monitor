import createApiService from './api.js';

const createStatusService = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const api = createApiService(global);

    return {
        fetchStatus() {
            return api.fetchWithPrinter('/api/status');
        },
        toggleFeature(payload) {
            return api.postWithPrinter('/api/control/features/toggle', payload);
        },
        triggerAmsCommand(payload) {
            return api.sendAmsFilamentCommand(payload);
        },
        setAmsMaterial(payload) {
            return api.postWithPrinter('/api/control/ams/material', payload);
        },
        toggleChamberLight(mode) {
            return api.postWithPrinter('/api/control/chamber-light', { mode });
        },
        setNozzleAccessory(payload) {
            return api.postWithPrinter('/api/control/accessories/nozzle', payload);
        },
    };
};

export { createStatusService };
export default createStatusService;
