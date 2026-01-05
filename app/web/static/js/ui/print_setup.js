import initModalManager from '../core/modal_manager.js';

// =============================
//  PRINT SETUP UI CONTROLLER
// =============================

let printSetupInitialized = false;
let printSetupInstance = null;

const initPrintSetup = (global = typeof window !== "undefined" ? window : globalThis) => {
    if (printSetupInitialized) {
        return printSetupInstance;
    }
    printSetupInitialized = true;

    const __root = global;
    const appContext = __root.appContext || (__root.appContext = {});
    appContext.components = appContext.components || {};
    const masterStore = appContext.stores?.core ?? null;
    const masterUtils = appContext.utils ?? {};
    const apiService = appContext.services?.api ?? null;
    const selectors = appContext.selectors?.printSetup || {};
    const statusSelectors = appContext.selectors?.statusPanel || {};
    const printSetupActions = appContext.actions?.printSetup || null;
    const modalManager = initModalManager(global);
    const showToast =
        masterUtils.dom?.showToast ||
        __root?.showToast ||
        ((message, type = "info") => console.log(type, message));
    const printSetupUtils = masterUtils.printSetup || {};
    const setInertState =
        masterUtils.dom?.setInertState ||
        ((element, isVisible) => {
            if (!element) {
                return;
            }
            if (isVisible) {
                element.setAttribute("aria-hidden", "false");
                element.removeAttribute("inert");
                element.inert = false;
                return;
            }
            const activeElement = document.activeElement;
            if (activeElement && element.contains(activeElement) && typeof activeElement.blur === "function") {
                activeElement.blur();
            }
            element.setAttribute("aria-hidden", "true");
            element.setAttribute("inert", "");
            element.inert = true;
        });
    const getSnapshot = () => {
        if (!masterStore || typeof masterStore.getState !== "function") {
            return {};
        }
        return masterStore.getState() || {};
    };
    const select = (selector, ...args) =>
        typeof selector === "function" ? selector(getSnapshot(), ...args) : undefined;
    const hasPrinterCapability = (section, key) => {
        if (typeof masterStore?.hasCapability === "function") {
            return masterStore.hasCapability(section, key);
        }
        const capabilities = getSnapshot().capabilities || {};
        const sectionFields = capabilities?.fields?.[section];
        if (!sectionFields) {
            return true;
        }
        if (!Object.prototype.hasOwnProperty.call(sectionFields, key)) {
            return true;
        }
        return sectionFields[key] !== false;
    };

    const PrintSetupUI = {
        modal: null,
        modalManager,
    _isOpen: false,
    _metadata: null,
    _currentPlateIndex: 0,
    _amsMapping: [],
    _currentTrayMeta: [],
    _currentFilamentGroups: [],
    _typeMismatchMessages: [],
    _nozzleWarningText: "",
    _nozzleMismatch: false,
    _busyWarningText: "",
    _amsExternalWarningText: "",
    _plateMappings: {},
    _autoAssignedPlates: {},
    _plateFiles: [],
    _plateFilamentIds: [],
    _maxFilamentId: 0,
    _platePreviewUrls: [],
    _externalSlotValue: -2,
    _externalFocusIndex: null,
    _isSubmitting: false,
    _lastError: null,
    _amsMenuListenerAttached: false,
    _closeAmsMenus: null,
    _unsubscribe: null,
    _lastRenderKey: "",
    _lastModalKey: "",
    _lastCapabilityKey: "",

      init() {
          this.modal = document.getElementById("print-setup-modal");
          setInertState(this.modal, false);
          this.registerModalManager();
          this.subscribeToStore();
      },

    registerModalManager() {
        if (!this.modal || !this.modalManager?.register) {
            return;
        }
        if (this.modalManager.get?.('printSetup')?.element === this.modal) {
            return;
        }
        this.modalManager.register('printSetup', {
            element: this.modal,
            openClass: null,
            hiddenClass: 'hidden',
            onClose: () => this.close(),
        });
    },

    open(metadata) {
        if (typeof document !== 'undefined') {
            document.dispatchEvent(new Event('file-explorer-hide-overlays'));
        }

        if (!metadata) {
            console.error("No metadata for Print Setup");
            return;
        }

        this._autoAssignedPlates = {};
        this._amsMapping = [];
        this._currentTrayMeta = [];
        this._currentFilamentGroups = [];
        this._typeMismatchMessages = [];
        this._busyWarningText = "";
        this._amsExternalWarningText = "";
        this._nozzleWarningText = "";
        this._nozzleMismatch = false;
        this._externalFocusIndex = null;
        this._isSubmitting = false;
        this._lastError = null;

        this._metadata = metadata;
        this._plateMappings = {};
        this._plateFiles = Array.isArray(metadata.plate_files) ? metadata.plate_files : [];
        this._plateFilamentIds = Array.isArray(metadata.plates)
            ? metadata.plates.map((plate) =>
                  (plate.filaments || [])
                      .map((fil) => {
                          const id = parseInt(fil.id, 10);
                          return Number.isFinite(id) ? id : null;
                      })
                      .filter((val) => val != null)
              )
            : [];
        this._maxFilamentId = Number(metadata.max_filament_id) || 0;
        this._currentPlateIndex = this._normalizePlateIndex(metadata.default_plate_index ?? 0);
        this._platePreviewUrls = Array.isArray(metadata.plate_preview_urls)
            ? metadata.plate_preview_urls
            : [];

        this.setupPlateSelect();

        const plate = this.getCurrentPlate();
        if (!plate) {
            console.error("No plate data in metadata_result");
            return;
        }

        // Write file name
        const fileNameEl = document.getElementById("ps-file-name");
        if (fileNameEl) {
            fileNameEl.textContent = metadata.filename || "";
        }

        // Plate + gcode bilgilerini UI'ya uygula
        this.applyData({
            file: metadata.filename,
            plate,
            gcode: plate.gcode || metadata.gcode
        });
        this.updatePlatePreview();
        const amsArea = document.getElementById("ams-mapping-area");
        if (amsArea) {
            amsArea.classList.remove("hidden");
        }
        this.buildAmsMappingUI();
        
        this._isOpen = true;
    },

      close() {
          this._isOpen = false;
      },

    applyOptionVisibility() {
        const layerInspectInput = document.getElementById("ps-layer-inspect");
        const layerInspectRow = layerInspectInput?.closest(".ps-toggle");
        const showLayerInspect = hasPrinterCapability("print", "layer_inspect");
        if (layerInspectRow) {
            layerInspectRow.classList.toggle("hidden", !showLayerInspect);
            layerInspectRow.setAttribute("aria-hidden", showLayerInspect ? "false" : "true");
        }
        if (!showLayerInspect && layerInspectInput) {
            layerInspectInput.checked = false;
        }
    },

    applyData(data) {
        if (!data) return;
        const plate = data.plate;
        const gcode = data.gcode || {};
        const meta = plate.metadata || {};

        this.applyOptionVisibility();

        // Duration
        let seconds = gcode.estimated_time_s;
        if (!seconds && meta.prediction) {
            seconds = parseInt(meta.prediction, 10);
        }
        const timeEl = document.getElementById("ps-time");
          if (timeEl) {
              const formatDuration = printSetupUtils.formatDuration || this.formatTime;
              timeEl.textContent = formatDuration(seconds);
          }

        // Weight
        const weight =
            gcode.total_filament_weight_g ??
            (meta.weight ? parseFloat(meta.weight) : null);
        const filEl = document.getElementById("ps-filament");
        if (filEl) {
            filEl.textContent = weight != null ? `${weight.toFixed(2)} g` : "---";
        }

        const plateNameEl = document.getElementById("ps-plate-name");
        if (plateNameEl) {
            const plateName =
                plate.metadata?.plater_name ||
                plate.metadata?.plate_name ||
                meta.plater_name ||
                meta.plate_name ||
                plate.metadata?.name ||
                "---";
            plateNameEl.textContent = plateName;
        }

        // Layer count
        const layers =
            gcode.total_layer_number ??
            (meta.total_layer_number ? parseInt(meta.total_layer_number, 10) : null);
        const layerEl = document.getElementById("ps-layers");
        if (layerEl) {
            layerEl.textContent = layers != null ? layers : "---";
        }

        // Nozzle
        const nozzle = meta.nozzle_diameters || "";
        const nozzleEl = document.getElementById("ps-nozzle");
        if (nozzleEl) {
            nozzleEl.textContent = nozzle || "---";
        }

        // --- NOZZLE MISMATCH WARNING ---
        const parseNozzleValue = (value) => {
            if (value == null) return null;
            const source = Array.isArray(value) ? value[0] : value;
            const match = String(source).replace(',', '.').match(/(\d+(?:\.\d+)?)/);
            if (!match) return null;
            const num = parseFloat(match[1]);
            return Number.isFinite(num) ? num : null;
        };

        const printerNozzle = parseNozzleValue(select(selectors.getPrinter)?.nozzle_diameter);
        const slicerNozzle = parseNozzleValue(meta.nozzle_diameters);
        const warnBar = document.getElementById("ps-nozzle-warning");

        const hasNozzleMismatch =
            printerNozzle != null &&
            slicerNozzle != null &&
            Math.abs(printerNozzle - slicerNozzle) > 0.01;

        this._nozzleMismatch = Boolean(hasNozzleMismatch);
        const nozzleWarningText = hasNozzleMismatch
            ? `Nozzle mismatch: Printer ${printerNozzle} mm / Slicer ${slicerNozzle} mm`
            : "";
        this._nozzleWarningText = nozzleWarningText;

        if (warnBar) {
            if (hasNozzleMismatch) {
                warnBar.classList.remove("hidden");
                warnBar.textContent = nozzleWarningText;
            } else {
                warnBar.classList.add("hidden");
                warnBar.textContent = "";
            }
        }

        this.syncPrintButtonState();

        // Build filament cells (left side)
        this.buildFilamentTiles(plate, gcode);
        this.buildAmsMappingUI();
        this.updatePlatePreview();
    },
    updatePlatePreview() {
        const modelImgBox = document.querySelector(".ps-model-image");
        if (!modelImgBox) {
            return;
        }

        const existingPlaceholder = modelImgBox.querySelector(".ps-preview-placeholder");
        if (existingPlaceholder) {
            existingPlaceholder.remove();
        }

        const previewUrl =
            Array.isArray(this._platePreviewUrls) && this._platePreviewUrls.length > 0
                ? this._platePreviewUrls[this._currentPlateIndex] || null
                : null;
        if (previewUrl) {
            modelImgBox.style.backgroundImage = `url('${previewUrl}')`;
            modelImgBox.classList.remove("ps-model-image--empty");
        } else {
            modelImgBox.style.backgroundImage = "none";
            modelImgBox.classList.add("ps-model-image--empty");
            const placeholder = document.createElement("div");
            placeholder.className = "ps-preview-placeholder";
            placeholder.textContent = "No preview";
            modelImgBox.appendChild(placeholder);
        }
        modelImgBox.style.backgroundSize = "cover";
        modelImgBox.style.backgroundPosition = "center";
    },

    getAmsTrays() {
        const s = select(selectors.getAms);
        if (!s) return [];

        if (Array.isArray(s.slots)) {
            return s.slots;
        }

        if (s.ams_units && s.ams_units.length > 0) {
            return s.ams_units[0].trays || [];
        }

        if (Array.isArray(s.ams) && s.ams.length > 0) {
            return s.ams[0].tray || [];
        }

        if (Array.isArray(s.trays) && s.trays.length > 0) {
            return s.trays;
        }

        return [];
    },

    _getExternalSpoolMeta() {
        const spool = select(selectors.getAms)?.external_spool || null;
        if (!spool) {
            return null;
        }
        const material = spool.material || spool.tray_type || "External Spool";
        const name = `External Spool (${material})`;
        const colorRaw = spool.color || "";
        return {
            slotIndex: this._externalSlotValue,
            name,
            type: (material || "").toUpperCase().trim(),
            color: colorRaw ? colorRaw.toUpperCase().replace(/^#/, "").slice(0, 6) : "",
            colorDisplay: colorRaw ? `#${colorRaw.replace(/^#/, "").slice(0, 6)}` : "#2b2f3a",
            idxRaw: spool.tray_info_idx || "",
            idx: (spool.tray_info_idx || "").toUpperCase().trim(),
            isEmptySlot: false,
            isExternal: true,
        };
    },

    _isExternalSelectionActive() {
        return Array.isArray(this._amsMapping) && this._amsMapping.some((v) => v === this._externalSlotValue);
    },

    getCurrentPlate() {
        const plates = Array.isArray(this._metadata?.plates) ? this._metadata.plates : [];
        if (!plates.length) {
            return null;
        }
        const idx = this._normalizePlateIndex(this._currentPlateIndex);
        this._currentPlateIndex = idx;
        return plates[idx] || null;
    },

    setupPlateSelect() {
        const select = document.getElementById("ps-plate-select");
        if (!select || !this._metadata) {
            return;
        }

        const plates = Array.isArray(this._metadata.plates) ? this._metadata.plates : [];
        select.innerHTML = "";

        if (!plates.length) {
            const fallbackName = this._metadata.plate_file || "plate_1.gcode";
            const option = document.createElement("option");
            option.value = this._ensurePlatePath(fallbackName) || "Metadata/plate_1.gcode";
            option.dataset.index = "0";
            option.textContent = "Plate 1";
            select.appendChild(option);
            select.disabled = true;
            this._currentPlateIndex = 0;
        } else {
            plates.forEach((plate, idx) => {
                const option = document.createElement("option");
                option.dataset.index = String(idx);
                option.value =
                    this._resolvePlatePath(idx) || `Metadata/plate_${idx + 1}.gcode`;
                const label =
                    plate.metadata?.plate_name ||
                    plate.metadata?.name ||
                    `Plate ${idx + 1}`;
                option.textContent = label;
                if (idx === this._currentPlateIndex) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
            select.disabled = plates.length <= 1;
        }

        const desiredValue = this._resolvePlatePath(this._currentPlateIndex);
        if (desiredValue) {
            const found = Array.from(select.options).find(
                (opt) => opt.value === desiredValue
            );
            if (found) {
                found.selected = true;
            }
        }
    },

    _normalizePlateIndex(rawIndex) {
        const plates = Array.isArray(this._metadata?.plates) ? this._metadata.plates : [];
        if (!plates.length) {
            return 0;
        }
        if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= plates.length) {
            return 0;
        }
        return rawIndex;
    },

    _resolvePlateFileName(index) {
        if (Array.isArray(this._plateFiles) && this._plateFiles[index]) {
            const candidate = String(this._plateFiles[index]);
            return candidate.startsWith("Metadata/")
                ? candidate.slice("Metadata/".length)
                : candidate;
        }
        if (this._metadata?.plate_file && index === 0) {
            const base = String(this._metadata.plate_file);
            return base.startsWith("Metadata/") ? base.slice("Metadata/".length) : base;
        }
        const plate = this._metadata?.plates?.[index];
        const rawIdx = plate?.metadata?.index;
        const numeric = Number.isFinite(parseInt(rawIdx, 10))
            ? parseInt(rawIdx, 10)
            : index + 1;
        return `plate_${numeric}.gcode`;
    },

    _ensurePlatePath(fileName) {
        if (!fileName) {
            return null;
        }
        return fileName.startsWith("Metadata/") ? fileName : `Metadata/${fileName}`;
    },

    _resolvePlatePath(index) {
        const name = this._resolvePlateFileName(index);
        return this._ensurePlatePath(name);
    },

    _updatePlateMapping(updater) {
        const index = Number.isInteger(this._currentPlateIndex) ? this._currentPlateIndex : 0;
        const mappings = { ...(this._plateMappings || {}) };
        const current = { ...(mappings[index] || {}) };
        const next = typeof updater === "function" ? updater(current) || current : current;
        mappings[index] = next;
        this._plateMappings = mappings;
        return next;
    },

    _getGroupSelection(group) {
        const store = this._plateMappings?.[this._currentPlateIndex];
        if (!store) {
            return -1;
        }
        let selection = null;
        for (const filamentId of group.filamentIds) {
            const value = store[filamentId];
            if (value == null) {
                return -1;
            }
            if (value < 0 && value !== this._externalSlotValue) {
                return -1;
            }
            if (selection == null) {
                selection = value;
            } else if (selection !== value) {
                return -1;
            }
        }
        return selection ?? -1;
    },

    _storeGroupSelection(group, slot) {
        this._updatePlateMapping((store) => {
            group.filamentIds.forEach((id) => {
                store[id] = slot >= 0 || slot === this._externalSlotValue ? slot : -1;
            });
            return store;
        });
    },

    _isTypeCompatible(filamentType, trayType) {
        const target = (filamentType || "").toUpperCase().trim();
        const candidate = (trayType || "").toUpperCase().trim();
        if (!target) {
            return true;
        }
        if (!candidate || candidate === "EMPTY") {
            return false;
        }
        return target === candidate;
    },

    _groupFilaments(filaments) {
        const sorted = [...filaments].map((fil, idx) => {
            const parsedId = parseInt(fil.id, 10);
            return {
                ...fil,
                id: Number.isFinite(parsedId) ? parsedId : idx + 1,
            };
        });

        sorted.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

        return sorted.map((fil) => ({
            key: String(fil.id),
            base: fil,
            filamentIds: [fil.id],
            filaments: [fil],
        }));
    },

    _getFilamentMapLength(plate) {
        const raw = plate?.metadata?.filament_maps;
        if (typeof raw === "string" && raw.trim()) {
            const tokens = raw
                .trim()
                .split(/\s+/)
                .filter((token) => token.length > 0);
            if (tokens.length) {
                return tokens.length;
            }
        }
        if (Array.isArray(plate?.filaments)) {
            return plate.filaments.length;
        }
        return 0;
    },

    _getPlateMaxFilamentId(index) {
        const localIds = Array.isArray(this._plateFilamentIds?.[index])
            ? this._plateFilamentIds[index]
            : [];
        const localMax = localIds.reduce(
            (max, val) => (Number.isFinite(val) && val > max ? val : max),
            0
        );
        return Math.max(localMax, this._maxFilamentId || 0);
    },

    _buildFinalAmsMapping(plate) {
        const store = this._plateMappings?.[this._currentPlateIndex] || {};
        const baseLength = Math.max(
            this._getPlateMaxFilamentId(this._currentPlateIndex),
            this._getFilamentMapLength(plate)
        );
        const result = new Array(Math.max(baseLength, 0)).fill(-1);

        Object.entries(store).forEach(([idStr, slot]) => {
            const id = parseInt(idStr, 10);
            if (!Number.isFinite(id) || id <= 0) {
                return;
            }
            if (slot == null || slot < 0) {
                return;
            }
            const targetIndex = id - 1;
            if (targetIndex >= result.length) {
                const extra = targetIndex - result.length + 1;
                for (let i = 0; i < extra; i += 1) {
                    result.push(-1);
                }
            }
            result[targetIndex] = slot;
        });

        return result;
    },

    _setAmsMapping(nextMapping) {
        this._amsMapping = Array.isArray(nextMapping) ? [...nextMapping] : [];
    },

    _setAmsMappingIndex(index, value) {
        const mapping = Array.isArray(this._amsMapping) ? [...this._amsMapping] : [];
        mapping[index] = value;
        this._amsMapping = mapping;
        return mapping;
    },

    _persistCurrentMapping() {
        if (!Number.isInteger(this._currentPlateIndex)) {
            return;
        }
        this._updatePlateMapping((current) => ({ ...current }));
    },
    
    buildFilamentTiles(plate, gcode) {
        const container = document.getElementById("ps-filament-list");
        if (!container) return;

        container.innerHTML = "";

        const filaments = plate.filaments || [];
        const profiles = gcode.filament_settings || [];

        filaments.forEach((fil, idx) => {
            const color = fil.color || "#999999";
            const type = fil.type || "N/A";
            const profileRaw = profiles[idx] || "";
            // "Sigma3d ABS PowerABS @Bambu Lab A1 0.4 nozzle"
            // -> "Sigma3d ABS PowerABS"
            let profile = profileRaw.split("@")[0].trim();
            if (!profile && profileRaw) profile = profileRaw;

            const labelText = profile ? `${type} - ${profile}` : type;

            const tile = document.createElement("div");
            tile.className = "filament-tile";

            const colorBox = document.createElement("div");
            colorBox.className = "filament-color";
            colorBox.style.backgroundColor = color;

            const info = document.createElement("div");
            info.className = "filament-info";

            const title = document.createElement("div");
            title.className = "filament-type";
            title.textContent = labelText;

            const extra = document.createElement("div");
            extra.className = "filament-extra";
            if (fil.used_g) {
                extra.textContent = `${fil.used_g.toFixed
                    ? fil.used_g.toFixed(2)
                    : fil.used_g} g`;
            } else {
                extra.textContent = "";
            }

            info.appendChild(title);
            info.appendChild(extra);

            tile.appendChild(colorBox);
            tile.appendChild(info);

            container.appendChild(tile);
        });
    },

    buildAmsMappingUI(options = {}) {
        const plate = this.getCurrentPlate();
        if (!plate) {
            return;
        }
        const prepared = this._prepareAmsMappingState(plate, options);
        this._renderAmsMappingUI(prepared);
        this.syncPrintButtonState();
    },

    _prepareAmsMappingState(plate, options = {}) {
        const filaments = Array.isArray(plate?.filaments) ? plate.filaments : [];
        const groups = this._groupFilaments(filaments);
        const mapping = new Array(groups.length).fill(-1);

        const trays = PrintSetupUI.getAmsTrays();
        const externalMeta = this._getExternalSpoolMeta();

        const normalizeType = printSetupUtils.normalizeType || ((value) => (value || "").toUpperCase().trim());
        const normalizeColor = (value) => {
            if (!value) return "";
            const raw = String(value).trim().replace(/\s+/g, "");
            if (!raw) return "";
            let hex = raw.replace(/^#/, "");
            if (/^[0-9A-Fa-f]{3}$/.test(hex)) {
                hex = hex
                    .split("")
                    .map((ch) => ch + ch)
                    .join("");
            }
            if (/^[0-9A-Fa-f]{8}$/.test(hex)) {
                hex = hex.slice(0, 6);
            }
            if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
                return hex.toUpperCase();
            }
            return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
        };
        const normalizeIdx = printSetupUtils.normalizeIdx || ((value) => (value || "").toUpperCase().trim());
        const toDisplayColor = (normalized, fallback) => {
            if (normalized) {
                return `#${normalized}`;
            }
            if (!fallback) {
                return "";
            }
            const raw = String(fallback).trim();
            let hex = raw.replace(/^#/, "");
            if (/^[0-9A-Fa-f]{8}$/.test(hex)) {
                hex = hex.slice(0, 6);
            }
            if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
                return `#${hex.toUpperCase()}`;
            }
            return raw;
        };

        const trayMeta = trays.map((tray, slotIndex) => {
            const typeRaw = tray.tray_type || tray.material || "";
            const colorRaw = tray.color || tray.color_hex || tray.color_name || "";
            const idxRaw = tray.tray_info_idx || tray.info_idx || tray.tray_id || tray.uid || "";
            const name =
                tray.display_name ||
                tray.name ||
                tray.material ||
                tray.tray_type ||
                `Slot ${slotIndex + 1}`;
            const normalizedColor = normalizeColor(colorRaw);
            const displayColor = toDisplayColor(normalizedColor, colorRaw);
            const lowerName = (name || "").toLowerCase().trim();
            const lowerType = (tray.tray_type || tray.material || "").toLowerCase().trim();
            const isEmptySlot =
                lowerType === "empty" ||
                lowerType === "empty slot" ||
                lowerName === "empty slot" ||
                Boolean(lowerName && lowerName.includes("empty") && !lowerName.includes("slot"));
            return {
                slotIndex,
                name,
                type: normalizeType(typeRaw),
                color: normalizedColor,
                colorDisplay: displayColor,
                idxRaw,
                idx: normalizeIdx(idxRaw),
                isEmptySlot,
                isExternal: false,
            };
        });
        if (externalMeta) {
            trayMeta.push(externalMeta);
        }

        const autoAssignedPlates = this._autoAssignedPlates || {};
        const autoAssignActive =
            typeof options.autoAssignActive === "boolean"
                ? options.autoAssignActive
                : !autoAssignedPlates[this._currentPlateIndex];
        groups.forEach((group, idx) => {
            const selection = this._getGroupSelection(group);
            if (selection === this._externalSlotValue || selection >= 0) {
                mapping[idx] = selection;
            }
        });

        if (autoAssignActive) {
            const hasAmsCandidates = trayMeta.some(
                (tray) => !tray.isExternal && !tray.isEmptySlot
            );
            if (!hasAmsCandidates && externalMeta) {
                groups.forEach((group, idx) => {
                    if (mapping[idx] >= 0 || mapping[idx] === this._externalSlotValue) {
                        return;
                    }
                    mapping[idx] = this._externalSlotValue;
                });
            }
            groups.forEach((group, idx) => {
                if (mapping[idx] >= 0 || mapping[idx] === this._externalSlotValue) {
                    return;
                }
                const baseFilament = group.base;
                const filamentType = normalizeType(baseFilament.type);
                const filamentColor = normalizeColor(baseFilament.color);
                const filamentIdx = normalizeIdx(baseFilament.tray_info_idx);
                const candidates = trayMeta.filter(
                    (tray) =>
                        !tray.isExternal &&
                        !tray.isEmptySlot &&
                        this._isTypeCompatible(filamentType, tray.type)
                );
                const findExactIdx = () =>
                    candidates.find((tray) => filamentIdx && tray.idx && filamentIdx === tray.idx) || null;
                const findExactColor = () =>
                    candidates.find(
                        (tray) =>
                            filamentType &&
                            tray.type &&
                            filamentType === tray.type &&
                            filamentColor &&
                            tray.color &&
                            filamentColor === tray.color
                    ) || null;
                const hexToRgb = (hex) => {
                    if (!hex || !/^[0-9A-F]{6}$/i.test(hex)) {
                        return null;
                    }
                    const num = parseInt(hex, 16);
                    return {
                        r: (num >> 16) & 255,
                        g: (num >> 8) & 255,
                        b: num & 255,
                    };
                };
                const colorDistance = (a, b) => {
                    const dr = a.r - b.r;
                    const dg = a.g - b.g;
                    const db = a.b - b.b;
                    return dr * dr + dg * dg + db * db;
                };
                const findClosestColor = () => {
                    const filamentRgb = hexToRgb(filamentColor);
                    if (!filamentRgb) {
                        return null;
                    }
                    let best = null;
                    let bestDist = Number.POSITIVE_INFINITY;
                    candidates.forEach((tray) => {
                        const trayRgb = hexToRgb(tray.color);
                        if (!trayRgb) {
                            return;
                        }
                        const dist = colorDistance(filamentRgb, trayRgb);
                        if (dist < bestDist) {
                            bestDist = dist;
                            best = tray;
                        }
                    });
                    return best;
                };

                const idxMatch = findExactIdx();
                const colorMatch = idxMatch ? null : findExactColor();
                const closestMatch = !idxMatch && !colorMatch ? findClosestColor() : null;
                const fallback = candidates[0] || null;
                const chosen = idxMatch || colorMatch || closestMatch || fallback;
                if (chosen) {
                    mapping[idx] = chosen.slotIndex;
                }
            });
        }

        groups.forEach((group, idx) => {
            const selection = mapping[idx];
            if (selection === this._externalSlotValue || selection >= 0) {
                this._storeGroupSelection(group, selection);
            } else {
                this._storeGroupSelection(group, -1);
            }
        });

        this._setAmsMapping(mapping);
        this._currentTrayMeta = trayMeta;
        this._currentFilamentGroups = groups;

        if (autoAssignActive) {
            this._autoAssignedPlates = {
                ...autoAssignedPlates,
                [this._currentPlateIndex]: true,
            };
        }

        this._persistCurrentMapping();

        return {
            plate,
            trayMeta,
            groups,
            mapping,
            autoAssignActive,
            hasTrays: Boolean(trays.length || externalMeta),
        };
    },

    _renderAmsMappingUI(prepared = {}) {
        const area = document.getElementById("ams-mapping-area");
        if (!area || !this._metadata) return;

        area.innerHTML = "";
        const closeSlotModal = () => {
            if (!this._amsSlotModal) {
                return;
            }
            area
                .querySelectorAll(".ams-slot-trigger[aria-expanded=\"true\"]")
                .forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
            this._amsSlotModal.classList.remove("is-open");
            this._amsSlotModalHeader.textContent = "Select slot";
            this._amsSlotModalActiveIndex = null;
        };
        this._closeAmsMenus = closeSlotModal;
        if (!this._amsMenuListenerAttached) {
            this._amsMenuListenerAttached = true;
        }

        const plate = prepared.plate || this.getCurrentPlate();
        if (!plate) return;

        const trayMeta = Array.isArray(prepared.trayMeta)
            ? prepared.trayMeta
            : Array.isArray(this._currentTrayMeta)
            ? this._currentTrayMeta
            : [];
        const groups = Array.isArray(prepared.groups)
            ? prepared.groups
            : Array.isArray(this._currentFilamentGroups)
            ? this._currentFilamentGroups
            : [];
        const mapping = Array.isArray(prepared.mapping)
            ? prepared.mapping
            : Array.isArray(this._amsMapping)
            ? this._amsMapping
            : [];
        const autoAssignActive = Boolean(prepared.autoAssignActive);

        if (!trayMeta.length) {
            area.innerHTML = `<div class="ams-warning">AMS not found</div>`;
            return;
        }

        const normalizeType = printSetupUtils.normalizeType || ((value) => (value || "").toUpperCase().trim());
        const normalizeColor = (value) => {
            if (!value) return "";
            const raw = String(value).trim().replace(/\s+/g, "");
            if (!raw) return "";
            let hex = raw.replace(/^#/, "");
            if (/^[0-9A-Fa-f]{3}$/.test(hex)) {
                hex = hex
                    .split("")
                    .map((ch) => ch + ch)
                    .join("");
            }
            if (/^[0-9A-Fa-f]{8}$/.test(hex)) {
                hex = hex.slice(0, 6);
            }
            if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
                return hex.toUpperCase();
            }
            return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
        };
        const normalizeIdx = printSetupUtils.normalizeIdx || ((value) => (value || "").toUpperCase().trim());

        const compatibleTraysForAuto = (filamentType) =>
            trayMeta.filter(
                (tray) =>
                    !tray.isExternal &&
                    !tray.isEmptySlot &&
                    this._isTypeCompatible(filamentType, tray.type)
            );

        groups.forEach((group, idx) => {
            const row = document.createElement("div");
            row.className = "ams-map-row";
            row.dataset.index = String(idx);

            const baseFilament = group.base;
            const label = document.createElement("div");
            label.className = "ams-map-label";
            const idLabel =
                group.filamentIds.length > 1
                    ? `IDs ${group.filamentIds.join(", ")}`
                    : `ID ${group.filamentIds[0]}`;
            const typeLabel = baseFilament.type || "Unknown";
            const labelMain = document.createElement("div");
            labelMain.className = "ams-map-label-main";
            labelMain.textContent = `${idLabel}`.trim();
            label.appendChild(labelMain);
            const labelSub = document.createElement("div");
            labelSub.className = "ams-map-label-sub";
            labelSub.textContent = typeLabel;
            label.appendChild(labelSub);
            const tooltipParts = [];
            if (baseFilament.tray_info_idx) {
                tooltipParts.push(`IDX: ${baseFilament.tray_info_idx}`);
            }
            if (baseFilament.color) {
                tooltipParts.push(`Color: ${baseFilament.color}`);
            }
            if (tooltipParts.length) {
                label.title = tooltipParts.join(" | ");
            }

            const select = document.createElement("select");
            select.className = "ams-slot-select";
            select.id = `ams-slot-select-${idx}`;
            select.name = `ams_slot_${idx}`;
            select.dataset.index = idx;
            select.dataset.placeholderText = "Select slot";
            select.classList.add("is-hidden");

            const picker = document.createElement("div");
            picker.className = "ams-slot-picker";
            const trigger = document.createElement("button");
            trigger.type = "button";
            trigger.className = "ams-slot-trigger";
            trigger.textContent = "Select slot";
            trigger.setAttribute("aria-expanded", "false");
            picker.appendChild(select);
            picker.appendChild(trigger);
            select._pickerTrigger = trigger;

            const optEmpty = document.createElement("option");
            optEmpty.value = "-1";
            optEmpty.textContent = "Select slot";
            select.appendChild(optEmpty);
            const applySelection = (value) => {
                select.value = String(value);
                select.dispatchEvent(new Event("change", { bubbles: true }));
            };

            const slotDetail = document.createElement("div");
            slotDetail.className = "ams-slot-detail";
            const slotDetailMain = document.createElement("div");
            slotDetailMain.className = "ams-slot-detail-main";
            const slotDetailSub = document.createElement("div");
            slotDetailSub.className = "ams-slot-detail-sub hidden";
            const slotDetailColor = document.createElement("span");
            slotDetailColor.className = "ams-slot-detail-color";
            slotDetailColor.style.background = baseFilament.color || "#999999";
            const slotDetailText = document.createElement("span");
            slotDetailText.className = "ams-slot-detail-color-text";
            slotDetailSub.appendChild(slotDetailColor);
            slotDetailSub.appendChild(slotDetailText);
            slotDetailMain.textContent = "Slot: Select slot";
            slotDetail.appendChild(slotDetailMain);
            slotDetail.appendChild(slotDetailSub);
            select._slotDetail = slotDetail;

            const info = document.createElement("div");
            info.className = "ams-map-info";
            info.style.display = "flex";
            info.style.alignItems = "center";
            info.style.gap = "6px";

            const colorSwatch = document.createElement("span");
            colorSwatch.className = "ams-color-swatch";
            colorSwatch.style.backgroundColor = baseFilament.color || "#999999";
            colorSwatch.style.width = "12px";
            colorSwatch.style.height = "12px";
            colorSwatch.style.borderRadius = "999px";
            colorSwatch.style.border = "1px solid #64748b";
            info.appendChild(colorSwatch);

            const infoText = document.createElement("span");
            const countLabel =
                group.filamentIds.length > 1 ? `x${group.filamentIds.length}` : "";
            infoText.textContent = `${baseFilament.type || "?"} ${countLabel}`.trim();
            infoText.style.fontSize = "12px";
            infoText.style.opacity = "0.9";
            info.appendChild(infoText);

            if (label.title) {
                info.title = label.title;
            }

            const hint = document.createElement("div");
            hint.className = "ams-map-hint";
            const hintPreview = document.createElement("span");
            hintPreview.style.display = "none";
            hintPreview.style.width = "12px";
            hintPreview.style.height = "12px";
            hintPreview.style.borderRadius = "999px";
            hintPreview.style.border = "1px solid rgba(255,255,255,0.4)";
            hintPreview.style.marginRight = "6px";
            const hintText = document.createElement("span");
            hintText.className = "ams-map-hint-text";
            hint.appendChild(hintPreview);
            hint.appendChild(hintText);
            const updateHint = (text, trayInfo = null) => {
                hintText.textContent = text || "";
                if (trayInfo && trayInfo.colorDisplay) {
                    hintPreview.style.display = "inline-block";
                    hintPreview.style.backgroundColor = trayInfo.colorDisplay;
                } else {
                    hintPreview.style.display = "none";
                }
            };
            const filamentType = normalizeType(baseFilament.type);
            const filamentColor = normalizeColor(baseFilament.color);
            const filamentIdx = normalizeIdx(baseFilament.tray_info_idx);

            const compatibleTrays = compatibleTraysForAuto(filamentType);
            const displayTrays = trayMeta.filter((tray) => tray.isExternal || !tray.isEmptySlot);
            const externalTray = trayMeta.find((tray) => tray.isExternal) || null;

            const ensureSlotModal = () => {
                if (this._amsSlotModal) {
                    return;
                }
                const modal = document.createElement("div");
                modal.className = "ps-ams-modal";
                const backdrop = document.createElement("div");
                backdrop.className = "ps-ams-modal-backdrop";
                const panel = document.createElement("div");
                panel.className = "ps-ams-modal-panel";
                const header = document.createElement("div");
                header.className = "ps-ams-modal-header";
                const title = document.createElement("div");
                title.className = "ps-ams-modal-title";
                title.textContent = "Select slot";
                const closeBtn = document.createElement("button");
                closeBtn.type = "button";
                closeBtn.className = "ps-ams-modal-close";
                closeBtn.textContent = "×";
                header.appendChild(title);
                header.appendChild(closeBtn);
                const menu = document.createElement("div");
                menu.className = "ams-slot-menu";
                const menuList = document.createElement("div");
                menuList.className = "ams-slot-menu-list";
                const amsSection = document.createElement("div");
                amsSection.className = "ams-slot-menu-section";
                const amsTitle = document.createElement("div");
                amsTitle.className = "ams-slot-menu-title";
                amsTitle.textContent = "AMS";
                const amsGrid = document.createElement("div");
                amsGrid.className = "ams-slot-menu-grid";
                amsSection.appendChild(amsTitle);
                amsSection.appendChild(amsGrid);
                const externalSection = document.createElement("div");
                externalSection.className = "ams-slot-menu-section is-external";
                const externalTitle = document.createElement("div");
                externalTitle.className = "ams-slot-menu-title";
                externalTitle.textContent = "External";
                const externalGrid = document.createElement("div");
                externalGrid.className = "ams-slot-menu-grid";
                externalSection.appendChild(externalTitle);
                externalSection.appendChild(externalGrid);
                menuList.appendChild(amsSection);
                menuList.appendChild(externalSection);
                menu.appendChild(menuList);
                panel.appendChild(header);
                panel.appendChild(menu);
                modal.appendChild(backdrop);
                modal.appendChild(panel);
                document.body.appendChild(modal);
                const closeModal = () => {
                    modal.classList.remove("is-open");
                    title.textContent = "Select slot";
                    this._amsSlotModalActiveIndex = null;
                    document
                        .querySelectorAll(".ams-slot-trigger[aria-expanded=\"true\"]")
                        .forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
                };
                closeBtn.addEventListener("click", (event) => {
                    event.preventDefault();
                    closeModal();
                });
                backdrop.addEventListener("click", () => {
                    closeModal();
                });
                this._amsSlotModal = modal;
                this._amsSlotModalHeader = title;
                this._amsSlotModalAmsGrid = amsGrid;
                this._amsSlotModalExternalGrid = externalGrid;
                this._amsSlotModalExternalSection = externalSection;
                this._amsSlotModalClose = closeModal;
            };

            const openSlotModal = () => {
                ensureSlotModal();
                this._amsSlotModalAmsGrid.innerHTML = "";
                this._amsSlotModalExternalGrid.innerHTML = "";
                this._amsSlotModalExternalSection.style.display = "none";
                let hasExternalOptions = false;
                displayTrays.forEach((tray) => {
                    const isCompatible = tray.isExternal || this._isTypeCompatible(filamentType, tray.type);
                    const shouldDisable = !tray.isExternal && !isCompatible;
                    const slotLabel = tray.isExternal
                        ? "EXT"
                        : `A${tray.slotIndex + 1}`;
                    const textColor =
                        (tray.colorDisplay || "").toUpperCase() === "#FFFFFF" ? "#000" : "#FFF";
                    const menuOption = document.createElement("button");
                    menuOption.type = "button";
                    menuOption.className = "ams-slot-option";
                    menuOption.dataset.value = String(tray.slotIndex);
                    menuOption.style.setProperty("--slot-color", tray.colorDisplay || "#64748b");
                    menuOption.style.setProperty("--slot-text", textColor);
                    if (shouldDisable) {
                        menuOption.disabled = true;
                    }
                    const optionTop = document.createElement("div");
                    optionTop.className = "ams-slot-option-top";
                    const optionBody = document.createElement("div");
                    optionBody.className = "ams-slot-option-body";
                    const optionSpool = document.createElement("span");
                    optionSpool.className = "ams-slot-option-spool";
                    const optionId = document.createElement("span");
                    optionId.className = "ams-slot-option-id";
                    optionId.textContent = slotLabel;
                    optionBody.appendChild(optionSpool);
                    optionBody.appendChild(optionId);
                    const optionMaterial = document.createElement("div");
                    optionMaterial.className = "ams-slot-option-material";
                    optionMaterial.textContent = tray.type || tray.name || "Material";
                    menuOption.appendChild(optionTop);
                    menuOption.appendChild(optionBody);
                    menuOption.appendChild(optionMaterial);
                    menuOption.addEventListener("click", (event) => {
                        event.preventDefault();
                        if (menuOption.disabled) {
                            return;
                        }
                        applySelection(tray.slotIndex);
                        this._amsSlotModalClose?.();
                    });
                    if (tray.isExternal) {
                        this._amsSlotModalExternalGrid.appendChild(menuOption);
                        hasExternalOptions = true;
                    } else {
                        this._amsSlotModalAmsGrid.appendChild(menuOption);
                    }
                });
                this._amsSlotModalExternalSection.style.display = hasExternalOptions ? "flex" : "none";
                this._amsSlotModalHeader.textContent = `Select slot for ${idLabel}`;
                this._amsSlotModal.classList.add("is-open");
                this._amsSlotModalActiveIndex = idx;
            };
            displayTrays.forEach((tray) => {
                const opt = document.createElement("option");
                opt.value = String(tray.slotIndex);
                const slotLabel = tray.isExternal
                    ? "EXT"
                    : `A${tray.slotIndex + 1}`;
                const optionText = tray.isExternal
                    ? tray.name
                    : `${slotLabel} - ${tray.name}`;
                opt.textContent = optionText;

                opt.style.backgroundColor = tray.colorDisplay || "#444";
                const normalized = (tray.colorDisplay || "").toUpperCase();
                const textColor = (normalized === "#FFFFFF" || normalized === "#FFF") ? "#000" : "#FFF";
                opt.style.color = textColor;
                opt.dataset.slotColor = tray.colorDisplay || "";
                opt.dataset.textColor = textColor;
                opt.dataset.slotType = tray.type || "";
                opt.dataset.slotName = tray.name || "";
                opt.dataset.slotIdx = tray.idx || tray.idxRaw || "";
                opt.dataset.slotExternal = tray.isExternal ? "1" : "0";
                opt.dataset.slotLabel = slotLabel;
                opt.dataset.slotMaterial = tray.type || tray.name || "Material";

                const isCompatible = tray.isExternal || this._isTypeCompatible(filamentType, tray.type);
                const shouldDisable = !tray.isExternal && !isCompatible;
                if (shouldDisable) {
                    opt.disabled = true;
                }
                opt.style.setProperty("background", opt.style.backgroundColor, "important");
                opt.style.setProperty("color", opt.style.color, "important");
                select.appendChild(opt);
            });
            const buildPanelOptions = () => {
                panelAmsGrid.innerHTML = "";
                panelExternalGrid.innerHTML = "";
                panelExternalSection.style.display = "none";
                let hasExternalOptions = false;
                displayTrays.forEach((tray) => {
                    const isCompatible = tray.isExternal || this._isTypeCompatible(filamentType, tray.type);
                    const shouldDisable = !tray.isExternal && !isCompatible;
                    const slotLabel = tray.isExternal
                        ? "EXT"
                        : `A${tray.slotIndex + 1}`;
                    const textColor =
                        (tray.colorDisplay || "").toUpperCase() === "#FFFFFF" ? "#000" : "#FFF";
                    const menuOption = document.createElement("button");
                    menuOption.type = "button";
                    menuOption.className = "ams-slot-option";
                    menuOption.dataset.value = String(tray.slotIndex);
                    menuOption.style.setProperty("--slot-color", tray.colorDisplay || "#64748b");
                    menuOption.style.setProperty("--slot-text", textColor);
                    if (shouldDisable) {
                        menuOption.disabled = true;
                    }
                    const optionTop = document.createElement("div");
                    optionTop.className = "ams-slot-option-top";
                    const optionBody = document.createElement("div");
                    optionBody.className = "ams-slot-option-body";
                    const optionSpool = document.createElement("span");
                    optionSpool.className = "ams-slot-option-spool";
                    const optionId = document.createElement("span");
                    optionId.className = "ams-slot-option-id";
                    optionId.textContent = slotLabel;
                    optionBody.appendChild(optionSpool);
                    optionBody.appendChild(optionId);
                    const optionMaterial = document.createElement("div");
                    optionMaterial.className = "ams-slot-option-material";
                    optionMaterial.textContent = tray.type || tray.name || "Material";
                    menuOption.appendChild(optionTop);
                    menuOption.appendChild(optionBody);
                    menuOption.appendChild(optionMaterial);
                    menuOption.addEventListener("click", (event) => {
                        event.preventDefault();
                        if (menuOption.disabled) {
                            return;
                        }
                        applySelection(tray.slotIndex);
                        closePanel();
                    });
                    if (tray.isExternal) {
                        panelExternalGrid.appendChild(menuOption);
                        hasExternalOptions = true;
                    } else {
                        panelAmsGrid.appendChild(menuOption);
                    }
                });
                panelExternalSection.style.display = hasExternalOptions ? "flex" : "none";
                panelClear.disabled = false;
                panelClear.onclick = (event) => {
                    event.preventDefault();
                    applySelection(-1);
                    closePanel();
                };
            };
            const openPanelForRow = () => {
                closePanel();
                buildPanelOptions();
                panel.classList.add("is-active");
                panelHeader.textContent = `Select slot for ${idLabel}`;
                panelEmpty.hidden = true;
                panelMenu.hidden = false;
                this._amsPanelActiveIndex = idx;
                trigger.setAttribute("aria-expanded", "true");
            };
            trigger.addEventListener("click", (event) => {
                event.preventDefault();
                openSlotModal();
            });

            const selection =
                mapping[idx] === this._externalSlotValue || Number.isFinite(mapping[idx])
                    ? mapping[idx]
                    : -1;

            if (selection === this._externalSlotValue && externalTray) {
                select.value = String(this._externalSlotValue);
                if (autoAssignActive) {
                    row.classList.add("ams-map-row--auto");
                    updateHint(`AUTO - EXTERNAL - ${externalTray.name}`, externalTray);
                } else {
                    updateHint(`EXTERNAL - ${externalTray.name}`, externalTray);
                }
            } else if (selection >= 0) {
                select.value = String(selection);
                const resolveTray = (slotValue) =>
                    compatibleTrays.find((t) => t.slotIndex === slotValue) ||
                    trayMeta.find((t) => t.slotIndex === slotValue) ||
                    null;
                const autoTray = resolveTray(selection);
                const autoLabel =
                    autoTray?.name ? `Slot ${selection + 1} - ${autoTray.name}` : `Slot ${selection + 1}`;
                if (autoAssignActive) {
                    row.classList.add("ams-map-row--auto");
                    updateHint(`AUTO - ${autoLabel}`, autoTray);
                } else {
                    updateHint(`Slot ${selection + 1}${autoTray?.name ? ` - ${autoTray.name}` : ""}`, autoTray);
                }
            } else {
                row.classList.add("ams-map-row--warning");
                updateHint(
                    compatibleTrays.length
                        ? "Select slot"
                        : "No AMS slot available for this material"
                );
            }

            this._applySlotColor(select);

            select.addEventListener("change", (e) => {
                const i = parseInt(e.target.dataset.index, 10);
                const v = parseInt(e.target.value, 10);
                if (v === this._externalSlotValue) {
                    const nextMapping = new Array(groups.length).fill(this._externalSlotValue);
                    nextMapping.forEach((value, index) => {
                        this._setAmsMappingIndex(index, value);
                        this._storeGroupSelection(groups[index], value);
                    });
                    this.buildAmsMappingUI({ autoAssignActive: false });
                    this._persistCurrentMapping();
                    this.syncPrintButtonState();
                    return;
                }
                if (v >= 0) {
                    this._setAmsMappingIndex(i, v);
                    this._storeGroupSelection(group, v);
                    this.buildAmsMappingUI({ autoAssignActive: false });
                    this._persistCurrentMapping();
                    this.syncPrintButtonState();
                    return;
                }
                this._setAmsMappingIndex(i, -1);
                this._storeGroupSelection(group, -1);
                row.classList.add("ams-map-row--warning");
                updateHint("Select slot");
                this._applySlotColor(select);
                this.syncPrintButtonState();
                this._persistCurrentMapping();
            });

            row.appendChild(label);
            row.appendChild(info);
            row.appendChild(picker);
            row.appendChild(slotDetail);
            row.appendChild(hint);
            area.appendChild(row);
        });
    },



    async submitPrint() {
        const printerId =
			appContext.components?.printerSelector?.getSelectedPrinterId?.() ?? null;
		if (!printerId) {
			showToast("Printer not selected!", "error");
			return;
		}

		if (!this._pendingFileURL) {
			showToast("Selected File is not ready", "error");
			return;
		}

        const hasAmsSelection =
            Array.isArray(this._amsMapping) && this._amsMapping.some((v) => Number.isFinite(v) && v >= 0);
        const effectiveUseAms = hasAmsSelection;

		if (Array.isArray(this._amsMapping) && this._amsMapping.length) {
			if (!this._amsMapping?.length || this._amsMapping.some((v) => v == null || (v < 0 && v !== this._externalSlotValue))) {
                showToast("Printing cannot start because all colors must have an assigned slot. Please assign a slot to each color before proceeding.", "error");
				return;
			}
		}

		const plateSelect = document.getElementById("ps-plate-select");
		const plateValue =
			plateSelect?.value ||
			this._resolvePlatePath(this._currentPlateIndex) ||
			this._ensurePlatePath(this._metadata?.plate_file) ||
			"Metadata/plate_1.gcode";
        const activePlate = this.getCurrentPlate();
        const finalMapping = effectiveUseAms
            ? this._buildFinalAmsMapping(activePlate || {})
            : [];
        const payload = {
			url: this._pendingFileURL,
			plate: plateValue,
			bed_leveling: document.getElementById("ps-bed-leveling").checked,
			flow_cali: document.getElementById("ps-flow-cali").checked,
			timelapse: document.getElementById("ps-timelapse").checked,
			layer_inspect: document.getElementById("ps-layer-inspect").checked,
			vibration_cali: document.getElementById("ps-vibration-cali").checked,
			use_ams: effectiveUseAms
		};
        if (effectiveUseAms) {
            payload.ams_mapping = finalMapping;
        }

        try {
            if (printSetupActions?.setState) {
                printSetupActions.setState({ isSubmitting: true, lastError: null });
            } else {
                this._isSubmitting = true;
                this._lastError = null;
            }
            if (!printSetupActions?.executePrint && typeof apiService?.request !== "function") {
                showToast("API client unavailable", "error");
                if (printSetupActions?.setState) {
                    printSetupActions.setState({ isSubmitting: false, lastError: "API client unavailable" });
                } else {
                    this._isSubmitting = false;
                    this._lastError = "API client unavailable";
                }
                return;
            }
            if (printSetupActions?.executePrint) {
                await printSetupActions.executePrint(payload);
            } else {
                await apiService.request("/api/printjob/execute", {
                    method: "POST",
                    body: JSON.stringify(payload),
                    headers: { "Content-Type": "application/json" },
                });
            }

			this.close();
            showToast("Print command sent", "success");
		} catch (err) {
			console.error(err);
            const errorMessage = "MQTT print command cannot send";
			showToast(errorMessage, "error");
            if (printSetupActions?.setState) {
                printSetupActions.setState({ lastError: errorMessage });
            } else {
                this._lastError = errorMessage;
            }
        } finally {
            if (printSetupActions?.setState) {
                printSetupActions.setState({ isSubmitting: false });
            } else {
                this._isSubmitting = false;
            }
		}
	},


    _getPrintValidation(snapshot = getSnapshot()) {
        const isPrinterBusy =
            typeof statusSelectors.isPrinterBusy === "function"
                ? statusSelectors.isPrinterBusy(snapshot)
                : false;
        const groupCount = Array.isArray(this._currentFilamentGroups)
            ? this._currentFilamentGroups.length
            : 0;
        const hasMappingArray = Array.isArray(this._amsMapping) && this._amsMapping.length > 0;
        const hasAmsSelection =
            Array.isArray(this._amsMapping) && this._amsMapping.some((v) => Number.isFinite(v) && v >= 0);
        const effectiveUseAms = hasAmsSelection;
        const mappingComplete =
            groupCount === 0
                ? true
                : hasMappingArray &&
                  this._amsMapping.length === groupCount &&
                  this._amsMapping.every((v) => v != null && (v >= 0 || v === this._externalSlotValue));
        const mappingReady = mappingComplete;
        const hasExternalSelection = this._isExternalSelectionActive();
        const hasAmsExternalConflict = effectiveUseAms && hasExternalSelection && hasAmsSelection;
        const typeWarnings = this._collectTypeMismatchWarnings();
        const hasTypeMismatch = typeWarnings.length > 0;
        return {
            isPrinterBusy,
            useAms: effectiveUseAms,
            mappingReady,
            hasAmsExternalConflict,
            hasTypeMismatch,
            typeWarnings,
        };
    },

    syncPrintButtonState(snapshot = getSnapshot()) {
        const validation = this._getPrintValidation(snapshot);
        this._updatePrintWarningsState(validation);
        this._renderPrintButtonState(validation);
    },

    _updatePrintWarningsState(validation) {
        if (!validation) {
            return;
        }
        const busyWarningText = validation.isPrinterBusy ? "Printer is busy" : "";
        const amsExternalWarningText = validation.hasAmsExternalConflict
            ? "AMS and External Spool cannot be used in the same print."
            : "";
        const typeWarnings = Array.isArray(validation.typeWarnings) ? validation.typeWarnings : [];
        const sameWarnings =
            busyWarningText === this._busyWarningText &&
            amsExternalWarningText === this._amsExternalWarningText &&
            Array.isArray(this._typeMismatchMessages) &&
            this._typeMismatchMessages.length === typeWarnings.length &&
            this._typeMismatchMessages.every((msg, idx) => msg === typeWarnings[idx]);
        if (printSetupActions?.setState) {
            if (!sameWarnings) {
                printSetupActions.setState({
                    busyWarningText,
                    amsExternalWarningText,
                    typeMismatchMessages: typeWarnings,
                });
            }
            return;
        }
        this._busyWarningText = busyWarningText;
        this._amsExternalWarningText = amsExternalWarningText;
        this._typeMismatchMessages = typeWarnings;
    },

    _renderPrintButtonState(validation) {
        const printBtn = document.getElementById("ps-print-btn");
        if (!printBtn || !validation) {
            return;
        }
        const enabled =
            !validation.isPrinterBusy &&
            !this._nozzleMismatch &&
            validation.mappingReady &&
            !validation.hasTypeMismatch &&
            !validation.hasAmsExternalConflict &&
            !this._isSubmitting;
        printBtn.disabled = !enabled;
        const messages = [];
        if (this._busyWarningText) {
            messages.push(this._busyWarningText);
        }
        if (this._nozzleWarningText) {
            messages.push(this._nozzleWarningText);
        }
        if (this._amsExternalWarningText) {
            messages.push(this._amsExternalWarningText);
        }
        if (Array.isArray(this._typeMismatchMessages) && this._typeMismatchMessages.length) {
            messages.push(...this._typeMismatchMessages);
        }
        if (this._lastError) {
            messages.push(this._lastError);
        }
        this._renderWarningBanner(messages);
    },

    _gatherPrintSetupState() {
        const getCheckbox = (id) => document.getElementById(id)?.checked ?? false;
        const metadata = this._metadata || {};
        const plate = this.getCurrentPlate() || {};
        const platePath = this._resolvePlatePath(this._currentPlateIndex);
        const gcode = plate.gcode || metadata.gcode || {};
        return {
            fileName: metadata.filename || null,
            plateIndex: this._currentPlateIndex,
            platePath,
            plateName: plate.metadata?.plate_name || plate.metadata?.name || null,
            useAms:
                Array.isArray(this._amsMapping) &&
                this._amsMapping.some((v) => Number.isFinite(v) && v >= 0),
            bedLeveling: getCheckbox("ps-bed-leveling"),
            flowCali: getCheckbox("ps-flow-cali"),
            timelapse: getCheckbox("ps-timelapse"),
            layerInspect: getCheckbox("ps-layer-inspect"),
            vibrationCali: getCheckbox("ps-vibration-cali"),
            nozzleMismatch: this._nozzleMismatch,
            pendingFileURL: this._pendingFileURL || null,
            plateMetadata: plate.metadata || null,
            filamentSettings: Array.isArray(gcode.filament_settings)
                ? [...gcode.filament_settings]
                : [],
            filamentCount: Array.isArray(plate.filaments) ? plate.filaments.length : 0,
            amsMapping: Array.isArray(this._amsMapping) ? [...this._amsMapping] : [],
        };
    },

    _mirrorPrintSetupState() {
        // Deprecated: print setup is already stored in ui.printSetup.
    },

    _getGradientTextColor(hexColor) {
        if (!hexColor || !/^#([0-9A-F]{6})$/i.test(hexColor)) {
            return "#ffffff";
        }
        const value = hexColor.replace("#", "");
        const num = parseInt(value, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 180 ? "#111111" : "#ffffff";
    },

    _applySlotColor(select) {
        if (!select) {
            return;
        }
        const option =
            (select.selectedOptions && select.selectedOptions[0]) ||
            select.options[select.selectedIndex] ||
            null;
        if (option && option.dataset.slotColor) {
            select.style.backgroundColor = option.dataset.slotColor;
            select.style.color = option.dataset.textColor || this._getGradientTextColor(option.dataset.slotColor);
        } else {
            select.style.backgroundColor = "#f4f4f8";
            select.style.color = "#0f172a";
        }
        const trigger = select._pickerTrigger;
        if (trigger) {
            if (option && option.value !== "-1") {
                const slotLabel = option.dataset.slotLabel || "";
                const slotMaterial = option.dataset.slotMaterial || option.dataset.slotType || "";
                const slotColor = option.dataset.slotColor || "#f1f5f9";
                const slotText = option.dataset.textColor || "#0f172a";
                trigger.classList.remove("is-empty");
                trigger.style.setProperty("--slot-color", slotColor);
                trigger.style.setProperty("--slot-text", slotText);
                trigger.textContent = "";
                const top = document.createElement("div");
                top.className = "ams-slot-trigger-top";
                const body = document.createElement("div");
                body.className = "ams-slot-trigger-body";
                const spool = document.createElement("span");
                spool.className = "ams-slot-trigger-spool";
                const id = document.createElement("span");
                id.className = "ams-slot-trigger-id";
                id.textContent = slotLabel;
                body.appendChild(spool);
                body.appendChild(id);
                const material = document.createElement("div");
                material.className = "ams-slot-trigger-material";
                material.textContent = slotMaterial;
                trigger.appendChild(top);
                trigger.appendChild(body);
                trigger.appendChild(material);
            } else {
                trigger.classList.add("is-empty");
                trigger.style.removeProperty("--slot-color");
                trigger.style.removeProperty("--slot-text");
                trigger.textContent = select.dataset.placeholderText || "Select slot";
            }
        }
        this._updateSlotDetail(select);
    },

    _updateSlotDetail(select) {
        const detail = select?._slotDetail;
        if (!detail) {
            return;
        }
        const mainEl = detail.querySelector(".ams-slot-detail-main");
        const subEl = detail.querySelector(".ams-slot-detail-sub");
        if (!mainEl || !subEl) {
            return;
        }
        const option =
            (select.selectedOptions && select.selectedOptions[0]) ||
            select.options[select.selectedIndex] ||
            null;
        const slotDetailColor = detail.querySelector(".ams-slot-detail-color");
        const slotDetailText = detail.querySelector(".ams-slot-detail-color-text");
        if (option && option.value !== "-1") {
            const isExternal = option.dataset.slotExternal === "1";
            if (isExternal) {
                const externalName = option.dataset.slotName || "External Spool";
                mainEl.textContent = externalName;
                const colorCode = option.dataset.slotColor || "#000000";
                if (slotDetailColor) {
                    slotDetailColor.style.background = colorCode;
                }
                if (slotDetailText) {
                    slotDetailText.textContent = `Color: ${colorCode}`;
                }
                subEl.classList.remove("hidden");
                return;
            }
            const slotNumber = Number(option.value) + 1;
            const slotTypeText = option.dataset.slotType || "";
            const slotIdxText = option.dataset.slotIdx ? `[${option.dataset.slotIdx}]` : "";
            mainEl.textContent = `Slot ${slotNumber} ${slotTypeText} ${slotIdxText}`.replace(/\s+/g, " ").trim();
            const colorCode = option.dataset.slotColor || "#000000";
            if (slotDetailColor) {
                slotDetailColor.style.background = colorCode;
            }
            if (slotDetailText) {
                slotDetailText.textContent = `Color: ${colorCode}`;
            }
            subEl.classList.remove("hidden");
        } else {
            const placeholder = select.dataset.placeholderText || "Slot: Select slot";
            mainEl.textContent = placeholder;
            subEl.classList.add("hidden");
        }
    },

    _collectTypeMismatchWarnings() {
        const groups = Array.isArray(this._currentFilamentGroups) ? this._currentFilamentGroups : [];
        const trays = Array.isArray(this._currentTrayMeta) ? this._currentTrayMeta : [];
        const warnings = [];
        groups.forEach((group, idx) => {
            const slot = this._amsMapping[idx];
            if (slot === this._externalSlotValue) {
                return;
            }
            if (slot == null || slot < 0) {
                const idLabel =
                    group?.filamentIds?.length > 1
                        ? `IDs ${group.filamentIds.join(", ")}`
                        : group?.filamentIds?.length === 1
                        ? `ID ${group.filamentIds[0]}`
                        : "Filament";
                warnings.push(`Select slot for ${idLabel}`);
                return;
            }
            const tray = trays.find((t) => t.slotIndex === slot);
            if (!tray) {
                return;
            }
            const filamentType = (group?.base?.type || "").trim();
            if (!filamentType) {
                return;
            }
            if (!this._isTypeCompatible(filamentType, tray.type)) {
                const idLabel =
                    group?.filamentIds?.length > 1
                        ? `IDs ${group.filamentIds.join(", ")}`
                        : group?.filamentIds?.length === 1
                        ? `ID ${group.filamentIds[0]}`
                        : "Filament";
                const normalizedFilament = filamentType.toUpperCase();
                const trayType = tray.type || "Unknown";
                warnings.push(
                    `${idLabel} (${normalizedFilament}) assigned to slot ${slot + 1} (${trayType}).`
                );
            }
        });
        return warnings;
    },

    _renderWarningBanner(messages = null) {
        const banner = document.getElementById("ps-warning-banner");
        if (!banner) {
            return;
        }
        const resolved = Array.isArray(messages) ? messages : [];
        if (resolved.length) {
            banner.innerHTML = "";
            resolved.forEach((msg) => {
                const line = document.createElement("div");
                line.textContent = msg;
                banner.appendChild(line);
            });
            banner.classList.remove("hidden");
        } else {
            banner.textContent = "";
            banner.classList.add("hidden");
        }
    },

    // Helpers for UI formatting
    formatTime(seconds) {
        const formatDuration = printSetupUtils.formatDuration;
        if (formatDuration) {
            return formatDuration(seconds);
        }
        if (!seconds) return "---";
        const s = parseInt(seconds, 10);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${h}h ${m}m`;
    },

    formatFilament(mm) {
        if (!mm) return "---";
        const meters = (parseFloat(mm) / 1000).toFixed(2);
        return `${meters} m`;
    },

    setPendingFileURL(url) {
        this._pendingFileURL = url;
    }
    ,

    subscribeToStore() {
        if (this._unsubscribe || typeof masterStore?.subscribe !== "function") {
            return;
        }
        this._unsubscribe = masterStore.subscribe((snapshot) => {
            const state = snapshot?.ui?.printSetup || {};
            this.renderModalState(snapshot);
            const isOpen =
                typeof selectors.getIsOpen === "function"
                    ? selectors.getIsOpen(snapshot)
                    : Boolean(state.isOpen);
            if (isOpen) {
                const caps = snapshot?.capabilities?.fields?.print || {};
                const capKey = `layer_inspect:${caps.layer_inspect !== false}`;
                if (capKey !== this._lastCapabilityKey) {
                    this._lastCapabilityKey = capKey;
                    this.applyOptionVisibility();
                }
            }
            const busyFlag =
                typeof statusSelectors.isPrinterBusy === "function"
                    ? statusSelectors.isPrinterBusy(snapshot)
                    : false;
            const keyParts = [
                state.currentPlateIndex,
                (state.amsMapping || []).join(","),
                (state.typeMismatchMessages || []).join("|"),
                state.nozzleWarningText || "",
                state.nozzleMismatch ? "1" : "0",
                state.isSubmitting ? "1" : "0",
                state.lastError || "",
                busyFlag ? "busy" : "idle",
            ];
            const nextKey = keyParts.join("::");
            if (nextKey !== this._lastRenderKey) {
                this._lastRenderKey = nextKey;
                this.syncPrintButtonState(snapshot);
            }
        });
    }

      ,renderModalState(snapshot = getSnapshot()) {
          if (!this.modal) {
              return;
          }
          const state = snapshot?.ui?.printSetup || {};
          const isOpen =
              typeof selectors.getIsOpen === "function"
                  ? selectors.getIsOpen(snapshot)
                  : Boolean(state.isOpen);
          const key = isOpen ? "1" : "0";
          if (key === this._lastModalKey) {
              return;
          }
          this._lastModalKey = key;

          if (this.modalManager?.isOpen) {
              const managerOpen = this.modalManager.isOpen("printSetup");
              if (isOpen && !managerOpen) {
                  this.modalManager.open("printSetup");
              } else if (!isOpen && managerOpen) {
                  this.modalManager.close("printSetup", { force: true });
              }
              return;
          }

          if (isOpen) {
              this.modal.classList.remove("hidden");
              setInertState(this.modal, true);
              window.appContext?.actions?.ui?.setModalGate?.('printSetup');
          } else {
              this.modal.classList.add("hidden");
              setInertState(this.modal, false);
              window.appContext?.actions?.ui?.clearModalGate?.('printSetup');
          }
      }
};

const initializePrintSetupState = () => {
    if (!masterStore?.setPrintSetupUiState && !printSetupActions?.setState) {
        return;
    }
    const initialState = {
        isOpen: false,
        metadata: null,
        currentPlateIndex: 0,
        amsMapping: [],
        currentTrayMeta: [],
        currentFilamentGroups: [],
        typeMismatchMessages: [],
        busyWarningText: "",
        amsExternalWarningText: "",
        nozzleWarningText: "",
        nozzleMismatch: false,
        plateMappings: {},
        autoAssignedPlates: {},
        plateFiles: [],
        plateFilamentIds: [],
        maxFilamentId: 0,
        platePreviewUrls: [],
        externalSlotValue: -2,
        externalFocusIndex: null,
        pendingFileURL: null,
        isSubmitting: false,
        lastError: null,
    };
    if (printSetupActions?.setState) {
        printSetupActions.setState(initialState);
        return;
    }
    masterStore.setPrintSetupUiState(initialState);
};

const bindPrintSetupState = (ui) => {
    const map = {
        _isOpen: selectors.getIsOpen,
        _metadata: selectors.getMetadata,
        _currentPlateIndex: selectors.getCurrentPlateIndex,
        _amsMapping: selectors.getAmsMapping,
        _currentTrayMeta: selectors.getCurrentTrayMeta,
        _currentFilamentGroups: selectors.getCurrentFilamentGroups,
        _typeMismatchMessages: selectors.getTypeMismatchMessages,
        _busyWarningText: selectors.getBusyWarningText,
        _amsExternalWarningText: selectors.getAmsExternalWarningText,
        _nozzleWarningText: selectors.getNozzleWarningText,
        _nozzleMismatch: selectors.getNozzleMismatch,
        _plateMappings: selectors.getPlateMappings,
        _autoAssignedPlates: selectors.getAutoAssignedPlates,
        _plateFiles: selectors.getPlateFiles,
        _plateFilamentIds: selectors.getPlateFilamentIds,
        _maxFilamentId: selectors.getMaxFilamentId,
        _platePreviewUrls: selectors.getPlatePreviewUrls,
        _externalSlotValue: selectors.getExternalSlotValue,
        _externalFocusIndex: selectors.getExternalFocusIndex,
        _pendingFileURL: selectors.getPendingFileURL,
        _isSubmitting: selectors.getIsSubmitting,
        _lastError: selectors.getLastError,
    };
    Object.keys(map).forEach((prop) => {
        Object.defineProperty(ui, prop, {
            get: () => select(map[prop]),
            set: (value) => {
                const key = prop.replace(/^_/, "");
                if (printSetupActions?.setState) {
                    printSetupActions.setState({ [key]: value });
                    return;
                }
                masterStore?.setPrintSetupUiState?.({ [key]: value });
            },
        });
    });
};

initializePrintSetupState();
bindPrintSetupState(PrintSetupUI);

const bindPrintSetupEvents = () => {
    const closeBtn = document.getElementById("print-setup-close");
    if (closeBtn && !closeBtn.dataset?.modalClose) {
        closeBtn.addEventListener("click", () => PrintSetupUI.close());
    }

    const cancelBtn = document.getElementById("ps-cancel-btn");
    if (cancelBtn && !cancelBtn.dataset?.modalClose) {
        cancelBtn.addEventListener("click", () => PrintSetupUI.close());
    }

    const printBtn = document.getElementById("ps-print-btn");
    if (printBtn) {
        printBtn.addEventListener("click", () => PrintSetupUI.submitPrint());
    }

    const amsArea = document.getElementById("ams-mapping-area");
    if (amsArea) {
        amsArea.classList.remove("hidden");
    }

    const ids = [
        "ps-bed-leveling",
        "ps-flow-cali",
        "ps-timelapse",
        "ps-layer-inspect",
        "ps-vibration-cali",
    ];

    ids.forEach((id) => {
        const element = document.getElementById(id);
        if (!element) {
            return;
        }
        element.addEventListener("change", () => {
            PrintSetupUI.syncPrintButtonState();
        });
    });

    const plateSelect = document.getElementById("ps-plate-select");
    if (plateSelect && !plateSelect.dataset.listenerAttached) {
        const stopEvent = (event) => {
            event.stopPropagation();
        };
        plateSelect.addEventListener("mousedown", stopEvent);
        plateSelect.addEventListener("click", stopEvent);
        plateSelect.addEventListener("touchstart", stopEvent, { passive: true });
        plateSelect.addEventListener("change", (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            const idx = parseInt(selectedOption?.dataset.index ?? "0", 10);
            if (!Number.isInteger(idx)) {
                return;
            }
            PrintSetupUI._persistCurrentMapping();
            PrintSetupUI._currentPlateIndex = idx;
            const plate = PrintSetupUI.getCurrentPlate();
            if (!plate) {
                return;
            }
            PrintSetupUI.applyData({
                file: PrintSetupUI._metadata?.filename,
                plate,
                gcode: plate.gcode || PrintSetupUI._metadata?.gcode || {},
            });
            PrintSetupUI.updatePlatePreview();
        });
        plateSelect.dataset.listenerAttached = "1";
    }
};

  const bindPrintSetupDocumentEvents = () => {
      document.addEventListener("click", (event) => {
        const target = event?.target;
            if (target && typeof target.closest === "function") {
                if (target.closest("#ps-plate-select")) {
                    return;
                }
                if (target.closest(".ps-ams-modal, .ams-slot-trigger")) {
                    return;
                }
            }
        if (PrintSetupUI._closeAmsMenus) {
            PrintSetupUI._closeAmsMenus();
        }
      });
  };

    const events = appContext.events || {};
    const eventKey = events.keys?.PRINT_SETUP || 'printSetup';
    if (typeof events.register === 'function') {
        events.register(eventKey, {
            component: bindPrintSetupEvents,
            document: bindPrintSetupDocumentEvents,
        });
    } else {
        events.bindPrintSetupEvents = bindPrintSetupEvents;
        events.bindPrintSetupDocumentEvents = bindPrintSetupDocumentEvents;
    }

    appContext.components.printSetup = PrintSetupUI;
    printSetupInstance = PrintSetupUI;
    return PrintSetupUI;
};

const globalProxy =
    typeof window !== "undefined"
        ? window
        : typeof globalThis !== "undefined"
            ? globalThis
            : {};

let printSetupUiInitialized = false;
let printSetupInitScheduled = false;

const canInitializePrintSetup = () =>
    Boolean(globalProxy.document && globalProxy.appContext?.stores?.core);

const schedulePrintSetupInit = () => {
    if (printSetupInitScheduled) {
        return;
    }
    printSetupInitScheduled = true;
    const retry = () => {
        printSetupInitScheduled = false;
        initPrintSetupUI();
    };
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(retry);
    } else {
        setTimeout(retry, 16);
    }
};

const initPrintSetupUI = () => {
    if (printSetupUiInitialized) {
        return globalProxy.appContext?.components?.printSetup || null;
    }
    if (!canInitializePrintSetup()) {
        schedulePrintSetupInit();
        return null;
    }
    const ui = initPrintSetup(globalProxy);
    if (ui?.init) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => ui.init());
        } else {
            ui.init();
        }
    }
    printSetupUiInitialized = true;
    return globalProxy.appContext?.components?.printSetup || null;
};

export { initPrintSetupUI as initPrintSetup };
export default initPrintSetupUI;

