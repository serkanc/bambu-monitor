import initModalManager from '../../core/modal_manager.js';

const createNozzleModal = ({
    documentRef,
    actions,
    showToast,
    getSnapshot,
    uiActions,
}) => {
    const globalRef = documentRef?.defaultView || (typeof window !== 'undefined' ? window : globalThis);
    const modalManager = initModalManager(globalRef);
    const modal = {
        root: documentRef.getElementById('nozzle-modal'),
        backdrop: documentRef.getElementById('nozzle-modal-backdrop'),
        closeBtn: documentRef.getElementById('nozzle-modal-close'),
        cancelBtn: documentRef.getElementById('nozzle-modal-cancel'),
        confirmBtn: documentRef.getElementById('nozzle-modal-confirm'),
        typeOptions: documentRef.getElementById('nozzle-type-options'),
        diameterOptions: documentRef.getElementById('nozzle-diameter-options'),
    };

    const state = {
        isOpen: false,
        isSaving: false,
        type: null,
        diameter: null,
    };

    const nozzleTypeLabels = {
        stainless_steel: 'Stainless Steel',
        hardened_steel: 'Hardened Steel',
    };

    const nozzleDiameterMap = {
        stainless_steel: [0.2, 0.4],
        hardened_steel: [0.4, 0.6, 0.8],
    };

    const formatTypeLabel = (value) => nozzleTypeLabels[value] || value || '-';
    const normalizeType = (value) =>
        Object.prototype.hasOwnProperty.call(nozzleTypeLabels, value)
            ? value
            : 'stainless_steel';

    const setModalState = (next) => {
        state.type = next.type ?? state.type;
        state.diameter = next.diameter ?? state.diameter;
    };

    const handleOpen = () => {
        state.isOpen = true;
    };

    const handleClose = () => {
        state.isOpen = false;
        state.isSaving = false;
    };

    const registerModal = () => {
        if (!modal.root || !modalManager?.register) {
            return;
        }
        if (modalManager.get?.('nozzle')?.element === modal.root) {
            return;
        }
        modalManager.register('nozzle', {
            element: modal.root,
            openClass: null,
            hiddenClass: 'is-hidden',
            gateKey: 'nozzle',
            onOpen: handleOpen,
            onClose: handleClose,
        });
    };

    const renderOptions = () => {
        if (!modal.typeOptions || !modal.diameterOptions) {
            return;
        }
        modal.typeOptions.innerHTML = '';
        modal.diameterOptions.innerHTML = '';

        Object.keys(nozzleTypeLabels).forEach((type) => {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = 'nozzle-option-btn';
            button.textContent = formatTypeLabel(type);
            button.dataset.nozzleType = type;
            if (state.type === type) {
                button.classList.add('is-active');
            }
            button.addEventListener('click', () => {
                setModalState({ type });
                const allowed = nozzleDiameterMap[type] || [];
                if (!allowed.includes(state.diameter)) {
                    setModalState({ diameter: allowed[0] ?? null });
                }
                renderOptions();
            });
            modal.typeOptions.appendChild(button);
        });

        const diameterList = nozzleDiameterMap[state.type] || [];
        diameterList.forEach((value) => {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = 'nozzle-option-btn';
            button.textContent = value.toFixed(1);
            button.dataset.nozzleDiameter = String(value);
            if (Number(state.diameter) === value) {
                button.classList.add('is-active');
            }
            button.addEventListener('click', () => {
                setModalState({ diameter: value });
                renderOptions();
            });
            modal.diameterOptions.appendChild(button);
        });
    };

    const open = () => {
        const snapshot = getSnapshot?.() || {};
        const printStatus = snapshot.printStatus || {};
        const type = normalizeType(printStatus.nozzle_type || 'stainless_steel');
        const diameter = Number(printStatus.nozzle_diameter) || null;
        const allowed = nozzleDiameterMap[type] || [];
        const safeDiameter = allowed.includes(diameter) ? diameter : allowed[0] ?? null;
        setModalState({ type, diameter: safeDiameter });
        renderOptions();
        registerModal();
        if (modalManager?.open) {
            modalManager.open('nozzle');
            return;
        }
        if (modal.root) {
            modal.root.classList.remove('is-hidden');
            modal.root.setAttribute('aria-hidden', 'false');
        }
        if (uiActions?.setModalGate) {
            uiActions.setModalGate('nozzle');
        }
        handleOpen();
    };

    const close = (options = {}) => {
        if (modalManager?.close) {
            modalManager.close('nozzle', options);
            return;
        }
        handleClose();
        if (modal.root) {
            modal.root.classList.add('is-hidden');
            modal.root.setAttribute('aria-hidden', 'true');
        }
        if (uiActions?.clearModalGate) {
            uiActions.clearModalGate('nozzle');
        }
    };

    const confirm = async () => {
        if (state.isSaving) {
            return;
        }
        const snapshot = getSnapshot?.() || {};
        if (!snapshot?.online) {
            showToast?.('Printer must be online to update nozzle settings.', 'error');
            return;
        }
        if (!state.type || !state.diameter) {
            showToast?.('Select both type and diameter.', 'error');
            return;
        }
        const action = actions?.statusPanel?.setNozzleAccessory;
        if (typeof action !== 'function') {
            showToast?.('Nozzle command unavailable.', 'error');
            return;
        }
        state.isSaving = true;
        try {
            await action({
                nozzle_type: state.type,
                nozzle_diameter: Number(state.diameter),
            });
            showToast?.('Nozzle settings updated.', 'success');
            close();
        } catch (error) {
            showToast?.(error?.message || 'Failed to update nozzle settings.', 'error');
        } finally {
            state.isSaving = false;
        }
    };

    const bindEvents = () => {
        if (modal.backdrop && !modal.backdrop.dataset?.modalClose) {
            modal.backdrop.addEventListener('click', close);
        }
        if (modal.closeBtn && !modal.closeBtn.dataset?.modalClose) {
            modal.closeBtn.addEventListener('click', close);
        }
        if (modal.cancelBtn && !modal.cancelBtn.dataset?.modalClose) {
            modal.cancelBtn.addEventListener('click', close);
        }
        modal.confirmBtn?.addEventListener('click', confirm);
    };

    registerModal();
    bindEvents();

    return { open, close };
};

export { createNozzleModal };
export default createNozzleModal;
