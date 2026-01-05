import { ensureAppContext } from './registry.js';

const initSmoke = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const context = ensureAppContext(global);
    const telemetry = context.telemetry || null;

    const readSearchParams = () => {
        try {
            if (typeof window === 'undefined') {
                return new URLSearchParams();
            }
            return new URLSearchParams(window.location.search);
        } catch (_error) {
            return new URLSearchParams();
        }
    };

    const isEnabled = () => {
        const params = readSearchParams();
        if (params.has('smoke')) {
            return true;
        }
        try {
            return localStorage.getItem('bambu.smoke') === '1';
        } catch (_error) {
            return false;
        }
    };

    const check = (name, fn) => {
        try {
            const ok = Boolean(fn());
            return { name, ok };
        } catch (error) {
            return {
                name,
                ok: false,
                error: error?.message || String(error),
            };
        }
    };

    const checkElement = (selector) =>
        check(`dom:${selector}`, () => Boolean(global.document?.querySelector(selector)));

    const checkFn = (name, fn) =>
        check(`fn:${name}`, () => typeof fn === 'function');

    const run = ({ log = true } = {}) => {
        const start = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const results = [];
        results.push(check('appContext', () => Boolean(context)));
        results.push(check('store.core', () => Boolean(context.stores?.core)));
        results.push(checkFn('store.getState', context.stores?.core?.getState));
        results.push(checkFn('store.subscribe', context.stores?.core?.subscribe));
        results.push(check('services.api', () => Boolean(context.services?.api)));
        results.push(check('services.status', () => Boolean(context.services?.status)));
        results.push(check('services.controls', () => Boolean(context.services?.controls)));
        results.push(check('services.printers', () => Boolean(context.services?.printers)));
        results.push(check('services.files', () => Boolean(context.services?.files)));
        results.push(check('selectors.core', () => Boolean(context.selectors?.statusPanel)));
        results.push(checkFn('eventRegistry.bindAllEvents', context.eventRegistry?.bindAllEvents));

        if (typeof global.document !== 'undefined') {
            [
                '#printer-list',
                '#printer-sidebar',
                '#event-sidebar',
                '#camera-frame',
                '#camera-placeholder',
                '#file-list',
                '#transfer-overlay',
                '#print-setup-modal',
                '#pause-resume-btn',
                '#cancel-btn',
            ].forEach((selector) => results.push(checkElement(selector)));
        }

        const durationMs =
            (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - start;
        const failed = results.filter((entry) => !entry.ok);
        const summary = {
            ok: failed.length === 0,
            failed,
            durationMs,
            at: new Date().toISOString(),
        };

        context.smoke = context.smoke || {};
        context.smoke.lastReport = summary;

        if (telemetry?.record) {
            telemetry.record('smoke.run', durationMs, { ok: summary.ok, failures: failed.length });
        }

        if (log) {
            if (summary.ok) {
                console.log('[smoke] ok', summary);
            } else {
                console.warn('[smoke] failed', summary);
            }
        }

        return summary;
    };

    const autoRun = () => {
        if (!isEnabled()) {
            return;
        }
        run({ log: true });
    };

    context.smoke = {
        run,
        autoRun,
        lastReport: null,
    };

    return context.smoke;
};

export { initSmoke };
export default initSmoke;
