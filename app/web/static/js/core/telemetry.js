import { ensureAppContext } from './registry.js';

const initTelemetry = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const context = ensureAppContext(global);
    const entries = [];
    const MAX_ENTRIES = 200;
    const DEFAULT_SLOW_THRESHOLD_MS = 2000;

    const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

    const record = (name, durationMs, meta = {}) => {
        if (!name || !Number.isFinite(durationMs)) {
            return;
        }
        const entry = {
            name,
            durationMs,
            at: Date.now(),
            ...meta,
        };
        entries.push(entry);
        if (entries.length > MAX_ENTRIES) {
            entries.shift();
        }
        const threshold =
            context.serviceHooks?.slowThresholdMs ??
            context.telemetry?.slowThresholdMs ??
            DEFAULT_SLOW_THRESHOLD_MS;
        if (durationMs >= threshold) {
            console.warn('[telemetry:slow]', entry);
        }
    };

    const time = (name, fn, meta = {}) => {
        const start = now();
        try {
            const result = fn();
            if (result && typeof result.then === 'function') {
                return result.finally(() => {
                    record(name, now() - start, meta);
                });
            }
            record(name, now() - start, meta);
            return result;
        } catch (error) {
            record(name, now() - start, { ...meta, ok: false, error: error?.message || String(error) });
            throw error;
        }
    };

    const mark = (name) => {
        if (typeof performance !== 'undefined' && performance.mark) {
            performance.mark(name);
        }
    };

    const measure = (name, startMark, endMark) => {
        if (typeof performance !== 'undefined' && performance.measure) {
            performance.measure(name, startMark, endMark);
            const entries = performance.getEntriesByName(name);
            const latest = entries[entries.length - 1];
            if (latest && Number.isFinite(latest.duration)) {
                record(name, latest.duration, { source: 'performance' });
            }
        }
    };

    const reportError = (error, contextName = 'unhandled') => {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`[telemetry:${contextName}]`, err);
        context.serviceHooks?.onError?.(err, { name: `telemetry.${contextName}` });
    };

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('error', (event) => {
            reportError(event?.error || event?.message || 'unknown error', 'error');
        });
        global.addEventListener('unhandledrejection', (event) => {
            reportError(event?.reason || 'unhandled rejection', 'unhandledrejection');
        });
    }

    context.telemetry = {
        entries,
        time,
        mark,
        measure,
        record,
        slowThresholdMs: DEFAULT_SLOW_THRESHOLD_MS,
    };

    return context.telemetry;
};

export { initTelemetry };
export default initTelemetry;
