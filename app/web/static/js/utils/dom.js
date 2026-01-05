import { ensureAppContext } from '../core/registry.js';

const initDomUtils = (global = typeof window !== 'undefined' ? window : globalThis) => {
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

    const TOAST_TYPE_MAP = {
        success: 'success',
        info: 'info',
        warning: 'warning',
        warn: 'warning',
        error: 'error',
        danger: 'error',
    };

    function normalizeToastType(type) {
        if (!type) {
            return 'info';
        }
        if (typeof type === 'string') {
            const key = type.toLowerCase();
            return TOAST_TYPE_MAP[key] || 'info';
        }
        return 'info';
    }

    function showToast(message, type = 'info', duration = 4000) {
        const toastType = normalizeToastType(type);
        const toast = document.createElement('div');
        toast.className = `ui-toast ui-toast--${toastType}`;
        toast.textContent = message;

        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            toast.addEventListener(
                'transitionend',
                () => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                },
                { once: true },
            );
        }, duration);
    }

    function setInertState(element, isVisible) {
        if (!element) {
            return;
        }
        if (isVisible) {
            element.setAttribute('aria-hidden', 'false');
            element.removeAttribute('inert');
            element.inert = false;
            return;
        }
        const activeElement = document.activeElement;
        if (activeElement && element.contains(activeElement) && typeof activeElement.blur === 'function') {
            activeElement.blur();
        }
        element.setAttribute('aria-hidden', 'true');
        element.setAttribute('inert', '');
        element.inert = true;
    }

    const context = ensure();
    context.utils.dom = context.utils.dom || {};
    context.utils.dom.showToast = showToast;
    context.utils.dom.normalizeToastType = normalizeToastType;
    context.utils.dom.setInertState = setInertState;
    return context.utils.dom;
};

export { initDomUtils };
export default initDomUtils;
