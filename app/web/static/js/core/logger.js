import { ensureAppContext } from './registry.js';

const LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 50,
};

const normalizeLevel = (value) => {
    if (!value) {
        return 'info';
    }
    if (typeof value !== 'string') {
        return 'info';
    }
    const key = value.toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEVELS, key) ? key : 'info';
};

const initLogger = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const context = ensureAppContext(global);
    if (context.logger) {
        return context.logger;
    }

    const state = {
        level: normalizeLevel(global?.__APP_CONFIG__?.logLevel),
    };

    const shouldLog = (level) => LEVELS[level] >= LEVELS[state.level];

    const emit = (method, scope, args) => {
        if (!shouldLog(method)) {
            return;
        }
        const target = console[method] || console.log;
        if (scope) {
            target(`[${scope}]`, ...args);
        } else {
            target(...args);
        }
    };

    const createLogger = (scope = '') => {
        const nextScope = scope ? String(scope) : '';
        return {
            debug: (...args) => emit('debug', nextScope, args),
            info: (...args) => emit('info', nextScope, args),
            warn: (...args) => emit('warn', nextScope, args),
            error: (...args) => emit('error', nextScope, args),
            log: (...args) => emit('info', nextScope, args),
            child: (childScope) => {
                const suffix = childScope ? String(childScope) : '';
                const combined = nextScope ? `${nextScope}:${suffix}` : suffix;
                return createLogger(combined);
            },
            setLevel: (level) => {
                state.level = normalizeLevel(level);
                return state.level;
            },
            getLevel: () => state.level,
            isEnabled: (level) => shouldLog(normalizeLevel(level)),
        };
    };

    context.logger = createLogger('');
    return context.logger;
};

export { initLogger };
export default initLogger;
