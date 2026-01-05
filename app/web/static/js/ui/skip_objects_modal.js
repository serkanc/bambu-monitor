import initModalManager from '../core/modal_manager.js';

let skipObjectsInitialized = false;
let skipObjectsInstance = null;

const initSkipObjectsModal = (global = typeof window !== 'undefined' ? window : globalThis) => {
    if (skipObjectsInitialized) {
        return skipObjectsInstance;
    }
    skipObjectsInitialized = true;

    const appContext = global.appContext || (global.appContext = {});
    appContext.components = appContext.components || {};
    const components = appContext.components;
    const masterStore = appContext.stores?.core || null;
    const controlActions = appContext.actions?.controls || null;
    const printSetupActions = appContext.actions?.printSetup || null;
    const apiService = appContext.services?.api || null;
    const appClient = appContext.api || null;
    const showToast =
        appContext.utils?.dom?.showToast ||
        ((message, type = 'info') => console.log(type ?? 'info', message));
    const modalManager = initModalManager(global);

    if (typeof document === 'undefined') {
        return null;
    }

    const getSnapshot = () =>
        typeof masterStore?.getState === 'function' ? masterStore.getState() : {};
    const setPrintSetupMetadata = (metadata) => {
        if (!metadata) {
            return;
        }
        if (printSetupActions?.setState) {
            printSetupActions.setState({ metadata });
            return;
        }
        masterStore?.setPrintSetupUiState?.({ metadata });
    };

    const toInt = (value) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) ? parsed : null;
    };

    const parsePlateIndexFromFile = (value) => {
        if (!value) {
            return null;
        }
        const fileName = String(value).split(/[\\/]/).pop() || '';
        const match = fileName.match(/plate[_-]?(\d+)/i);
        if (!match) {
            return null;
        }
        const parsed = parseInt(match[1], 10);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const normalizePlateIndex = (plate, fallbackIndex) => {
        const raw = plate?.index ?? plate?.metadata?.index;
        const parsed = parseInt(raw, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
        if (Number.isFinite(fallbackIndex)) {
            return fallbackIndex + 1;
        }
        return null;
    };

    const resolvePlateSelection = (metadata, snapshot) => {
        const plates = Array.isArray(metadata?.plates) ? metadata.plates : [];
        if (!plates.length) {
            return { plate: null, plateIndex: null, plateArrayIndex: null };
        }

        const gcodeFile = snapshot?.printStatus?.gcode_file || '';
        const normalizedName = String(gcodeFile).split(/[\\/]/).pop() || '';
        if (normalizedName) {
            const plateFiles = Array.isArray(metadata?.plate_files) ? metadata.plate_files : [];
            const plateFileIndex = plateFiles.findIndex((plateFile) => {
                if (!plateFile) {
                    return false;
                }
                const candidate = String(plateFile).split(/[\\/]/).pop() || '';
                return candidate.toLowerCase() === normalizedName.toLowerCase();
            });
            if (plateFileIndex >= 0) {
                const plate = plates[plateFileIndex] || null;
                return {
                    plate,
                    plateIndex: normalizePlateIndex(plate, plateFileIndex),
                    plateArrayIndex: plateFileIndex,
                };
            }
            const parsedIndex = parsePlateIndexFromFile(normalizedName);
            if (parsedIndex != null) {
                const foundIndex = plates.findIndex(
                    (plate, idx) => normalizePlateIndex(plate, idx) === parsedIndex,
                );
                const fallbackIndex =
                    foundIndex >= 0 ? foundIndex : parsedIndex - 1 >= 0 ? parsedIndex - 1 : 0;
                const plateIndexSafe = fallbackIndex >= 0 && fallbackIndex < plates.length ? fallbackIndex : 0;
                const plate = plates[plateIndexSafe] || null;
                return {
                    plate,
                    plateIndex: normalizePlateIndex(plate, plateIndexSafe),
                    plateArrayIndex: plateIndexSafe,
                };
            }
        }

        const defaultIndex = Number.isInteger(metadata?.default_plate_index)
            ? metadata.default_plate_index
            : 0;
        const safeIndex = defaultIndex >= 0 && defaultIndex < plates.length ? defaultIndex : 0;
        const plate = plates[safeIndex] || null;
        return {
            plate,
            plateIndex: normalizePlateIndex(plate, safeIndex),
            plateArrayIndex: safeIndex,
        };
    };

    const buildReasonMessage = (reason) => {
        const map = {
            metadata_missing: 'Skip objects data has not been loaded yet.',
            skip_meta_missing: 'Skip objects metadata is unavailable for this file.',
            plate_unavailable: 'Skip objects data is unavailable for this plate.',
            slice_info_missing: 'Slice metadata is missing in the cache.',
            cache_meta_missing: 'Print cache metadata does not match the active file.',
            label_object_disabled: 'Object labeling is disabled for this print.',
            pick_file_missing: 'Object map image is missing in the cache.',
            objects_missing: 'No objects are available for this plate.',
            object_count_low: 'Skip objects requires at least two objects.',
            object_limit_exceeded: 'Skip objects is limited to 64 objects per plate.',
            object_remaining_low: 'Only one object remains; skipping is disabled.',
            selection_invalid: 'At least one object must remain after skipping.',
        };
        return map[reason] || 'Skip objects is currently unavailable.';
    };

    class SkipObjectsModal {
        constructor() {
            this.modal = null;
            this.previewWrap = null;
            this.previewCanvas = null;
            this.previewCtx = null;
            this.previewEmpty = null;
            this.statusEl = null;
            this.metaEl = null;
            this.countEl = null;
            this.listEl = null;
            this.applyBtn = null;
            this.modalManager = modalManager;
            this._unsubscribe = null;
            this._pendingSelections = new Set();
            this._skippedSet = new Set();
            this._objectIdSet = new Set();
            this._objects = [];
            this._available = false;
            this._reason = null;
            this._plateLabel = '';
            this._filename = '';
            this._pickUrl = null;
            this._pickImageUrl = null;
            this._pickImage = null;
            this._pickIds = null;
            this._pickWidth = 0;
            this._pickHeight = 0;
            this._pickBuffer = null;
            this._isOpen = false;
            this._lastRenderKey = '';
            this._metadataFetchInFlight = false;
            this._metadataFetchKey = '';
            this._metadataFetchFailedAt = 0;
            this.init();
        }

        init() {
            this.cacheDom();
            this.registerModalManager();
            this.bindEvents();
            this.subscribeToStore();
        }

        cacheDom() {
            this.modal = document.getElementById('skip-objects-modal');
            this.previewWrap = this.modal?.querySelector('.skip-objects-modal__preview') || null;
            this.previewCanvas = document.getElementById('skip-objects-canvas');
            this.previewCtx = this.previewCanvas?.getContext?.('2d') || null;
            this.previewEmpty = document.getElementById('skip-objects-preview-empty');
            this.statusEl = document.getElementById('skip-objects-status');
            this.metaEl = document.getElementById('skip-objects-meta');
            this.countEl = document.getElementById('skip-objects-count');
            this.listEl = document.getElementById('skip-objects-list');
            this.applyBtn = document.getElementById('skip-objects-apply');
        }

        registerModalManager() {
            if (!this.modal || !this.modalManager?.register) {
                return;
            }
            if (this.modalManager.get?.('skipObjects')?.element === this.modal) {
                return;
            }
            this.modalManager.register('skipObjects', {
                element: this.modal,
                openClass: null,
                hiddenClass: 'is-hidden',
                onClose: () => this.close(),
            });
        }

        bindEvents() {
            if (this.listEl) {
                this.listEl.addEventListener('click', (event) => this.handleListClick(event));
            }
            if (this.applyBtn) {
                this.applyBtn.addEventListener('click', () => this.handleApply());
            }
            if (this.previewCanvas) {
                this.previewCanvas.addEventListener('click', (event) => this.handlePreviewClick(event));
            }
        }

        subscribeToStore() {
            if (this._unsubscribe || typeof masterStore?.subscribe !== 'function') {
                return;
            }
            this._unsubscribe = masterStore.subscribe((snapshot) => {
                if (!this._isOpen) {
                    return;
                }
                const nextKey = this.buildRenderKey(snapshot);
                if (nextKey === this._lastRenderKey) {
                    return;
                }
                this._lastRenderKey = nextKey;
                this.refreshFromSnapshot(snapshot);
            });
        }

        buildRenderKey(snapshot) {
            const skipped = Array.isArray(snapshot?.printStatus?.skipped_objects)
                ? snapshot.printStatus.skipped_objects.join(',')
                : '';
            const file = snapshot?.printStatus?.gcode_file || '';
            const meta = snapshot?.ui?.printSetup?.metadata?.filename || '';
            const skipMeta = snapshot?.ui?.printSetup?.metadata?.skip_object || null;
            const skipKey = skipMeta
                ? (Array.isArray(skipMeta.plates) ? skipMeta.plates : [])
                      .map((plate) => `${plate.index}:${plate.available}:${plate.reason || ''}:${plate.pick_url || ''}`)
                      .join('|')
                : '';
            return [file, meta, skipped, skipKey].join('::');
        }

        open() {
            this._isOpen = true;
            this._pendingSelections.clear();
            const snapshot = getSnapshot();
            this.refreshFromSnapshot(snapshot);
            this.ensureMetadata(snapshot);
            if (this.modalManager?.open) {
                this.modalManager.open('skipObjects');
            } else if (this.modal) {
                this.modal.classList.remove('is-hidden');
            }
        }

        close() {
            this._isOpen = false;
            this._pendingSelections.clear();
        }

        refreshFromSnapshot(snapshot) {
            const derived = this.deriveData(snapshot);
            this._available = derived.available;
            this._reason = derived.reason;
            this._objects = derived.objects;
            this._skippedSet = derived.skippedSet;
            this._objectIdSet = new Set(this._objects.map((item) => item.id));
            this._plateLabel = derived.plateLabel;
            this._filename = derived.filename;
            this._pickUrl = derived.pickUrl;
            this._pendingSelections.forEach((id) => {
                if (this._skippedSet.has(id)) {
                    this._pendingSelections.delete(id);
                }
            });
            this.render();
        }

        async ensureMetadata(snapshot) {
            if (!apiService?.fetchWithPrinter) {
                return;
            }
            const metadata = snapshot?.ui?.printSetup?.metadata || null;
            if (metadata?.skip_object) {
                return;
            }
            const gcodeFile = snapshot?.printStatus?.gcode_file || '';
            if (!gcodeFile) {
                return;
            }
            const now = Date.now();
            if (this._metadataFetchInFlight) {
                return;
            }
            if (this._metadataFetchKey === gcodeFile && now - this._metadataFetchFailedAt < 15000) {
                return;
            }
            this._metadataFetchInFlight = true;
            this._metadataFetchKey = gcodeFile;
            try {
                const encoded = encodeURIComponent(gcodeFile);
                const payload = await apiService.fetchWithPrinter(
                    `/api/printjob/skip-metadata?filename=${encoded}`,
                );
                if (payload) {
                    setPrintSetupMetadata(payload);
                }
            } catch (error) {
                this._metadataFetchFailedAt = Date.now();
            } finally {
                this._metadataFetchInFlight = false;
            }
        }

        deriveData(snapshot) {
            const metadata = snapshot?.ui?.printSetup?.metadata || null;
            if (!metadata) {
                return {
                    available: false,
                    reason: 'metadata_missing',
                    objects: [],
                    skippedSet: new Set(),
                    plateLabel: '',
                    filename: '',
                    pickUrl: null,
                };
            }

            const skipMeta = metadata.skip_object || null;
            if (!skipMeta) {
                return {
                    available: false,
                    reason: 'skip_meta_missing',
                    objects: [],
                    skippedSet: new Set(),
                    plateLabel: '',
                    filename: metadata.filename || '',
                    pickUrl: null,
                };
            }

            const selection = resolvePlateSelection(metadata, snapshot);
            const plate = selection.plate;
            if (!plate) {
                return {
                    available: false,
                    reason: 'plate_unavailable',
                    objects: [],
                    skippedSet: new Set(),
                    plateLabel: '',
                    filename: metadata.filename || '',
                    pickUrl: null,
                };
            }

            const plateIndex = selection.plateIndex;
            const skipPlates = Array.isArray(skipMeta.plates) ? skipMeta.plates : [];
            const skipPlate = skipPlates.find((entry) => Number(entry.index) === Number(plateIndex)) || null;
            const available = Boolean(skipPlate?.available);
            const reason = skipPlate?.reason || (available ? null : 'plate_unavailable');
            const pickUrl = skipPlate?.pick_url || null;

            const objectsRaw = Array.isArray(plate?.objects) ? plate.objects : [];
            const objects = objectsRaw
                .map((obj) => {
                    const id = toInt(obj?.identify_id);
                    if (id == null) {
                        return null;
                    }
                    return {
                        id,
                        name: obj?.name || '',
                        skipped: obj?.skipped === true,
                    };
                })
                .filter(Boolean);

            const skippedSet = new Set();
            const skippedList = Array.isArray(snapshot?.printStatus?.skipped_objects)
                ? snapshot.printStatus.skipped_objects
                : [];
            skippedList.forEach((item) => {
                const id = toInt(item);
                if (id != null) {
                    skippedSet.add(id);
                }
            });
            objects.forEach((obj) => {
                if (obj.skipped) {
                    skippedSet.add(obj.id);
                }
            });

            const totalObjects = objects.length;
            const remainingObjects = totalObjects - skippedSet.size;
            let availability = available;
            let reasonCode = reason;
            if (availability) {
                if (totalObjects <= 1) {
                    availability = false;
                    reasonCode = 'object_count_low';
                } else if (totalObjects > 64) {
                    availability = false;
                    reasonCode = 'object_limit_exceeded';
                } else if (remainingObjects <= 1) {
                    availability = false;
                    reasonCode = 'object_remaining_low';
                }
            }

            const plateLabel =
                plate?.metadata?.plate_name ||
                plate?.metadata?.name ||
                (plateIndex ? `Plate ${plateIndex}` : 'Plate');

            return {
                available: availability,
                reason: reasonCode,
                objects,
                skippedSet,
                plateLabel,
                filename: metadata.filename || '',
                pickUrl,
            };
        }

        render() {
            this.renderStatus();
            this.renderMeta();
            this.renderPreview();
            this.renderList();
            this.syncApplyState();
        }

        renderStatus() {
            if (!this.statusEl) {
                return;
            }
            if (this._available) {
                this.statusEl.textContent = 'Select objects to skip. Skipped objects are highlighted.';
                this.statusEl.classList.remove('is-error');
                return;
            }
            this.statusEl.textContent = buildReasonMessage(this._reason);
            this.statusEl.classList.add('is-error');
        }

        renderMeta() {
            if (!this.metaEl) {
                return;
            }
            const parts = [];
            if (this._filename) {
                parts.push(this._filename);
            }
            if (this._plateLabel) {
                parts.push(this._plateLabel);
            }
            if (this._objects.length) {
                parts.push(`${this._objects.length} objects`);
            }
            const skippedCount = this._skippedSet.size;
            if (skippedCount) {
                parts.push(`${skippedCount} skipped`);
            }
            this.metaEl.textContent = parts.join(' | ');
        }

        renderPreview() {
            if (!this.previewWrap) {
                return;
            }
            if (this._pickUrl) {
                this.loadPickImage(this._pickUrl);
                return;
            }
            this.previewWrap.classList.remove('is-loaded');
            this._pickImageUrl = null;
            this._pickImage = null;
            this._pickIds = null;
            this._pickWidth = 0;
            this._pickHeight = 0;
            this._pickBuffer = null;
            if (this.previewCtx && this.previewCanvas) {
                this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
                this.previewCanvas.width = 0;
                this.previewCanvas.height = 0;
            }
            if (this.previewEmpty) {
                this.previewEmpty.textContent = 'No preview';
            }
        }

        loadPickImage(url) {
            if (!url || !this.previewCanvas || !this.previewCtx) {
                return;
            }
            if (this._pickImageUrl === url && this._pickImage) {
                this.drawPickCanvas();
                return;
            }
            this._pickImageUrl = url;
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => {
                const width = image.naturalWidth || image.width;
                const height = image.naturalHeight || image.height;
                if (!width || !height) {
                    return;
                }
                const offscreen = document.createElement('canvas');
                offscreen.width = width;
                offscreen.height = height;
                const offscreenCtx = offscreen.getContext('2d', { willReadFrequently: true });
                if (!offscreenCtx) {
                    return;
                }
                offscreenCtx.drawImage(image, 0, 0);
                const raw = offscreenCtx.getImageData(0, 0, width, height).data;
                const pixelCount = width * height;
                const ids = new Uint32Array(pixelCount);
                for (let i = 0, j = 0; j < pixelCount; i += 4, j += 1) {
                    const alpha = raw[i + 3];
                    if (alpha === 0) {
                        ids[j] = 0;
                        continue;
                    }
                    const id = raw[i] + (raw[i + 1] << 8) + (raw[i + 2] << 16);
                    ids[j] = id;
                }
                this._pickImage = image;
                this._pickWidth = width;
                this._pickHeight = height;
                this._pickIds = ids;
                this._pickBuffer = new Uint8ClampedArray(pixelCount * 4);
                this.previewWrap?.classList.add('is-loaded');
                if (this.previewEmpty) {
                    this.previewEmpty.textContent = '';
                }
                this.drawPickCanvas();
            };
            image.onerror = () => {
                this.previewWrap?.classList.remove('is-loaded');
                this._pickImage = null;
                this._pickIds = null;
                this._pickWidth = 0;
                this._pickHeight = 0;
                this._pickBuffer = null;
                if (this.previewEmpty) {
                    this.previewEmpty.textContent = 'Preview unavailable';
                }
            };
            image.src = url;
        }

        drawPickCanvas() {
            if (
                !this.previewCanvas ||
                !this.previewCtx ||
                !this._pickIds ||
                !this._pickWidth ||
                !this._pickHeight ||
                !this._pickBuffer
            ) {
                return;
            }

            if (
                this.previewCanvas.width !== this._pickWidth ||
                this.previewCanvas.height !== this._pickHeight
            ) {
                this.previewCanvas.width = this._pickWidth;
                this.previewCanvas.height = this._pickHeight;
            }

            const gray = [148, 163, 184];
            const blue = [37, 99, 235];
            const red = [220, 38, 38];
            const ids = this._pickIds;
            const buffer = this._pickBuffer;

            for (let i = 0, j = 0; j < ids.length; i += 4, j += 1) {
                const id = ids[j];
                if (!id) {
                    buffer[i] = 0;
                    buffer[i + 1] = 0;
                    buffer[i + 2] = 0;
                    buffer[i + 3] = 0;
                    continue;
                }
                let color = gray;
                if (this._skippedSet.has(id)) {
                    color = red;
                } else if (this._pendingSelections.has(id)) {
                    color = blue;
                }
                buffer[i] = color[0];
                buffer[i + 1] = color[1];
                buffer[i + 2] = color[2];
                buffer[i + 3] = 255;
            }

            const imageData = new ImageData(buffer, this._pickWidth, this._pickHeight);
            this.previewCtx.putImageData(imageData, 0, 0);
        }

        handlePreviewClick(event) {
            if (!this.previewCanvas || !this._pickIds) {
                return;
            }
            const rect = this.previewCanvas.getBoundingClientRect();
            if (!rect.width || !rect.height) {
                return;
            }
            if (!this._available) {
                showToast(buildReasonMessage(this._reason), 'error');
                return;
            }
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
                return;
            }
            const scaleX = this.previewCanvas.width / rect.width;
            const scaleY = this.previewCanvas.height / rect.height;
            const px = Math.min(
                this.previewCanvas.width - 1,
                Math.max(0, Math.floor(x * scaleX)),
            );
            const py = Math.min(
                this.previewCanvas.height - 1,
                Math.max(0, Math.floor(y * scaleY)),
            );
            const idx = py * this.previewCanvas.width + px;
            const id = this._pickIds[idx];
            if (!id || this._skippedSet.has(id)) {
                return;
            }
            if (this._objectIdSet && !this._objectIdSet.has(id)) {
                return;
            }
            if (this._pendingSelections.has(id)) {
                this._pendingSelections.delete(id);
            } else {
                const remainingBefore = this._objects.length - this._skippedSet.size;
                const remainingAfter = remainingBefore - (this._pendingSelections.size + 1);
                if (remainingAfter < 1) {
                    showToast(buildReasonMessage('selection_invalid'), 'error');
                    return;
                }
                this._pendingSelections.add(id);
            }
            this.renderList();
            this.syncApplyState();
            this.drawPickCanvas();
        }

        renderList() {
            if (!this.listEl) {
                return;
            }
            this.listEl.innerHTML = '';
            if (this.countEl) {
                this.countEl.textContent = String(this._objects.length);
            }

            if (!this._available) {
                this.listEl.appendChild(this.buildEmptyRow('Skip objects unavailable.'));
                return;
            }
            if (!this._objects.length) {
                this.listEl.appendChild(this.buildEmptyRow('No objects found for this plate.'));
                return;
            }

            this._objects.forEach((obj) => {
                const isSkipped = this._skippedSet.has(obj.id);
                const isSelected = this._pendingSelections.has(obj.id);
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'skip-objects-item';
                if (isSkipped) {
                    item.classList.add('is-skipped');
                } else if (isSelected) {
                    item.classList.add('is-selected');
                }
                item.dataset.objectId = String(obj.id);
                item.disabled = isSkipped;
                item.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

                const label = document.createElement('div');
                label.className = 'skip-objects-item__label';

                const name = document.createElement('span');
                name.className = 'skip-objects-item__name';
                name.textContent = obj.name ? obj.name : `Object ${obj.id}`;
                label.appendChild(name);

                const idEl = document.createElement('span');
                idEl.className = 'skip-objects-item__id';
                idEl.textContent = `ID ${obj.id}`;
                label.appendChild(idEl);

                const tag = document.createElement('span');
                tag.className = 'skip-objects-item__tag';
                if (isSkipped) {
                    tag.textContent = 'Skipped';
                } else if (isSelected) {
                    tag.textContent = 'Selected';
                } else {
                    tag.textContent = 'Available';
                }

                item.appendChild(label);
                item.appendChild(tag);
                this.listEl.appendChild(item);
            });
        }

        buildEmptyRow(message) {
            const empty = document.createElement('div');
            empty.className = 'skip-objects-empty';
            empty.textContent = message;
            return empty;
        }

        syncApplyState() {
            if (!this.applyBtn) {
                return;
            }
            const totalObjects = this._objects.length;
            const remainingBefore = totalObjects - this._skippedSet.size;
            const remainingAfter = remainingBefore - this._pendingSelections.size;
            const selectionValid = remainingAfter >= 1;
            this.applyBtn.disabled =
                !this._available ||
                this._pendingSelections.size === 0 ||
                !selectionValid;
            if (this._available && this.statusEl) {
                if (!selectionValid) {
                    this.statusEl.textContent = buildReasonMessage('selection_invalid');
                    this.statusEl.classList.add('is-error');
                } else {
                    this.statusEl.textContent =
                        'Select objects to skip. Skipped objects are highlighted.';
                    this.statusEl.classList.remove('is-error');
                }
            }
        }

        handleListClick(event) {
            const target = event.target?.closest?.('.skip-objects-item');
            if (!target || target.disabled) {
                return;
            }
            const id = toInt(target.dataset.objectId);
            if (id == null || this._skippedSet.has(id)) {
                return;
            }
            if (!this._available) {
                showToast(buildReasonMessage(this._reason), 'error');
                return;
            }
            if (this._pendingSelections.has(id)) {
                this._pendingSelections.delete(id);
            } else {
                const remainingBefore = this._objects.length - this._skippedSet.size;
                const remainingAfter = remainingBefore - (this._pendingSelections.size + 1);
                if (remainingAfter < 1) {
                    showToast(buildReasonMessage('selection_invalid'), 'error');
                    return;
                }
                this._pendingSelections.add(id);
            }
            this.renderList();
            this.syncApplyState();
            this.drawPickCanvas();
        }

        async handleApply() {
            if (!this._available) {
                showToast(buildReasonMessage(this._reason), 'error');
                return;
            }
            const selection = Array.from(this._pendingSelections).sort((a, b) => a - b);
            if (!selection.length) {
                return;
            }
            this.applyBtn.disabled = true;
            if (this.statusEl) {
                this.statusEl.textContent = 'Sending skip command...';
                this.statusEl.classList.remove('is-error');
            }
            try {
                const payload = {
                    obj_list: selection,
                    sequence_id: '0',
                };
                if (apiService?.postWithPrinter) {
                    await apiService.postWithPrinter('/api/control/skip-objects', payload);
                } else if (controlActions?.skipObjects) {
                    await controlActions.skipObjects(selection, '0');
                } else if (appClient?.postWithPrinter) {
                    await appClient.postWithPrinter('/api/control/skip-objects', payload);
                } else {
                    const message = 'Skip objects API unavailable';
                    showToast(message, 'error');
                    if (this.statusEl) {
                        this.statusEl.textContent = message;
                        this.statusEl.classList.add('is-error');
                    }
                    return;
                }
                selection.forEach((id) => this._skippedSet.add(id));
                this._pendingSelections.clear();
                this.renderList();
                this.syncApplyState();
                this.drawPickCanvas();
                showToast('Skip objects command sent', 'success');
                if (this.modalManager?.close) {
                    this.modalManager.close('skipObjects', { force: true });
                } else if (this.modal) {
                    this.modal.classList.add('is-hidden');
                }
                this.close();
            } catch (error) {
                const message = error?.message || 'Skip objects command failed';
                showToast(message, 'error');
                if (this.statusEl) {
                    this.statusEl.textContent = message;
                    this.statusEl.classList.add('is-error');
                }
                this.syncApplyState();
            } finally {
                if (this.applyBtn) {
                    this.applyBtn.disabled = false;
                }
            }
        }
    }

    const instance = new SkipObjectsModal();
    components.skipObjectsModal = instance;
    skipObjectsInstance = instance;
    return instance;
};

export { initSkipObjectsModal };
export default initSkipObjectsModal;
