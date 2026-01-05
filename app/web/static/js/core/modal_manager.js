import { ensureAppContext } from './registry.js';

const initModalManager = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const context = ensureAppContext(global);
    context.modals = context.modals || {};

    if (context.modals.manager) {
        return context.modals.manager;
    }

    const doc = global.document;
    if (!doc) {
        const noop = {
            register: () => null,
            open: () => false,
            close: () => false,
            toggle: () => false,
            isOpen: () => false,
            get: () => null,
        };
        context.modals.manager = noop;
        return noop;
    }

    const registry = new Map();
    let openStack = [];
    let listenersBound = false;

    const setInertState =
        context.utils?.dom?.setInertState ||
        ((element, isVisible) => {
            if (!element) {
                return;
            }
            if (isVisible) {
                element.setAttribute('aria-hidden', 'false');
                element.removeAttribute('inert');
                element.inert = false;
                return;
            }
            const activeElement = doc.activeElement;
            if (activeElement && element.contains(activeElement) && typeof activeElement.blur === 'function') {
                activeElement.blur();
            }
            element.setAttribute('aria-hidden', 'true');
            element.setAttribute('inert', '');
            element.inert = true;
        });

    const resolveElement = (id, config) => {
        if (config?.element) {
            return config.element;
        }
        if (!id) {
            return null;
        }
        return doc.querySelector(`[data-modal-id="${id}"]`) || doc.getElementById(id);
    };

    const syncInitialState = (config, element) => {
        if (!element) {
            return;
        }
        const openClass = config?.openClass === undefined ? 'is-open' : config?.openClass;
        const hiddenClass = config?.hiddenClass || null;
        const isOpen = openClass
            ? element.classList.contains(openClass)
            : hiddenClass
            ? !element.classList.contains(hiddenClass)
            : false;
        setInertState(element, isOpen);
        if (isOpen) {
            openStack = openStack.filter((openId) => openId !== config.id);
            openStack.push(config.id);
        }
    };

    const setModalState = (id, isOpen, options = {}) => {
        const config = registry.get(id);
        const element = resolveElement(id, config);
        if (!element) {
            return false;
        }
        if (!isOpen && config?.canClose && options.force !== true) {
            const allowed = config.canClose({ id, element, event: options.event || null });
            if (allowed === false) {
                return false;
            }
        }
        if (isOpen && config?.focusRestore !== false) {
            config.lastActiveElement = doc.activeElement || null;
        }
        const openClass = config?.openClass === undefined ? 'is-open' : config?.openClass;
        if (openClass) {
            element.classList.toggle(openClass, isOpen);
        }
        if (config?.hiddenClass) {
            element.classList.toggle(config.hiddenClass, !isOpen);
        }
        if (config?.useInert === false) {
            element.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        } else {
            setInertState(element, isOpen);
        }

        const gateKey = config?.gateKey === undefined ? id : config?.gateKey;
        const uiActions = context.actions?.ui;
        if (gateKey && uiActions) {
            if (isOpen) {
                uiActions.setModalGate?.(gateKey);
            } else {
                uiActions.clearModalGate?.(gateKey);
            }
        }

        if (isOpen) {
            openStack = openStack.filter((openId) => openId !== id);
            openStack.push(id);
            config?.onOpen?.({ id, element, event: options.event || null });
        } else {
            openStack = openStack.filter((openId) => openId !== id);
            config?.onClose?.({ id, element, event: options.event || null });
            if (config?.focusRestore !== false) {
                const previous = config.lastActiveElement;
                config.lastActiveElement = null;
                if (
                    previous &&
                    typeof previous.focus === 'function' &&
                    (previous.isConnected === undefined || previous.isConnected)
                ) {
                    previous.focus();
                }
            }
        }

        return true;
    };

    const register = (id, config = {}) => {
        if (!id) {
            return null;
        }
        const entry = {
            id,
            element: config.element || null,
            openClass: config.openClass,
            hiddenClass: config.hiddenClass || null,
            gateKey: config.gateKey === undefined ? id : config.gateKey,
            onOpen: config.onOpen || null,
            onClose: config.onClose || null,
            canClose: config.canClose || null,
            focusRestore: config.focusRestore !== false,
            lastActiveElement: null,
            useInert: config.useInert !== false,
        };
        registry.set(id, entry);
        syncInitialState(entry, resolveElement(id, entry));
        if (!listenersBound) {
            bindEvents();
        }
        return entry;
    };

    const open = (id, options = {}) => setModalState(id, true, options);
    const close = (id, options = {}) => setModalState(id, false, options);
    const toggle = (id, options = {}) => {
        const config = registry.get(id);
        const element = resolveElement(id, config);
        if (!element) {
            return false;
        }
        const openClass = config?.openClass === undefined ? 'is-open' : config?.openClass;
        const hiddenClass = config?.hiddenClass || null;
        const isOpen = openClass
            ? element.classList.contains(openClass)
            : hiddenClass
            ? !element.classList.contains(hiddenClass)
            : false;
        return setModalState(id, !isOpen, options);
    };

    const isOpen = (id) => {
        const config = registry.get(id);
        const element = resolveElement(id, config);
        if (!element) {
            return false;
        }
        const openClass = config?.openClass === undefined ? 'is-open' : config?.openClass;
        const hiddenClass = config?.hiddenClass || null;
        return openClass
            ? element.classList.contains(openClass)
            : hiddenClass
            ? !element.classList.contains(hiddenClass)
            : false;
    };

    const get = (id) => registry.get(id) || null;

    const resolveModalId = (element) => {
        if (!element) {
            return null;
        }
        const dataId = element.dataset?.modalId;
        if (dataId) {
            return dataId;
        }
        return element.id || null;
    };

    const bindEvents = () => {
        if (listenersBound) {
            return;
        }
        listenersBound = true;
        doc.addEventListener('click', (event) => {
            const openTarget = event.target?.closest?.('[data-modal-open]');
            if (openTarget) {
                const id = openTarget.dataset.modalOpen || null;
                if (id && registry.has(id)) {
                    event.preventDefault();
                    open(id, { event });
                }
                return;
            }
            const closeTarget = event.target?.closest?.('[data-modal-close]');
            if (!closeTarget) {
                return;
            }
            let id = closeTarget.dataset.modalClose || null;
            if (!id) {
                const container = closeTarget.closest?.('[data-modal-id]');
                id = resolveModalId(container);
            }
            if (id && registry.has(id)) {
                event.preventDefault();
                close(id, { event });
            }
        });
        doc.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') {
                return;
            }
            const activeId = openStack[openStack.length - 1] || null;
            if (activeId) {
                close(activeId, { event });
            }
        });
    };

    const manager = {
        register,
        open,
        close,
        toggle,
        isOpen,
        get,
    };

    context.modals.manager = manager;
    return manager;
};

export { initModalManager };
export default initModalManager;
