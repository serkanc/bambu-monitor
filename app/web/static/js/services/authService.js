import createApiService from './api.js';

const createAuthService = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const api = createApiService(global);

    const fetchJson = (path, options = {}) => {
        return api.fetchJSON(path, {
            credentials: 'same-origin',
            ...options,
        });
    };

    const postJson = (path, payload = {}, options = {}) => {
        return fetchJson(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
            body: JSON.stringify(payload || {}),
            ...options,
        });
    };

    return {
        login(username, password) {
            return postJson('/api/auth/login', { username, password });
        },
        setupPassword(password) {
            return postJson('/api/auth/setup-password', { password });
        },
        logout() {
            return postJson('/api/auth/logout');
        },
        changePassword(currentPassword, newPassword) {
            return postJson('/api/auth/change-password', {
                current_password: currentPassword,
                new_password: newPassword,
            });
        },
        getTokens() {
            return fetchJson('/api/auth/tokens');
        },
        rotateApiToken() {
            return postJson('/api/auth/api-token/rotate');
        },
        rotateAdminToken() {
            return postJson('/api/auth/admin-token/rotate');
        },
        getAllowlist() {
            return fetchJson('/api/auth/allowlist');
        },
        updateAllowlist(allowlist) {
            return postJson('/api/auth/allowlist', {
                allowlist: Array.isArray(allowlist) ? allowlist : [],
            });
        },
        rotateSessionSecret() {
            return postJson('/api/auth/session-secret/rotate');
        },
        getCacheStatus() {
            return fetchJson('/api/auth/cache/status');
        },
        cleanCache(days) {
            return postJson('/api/auth/cache/clean', { days });
        },
        getCacheSettings() {
            return fetchJson('/api/auth/cache/settings');
        },
        updateCacheSettings(payload) {
            return postJson('/api/auth/cache/settings', payload);
        },
    };
};

export { createAuthService };
export default createAuthService;
