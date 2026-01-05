import createApiService from './api.js';

const createControlsService = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const api = createApiService(global);

    return {
        postCommand(payload) {
            return api.postWithPrinter('/api/control/command', payload);
        },
        setChamberLight(mode) {
            return api.postWithPrinter('/api/control/chamber-light', { mode });
        },
        skipObjects(objList, sequenceId = '0') {
            return api.postWithPrinter('/api/control/skip-objects', {
                obj_list: Array.isArray(objList) ? objList : [],
                sequence_id: sequenceId,
            });
        },
    };
};

export { createControlsService };
export default createControlsService;
