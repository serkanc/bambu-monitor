const createAmsPanel = ({
    documentRef,
    actions,
    selectors,
    showToast,
    getSnapshot,
    getUiState,
    setUiState,
    printerBusyStateSet,
}) => {
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    const amsLoadButton = doc ? doc.getElementById('ams-load-btn') : null;
    const amsUnloadButton = doc ? doc.getElementById('ams-unload-btn') : null;
    const amsActionStatus = doc ? doc.getElementById('ams-action-status') : null;
    const amsStatusMainValue = doc ? doc.getElementById('ams-status-main') : null;
    const amsStatusSubValue = doc ? doc.getElementById('ams-status-sub') : null;
    const extruderIndicatorCircle = doc ? doc.getElementById('extruder-indicator-circle') : null;
    const extruderIndicatorLabel = doc ? doc.getElementById('extruder-indicator-label') : null;

    const escapeHtml =
        doc?.defaultView?.appContext?.utils?.format?.escapeHtml ||
        ((text) => {
            const element = doc ? doc.createElement('div') : null;
            if (!element) {
                return String(text ?? '');
            }
            element.textContent = text ?? '';
            return element.innerHTML;
        });
    const escapeAttribute =
        doc?.defaultView?.appContext?.utils?.format?.escapeAttribute ||
        ((value) => {
            const raw = value === undefined || value === null ? '' : String(value);
            return raw
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        });

    const formatAmsStatusLabel = (value) => {
        if (!value) {
            return '-';
        }
        const text = String(value).trim();
        if (!text) {
            return '-';
        }
        return text
            .replace(/_/g, ' ')
            .toLowerCase()
            .replace(/\b\w/g, (letter) => letter.toUpperCase());
    };

    const getUnitColor = (unitId) => {
        const palette = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
        const index = Number.parseInt(unitId, 10) || 0;
        return palette[index % palette.length];
    };

    const toInt = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const isSlotEmpty = (entry, options = {}) => {
        const { ignoreRemain = false } = options;
        if (!entry) {
            return true;
        }

        const materialText = `${entry.material || entry.tray_type || ''}`.trim().toLowerCase();
        const hasMaterial = Boolean(materialText) && materialText !== 'empty' && materialText !== 'none';

        if (!ignoreRemain && Number.isFinite(entry?.remain)) {
            if (entry.remain > 0) {
                return false;
            }
            if (entry.remain <= 0 && hasMaterial) {
                return false;
            }
            return true;
        }

        return !hasMaterial;
    };

    const renderEmptySlotContent = (labelText) => `
            <div class="slot-info slot-info--empty" aria-label="${escapeAttribute(labelText || 'Empty Slot')}">
                <span class="empty-slot-label">Empty Slot</span>
            </div>
        `;

    const renderSlotEditButton = (labelText) => `
            <button class="slot-edit-btn" type="button" aria-label="Edit ${escapeHtml(labelText)}" title="Edit ${escapeHtml(labelText)}">
                &#9998;
            </button>
        `;

    const formatSlotNumber = (rawValue) => {
        const parsed = Number(rawValue);
        if (Number.isFinite(parsed)) {
            return parsed + 1;
        }
        return null;
    };

    const normalizeSlotId = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const resolveActiveAmsSlotId = (amsData) => {
        const trayNow = normalizeSlotId(amsData?.tray_now);
        if (trayNow !== null && trayNow !== 255 && trayNow >= 0) {
            return trayNow;
        }
        const fallback = normalizeSlotId(amsData?.active_tray_index);
        if (fallback !== null && fallback !== 255 && fallback >= 0) {
            return fallback;
        }
        return null;
    };

    const getAmsSnapshot = (snapshot) => {
        const amsData = snapshot?.ams || null;
        return {
            amsData,
            online: Boolean(snapshot?.online),
            activeAmsSlotId: resolveActiveAmsSlotId(amsData),
            amsStatusMain: amsData?.ams_status_main || '',
            amsStatusSub: amsData?.ams_status_sub || '',
        };
    };

    const getSelectedSlot = (snapshot) =>
        selectors?.statusPanel?.getSelectedSlot
            ? selectors.statusPanel.getSelectedSlot(snapshot)
            : snapshot?.ui?.statusPanel?.selectedSlot || null;

    const getCatalogItems = (snapshot) => {
        if (selectors?.filamentCatalog?.getItems) {
            return selectors.filamentCatalog.getItems(snapshot);
        }
        return snapshot?.filamentCatalog || [];
    };

    const buildTrayInfoAliasMap = (snapshot) => {
        const map = new Map();
        const items = getCatalogItems(snapshot);
        if (!Array.isArray(items)) {
            return map;
        }
        items.forEach((item) => {
            const trayInfo = item?.tray_info_idx ? String(item.tray_info_idx) : '';
            const alias = item?.alias ? String(item.alias) : '';
            if (!trayInfo || !alias) {
                return;
            }
            if (!map.has(trayInfo) || item?.is_custom) {
                map.set(trayInfo, alias);
            }
        });
        return map;
    };

    const resolveTrayInfoLabel = (trayInfoIdx, aliasMap) => {
        if (!trayInfoIdx) {
            return '';
        }
        const trayKey = String(trayInfoIdx);
        if (aliasMap && aliasMap.has(trayKey)) {
            return aliasMap.get(trayKey);
        }
        return trayKey;
    };

    const hasFieldCapability = (capabilityObj, section, key) => {
        if (!section || !key) {
            return true;
        }
        const sectionFields = capabilityObj?.fields?.[section];
        if (!sectionFields) {
            return true;
        }
        if (!Object.prototype.hasOwnProperty.call(sectionFields, key)) {
            return true;
        }
        return sectionFields[key] !== false;
    };

    const hasAmsCapability = (unit, section, key) => hasFieldCapability(unit?.capabilities, section, key);

    const renderTraySlot = (entry, options = {}) => {
        const {
            label,
            amsId = null,
            slotKind = 'ams',
            slotIdOverride = null,
            slotIndex = null,
            isActive = false,
            isLoaded = false,
            ignoreRemain = false,
            trayInfoAliasMap = null,
        } = options;
        const slotIdValue = entry?.id ?? slotIdOverride;
        const normalizedSlotId = normalizeSlotId(slotIdValue);
        const slotIdAttrValue = normalizedSlotId !== null ? normalizedSlotId : slotIdValue;
        const slotNumber = formatSlotNumber(slotIdValue);
        const baseLabel =
            label ||
            (slotNumber !== null
                ? `Slot ${slotNumber}`
                : `Slot ${entry?.id !== undefined ? entry.id : '?'}`);
        const trayInfoIdx = entry?.tray_info_idx ? String(entry.tray_info_idx) : '';
        const hasBadge = Boolean(trayInfoIdx);
        const badgeText = hasBadge ? resolveTrayInfoLabel(trayInfoIdx, trayInfoAliasMap) : '';
        const badge = hasBadge ? ` [${badgeText}]` : '';
        const decoratedLabel = hasBadge ? `${baseLabel}${badge}` : baseLabel;
        const datasetParts = [
            slotKind ? `data-slot-kind="${escapeAttribute(slotKind)}"` : '',
            slotIdAttrValue !== undefined && slotIdAttrValue !== null
                ? `data-slot-id="${escapeAttribute(slotIdAttrValue)}"`
                : '',
            amsId !== null && amsId !== undefined && amsId !== ''
                ? `data-ams-id="${escapeAttribute(amsId)}"`
                : '',
            baseLabel ? `data-slot-label="${escapeAttribute(baseLabel)}"` : '',
            slotIndex !== null && slotIndex !== undefined
                ? `data-slot-index="${escapeAttribute(slotIndex)}"`
                : '',
        ].filter(Boolean);
        const classes = ['ams-slot'];
        if (isActive) {
            classes.push('is-active');
        }
        if (isLoaded) {
            classes.push('is-loaded');
        }

        const rawColor = (entry?.color || '000000FF').toString().replace(/^#/, '');
        const colorHex = /^[0-9A-Fa-f]{6}/.test(rawColor) ? `#${rawColor.substring(0, 6)}` : '#cccccc';
        const treatAsEmpty = slotKind !== 'external' && isSlotEmpty(entry, { ignoreRemain });

        if (treatAsEmpty) {
            classes.push('ams-slot--empty');
            return `
                <div class="${classes.join(' ')}" ${datasetParts.join(' ')}>
                    ${renderEmptySlotContent(baseLabel)}
                </div>
            `;
        }

        const material = entry?.material || entry?.tray_type || 'Empty';
        const nozzleMin = entry?.nozzle_min ?? entry?.nozzle_temp_min ?? '?';
        const nozzleMax = entry?.nozzle_max ?? entry?.nozzle_temp_max ?? '?';
        const slotMeta = `Nozzle: ${nozzleMin}C-${nozzleMax}C`;

        return `
            <div class="${classes.join(' ')}" ${datasetParts.join(' ')}>
                <div class="color-box" style="background-color: ${escapeAttribute(colorHex)};"></div>
                <div class="slot-info">
                    <div class="slot-info-primary">
                        <b>${escapeHtml(decoratedLabel)}</b> <span class="slot-material">${escapeHtml(
                            material,
                        )}</span>
                    </div>
                    <div class="slot-info-sub">${escapeHtml(slotMeta)}</div>
                </div>
                ${renderSlotEditButton(baseLabel)}
            </div>
        `;
    };

    const normalizeTrayRecord = (vtTray, recordId) => {
        if (!vtTray || !recordId) {
            return null;
        }
        const trayType = vtTray?.tray_type ?? vtTray?.material ?? 'Unknown';
        const rawColor = vtTray?.tray_color ?? vtTray?.color ?? '000000FF';
        const nozzleMin = vtTray.nozzle_temp_min ?? vtTray.nozzle_min ?? '?';
        const nozzleMax = vtTray.nozzle_temp_max ?? vtTray.nozzle_max ?? '?';

        return {
            id: String(recordId),
            material: String(trayType),
            remain: toInt(vtTray.remain),
            color: rawColor.toUpperCase(),
            nozzle_min: String(nozzleMin),
            nozzle_max: String(nozzleMax),
            tray_type: String(trayType),
            tray_info_idx: String(vtTray.tray_info_idx ?? vtTray.tray_id_name ?? ''),
        };
    };

    const renderEmptyTrays = (amsId) =>
        Array.from({ length: 4 })
            .map((_, index) =>
                renderTraySlot(null, {
                    amsId,
                    slotIdOverride: index,
                    slotIndex: index,
                }),
            )
            .join('');

    const renderAmsUnit = (unit, activeSlotId, trayInfoAliasMap) => {
        const unitColor = getUnitColor(unit.id);
        const productName =
            typeof unit.product_name === 'string' && unit.product_name.trim()
                ? escapeHtml(unit.product_name.trim())
                : '';
        const headerLabel = (() => {
            const rawId = Number(unit.id);
            const displayId = Number.isFinite(rawId) ? rawId + 1 : unit.id;
            return productName ? `AMS ${displayId} - ${productName}` : `AMS ${displayId}`;
        })();
        const amsId = unit.ams_id ?? unit.id ?? null;
        const showRemain = hasAmsCapability(unit, 'trays', 'remain');
        const showHumidity = hasAmsCapability(unit, 'unit', 'humidity');
        const showTemp = hasAmsCapability(unit, 'unit', 'temp');
        const trays =
            Array.isArray(unit.trays) && unit.trays.length > 0
                ? unit.trays
                      .map((tray, index) => {
                          const trayIdNumeric = normalizeSlotId(tray?.id);
                          const isLoaded = !isSlotEmpty(tray);
                          return renderTraySlot(tray, {
                              amsId,
                              slotKind: 'ams',
                              slotIndex: index,
                              isActive:
                                  activeSlotId !== null &&
                                  trayIdNumeric !== null &&
                                  trayIdNumeric === activeSlotId,
                              isLoaded,
                              ignoreRemain: !showRemain,
                              trayInfoAliasMap,
                          });
                      })
                      .join('')
                : renderEmptyTrays(amsId);
        const headerMetrics = [];
        if (showHumidity) {
            headerMetrics.push(`Humidity: ${unit.humidity}%`);
        }
        if (showTemp) {
            headerMetrics.push(`Temperature: ${unit.temp} C`);
        }
        headerMetrics.push(`FW: ${unit.firmware}`);
        const metricsText = headerMetrics.length ? ` - ${headerMetrics.join(' - ')}` : '';

        return `
            <div class="ams-unit" style="border-left-color: ${unitColor};">
                <div class="ams-header">
                    ${headerLabel}${metricsText}
                </div>
                ${trays}
            </div>
        `;
    };

    const updateAMSInfo = (snapshot) => {
        const { amsData, online, activeAmsSlotId, amsStatusMain, amsStatusSub } =
            getAmsSnapshot(snapshot);
        const container = doc ? doc.getElementById('ams-info') : null;
        if (!container) {
            return;
        }

        if (!online || !amsData || !Array.isArray(amsData.ams_units) || amsData.ams_units.length === 0) {
            clearSelectedSlot();
            container.innerHTML = `
                <div class="ams-unit">
                    <div class="ams-header">AMS Information</div>
                    <div class="empty-slot">AMS not connected</div>
                </div>
            `;
            if (amsStatusMainValue) {
                amsStatusMainValue.textContent = '-';
            }
            if (amsStatusSubValue) {
                amsStatusSubValue.textContent = '-';
            }
            return;
        }

        const header = `
            <div style="margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #3498db;">
                <b>AMS Hub:</b> ${amsData.ams_hub_connected || 'No'} |
                <b>Total AMS:</b> ${amsData.total_ams || 0} |
            </div>
        `;

        const trayInfoAliasMap = buildTrayInfoAliasMap(snapshot);
        const unitsHtml = amsData.ams_units
            .map((unit) => renderAmsUnit(unit, activeAmsSlotId, trayInfoAliasMap))
            .join('');
        container.innerHTML = `${header}${unitsHtml}`;
        if (amsStatusMainValue) {
            amsStatusMainValue.textContent = formatAmsStatusLabel(amsStatusMain);
        }
        if (amsStatusSubValue) {
            amsStatusSubValue.textContent = formatAmsStatusLabel(amsStatusSub);
        }
        updateAmsActionButtons(snapshot);
    };

    const updateExternalSpool = (externalSpool, snapshot) => {
        const container = doc ? doc.getElementById('external-spool-info') : null;
        if (!container) {
            return;
        }
        const { activeAmsSlotId } = getAmsSnapshot(snapshot);

        if (!externalSpool) {
            container.innerHTML = `
                <div class="ams-unit">
                    <div class="ams-header">External Spool</div>
                    <div class="empty-slot">External spool not connected</div>
                </div>
            `;
            return;
        }

        const spoolIdNumber = normalizeSlotId(externalSpool?.id);
        const trayInfoAliasMap = buildTrayInfoAliasMap(snapshot);
        const slotMarkup = renderTraySlot(externalSpool, {
            label: 'External Spool',
            slotKind: 'external',
            slotIdOverride: spoolIdNumber !== null ? spoolIdNumber : externalSpool?.id ?? 254,
            slotIndex: 254,
            isActive:
                activeAmsSlotId !== null &&
                spoolIdNumber !== null &&
                spoolIdNumber === activeAmsSlotId,
            ignoreRemain: true,
            trayInfoAliasMap,
        });

        container.innerHTML = `
            <div class="ams-unit" style="border-left-color: #9b59b6;">
                <div class="ams-header" style="border-left-color: #9b59b6;">External Spool</div>
                ${slotMarkup}
            </div>
        `;
    };

    const updateHardwareAmsStatus = (amsData, isOnline) => {
        const element = doc ? doc.getElementById('hardware-ams-status') : null;
        if (!element) {
            return;
        }

        if (!isOnline) {
            element.textContent = 'Offline';
            return;
        }

        const status =
            (amsData?.ams_hub_connected
                ? amsData.ams_hub_connected
                : amsData?.total_ams > 0
                    ? 'Connected'
                    : 'Disconnected');
        element.textContent = status;
    };

    const getSlotMetadataFromElement = (element) => {
        if (!element || !element.dataset) {
            return null;
        }
        const slotKind = element.dataset.slotKind || 'ams';
        const rawSlotIdAttr = element.dataset.slotId;
        let resolvedSlotId = Number(rawSlotIdAttr);
        if (!Number.isFinite(resolvedSlotId)) {
            const indexAttr = Number(element.dataset.slotIndex);
            if (Number.isFinite(indexAttr)) {
                resolvedSlotId = indexAttr;
            }
        }
        if (!Number.isFinite(resolvedSlotId)) {
            if (slotKind === 'external') {
                resolvedSlotId = 254;
            } else {
                const label = element.dataset.slotLabel || '';
                const match = label.match(/slot\s+(\d+)/i);
                if (match) {
                    const guess = Number(match[1]) - 1;
                    if (Number.isFinite(guess)) {
                        resolvedSlotId = guess;
                    }
                }
            }
        }
        if (!Number.isFinite(resolvedSlotId)) {
            return null;
        }
        return {
            slotId: resolvedSlotId,
            slotLabel: element.dataset.slotLabel || `Slot ${resolvedSlotId + 1}`,
            amsId: element.dataset.amsId ?? null,
            slotKind,
        };
    };

    let slotSelectionUpdateInProgress = false;
    const updateSelectedSlotState = (value) => {
        if (slotSelectionUpdateInProgress) {
            return;
        }
        slotSelectionUpdateInProgress = true;
        try {
            setUiState({ selectedSlot: value });
        } finally {
            slotSelectionUpdateInProgress = false;
        }
    };

    const getSlotKey = (metadata) => {
        if (!metadata) {
            return null;
        }
        const amsPart = metadata.amsId ?? 'none';
        return `${metadata.slotKind || 'ams'}-${amsPart}-${metadata.slotId}`;
    };

    const setSelectedSlotElement = (element) => {
        if (!element) {
            return;
        }
        const metadata = getSlotMetadataFromElement(element);
        if (!metadata) {
            return;
        }
        const selected = getSelectedSlot(getSnapshot());
        const currentKey = selected ? getSlotKey(selected) : null;
        const nextKey = getSlotKey(metadata);
        if (currentKey && currentKey === nextKey && element.classList.contains('is-selected')) {
            return;
        }
        doc?.querySelectorAll('.ams-slot.is-selected').forEach((slot) => {
            slot.classList.remove('is-selected');
        });
        element.classList.add('is-selected');
        if (!currentKey || currentKey !== nextKey) {
            updateSelectedSlotState(metadata);
        }
        updateAmsActionButtons(getSnapshot());
    };

    const findSlotElement = (metadata) => {
        if (!metadata || !doc) {
            return null;
        }
        const selectorParts = [
            metadata.slotKind ? `[data-slot-kind="${metadata.slotKind}"]` : '',
            Number.isFinite(metadata.slotId) ? `[data-slot-id="${metadata.slotId}"]` : '',
            metadata.amsId !== null && metadata.amsId !== undefined && metadata.amsId !== ''
                ? `[data-ams-id="${metadata.amsId}"]`
                : '',
        ].join('');
        if (!selectorParts) {
            return null;
        }
        const scopeSelectors = ['#ams-info', '#external-spool-info'];
        for (const scope of scopeSelectors) {
            const root = doc.querySelector(scope);
            if (!root) continue;
            const match = root.querySelector(`.ams-slot${selectorParts}`);
            if (match) {
                return match;
            }
        }
        return null;
    };

    const clearSelectedSlot = () => {
        const snapshot = getSnapshot();
        const selected = getSelectedSlot(snapshot);
        if (!selected) {
            updateAmsActionButtons(snapshot);
            return;
        }
        if (selected) {
            const element = findSlotElement(selected);
            if (element) {
                element.classList.remove('is-selected');
            }
            updateSelectedSlotState(null);
        }
        updateAmsActionButtons(snapshot);
    };

    const ensureDefaultSlotSelection = () => {
        const amsContainer = doc ? doc.getElementById('ams-info') : null;
        const spoolContainer = doc ? doc.getElementById('external-spool-info') : null;
        const fallback =
            amsContainer?.querySelector('.ams-slot.is-active') ||
            amsContainer?.querySelector('.ams-slot') ||
            spoolContainer?.querySelector('.ams-slot');
        if (fallback) {
            setSelectedSlotElement(fallback);
        } else {
            clearSelectedSlot();
        }
    };

    const restoreSelectedSlot = () => {
        const snapshot = getSnapshot();
        const selectedSlot = getSelectedSlot(snapshot);
        if (selectedSlot) {
            const element = findSlotElement(selectedSlot);
            if (element) {
                setSelectedSlotElement(element);
                return;
            }
        }
        ensureDefaultSlotSelection();
    };

    const getActiveSlotMetadata = () => {
        const snapshot = getSnapshot();
        const { activeAmsSlotId } = getAmsSnapshot(snapshot);
        if (activeAmsSlotId === null || activeAmsSlotId === 255) {
            return null;
        }
        const root = doc ? doc.getElementById('ams-info') : null;
        if (!root) {
            return null;
        }
        const activeElement =
            root.querySelector('.ams-slot.is-active') ||
            root.querySelector(`.ams-slot[data-slot-kind="ams"][data-slot-id="${activeAmsSlotId}"]`);
        return getSlotMetadataFromElement(activeElement);
    };

    const isPrinterBusy = () => {
        const snapshot = getSnapshot?.() || {};
        if (selectors?.statusPanel?.isPrinterBusy) {
            return selectors.statusPanel.isPrinterBusy(snapshot);
        }
        const state = snapshot?.printStatus?.gcode_state || '';
        const normalized =
            typeof state === 'string' ? state.toUpperCase() : state;
        return printerBusyStateSet.has(normalized);
    };

    const bindSlotListeners = (root) => {
        if (!root) {
            return;
        }
        root.querySelectorAll('.ams-slot').forEach((slot) => {
            slot.addEventListener('click', (event) => {
                if (event.target.closest('.slot-edit-btn')) {
                    return;
                }
                if (slot.classList.contains('is-active') || slot.classList.contains('ams-slot--empty')) {
                    return;
                }
                setSelectedSlotElement(slot);
            });
            const editBtn = slot.querySelector('.slot-edit-btn');
            if (editBtn) {
                editBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    if (slot.classList.contains('ams-slot--empty')) {
                        return;
                    }
                    if (slot.classList.contains('is-active') && isPrinterBusy()) {
                        showToast?.('Cannot edit active slot while printer is busy', 'warning');
                        return;
                    }
                    const metadata = getSlotMetadataFromElement(slot);
                    if (metadata) {
                        if (!slot.classList.contains('is-active')) {
                            setSelectedSlotElement(slot);
                        }
                        handleSlotEdit(metadata);
                    }
                });
            }
        });
    };

    const bindAmsSlotInteractions = () => {
        bindSlotListeners(doc ? doc.getElementById('ams-info') : null);
        bindSlotListeners(doc ? doc.getElementById('external-spool-info') : null);
        restoreSelectedSlot();
    };

    let amsStatusTimer = null;

    const showAmsStatus = (message, autoHide = false) => {
        if (!amsActionStatus) {
            return;
        }
        if (amsStatusTimer) {
            clearTimeout(amsStatusTimer);
            amsStatusTimer = null;
        }
        if (!message) {
            amsActionStatus.hidden = true;
            amsActionStatus.textContent = '';
            return;
        }
        amsActionStatus.textContent = message;
        amsActionStatus.hidden = false;
        if (autoHide) {
            amsStatusTimer = setTimeout(() => {
                amsActionStatus.hidden = true;
                amsActionStatus.textContent = '';
                amsStatusTimer = null;
            }, 2500);
        }
    };

    const updateExtruderIndicator = (snapshot) => {
        if (!extruderIndicatorCircle || !extruderIndicatorLabel) {
            return;
        }
        const rawValue = snapshot?.printStatus?.hw_switch_state;
        let labelText = 'Sensor unavailable';
        let isLoaded = false;

        if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
            const normalized =
                typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : rawValue;
            isLoaded =
                normalized === 1 ||
                normalized === '1' ||
                normalized === true ||
                normalized === 'true';
            labelText = isLoaded ? 'Filament detected' : 'No filament';
        }

        extruderIndicatorCircle.classList.toggle('is-loaded', isLoaded);
        extruderIndicatorLabel.classList.toggle('is-loaded', isLoaded);
        extruderIndicatorLabel.textContent = labelText;
    };

    const updateAmsActionButtons = (snapshot) => {
        if (!amsLoadButton || !amsUnloadButton) {
            return;
        }
        const safeSnapshot = snapshot || getSnapshot();
        const selected = getSelectedSlot(safeSnapshot);
        const online = Boolean(safeSnapshot?.online);
        const { activeAmsSlotId, amsStatusMain } = getAmsSnapshot(safeSnapshot);
        const printStatus = safeSnapshot?.printStatus || {};
        const hasSelection = Boolean(selected);
        const label = selected?.slotLabel || '';

        amsLoadButton.textContent = label ? `Load ${label}` : 'Load';
        amsUnloadButton.textContent = 'Unload';

        const isActiveSlot =
            hasSelection &&
            selected.slotKind === 'ams' &&
            activeAmsSlotId !== null &&
            selected.slotId === activeAmsSlotId;

        const hasActiveSlot = activeAmsSlotId !== null && activeAmsSlotId !== 255;
        const amsMain = amsStatusMain || '';
        const isIdle = typeof amsMain === 'string' ? amsMain.toUpperCase() === 'IDLE' : false;
        const isAmsReady = selectors?.statusPanel?.isAmsReady
            ? selectors.statusPanel.isAmsReady(safeSnapshot)
            : isIdle;
        const gcodeStateValue = printStatus.gcode_state;
        const normalizedGcodeState =
            typeof gcodeStateValue === 'string' ? gcodeStateValue.toUpperCase() : gcodeStateValue ?? '';
        const isPrinterBusy = selectors?.statusPanel?.isPrinterBusy
            ? selectors.statusPanel.isPrinterBusy(safeSnapshot)
            : printerBusyStateSet.has(normalizedGcodeState);

        const baseDisabled = !online || isPrinterBusy || !isAmsReady;
        amsLoadButton.disabled = baseDisabled || !hasSelection || isActiveSlot;
        amsUnloadButton.disabled = baseDisabled || !hasActiveSlot;
        showAmsStatus('');
        updateExtruderIndicator(safeSnapshot);
    };

    const triggerAmsSlotCommand = async (action) => {
        const snapshot = getSnapshot();
        if (typeof actions?.statusPanel?.triggerAmsCommand !== 'function') {
            showToast('Unable to contact API client', 'error');
            return;
        }
        if (!snapshot?.online) {
            showToast('Printer must be online to control filament', 'error');
            return;
        }
        const selected = getSelectedSlot(snapshot);
        const metadata = action === 'unload' ? getActiveSlotMetadata() : selected;
        if (!metadata || !Number.isFinite(metadata.slotId)) {
            showToast(
                action === 'unload' ? 'No active slot to unload' : 'Select a slot first',
                'error',
            );
            return;
        }
        let amsIdValue = null;
        if (metadata.amsId !== null && metadata.amsId !== undefined && metadata.amsId !== '') {
            const parsed = Number(metadata.amsId);
            amsIdValue = Number.isFinite(parsed) ? parsed : null;
        }
        try {
            await actions.statusPanel.triggerAmsCommand({
                ams_id: amsIdValue,
                slot_id: metadata.slotId,
                action,
            });
            const label = metadata.slotLabel || `Slot ${metadata.slotId + 1}`;
            showToast(`${action === 'load' ? 'Load' : 'Unload'} command sent for ${label}`, 'success');
        } catch (error) {
            console.error('AMS command failed', error);
            showToast('Failed to send AMS command', 'error');
        }
    };

    const handleSlotEdit = (metadata) => {
        const detail = {
            ...metadata,
            timestamp: Date.now(),
        };
        const globalRef = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null;
        if (globalRef?.dispatchEvent) {
            globalRef.dispatchEvent(new CustomEvent('ams-slot-edit', { detail }));
        }
    };

    const bindEvents = () => {
        if (amsLoadButton) {
            amsLoadButton.addEventListener('click', () => triggerAmsSlotCommand('load'));
        }
        if (amsUnloadButton) {
            amsUnloadButton.addEventListener('click', () => triggerAmsSlotCommand('unload'));
        }
    };

    return {
        updateAMSInfo,
        updateExternalSpool,
        updateHardwareAmsStatus,
        updateAmsActionButtons,
        bindAmsSlotInteractions,
        bindEvents,
    };
};

export { createAmsPanel };
export default createAmsPanel;
