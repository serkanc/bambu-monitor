import createApiService from './api.js';

const createCameraService = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const api = createApiService(global);

    const postJson = async (path, payload, options = {}) => {
        const response = await api.request(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
            body: JSON.stringify(payload || {}),
            skipPrinterId: true,
            ...options,
        });
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return response.json();
        }
        return {};
    };

    return {
        requestWebrtcOffer(signalingUrl, payload) {
            if (!signalingUrl) {
                throw new Error('Missing signaling URL');
            }
            return postJson(signalingUrl, payload);
        },
        keepalive(sessionId) {
            return postJson('/api/camera/webrtc/keepalive', { session_id: sessionId });
        },
        release(sessionId) {
            return postJson('/api/camera/webrtc/release', { session_id: sessionId });
        },
    };
};

export { createCameraService };
export default createCameraService;
