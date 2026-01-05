import { ensureAppContext } from './registry.js';

const normalizeFlagValue = (value) => {
    if (typeof value === 'string') {
        const normalized = value.toLowerCase();
        if (normalized === 'true') {
            return true;
        }
        if (normalized === 'false') {
            return false;
        }
    }
    return Boolean(value);
};

const normalizeFlags = (flags) => {
    const source = flags && typeof flags === 'object' ? flags : {};
    const result = {};
    Object.entries(source).forEach(([key, value]) => {
        result[key] = normalizeFlagValue(value);
    });
    return result;
};

const initFeatureFlags = (global = typeof window !== 'undefined' ? window : globalThis, defaults = {}) => {
    const context = ensureAppContext(global);
    if (context.features) {
        if (defaults && typeof context.features.define === 'function') {
            context.features.define(defaults);
        }
        return context.features;
    }

    const configFlags =
        global?.__APP_CONFIG__?.featureFlags ||
        global?.__APP_CONFIG__?.features ||
        global?.__FEATURE_FLAGS__ ||
        {};
    const state = {
        ...normalizeFlags(defaults),
        ...normalizeFlags(configFlags),
    };

    const all = () => ({ ...state });
    const get = (key, fallback = false) =>
        Object.prototype.hasOwnProperty.call(state, key) ? state[key] : Boolean(fallback);
    const set = (key, value) => {
        state[key] = normalizeFlagValue(value);
        return state[key];
    };
    const enable = (key) => set(key, true);
    const disable = (key) => set(key, false);
    const isEnabled = (key, fallback = false) => Boolean(get(key, fallback));
    const define = (values = {}) => {
        Object.entries(normalizeFlags(values)).forEach(([key, value]) => {
            if (!Object.prototype.hasOwnProperty.call(state, key)) {
                state[key] = value;
            }
        });
        return all();
    };
    const load = (values = {}) => {
        Object.entries(normalizeFlags(values)).forEach(([key, value]) => {
            state[key] = value;
        });
        return all();
    };

    const features = {
        all,
        get,
        set,
        enable,
        disable,
        isEnabled,
        define,
        load,
    };

    context.features = features;
    context.featureFlags = state;
    return features;
};

export { initFeatureFlags };
export default initFeatureFlags;
