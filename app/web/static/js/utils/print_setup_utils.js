import { ensureAppContext } from '../core/registry.js';

const initPrintSetupUtils = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const context = ensureAppContext(global);
    context.utils = context.utils || {};
    context.utils.printSetup = context.utils.printSetup || {};

    const formatDuration = (seconds) => {
        if (!seconds) {
            return '---';
        }
        const s = parseInt(seconds, 10);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${h}h ${m}m`;
    };

    const normalizeType = (value) => (value || '').toUpperCase().trim();

    const normalizeColor = (value) => {
        if (!value) {
            return '';
        }
        const raw = String(value).trim().replace(/\s+/g, '');
        if (!raw) {
            return '';
        }
        let hex = raw.replace(/^#/, '');
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
            return hex.toUpperCase();
        }
        return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    };

    const normalizeIdx = (value) => (value || '').toUpperCase().trim();

    const toDisplayColor = (normalized, fallback) => {
        if (normalized) {
            return `#${normalized}`;
        }
        if (!fallback) {
            return '';
        }
        const raw = String(fallback).trim();
        if (!raw) {
            return '';
        }
        if (raw.startsWith('#')) {
            return raw;
        }
        return raw.toUpperCase();
    };

    context.utils.printSetup.formatDuration = formatDuration;
    context.utils.printSetup.normalizeType = normalizeType;
    context.utils.printSetup.normalizeColor = normalizeColor;
    context.utils.printSetup.normalizeIdx = normalizeIdx;
    context.utils.printSetup.toDisplayColor = toDisplayColor;

    return context.utils.printSetup;
};

export { initPrintSetupUtils };
export default initPrintSetupUtils;
