import initModalManager from '../../core/modal_manager.js';

const createPrintErrorModal = ({ documentRef, getPrintErrorState, setPrintErrorState }) => {
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    const globalRef = doc?.defaultView || (typeof window !== 'undefined' ? window : globalThis);
    const modalManager = initModalManager(globalRef);
    const modal = doc ? doc.getElementById('print-error-modal') : null;
    const modalMessage = doc ? doc.getElementById('print-error-modal-message') : null;
    const modalCode = doc ? doc.getElementById('print-error-modal-code') : null;
    const modalClose = doc ? doc.getElementById('print-error-modal-close') : null;
    const modalBackdrop = doc ? doc.getElementById('print-error-modal-backdrop') : null;
    const setInertState =
        doc?.defaultView?.appContext?.utils?.dom?.setInertState ||
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
            const activeElement = doc?.activeElement instanceof HTMLElement ? doc.activeElement : null;
            if (activeElement && element.contains(activeElement) && typeof activeElement.blur === 'function') {
                activeElement.blur();
            }
            element.setAttribute('aria-hidden', 'true');
            element.setAttribute('inert', '');
            element.inert = true;
        });

    let previousFocus = null;

    const focusModal = () => {
        if (!modal) {
            return;
        }
        previousFocus = doc?.activeElement instanceof HTMLElement ? doc.activeElement : null;
        if (modalClose && typeof modalClose.focus === 'function') {
            modalClose.focus();
        }
    };

    const moveFocusOutside = () => {
        if (!modal) {
            return;
        }
        const activeElement = doc?.activeElement instanceof HTMLElement ? doc.activeElement : null;
        if (activeElement && modal.contains(activeElement)) {
            activeElement.blur();
        }
        if (doc?.body && typeof doc.body.focus === 'function') {
            doc.body.setAttribute('tabindex', '-1');
            doc.body.focus();
            doc.body.removeAttribute('tabindex');
        }
    };

    const restoreFocus = () => {
        if (!modal) {
            return;
        }
        moveFocusOutside();
        if (previousFocus && typeof previousFocus.focus === 'function') {
            previousFocus.focus();
        }
        previousFocus = null;
    };

    const registerModal = () => {
        if (!modal || !modalManager?.register) {
            return;
        }
        if (modalManager.get?.('printError')?.element === modal) {
            return;
        }
        modalManager.register('printError', {
            element: modal,
            openClass: null,
            hiddenClass: 'is-hidden',
            gateKey: 'printError',
            focusRestore: false,
            onOpen: focusModal,
            onClose: restoreFocus,
        });
    };

    const setVisibility = (visible) => {
        if (!modal) {
            return;
        }
        registerModal();
        if (visible) {
            if (modalManager?.open) {
                modalManager.open('printError');
                return;
            }
            modal.classList.remove('is-hidden');
            setInertState(modal, true);
            doc?.defaultView?.appContext?.actions?.ui?.setModalGate?.('printError');
            focusModal();
            return;
        }
        if (modalManager?.close) {
            modalManager.close('printError', { force: true });
            return;
        }
        restoreFocus();
        modal.classList.add('is-hidden');
        setInertState(modal, false);
        doc?.defaultView?.appContext?.actions?.ui?.clearModalGate?.('printError');
    };

    const show = (error) => {
        if (!modal) {
            return;
        }
        if (modalMessage) {
            modalMessage.textContent = error.description ?? '';
        }
        if (modalCode) {
            modalCode.textContent = error.code ? `Code: ${error.code}` : '';
        }
        const nextCode = error.code ?? null;
        const { lastDisplayed } = getPrintErrorState();
        if (lastDisplayed !== nextCode) {
            setPrintErrorState({ lastDisplayedPrintErrorCode: nextCode });
        }
        setVisibility(true);
    };

    const hide = () => {
        setVisibility(false);
    };

    const acknowledge = () => {
        const { lastDisplayed } = getPrintErrorState();
        if (lastDisplayed) {
            const { lastAcknowledged } = getPrintErrorState();
            if (lastAcknowledged !== lastDisplayed) {
                setPrintErrorState({ lastAcknowledgedPrintErrorCode: lastDisplayed });
            }
        }
        hide();
    };

    const updatePrintError = (error) => {
        if (!error || !error.description) {
            const { lastDisplayed, lastAcknowledged } = getPrintErrorState();
            if (lastDisplayed !== null || lastAcknowledged !== null) {
                setPrintErrorState({
                    lastDisplayedPrintErrorCode: null,
                    lastAcknowledgedPrintErrorCode: null,
                });
            }
            hide();
            return;
        }

        const code = error.code ?? null;
        const { lastAcknowledged } = getPrintErrorState();
        if (code === lastAcknowledged) {
            return;
        }
        show(error);
    };

    const resetCache = () => {
        setPrintErrorState({
            lastDisplayedPrintErrorCode: null,
            lastAcknowledgedPrintErrorCode: null,
        });
    };

    const bindEvents = () => {
        if (modalClose) {
            modalClose.addEventListener('click', (event) => {
                event.preventDefault();
                acknowledge();
            });
        }
        if (modalBackdrop) {
            modalBackdrop.addEventListener('click', () => {
                acknowledge();
            });
        }
    };

    registerModal();

    return {
        bindEvents,
        updatePrintError,
        resetCache,
    };
};

export { createPrintErrorModal };
export default createPrintErrorModal;
