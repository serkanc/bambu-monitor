import initModalManager from '../../core/modal_manager.js';

const createAmsMaterialModal = ({
    documentRef,
    selectors,
    getSnapshot,
    showToast,
    uiActions,
    filamentActions,
}) => {
    const globalRef = documentRef?.defaultView || (typeof window !== 'undefined' ? window : globalThis);
    const modalManager = initModalManager(globalRef);
    const modal = {
        root: documentRef.getElementById('ams-material-modal'),
        backdrop: documentRef.getElementById('ams-material-modal-backdrop'),
        closeBtn: documentRef.getElementById('ams-material-modal-close'),
        closeFooterBtn: documentRef.getElementById('ams-material-close'),
        confirmBtn: documentRef.getElementById('ams-material-confirm'),
        resetBtn: documentRef.getElementById('ams-material-reset'),
        filamentSelect: documentRef.getElementById('ams-material-filament'),
        nozzleMax: documentRef.getElementById('ams-material-nozzle-max'),
        nozzleMin: documentRef.getElementById('ams-material-nozzle-min'),
        colorBtn: documentRef.getElementById('ams-material-color-btn'),
        colorSwatch: documentRef.getElementById('ams-material-color-swatch'),
        colorPopover: documentRef.getElementById('ams-material-color-popover'),
        colorAms: documentRef.getElementById('ams-material-color-ams'),
        colorList: documentRef.getElementById('ams-material-color-list'),
        colorCustom: documentRef.getElementById('ams-material-color-custom'),
    };

    const fixedColors = [
        '#ffffff',
        '#fff144',
        '#dcf478',
        '#0acc38',
        '#057748',
        '#0d6284',
        '#0ee2a0',
        '#76d9f4',
        '#46a8f9',
        '#2850e0',
        '#443089',
        '#a03cf7',
        '#f330f9',
        '#d4b1dd',
        '#f95d73',
        '#f72323',
        '#7c4b00',
        '#f98c36',
        '#fcecd6',
        '#d3c5a3',
        '#af7933',
        '#898989',
        '#bcbcbc',
        '#161616',
    ];

    const state = {
        isOpen: false,
        slotMeta: null,
        baseline: null,
        catalog: [],
        selectedKey: null,
        selectedColor: '#ffffff',
    };

    const handleOpen = () => {
        state.isOpen = true;
    };

    const handleClose = () => {
        state.isOpen = false;
        closeColorPopover();
    };

    const registerModal = () => {
        if (!modal.root || !modalManager?.register) {
            return;
        }
        if (modalManager.get?.('amsMaterial')?.element === modal.root) {
            return;
        }
        modalManager.register('amsMaterial', {
            element: modal.root,
            openClass: null,
            hiddenClass: 'is-hidden',
            gateKey: 'amsMaterial',
            onOpen: handleOpen,
            onClose: handleClose,
        });
    };

    const normalizeColor = (value) => {
        if (!value) {
            return '#ffffff';
        }
        let raw = String(value).trim();
        if (!raw) {
            return '#ffffff';
        }
        raw = raw.replace(/^#/, '');
        if (raw.length === 8) {
            raw = raw.slice(0, 6);
        }
        if (/^[0-9a-fA-F]{6}$/.test(raw)) {
            return `#${raw}`.toLowerCase();
        }
        return '#ffffff';
    };

    const buildItemKey = (item) => {
        const settingId = item?.setting_id ? String(item.setting_id) : '';
        const trayInfo = item?.tray_info_idx ? String(item.tray_info_idx) : '';
        const alias = item?.alias ? String(item.alias) : '';
        return `${settingId}::${trayInfo}::${alias}`;
    };

    const getCatalogItems = () => {
        const snapshot = getSnapshot?.() || {};
        if (selectors?.filamentCatalog?.getItems) {
            return selectors.filamentCatalog.getItems(snapshot);
        }
        return snapshot?.filamentCatalog || [];
    };

    const getAmsColors = (snapshot, slotMeta) => {
        const colors = [];
        const amsUnits = snapshot?.ams?.ams_units || [];
        const targetAmsId = slotMeta?.amsId ?? null;
        amsUnits.forEach((unit) => {
            const unitId = unit?.ams_id ?? unit?.id ?? null;
            if (targetAmsId !== null && unitId !== targetAmsId && String(unitId) !== String(targetAmsId)) {
                return;
            }
            (unit?.trays || []).forEach((tray) => {
                const color = normalizeColor(tray?.color || tray?.tray_color);
                if (color && !colors.includes(color)) {
                    colors.push(color);
                }
            });
        });
        if (!colors.length && Array.isArray(snapshot?.ams?.slots)) {
            snapshot.ams.slots.forEach((tray) => {
                const color = normalizeColor(tray?.color || tray?.tray_color);
                if (color && !colors.includes(color)) {
                    colors.push(color);
                }
            });
        }
        return colors;
    };

    const resolveBaseline = (snapshot, slotMeta) => {
        if (!slotMeta) {
            return null;
        }
        if (slotMeta.slotKind === 'external') {
            const spool = snapshot?.externalSpool || snapshot?.ams?.external_spool || null;
            if (!spool) {
                return null;
            }
            return {
                alias: spool.material || spool.tray_type || 'External Spool',
                tray_info_idx: spool.tray_info_idx || '',
                tray_type: spool.tray_type ? [spool.tray_type] : [],
                nozzle_temp_min: spool.nozzle_min ?? null,
                nozzle_temp_max: spool.nozzle_max ?? null,
                setting_id: spool.setting_id || '',
                color: normalizeColor(spool.color),
            };
        }

        const amsUnits = snapshot?.ams?.ams_units || [];
        const targetAmsId = slotMeta.amsId ?? null;
        let unit = null;
        if (targetAmsId !== null) {
            unit = amsUnits.find(
                (entry) =>
                    String(entry?.ams_id ?? entry?.id ?? '') === String(targetAmsId),
            );
        }
        if (!unit && amsUnits.length) {
            unit = amsUnits[0];
        }
        const trays = unit?.trays || [];
        const tray = trays.find((entry) => String(entry?.id) === String(slotMeta.slotId));
        if (!tray) {
            return null;
        }
        return {
            alias: tray.material || tray.tray_type || 'Unknown',
            tray_info_idx: tray.tray_info_idx || '',
            tray_type: tray.tray_type ? [tray.tray_type] : [],
            nozzle_temp_min: tray.nozzle_min ?? null,
            nozzle_temp_max: tray.nozzle_max ?? null,
            setting_id: tray.setting_id || '',
            color: normalizeColor(tray.color),
        };
    };

    const buildCatalogWithBaseline = (items, baseline) => {
        const list = Array.isArray(items) ? [...items] : [];
        if (!baseline) {
            return list.sort((a, b) =>
                String(a?.alias || '').localeCompare(String(b?.alias || ''), 'tr', {
                    sensitivity: 'base',
                }),
            );
        }
        const hasMatch = list.some((item) => {
            if (baseline.tray_info_idx && item.tray_info_idx === baseline.tray_info_idx) {
                return true;
            }
            return baseline.alias && item.alias === baseline.alias;
        });
        if (!hasMatch) {
            list.unshift({
                alias: baseline.alias,
                setting_id: baseline.setting_id || '',
                tray_info_idx: baseline.tray_info_idx || '',
                tray_type: baseline.tray_type || [],
                nozzle_temp_min: baseline.nozzle_temp_min,
                nozzle_temp_max: baseline.nozzle_temp_max,
                isBaseline: true,
            });
        }
        const [first, ...rest] = list;
        rest.sort((a, b) =>
            String(a?.alias || '').localeCompare(String(b?.alias || ''), 'tr', {
                sensitivity: 'base',
            }),
        );
        return [first, ...rest];
    };

    const setSelectedColor = (color) => {
        state.selectedColor = normalizeColor(color);
        if (modal.colorSwatch) {
            modal.colorSwatch.style.backgroundColor = state.selectedColor;
        }
        renderColorGrids();
    };

    const setTemperatureFields = (item) => {
        const min = item?.nozzle_temp_min ?? '-';
        const max = item?.nozzle_temp_max ?? '-';
        if (modal.nozzleMin) {
            modal.nozzleMin.value = min === null ? '-' : String(min);
        }
        if (modal.nozzleMax) {
            modal.nozzleMax.value = max === null ? '-' : String(max);
        }
    };

    const renderFilamentOptions = () => {
        if (!modal.filamentSelect) {
            return;
        }
        modal.filamentSelect.innerHTML = '';
        const addOption = documentRef.createElement('option');
        addOption.value = '__add_custom__';
        addOption.textContent = 'Add custom...';
        modal.filamentSelect.appendChild(addOption);
        if (!state.catalog.length) {
            const option = documentRef.createElement('option');
            option.textContent = 'No filament options';
            option.disabled = true;
            option.selected = true;
            modal.filamentSelect.appendChild(option);
            return;
        }
        const customItems = state.catalog.filter((item) => item.is_custom);
        const otherItems = state.catalog.filter((item) => !item.is_custom);

        const sortByAlias = (a, b) =>
            String(a?.alias || '').localeCompare(String(b?.alias || ''), 'tr', {
                sensitivity: 'base',
            });

        if (customItems.length) {
            const group = documentRef.createElement('optgroup');
            group.label = 'Custom';
            customItems.sort(sortByAlias).forEach((item) => {
                const option = documentRef.createElement('option');
                option.value = buildItemKey(item);
                option.textContent = item.alias || 'Unknown';
                if (option.value === state.selectedKey) {
                    option.selected = true;
                }
                group.appendChild(option);
            });
            modal.filamentSelect.appendChild(group);
        }

        const brandMap = new Map();
        otherItems.forEach((item) => {
            const brand = item.brand || 'Other';
            if (!brandMap.has(brand)) {
                brandMap.set(brand, []);
            }
            brandMap.get(brand).push(item);
        });
        Array.from(brandMap.keys())
            .sort((a, b) =>
                String(a).localeCompare(String(b), 'tr', { sensitivity: 'base' }),
            )
            .forEach((brand) => {
                const group = documentRef.createElement('optgroup');
                group.label = brand;
                brandMap
                    .get(brand)
                    .sort(sortByAlias)
                    .forEach((item) => {
                        const option = documentRef.createElement('option');
                        option.value = buildItemKey(item);
                        option.textContent = item.material ? item.material : item.alias || 'Unknown';
                        if (option.value === state.selectedKey) {
                            option.selected = true;
                        }
                        group.appendChild(option);
                    });
                modal.filamentSelect.appendChild(group);
            });
    };

    const findSelectedItem = () => {
        if (!state.catalog.length) {
            return null;
        }
        const index = state.catalog.findIndex(
            (item) => buildItemKey(item) === state.selectedKey,
        );
        if (index >= 0) {
            return state.catalog[index];
        }
        return state.catalog[0];
    };

    const handleFilamentChange = () => {
        if (!modal.filamentSelect) {
            return;
        }
        const value = modal.filamentSelect.value;
        if (value === '__add_custom__') {
            const globalRef = typeof window !== 'undefined' ? window : globalThis;
            if (globalRef?.dispatchEvent) {
                globalRef.dispatchEvent(
                    new CustomEvent('ams-custom-filament', { detail: { slot: state.slotMeta } }),
                );
            }
            close();
            return;
        }
        state.selectedKey = value;
        const item = findSelectedItem();
        setTemperatureFields(item);
    };

    const renderColorGrid = (container, colors) => {
        if (!container) {
            return;
        }
        container.innerHTML = '';
        colors.forEach((color) => {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = 'ams-material-color-swatch-btn';
            button.style.backgroundColor = color;
            if (normalizeColor(color) === state.selectedColor) {
                button.classList.add('is-selected');
            }
            button.addEventListener('click', () => {
                setSelectedColor(color);
                closeColorPopover();
            });
            container.appendChild(button);
        });
    };

    const renderColorGrids = () => {
        const snapshot = getSnapshot?.() || {};
        renderColorGrid(modal.colorAms, getAmsColors(snapshot, state.slotMeta));
        renderColorGrid(modal.colorList, fixedColors);
        if (modal.colorCustom) {
            modal.colorCustom.value = state.selectedColor;
        }
    };

    const openColorPopover = () => {
        if (!modal.colorPopover) {
            return;
        }
        renderColorGrids();
        modal.colorPopover.classList.remove('is-hidden');
        modal.colorPopover.setAttribute('aria-hidden', 'false');
    };

    const closeColorPopover = () => {
        if (!modal.colorPopover) {
            return;
        }
        modal.colorPopover.classList.add('is-hidden');
        modal.colorPopover.setAttribute('aria-hidden', 'true');
    };

    const toggleColorPopover = () => {
        if (!modal.colorPopover) {
            return;
        }
        if (modal.colorPopover.classList.contains('is-hidden')) {
            openColorPopover();
        } else {
            closeColorPopover();
        }
    };

    const applyBaseline = (preselectTrayInfoIdx) => {
        state.catalog = buildCatalogWithBaseline(getCatalogItems(), state.baseline);
        state.selectedKey = state.catalog.length
            ? buildItemKey(state.catalog[0])
            : null;
        if (state.baseline) {
            const matchIndex = state.catalog.findIndex(
                (item) =>
                    (state.baseline.tray_info_idx &&
                        item.tray_info_idx === state.baseline.tray_info_idx) ||
                    (state.baseline.alias && item.alias === state.baseline.alias),
            );
            if (matchIndex >= 0) {
                state.selectedKey = buildItemKey(state.catalog[matchIndex]);
            }
            if (state.baseline.color) {
                setSelectedColor(state.baseline.color);
            }
        }
        if (preselectTrayInfoIdx) {
            const matchIndex = state.catalog.findIndex(
                (item) => item.tray_info_idx === preselectTrayInfoIdx,
            );
            if (matchIndex >= 0) {
                state.selectedKey = buildItemKey(state.catalog[matchIndex]);
            }
        }
        renderFilamentOptions();
        if (modal.filamentSelect && state.selectedKey) {
            modal.filamentSelect.value = state.selectedKey;
        }
        handleFilamentChange();
    };

    const open = async (slotMeta, options = {}) => {
        state.slotMeta = slotMeta || null;
        const snapshot = getSnapshot?.() || {};
        if (!getCatalogItems().length && typeof filamentActions?.refreshCatalog === 'function') {
            try {
                await filamentActions.refreshCatalog();
            } catch (error) {
                console.warn('Failed to refresh filament catalog', error);
            }
        }
        state.baseline = resolveBaseline(snapshot, state.slotMeta);
        setSelectedColor(state.baseline?.color || '#ffffff');
        applyBaseline(options.preselectTrayInfoIdx);

        registerModal();
        if (modalManager?.open) {
            modalManager.open('amsMaterial');
            return;
        }
        if (modal.root) {
            modal.root.classList.remove('is-hidden');
            modal.root.setAttribute('aria-hidden', 'false');
        }
        if (uiActions?.setModalGate) {
            uiActions.setModalGate('amsMaterial');
        }
        handleOpen();
    };

    const close = (options = {}) => {
        if (modalManager?.close) {
            modalManager.close('amsMaterial', options);
            return;
        }
        handleClose();
        if (modal.root) {
            modal.root.classList.add('is-hidden');
            modal.root.setAttribute('aria-hidden', 'true');
        }
        if (uiActions?.clearModalGate) {
            uiActions.clearModalGate('amsMaterial');
        }
    };

    const confirm = () => {
        const selected = findSelectedItem();
        if (!selected) {
            showToast?.('Select a filament first.', 'warning');
            return;
        }
        const detail = {
            slot: state.slotMeta,
            color: state.selectedColor,
            filament: {
                alias: selected.alias,
                setting_id: selected.setting_id,
                tray_info_idx: selected.tray_info_idx,
                tray_type: selected.tray_type,
                nozzle_temp_min: selected.nozzle_temp_min,
                nozzle_temp_max: selected.nozzle_temp_max,
            },
        };
        const globalRef = typeof window !== 'undefined' ? window : globalThis;
        if (globalRef?.dispatchEvent) {
            globalRef.dispatchEvent(new CustomEvent('ams-material-confirm', { detail }));
        }
        close();
    };

    const reset = () => {
        applyBaseline();
    };

    const handleDocumentClick = (event) => {
        if (!state.isOpen || !modal.colorPopover || modal.colorPopover.classList.contains('is-hidden')) {
            return;
        }
        if (modal.colorPopover.contains(event.target) || modal.colorBtn?.contains(event.target)) {
            return;
        }
        closeColorPopover();
    };

    const bindEvents = () => {
        if (modal.backdrop && !modal.backdrop.dataset?.modalClose) {
            modal.backdrop.addEventListener('click', close);
        }
        if (modal.closeBtn && !modal.closeBtn.dataset?.modalClose) {
            modal.closeBtn.addEventListener('click', close);
        }
        if (modal.closeFooterBtn && !modal.closeFooterBtn.dataset?.modalClose) {
            modal.closeFooterBtn.addEventListener('click', close);
        }
        modal.confirmBtn?.addEventListener('click', confirm);
        modal.resetBtn?.addEventListener('click', reset);
        modal.filamentSelect?.addEventListener('change', handleFilamentChange);
        modal.colorBtn?.addEventListener('click', toggleColorPopover);
        modal.colorCustom?.addEventListener('input', (event) => {
            setSelectedColor(event.target.value);
        });
    };

    let documentEventsBound = false;
    const bindDocumentEvents = () => {
        if (documentEventsBound) {
            return;
        }
        documentEventsBound = true;
        const globalRef = typeof window !== 'undefined' ? window : globalThis;
        globalRef?.addEventListener?.('ams-slot-edit', (event) => {
            open(event?.detail);
        });
        documentRef.addEventListener('click', handleDocumentClick);
        if (!modalManager?.isOpen) {
            documentRef.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && state.isOpen) {
                    close();
                }
            });
        }
    };

    registerModal();
    bindEvents();

    return { open, close, bindDocumentEvents };
};

export { createAmsMaterialModal };
export default createAmsMaterialModal;
