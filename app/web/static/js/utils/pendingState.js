import { ensureAppContext } from '../core/registry.js';

const initPendingState = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const DEFAULT_TTL = 5000;

    const createPendingValue = ({ initial = null, ttl = DEFAULT_TTL } = {}) => {
        let baseValue = initial;
        let pendingValue = null;
        let expiresAt = 0;

        const isPendingActive = () => pendingValue !== null && expiresAt > Date.now();

        const get = () => (isPendingActive() ? pendingValue : baseValue);

        const setBase = (value) => {
            baseValue = value;
            if (!isPendingActive() || pendingValue === value) {
                pendingValue = null;
                expiresAt = 0;
            }
        };

        const setPending = (value, overrideTtl) => {
            const duration = Number(overrideTtl) || ttl || DEFAULT_TTL;
            pendingValue = value;
            expiresAt = Date.now() + duration;
        };

        const resetPending = () => {
            pendingValue = null;
            expiresAt = 0;
        };

        return {
            get,
            setBase,
            setPending,
            resetPending,
            isPending: isPendingActive,
            peekBase: () => baseValue,
        };
    };

    const context = ensureAppContext(global);
    context.utils = context.utils || {};
    context.utils.createPendingValue = createPendingValue;
    return context.utils;
};

export { initPendingState };
export default initPendingState;
