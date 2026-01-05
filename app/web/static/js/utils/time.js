import { ensureAppContext } from '../core/registry.js';

const initTimeUtils = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const ensure = () => {
        const context = ensureAppContext(global);
        context.utils = context.utils || {
            format: {},
            dom: {},
            time: {},
            network: {},
        };
        return context;
    };

    const formatDuration = (seconds) => {
        if (!Number.isFinite(seconds) || seconds <= 0) {
            return '0s';
        }
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const parts = [];
        if (hrs) parts.push(`${hrs}h`);
        if (mins) parts.push(`${mins}m`);
        if (secs || !parts.length) parts.push(`${secs}s`);
        return parts.join(' ');
    };

    const relativeTime = (timestamp) => {
        const then = Date.parse(timestamp);
        if (Number.isNaN(then)) {
            return '';
        }
        const deltaSeconds = Math.round((Date.now() - then) / 1000);
        if (deltaSeconds < 60) {
            return `${deltaSeconds}s ago`;
        }
        if (deltaSeconds < 3600) {
            return `${Math.floor(deltaSeconds / 60)}m ago`;
        }
        if (deltaSeconds < 86400) {
            return `${Math.floor(deltaSeconds / 3600)}h ago`;
        }
        return `${Math.floor(deltaSeconds / 86400)}d ago`;
    };

    const context = ensure();
    context.utils.time = context.utils.time || {};
    context.utils.time.formatDuration = formatDuration;
    context.utils.time.relativeTime = relativeTime;
    return context.utils.time;
};

export { initTimeUtils };
export default initTimeUtils;
