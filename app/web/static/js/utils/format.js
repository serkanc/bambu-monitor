import { ensureAppContext } from '../core/registry.js';

const initFormatUtils = (global = typeof window !== 'undefined' ? window : globalThis) => {
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

    const escapeHtml = (text) => {
        const element = document.createElement('div');
        element.textContent = text ?? '';
        return element.innerHTML;
    };

    const escapeAttribute = (value) => {
        const raw = value === undefined || value === null ? '' : String(value);
        return raw
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    };

    const formatBytes = (value) => {
        const bytes = Number(value);
        if (!Number.isFinite(bytes)) {
            return '-';
        }
        if (bytes <= 0) {
            return '0 B';
        }
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        const formatted = bytes / 1024 ** exponent;
        return `${formatted.toFixed(formatted < 10 && exponent > 0 ? 1 : 0)} ${units[exponent]}`;
    };

    const context = ensure();
    context.utils.format = context.utils.format || {};
    context.utils.format.escapeHtml = escapeHtml;
    context.utils.format.escapeAttribute = escapeAttribute;
    context.utils.format.formatBytes = formatBytes;
    return context.utils.format;
};

export { initFormatUtils };
export default initFormatUtils;
