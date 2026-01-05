import initModalManager from '../../core/modal_manager.js';

const createCustomFilamentModal = ({
    documentRef,
    actions,
    showToast,
    uiActions,
}) => {
    const globalRef = documentRef?.defaultView || (typeof window !== 'undefined' ? window : globalThis);
    const modalManager = initModalManager(globalRef);
    const modal = {
        root: documentRef.getElementById('custom-filament-modal'),
        backdrop: documentRef.getElementById('custom-filament-modal-backdrop'),
        closeBtn: documentRef.getElementById('custom-filament-modal-close'),
        cancelBtn: documentRef.getElementById('custom-filament-cancel'),
        saveBtn: documentRef.getElementById('custom-filament-save'),
        deleteBtn: documentRef.getElementById('custom-filament-delete'),
        savedSelect: documentRef.getElementById('custom-filament-saved'),
        candidatesSelect: documentRef.getElementById('custom-filament-candidates'),
        aliasInput: documentRef.getElementById('custom-filament-alias'),
        settingIdInput: documentRef.getElementById('custom-filament-setting-id'),
        trayIdxInput: documentRef.getElementById('custom-filament-tray-idx'),
        trayTypeInput: documentRef.getElementById('custom-filament-tray-type'),
        nozzleMinInput: documentRef.getElementById('custom-filament-nozzle-min'),
        nozzleMaxInput: documentRef.getElementById('custom-filament-nozzle-max'),
    };

    const state = {
        isOpen: false,
        slotMeta: null,
        candidates: [],
        customs: [],
    };

    const handleOpen = () => {
        state.isOpen = true;
    };

    const handleClose = () => {
        state.isOpen = false;
    };

    const registerModal = () => {
        if (!modal.root || !modalManager?.register) {
            return;
        }
        if (modalManager.get?.('customFilament')?.element === modal.root) {
            return;
        }
        modalManager.register('customFilament', {
            element: modal.root,
            openClass: null,
            hiddenClass: 'is-hidden',
            gateKey: 'customFilament',
            onOpen: handleOpen,
            onClose: handleClose,
        });
    };

    const normalizeText = (value) => {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).trim();
    };

    const setModalValues = (values = {}) => {
        if (modal.settingIdInput) {
            modal.settingIdInput.value = values.setting_id || '';
        }
        if (modal.trayIdxInput) {
            modal.trayIdxInput.value = values.tray_info_idx || '';
        }
        if (modal.trayTypeInput) {
            modal.trayTypeInput.value = values.tray_type || '';
        }
        if (modal.nozzleMinInput) {
            modal.nozzleMinInput.value =
                values.nozzle_temp_min !== undefined && values.nozzle_temp_min !== null
                    ? String(values.nozzle_temp_min)
                    : '';
        }
        if (modal.nozzleMaxInput) {
            modal.nozzleMaxInput.value =
                values.nozzle_temp_max !== undefined && values.nozzle_temp_max !== null
                    ? String(values.nozzle_temp_max)
                    : '';
        }
    };

    const clearModalValues = () => {
        setModalValues({});
        if (modal.aliasInput) {
            modal.aliasInput.value = '';
        }
    };

    const renderCustoms = () => {
        if (!modal.savedSelect) {
            return;
        }
        modal.savedSelect.innerHTML = '';
        const baseOption = documentRef.createElement('option');
        baseOption.value = '__none__';
        baseOption.textContent = 'Select saved';
        modal.savedSelect.appendChild(baseOption);

        const sorted = [...state.customs].sort((a, b) =>
            String(a?.alias || '').localeCompare(String(b?.alias || ''), 'tr', {
                sensitivity: 'base',
            }),
        );
        if (!sorted.length) {
            const emptyOption = documentRef.createElement('option');
            emptyOption.value = '__empty__';
            emptyOption.textContent = 'No saved';
            emptyOption.disabled = true;
            modal.savedSelect.appendChild(emptyOption);
            modal.savedSelect.value = '__none__';
            return;
        }
        sorted.forEach((custom) => {
            const option = documentRef.createElement('option');
            option.value = custom.tray_info_idx || '';
            const label = custom.alias || custom.tray_info_idx || 'Custom';
            const idxText = custom.tray_info_idx ? ` (${custom.tray_info_idx})` : '';
            option.textContent = `${label}${idxText}`;
            modal.savedSelect.appendChild(option);
        });
        modal.savedSelect.value = '__none__';
    };

    const renderCandidates = () => {
        if (!modal.candidatesSelect) {
            return;
        }
        modal.candidatesSelect.innerHTML = '';
        const newOption = documentRef.createElement('option');
        newOption.value = '__new__';
        newOption.textContent = 'New';
        modal.candidatesSelect.appendChild(newOption);

        if (!state.candidates.length) {
            const emptyOption = documentRef.createElement('option');
            emptyOption.value = '__empty__';
            emptyOption.textContent = 'No captured';
            emptyOption.disabled = true;
            modal.candidatesSelect.appendChild(emptyOption);
            modal.candidatesSelect.value = '__new__';
            return;
        }

        const isAmsSlot = (candidate) => candidate.source === 'ams_slot';
        const isExternalSpool = (candidate) => candidate.source === 'external_spool';
        const commandCandidates = state.candidates.filter(
            (candidate) => !isAmsSlot(candidate) && !isExternalSpool(candidate),
        );
        const amsCandidates = state.candidates.filter((candidate) => isAmsSlot(candidate));
        const externalCandidates = state.candidates.filter((candidate) =>
            isExternalSpool(candidate),
        );

        const sortByIdx = (a, b) =>
            String(a?.tray_info_idx || '').localeCompare(String(b?.tray_info_idx || ''), 'tr', {
                sensitivity: 'base',
            });

        const appendGroup = (label, items, formatter) => {
            if (!items.length) {
                return;
            }
            const group = documentRef.createElement('optgroup');
            group.label = label;
            items.sort(sortByIdx).forEach((candidate) => {
                const option = documentRef.createElement('option');
                option.value = candidate.tray_info_idx || '';
                option.textContent = formatter(candidate);
                group.appendChild(option);
            });
            modal.candidatesSelect.appendChild(group);
        };

        appendGroup('Captured Filaments', commandCandidates, (candidate) => {
            const label = candidate.tray_info_idx || 'Unknown';
            const typeText = candidate.tray_type ? ` (${candidate.tray_type})` : '';
            return `${label}${typeText}`;
        });

        appendGroup('AMS Slot', amsCandidates, (candidate) => {
            const trayId = Number(candidate.tray_id);
            const slotNumber = Number.isFinite(trayId) ? trayId + 1 : null;
            const slotLabel = slotNumber ? `AMS Slot ${slotNumber}` : 'AMS Slot';
            const idxLabel = candidate.tray_info_idx || 'Unknown';
            const typeText = candidate.tray_type ? ` (${candidate.tray_type})` : '';
            return `${slotLabel} - ${idxLabel}${typeText}`;
        });

        appendGroup('External Spool', externalCandidates, (candidate) => {
            const idxLabel = candidate.tray_info_idx || 'Unknown';
            const typeText = candidate.tray_type ? ` (${candidate.tray_type})` : '';
            return `External Spool - ${idxLabel}${typeText}`;
        });
        modal.candidatesSelect.value = '__new__';
    };

    const handleSavedChange = () => {
        if (!modal.savedSelect) {
            return;
        }
        const value = modal.savedSelect.value;
        if (value === '__none__') {
            clearModalValues();
            if (modal.candidatesSelect) {
                modal.candidatesSelect.value = '__new__';
            }
            if (modal.deleteBtn) {
                modal.deleteBtn.disabled = true;
            }
            return;
        }
        const custom = state.customs.find((entry) => entry.tray_info_idx === value);
        if (!custom) {
            clearModalValues();
            if (modal.deleteBtn) {
                modal.deleteBtn.disabled = true;
            }
            return;
        }
        if (modal.candidatesSelect) {
            modal.candidatesSelect.value = '__new__';
        }
        setModalValues(custom);
        if (modal.aliasInput) {
            modal.aliasInput.value = custom.alias || '';
        }
        if (modal.deleteBtn) {
            modal.deleteBtn.disabled = false;
        }
    };

    const handleCandidateChange = () => {
        if (!modal.candidatesSelect) {
            return;
        }
        const value = modal.candidatesSelect.value;
        if (value === '__new__') {
            clearModalValues();
            if (modal.savedSelect) {
                modal.savedSelect.value = '__none__';
            }
            if (modal.deleteBtn) {
                modal.deleteBtn.disabled = true;
            }
            return;
        }
        const candidate = state.candidates.find((entry) => entry.tray_info_idx === value);
        if (!candidate) {
            clearModalValues();
            if (modal.savedSelect) {
                modal.savedSelect.value = '__none__';
            }
            if (modal.deleteBtn) {
                modal.deleteBtn.disabled = true;
            }
            return;
        }
        if (modal.savedSelect) {
            modal.savedSelect.value = '__none__';
        }
        setModalValues(candidate);
        if (modal.aliasInput) {
            modal.aliasInput.value = '';
        }
        if (modal.deleteBtn) {
            modal.deleteBtn.disabled = false;
        }
    };

    const open = async (slotMeta) => {
        state.slotMeta = slotMeta || null;
        state.candidates = [];
        state.customs = [];
        if (typeof actions?.filamentCatalog?.fetchCustomCandidates === 'function') {
            try {
                const payload = await actions.filamentCatalog.fetchCustomCandidates();
                state.candidates = Array.isArray(payload) ? payload : [];
            } catch (error) {
                console.warn('Failed to load custom candidates', error);
                state.candidates = [];
            }
        }
        if (typeof actions?.filamentCatalog?.fetchCustomFilaments === 'function') {
            try {
                const payload = await actions.filamentCatalog.fetchCustomFilaments();
                state.customs = Array.isArray(payload) ? payload : [];
            } catch (error) {
                console.warn('Failed to load custom filaments', error);
                state.customs = [];
            }
        }
        if (state.customs.length && state.candidates.length) {
            const savedIdx = new Set(
                state.customs
                    .map((entry) => entry?.tray_info_idx)
                    .filter((value) => Boolean(value)),
            );
            state.candidates = state.candidates.filter(
                (candidate) => !savedIdx.has(candidate?.tray_info_idx),
            );
        }
        renderCustoms();
        renderCandidates();
        clearModalValues();
        if (modal.deleteBtn) {
            modal.deleteBtn.disabled = true;
        }
        if (modal.savedSelect) {
            modal.savedSelect.value = '__none__';
        }
        registerModal();
        if (modalManager?.open) {
            modalManager.open('customFilament');
            return;
        }
        if (modal.root) {
            modal.root.classList.remove('is-hidden');
            modal.root.setAttribute('aria-hidden', 'false');
        }
        if (uiActions?.setModalGate) {
            uiActions.setModalGate('customFilament');
        }
        handleOpen();
    };

    const close = (options = {}) => {
        if (modalManager?.close) {
            modalManager.close('customFilament', options);
            return;
        }
        handleClose();
        if (modal.root) {
            modal.root.classList.add('is-hidden');
            modal.root.setAttribute('aria-hidden', 'true');
        }
        if (uiActions?.clearModalGate) {
            uiActions.clearModalGate('customFilament');
        }
    };

    const save = async () => {
        if (typeof actions?.filamentCatalog?.saveCustomFilament !== 'function') {
            showToast?.('Custom filament API is not ready.', 'error');
            return;
        }
        const alias = normalizeText(modal.aliasInput?.value);
        const settingId = normalizeText(modal.settingIdInput?.value);
        const trayIdx = normalizeText(modal.trayIdxInput?.value);
        const trayType = normalizeText(modal.trayTypeInput?.value);
        const nozzleMin = Number(modal.nozzleMinInput?.value);
        const nozzleMax = Number(modal.nozzleMaxInput?.value);

        if (!alias || !trayIdx || !trayType) {
            showToast?.('Please fill in all fields.', 'warning');
            return;
        }
        if (!Number.isFinite(nozzleMin) || !Number.isFinite(nozzleMax)) {
            showToast?.('Nozzle temperature values are invalid.', 'warning');
            return;
        }
        try {
            await actions.filamentCatalog.saveCustomFilament({
                alias,
                setting_id: settingId,
                tray_info_idx: trayIdx,
                tray_type: trayType,
                nozzle_temp_min: Math.round(nozzleMin),
                nozzle_temp_max: Math.round(nozzleMax),
            });
            const globalRef = typeof window !== 'undefined' ? window : globalThis;
            if (globalRef?.dispatchEvent) {
                globalRef.dispatchEvent(
                    new CustomEvent('custom-filament-saved', {
                        detail: { slot: state.slotMeta, tray_info_idx: trayIdx },
                    }),
                );
            }
            close();
        } catch (error) {
            console.error('Custom filament save failed', error);
            showToast?.(error?.message || 'Failed to save custom filament.', 'error');
        }
    };

    const remove = async () => {
        if (typeof actions?.filamentCatalog?.deleteCustomFilament !== 'function') {
            showToast?.('Delete API is not ready.', 'error');
            return;
        }
        const trayIdx = normalizeText(modal.trayIdxInput?.value);
        if (!trayIdx) {
            showToast?.('Tray info index is required.', 'warning');
            return;
        }
        const isSaved = state.customs.some((entry) => entry.tray_info_idx === trayIdx);
        if (!isSaved) {
            showToast?.('Select a saved custom filament to delete.', 'warning');
            return;
        }
        if (!window.confirm('Delete custom filament?')) {
            return;
        }
        try {
            await actions.filamentCatalog.deleteCustomFilament(trayIdx);
            const globalRef = typeof window !== 'undefined' ? window : globalThis;
            if (globalRef?.dispatchEvent) {
                globalRef.dispatchEvent(
                    new CustomEvent('custom-filament-deleted', {
                        detail: { slot: state.slotMeta, tray_info_idx: trayIdx },
                    }),
                );
            }
            close();
        } catch (error) {
            console.error('Custom filament delete failed', error);
            showToast?.(error?.message || 'Failed to delete custom filament.', 'error');
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
        modal.saveBtn?.addEventListener('click', save);
        modal.deleteBtn?.addEventListener('click', remove);
        modal.savedSelect?.addEventListener('change', handleSavedChange);
        modal.candidatesSelect?.addEventListener('change', handleCandidateChange);
    };

    registerModal();
    bindEvents();

    return { open, close };
};

export { createCustomFilamentModal };
export default createCustomFilamentModal;
