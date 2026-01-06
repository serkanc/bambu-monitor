import { PrinterEventPanel, bindPrinterEventPanelEvents } from './printer_selector/event_panel.js';
import bindSidebarEvents from './printer_selector/sidebar_events.js';
import bindModalEvents from './printer_selector/modal_events.js';
import initModalManager from '../core/modal_manager.js';

function initializePrinterSelector(global) {
    const appContext = global.appContext || (global.appContext = {});
    appContext.components = appContext.components || {};
    const components = appContext.components;
    const masterStore = appContext.stores?.core ?? null;
    const masterUtils = appContext.utils ?? {};
    const services = appContext.services ?? {};
    const printerActions = appContext.actions?.printerSelector || null;
    const filamentActions = appContext.actions?.filamentCatalog || null;
    const printerApi = printerActions || services.printers || {};
    const printerSelectors = appContext.selectors?.printerSelector || {};
    const modalManager = initModalManager(global);

    const parseApiResponse = async (response) => {
        if (response && typeof response.json === 'function') {
            return response.json();
        }
        return response;
    };
    const scheduleApiRetry = (callback) => {
        if (typeof callback !== 'function') {
            return;
        }
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(callback);
        } else {
            setTimeout(callback, 16);
        }
    };
    const showToast =
        masterUtils.dom?.showToast ||
        ((message, type = 'info') => console.log(type, message));
    const setInertState =
        masterUtils.dom?.setInertState ||
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
            const activeElement = document.activeElement;
            if (activeElement && element.contains(activeElement) && typeof activeElement.blur === 'function') {
                activeElement.blur();
            }
            element.setAttribute('aria-hidden', 'true');
            element.setAttribute('inert', '');
            element.inert = true;
        });

    const statusConstants = printerSelectors.getStatusConstants
        ? printerSelectors.getStatusConstants(
              typeof masterStore?.getState === 'function' ? masterStore.getState() : {},
          )
        : masterStore?.constants?.status || {};
    const defaultStateLabels = {
        FINISH: 'Finished',
        SLICING: 'Slicing',
        RUNNING: 'Running',
        PAUSE: 'Paused',
        INIT: 'Initializing',
        FAILED: 'Failed',
        IDLE: 'Idle',
        UNKNOWN: 'Unknown',
    };
    const stateLabels = statusConstants.labels || defaultStateLabels;
    const getStateLabel = (value) => {
        if (!value) {
            return 'Unknown';
        }
        const key = String(value).toUpperCase();
        return stateLabels[key] || defaultStateLabels[key] || key;
    };

    const MODAL_CONTEXTS = {
        setup: {
            eyebrow: 'SETUP MODE',
            title: 'Add Printer',
            description:
                'Enter the printer IP, serial number, and access code; verification automatically retrieves model and firmware information.',
            showNameField: true,
            showAccessField: true,
            secondaryLabel: 'Close',
            secondaryAction: 'close',
        },
        add: {
            eyebrow: 'NEW DEVICE',
            title: 'Add Printer',
            description:
                'Enter the printer IP, serial number, and access code; verification automatically retrieves model and firmware information.',
            showNameField: true,
            showAccessField: true,
            secondaryLabel: 'Close',
            secondaryAction: 'close',
        },
        edit: {
            eyebrow: 'EDIT PRINTER',
            title: 'Edit Printer',
            description:
                'Update the printer connection details (IP/Serial). Access code remains unchanged unless you enter a new one.',
            showNameField: true,
            showAccessField: true,
            secondaryLabel: 'Close',
            secondaryAction: 'close',
        },
    };

    const STORAGE_KEY = 'bambu.selectedPrinter';

    const defaultSpeedLabels = {
        '1': 'Silent',
        '2': 'Standard',
        '3': 'Sport',
        '4': 'Ludicrous',
    };

    const formatSpeedMode = (value) => {
        if (value === undefined || value === null || value === '') {
            return '-';
        }
        const labels =
            printerSelectors.getSpeedLabels?.(
                typeof masterStore?.getState === 'function' ? masterStore.getState() : {},
            ) || defaultSpeedLabels;
        const key = String(value);
        return labels[key] ?? key;
    };

    class PrinterSelector {
        constructor() {
            this.autoRefreshId = null;
            this.listeners = [];
            this.openStatusDetailEl = null;
            this._unsubscribe = null;
            this._lastRenderKey = '';
            this._lastLayoutKey = '';
            this._lastModalOpenKey = '';
            this._lastModalContentKey = '';
            this._lastContextMenuKey = '';

            this.layoutEl = document.querySelector('.dashboard-layout');
            this.dashboardMainEl = document.querySelector('.dashboard-main');
            this.listEl = document.getElementById('printer-list');
            this.sidebarEl = document.getElementById('printer-sidebar');
            this.backdropEl = document.getElementById('printer-sidebar-backdrop');
            this.menuToggle = document.getElementById('printer-menu-toggle');
            this.closeBtn = document.getElementById('printer-sidebar-close');
            this.addBtn = document.getElementById('add-printer-btn');
            this.currentNameEl = document.getElementById('current-printer-name');
            this.currentMetaEl = document.getElementById('current-printer-meta');
            this.currentModelEl = document.getElementById('current-printer-model');
            this.identityNameEl = document.getElementById('printer-identity-name');
            this.identityIpEl = document.getElementById('printer-identity-ip');
            this.identitySerialEl = document.getElementById('printer-identity-serial');
            this.identityModelEl = document.getElementById('printer-identity-model');
            this.countEl = document.getElementById('printer-count-badge');
            this.breakpoint = window.matchMedia('(max-width: 1024px)');
            this.modalEl = document.getElementById('printer-modal');
            this.modalBackdrop = document.getElementById('printer-modal-backdrop');
            this.modalForm = document.getElementById('printer-form');
            this.modalSubmitBtn = document.getElementById('printer-form-submit');
            this.modalStatusChip = document.getElementById('printer-modal-status-chip');
            this.modalErrorEl = document.getElementById('printer-modal-error');
            this.previewModelEl = document.getElementById('preview-model');
            this.previewFirmwareEl = document.getElementById('preview-firmware');
            this.previewModulesList = document.getElementById('preview-modules-list');
            this.previewPanel = document.getElementById('printer-modal-preview');
            this.modalAddArea = document.getElementById('printer-modal-add-area');
            this.modalAddBtn = document.getElementById('printer-modal-add');
            this.modalCloseBtn = document.getElementById('printer-modal-close');
            this.modalHelpBtn = document.getElementById('printer-modal-help');
            this.makeDefaultField = document.getElementById('modal-field-default');
            this.makeDefaultCheckbox = document.getElementById('printer-make-default');
            this.modalTitleEl = document.getElementById('printer-modal-title');
            this.modalEyebrowEl = document.getElementById('printer-modal-eyebrow');
            this.modalDescriptionEl = document.getElementById('printer-modal-description');
            this.nameFieldEl = document.getElementById('modal-field-name');
            this.accessFieldEl = document.getElementById('modal-field-access');
            this.printerIdInput = document.getElementById('printer-id');
            this.printerIpInput = document.getElementById('printer-ip');
            this.printerSerialInput = document.getElementById('printer-serial');
            this.printerAccessInput = document.getElementById('printer-access');
            this.externalForm = document.getElementById('printer-external-form');
            this.externalCameraToggle = document.getElementById('external-camera-enabled');
            this.externalCameraUrlInput = document.getElementById('external-camera-url');
            this.externalCameraUsernameInput = document.getElementById('external-camera-username');
            this.externalCameraPasswordInput = document.getElementById('external-camera-password');
            this.externalCameraUrlField = document.getElementById('modal-field-external-camera-url');
            this.externalCameraUsernameField = document.getElementById('modal-field-external-camera-username');
            this.externalCameraPasswordField = document.getElementById('modal-field-external-camera-password');
            this.contextMenuEl = document.getElementById('printer-context-menu');
            this.contextMenuTarget = null;
            this.longPressTimer = null;
            this.longPressTriggered = false;
            this.isSetupMode =
                document.body?.dataset?.firstRun === 'true' || window.location.pathname === '/setup';
            this.isVerified = false;
            this.verificationPayloadHash = null;
            this.isEditing = false;
            this.editingPrinterId = null;
            this.modalMode = this.isSetupMode ? 'setup' : 'add';
            this.modalSecondaryAction = this.isSetupMode ? 'help' : 'close';
            this.editingPrinterAccessCode = '';
            this.longPressPosition = { clientX: 0, clientY: 0 };
            this.longPressEvent = null;
            this.longPressStartPosition = null;
            this.longPressTouchId = null;
            this.eventToggleEl = document.getElementById('event-panel-toggle');
            this.eventBadgeEl = document.getElementById('event-panel-badge');
            this.eventPanelEl = document.getElementById('event-sidebar');
            this.eventPanelBackdropEl = document.getElementById('event-sidebar-backdrop');
            this.eventListEl = document.getElementById('printer-events-list');
            this.eventClearBtn = document.getElementById('event-panel-clear');
            this.eventMarkReadBtn = document.getElementById('event-panel-mark-read');
            this.eventCloseBtn = document.getElementById('event-panel-close');
            this.eventPanel = null;
            this.uiActions = null;
            this.serverOfflineBanner = document.getElementById('server-offline-banner');
            this.serverOffline = false;
            this.modalManager = modalManager;

            this._bindStateProxy();
            this._initializeState();
            this.registerModalManager();
            this.initialize();
            this._initializeActions();
            const setupStep = document.body?.dataset?.setupStep || '';
            const passwordRequired = document.body?.dataset?.passwordRequired === 'true';
            if (this._getStateValue('isSetupMode') && setupStep === 'printer' && !passwordRequired) {
                this.openModalForMode('setup');
            }
        }

        _bindStateProxy() {
            this._stateKeys = [
                'printers',
                'selectedId',
                'pendingId',
                'isSwitching',
                'isRefreshing',
                'isAdding',
                'userCollapsed',
                'isSidebarOpen',
                'refreshIntervalMs',
                'apiRetryScheduled',
                'lastEmittedSelectionId',
                'openStatusDetailId',
                'printerUnreadMap',
                'isSetupMode',
                'isVerified',
                'verificationPayloadHash',
                'isEditing',
                'editingPrinterId',
                'modalMode',
                'modalSecondaryAction',
                'isModalOpen',
                'isContextMenuOpen',
                'contextMenuPosition',
                'contextMenuPrinterId',
                'modalStatus',
                'modalError',
                'modalPreview',
                'isPreviewVisible',
                'modalSubmitLabel',
                'modalAddLabel',
                'modalSubmitDisabled',
                'modalAddDisabled',
                'modalSubmitLoading',
                'modalAddLoading',
                'editingPrinterAccessCode',
                'initialPayload',
                'canApplyWithoutVerify',
            ];
            this._stateKeys.forEach((key) => {
                Object.defineProperty(this, key, {
                    get: () => this._getStateValue(key),
                    set: (value) => this._setStateValue(key, value),
                });
            });
        }

        _getSnapshot() {
            return typeof masterStore?.getState === 'function' ? masterStore.getState() : {};
        }

        _getUnreadCount(snapshot = this._getSnapshot()) {
            if (typeof printerSelectors?.getEventPanelUnreadIds === 'function') {
                const ids = printerSelectors.getEventPanelUnreadIds(snapshot);
                return Array.isArray(ids) ? ids.length : 0;
            }
            const ids = snapshot?.ui?.printerSelector?.eventPanel?.unreadIds || [];
            return Array.isArray(ids) ? ids.length : 0;
        }

        updateEventBadge(snapshot = this._getSnapshot()) {
            if (!this.eventBadgeEl || !this.eventToggleEl) {
                return;
            }
            const count = this._getUnreadCount(snapshot);
            if (count > 0) {
                this.eventBadgeEl.textContent = count > 99 ? '99+' : String(count);
                this.eventBadgeEl.classList.add('is-visible');
                this.eventToggleEl.setAttribute('aria-label', `Open events panel (${count} unread)`);
            } else {
                this.eventBadgeEl.textContent = '';
                this.eventBadgeEl.classList.remove('is-visible');
                this.eventToggleEl.setAttribute('aria-label', 'Open events panel');
            }
        }

        _getStateValue(key) {
            const snapshot = this._getSnapshot();
            const map = {
                printers: printerSelectors.getPrinters,
                selectedId: printerSelectors.getSelectedId,
                pendingId: printerSelectors.getPendingId,
                isSwitching: printerSelectors.getIsSwitching,
                isRefreshing: printerSelectors.getIsRefreshing,
                isAdding: printerSelectors.getIsAdding,
                userCollapsed: printerSelectors.getUserCollapsed,
                refreshIntervalMs: printerSelectors.getRefreshIntervalMs,
                isSidebarOpen: () => snapshot?.ui?.printerSelector?.isSidebarOpen ?? false,
                apiRetryScheduled: () => snapshot?.ui?.printerSelector?.apiRetryScheduled ?? false,
                lastEmittedSelectionId: printerSelectors.getLastEmittedSelectionId,
                openStatusDetailId: printerSelectors.getOpenStatusDetailId,
                printerUnreadMap: printerSelectors.getPrinterUnreadMap,
                isSetupMode: printerSelectors.getIsSetupMode,
                isVerified: () => snapshot?.ui?.printerSelector?.isVerified ?? false,
                verificationPayloadHash: printerSelectors.getVerificationPayloadHash,
                isEditing: printerSelectors.getIsEditing,
                editingPrinterId: printerSelectors.getEditingPrinterId,
                modalMode: printerSelectors.getModalMode,
                modalSecondaryAction: printerSelectors.getModalSecondaryAction,
                isModalOpen: () => snapshot?.ui?.printerSelector?.isModalOpen ?? false,
                isContextMenuOpen: () => snapshot?.ui?.printerSelector?.isContextMenuOpen ?? false,
                contextMenuPosition: () => snapshot?.ui?.printerSelector?.contextMenuPosition ?? null,
                contextMenuPrinterId: () => snapshot?.ui?.printerSelector?.contextMenuPrinterId ?? null,
                modalStatus: () => snapshot?.ui?.printerSelector?.modalStatus ?? null,
                modalError: () => snapshot?.ui?.printerSelector?.modalError ?? '',
                modalPreview: () => snapshot?.ui?.printerSelector?.modalPreview ?? null,
                isPreviewVisible: () => snapshot?.ui?.printerSelector?.isPreviewVisible ?? false,
                modalSubmitLabel: () => snapshot?.ui?.printerSelector?.modalSubmitLabel ?? 'Verify',
                modalAddLabel: () => snapshot?.ui?.printerSelector?.modalAddLabel ?? 'Add Printer',
                modalSubmitDisabled: () => snapshot?.ui?.printerSelector?.modalSubmitDisabled ?? false,
                modalAddDisabled: () => snapshot?.ui?.printerSelector?.modalAddDisabled ?? false,
                modalSubmitLoading: () => snapshot?.ui?.printerSelector?.modalSubmitLoading ?? false,
                modalAddLoading: () => snapshot?.ui?.printerSelector?.modalAddLoading ?? false,
                editingPrinterAccessCode: printerSelectors.getEditingAccessCode,
                initialPayload: printerSelectors.getInitialPayload,
                canApplyWithoutVerify: printerSelectors.getCanApplyWithoutVerify,
            };
            const selector = map[key];
            if (typeof selector === 'function') {
                return selector(snapshot);
            }
            return snapshot?.ui?.printerSelector?.[key];
        }

        _setStateValue(key, value) {
            if (printerActions?.setUiState) {
                printerActions.setUiState({ [key]: value });
                return;
            }
        }

        _setPrintersState(printers) {
            if (printerActions?.setPrinters) {
                printerActions.setPrinters(printers);
                return;
            }
        }

        _initializeState() {
            const isSetupMode =
                document.body?.dataset?.firstRun === 'true' || window.location.pathname === '/setup';
            const nextModalMode = isSetupMode ? 'setup' : 'add';
            const nextSecondaryAction = isSetupMode ? 'help' : 'close';
            if (printerActions?.setUiState) {
                printerActions.setUiState({
                    selectedId: this.readStoredSelection(),
                    isSetupMode,
                    modalMode: nextModalMode,
                    modalSecondaryAction: nextSecondaryAction,
                    isSidebarOpen: false,
                    isModalOpen: false,
                    isContextMenuOpen: false,
                    contextMenuPosition: null,
                    contextMenuPrinterId: null,
                    modalStatus: { type: 'info', text: 'Fill in the information' },
                    modalError: '',
                    modalPreview: null,
                    isPreviewVisible: false,
                    modalSubmitLabel: 'Verify',
                    modalAddLabel: 'Add Printer',
                    modalSubmitDisabled: false,
                    modalAddDisabled: false,
                    modalSubmitLoading: false,
                    modalAddLoading: false,
                    isVerified: false,
                    verificationPayloadHash: null,
                    isEditing: false,
                    editingPrinterId: null,
                    editingPrinterAccessCode: '',
                    initialPayload: null,
                    canApplyWithoutVerify: false,
                });
                return;
            }
        }

        initialize() {
            this.handleViewportChange();
            this.loadPrinters();
            this.startAutoRefresh();
            this.setupEventPanel();
            this.bindListEvents();
            this.subscribeToStore();
        }

        registerModalManager() {
            if (!this.modalEl || !this.modalManager?.register) {
                return;
            }
            if (this.modalManager.get?.('printer')?.element === this.modalEl) {
                return;
            }
            this.modalManager.register('printer', {
                element: this.modalEl,
                openClass: 'is-open',
                canClose: () => !this.isAdding,
                onClose: () => this.closeAddPrinterModal(),
            });
        }

        _initializeActions() {
            this.uiActions = {
                toggleSidebar: () => {
                    if (
                        this.sidebarEl?.classList?.contains('is-open') ||
                        !this.layoutEl?.classList?.contains('sidebar-collapsed')
                    ) {
                        this.collapseSidebar({ persist: true });
                    } else {
                        this.openSidebar();
                    }
                },
                openSidebar: () => this.openSidebar(),
                closeSidebar: (options = {}) => this.collapseSidebar(options),
                openAddModal: () => this.openAddPrinterModal(),
                closeModal: (options = {}) => this.closeAddPrinterModal(options),
                handleVerifySubmit: (event) => this.handleVerifySubmit(event),
                handleAddPrinterConfirm: () => this.handleAddPrinterConfirm(),
                handleModalHelp: () => {
                    if (this.modalSecondaryAction === 'help') {
                        showToast('Help for onboarding is not available yet.', 'info');
                        return;
                    }
                    this.closeAddPrinterModal();
                },
                updateVerifyState: () => this.updateVerifyState(),
                updateExternalCameraFields: () => this.updateExternalCameraFields(),
                handleViewportChange: () => this.handleViewportChange(),
            };
        }

        setupEventPanel() {
            if (!this.eventPanelEl) {
                return;
            }
            this.eventPanel = new PrinterEventPanel({
                panelEl: this.eventPanelEl,
                backdropEl: this.eventPanelBackdropEl,
                toggleBtn: this.eventToggleEl,
                clearBtn: this.eventClearBtn,
                closeBtn: this.eventCloseBtn,
                listEl: this.eventListEl,
                actions: appContext.actions?.eventPanel,
                store: masterStore,
                selectors: printerSelectors,
                apiProvider: printerApi,
                showToast,
                resolvePrinterName: (printerId) => this.resolvePrinterName(printerId),
                getStateLabel,
                onUnreadChange: this.handleEventUnreadChange.bind(this),
            });
            this.eventPanel.start();
        }

        buildRenderKey(snapshot) {
            const uiState = snapshot?.ui?.printerSelector || {};
            const printers = Array.isArray(uiState.printers) ? uiState.printers : [];
            const printerKey = printers
                .map((printer) =>
                    [
                        printer.id,
                        printer.is_active ? '1' : '0',
                        printer.online ? '1' : '0',
                        printer.gcode_state || '',
                        printer.model || '',
                        printer.serial || '',
                        printer.printer_ip || '',
                    ].join(':'),
                )
                .join('|');
            const unreadKey = Object.keys(uiState.printerUnreadMap || {})
                .sort()
                .join(',');
            return [
                printerKey,
                uiState.selectedId || '',
                uiState.pendingId || '',
                uiState.openStatusDetailId || '',
                uiState.isSwitching ? '1' : '0',
                uiState.isRefreshing ? '1' : '0',
                uiState.isAdding ? '1' : '0',
                uiState.isSetupMode ? '1' : '0',
                unreadKey,
            ].join('#');
        }

        subscribeToStore() {
            if (this._unsubscribe || typeof masterStore?.subscribe !== 'function') {
                return;
            }
            this._unsubscribe = masterStore.subscribe((snapshot) => {
                const modalGate = snapshot?.ui?.modalGate?.active;
                if (modalGate && modalGate !== 'printer') {
                    return;
                }
                this.renderModalState(snapshot);
                this.renderLayoutState(snapshot);
                this.renderContextMenu(snapshot);
                this.renderServerOfflineState(snapshot);
                if (this.modalEl?.classList?.contains('is-open')) {
                    return;
                }
                const key = this.buildRenderKey(snapshot);
                if (key !== this._lastRenderKey) {
                    this._lastRenderKey = key;
                    this.renderList();
                    this.updateBanner();
                    this.updateDefaultOptionVisibility();
                }
            });
        }

        printerHasUnreadEvents(printerId) {
            return Boolean(this.printerUnreadMap?.[printerId]);
        }

        handleEventUnreadChange(payload) {
            this.printerUnreadMap = payload?.unreadByPrinter || {};
            this.updateEventBadge();
            this.renderList();
        }

        openEventsForPrinter(printerId) {
            if (!this.eventPanel) {
                return;
            }
            this.eventPanel.openPanel();
            this.eventPanel.markAllRead(printerId);
        }

        isMobile() {
            return this.breakpoint.matches;
        }

        handleViewportChange() {
            if (this.isMobile()) {
                this.collapseSidebar({ persist: false });
            } else if (!this.userCollapsed) {
                this.openSidebar();
            }
        }

        renderLayoutState(snapshot = this._getSnapshot()) {
            const uiState = snapshot?.ui?.printerSelector || {};
            const isMobile = this.isMobile();
            const isSidebarOpen = isMobile ? Boolean(uiState.isSidebarOpen) : !uiState.userCollapsed;
            const layoutKey = [
                isMobile ? 'mobile' : 'desktop',
                isSidebarOpen ? 'open' : 'closed',
                uiState.userCollapsed ? 'collapsed' : 'expanded',
            ].join(':');
            if (layoutKey === this._lastLayoutKey) {
                return;
            }
            this._lastLayoutKey = layoutKey;
            if (this.layoutEl) {
                this.layoutEl.classList.toggle('sidebar-collapsed', !isSidebarOpen);
            }
            if (this.sidebarEl) {
                this.sidebarEl.classList.toggle('is-open', isSidebarOpen);
            }
            if (this.backdropEl) {
                const shouldShowBackdrop = isMobile && isSidebarOpen;
                this.backdropEl.classList.toggle('is-visible', shouldShowBackdrop);
            }
        }

        renderServerOfflineState(snapshot = this._getSnapshot()) {
            const isOffline = Boolean(snapshot?.serverOffline);
            if (this.serverOffline === isOffline) {
                return;
            }
            this.serverOffline = isOffline;
            if (this.serverOfflineBanner) {
                this.serverOfflineBanner.classList.toggle('is-visible', isOffline);
                this.serverOfflineBanner.hidden = !isOffline;
            }
        }


        renderModalState(snapshot = this._getSnapshot()) {
            if (!this.modalEl) {
                return;
            }
            const uiState = snapshot?.ui?.printerSelector || {};
            const isOpen = Boolean(uiState.isModalOpen);
            if (this.modalManager?.isOpen) {
                const managerOpen = this.modalManager.isOpen('printer');
                if (isOpen && !managerOpen) {
                    this.modalManager.open('printer');
                } else if (!isOpen && managerOpen) {
                    this.modalManager.close('printer', { force: true });
                }
            }
            const openKey = `${isOpen ? 'open' : 'closed'}:${uiState.modalMode || this.modalMode || 'add'}`;
            if (openKey !== this._lastModalOpenKey) {
                this._lastModalOpenKey = openKey;
            }
            if (!isOpen) {
                return;
            }
            this._renderModalContext(uiState.modalMode || this.modalMode || 'add');
            const preview = uiState.modalPreview || {};
            const modules = Array.isArray(preview.modules) ? preview.modules : [];
            const moduleKey = modules
                .map((module) => `${module.product_name || module.name || ''}:${module.sw_ver || ''}:${module.visible ? '1' : '0'}`)
                .join('|');
            const contentKey = [
                uiState.modalMode || this.modalMode || 'add',
                uiState.modalStatus?.type || 'info',
                uiState.modalStatus?.text || '',
                uiState.modalError || '',
                uiState.isPreviewVisible ? 'preview' : 'nopreview',
                preview.model || '',
                preview.firmware || '',
                moduleKey,
                preview.emptyMessage || '',
                uiState.modalSubmitLabel || '',
                uiState.modalAddLabel || '',
                uiState.modalSubmitDisabled ? '1' : '0',
                uiState.modalAddDisabled ? '1' : '0',
                uiState.modalSubmitLoading ? '1' : '0',
                uiState.modalAddLoading ? '1' : '0',
            ].join('#');
            if (contentKey !== this._lastModalContentKey) {
                this._lastModalContentKey = contentKey;
                this._renderModalContent(snapshot);
            }
        }

        _renderModalContent(snapshot = this._getSnapshot()) {
            const uiState = snapshot?.ui?.printerSelector || {};
            const modalStatus = uiState.modalStatus || { type: 'info', text: '' };
            if (this.modalStatusChip) {
                this.modalStatusChip.textContent = modalStatus.text || '';
                this.modalStatusChip.classList.remove('is-success', 'is-error', 'is-info');
                this.modalStatusChip.classList.add(`is-${modalStatus.type || 'info'}`);
            }

            if (this.modalErrorEl) {
                if (uiState.modalError) {
                    this.modalErrorEl.textContent = uiState.modalError;
                    this.modalErrorEl.classList.add('is-visible');
                } else {
                    this.modalErrorEl.textContent = '';
                    this.modalErrorEl.classList.remove('is-visible');
                }
            }

            if (this.previewPanel) {
                this.previewPanel.classList.toggle('is-hidden', !uiState.isPreviewVisible);
            }

            const preview = uiState.modalPreview || {};
            if (this.previewModelEl) {
                this.previewModelEl.textContent = preview.model || '-';
            }
            if (this.previewFirmwareEl) {
                this.previewFirmwareEl.textContent = `Firmware: ${preview.firmware || '-'}`;
            }
            if (this.previewModulesList) {
                if (Array.isArray(preview.modules) && preview.modules.length > 0) {
                    this.previewModulesList.innerHTML = preview.modules
                        .map((module) => `
                            <div class="preview-module">
                                <div>
                                    <strong>${module.product_name || module.name}</strong>
                                    <p class="preview-meta">Surum: ${module.sw_ver || '-'}</p>
                                </div>
                                <span>${module.visible ? 'Active' : ''}</span>
                            </div>
                        `)
                        .join('');
                } else {
                    const message =
                        preview.emptyMessage ||
                        'Module information will be displayed here once verification is complete.';
                    this.previewModulesList.innerHTML = `<p class="preview-placeholder">${message}</p>`;
                }
            }

            if (this.modalSubmitBtn) {
                const labelEl = this.modalSubmitBtn.querySelector('.btn-label');
                if (labelEl) {
                    labelEl.textContent = uiState.modalSubmitLabel || 'Verify';
                }
                this.modalSubmitBtn.disabled = Boolean(uiState.modalSubmitDisabled);
                this.modalSubmitBtn.classList.toggle('is-loading', Boolean(uiState.modalSubmitLoading));
            }
            if (this.modalAddBtn) {
                const labelEl = this.modalAddBtn.querySelector('.btn-label');
                if (labelEl) {
                    labelEl.textContent = uiState.modalAddLabel || 'Add Printer';
                }
                this.modalAddBtn.disabled = Boolean(uiState.modalAddDisabled);
                this.modalAddBtn.classList.toggle('is-loading', Boolean(uiState.modalAddLoading));
            }
        }

        renderContextMenu(snapshot = this._getSnapshot()) {
            if (!this.contextMenuEl) {
                return;
            }
            const uiState = snapshot?.ui?.printerSelector || {};
            const isOpen = Boolean(uiState.isContextMenuOpen);
            const position = uiState.contextMenuPosition || { x: -9999, y: -9999 };
            const printerId = uiState.contextMenuPrinterId || null;
            const menuKey = [
                isOpen ? 'open' : 'closed',
                printerId || '',
                position?.x ?? -1,
                position?.y ?? -1,
            ].join(':');
            if (menuKey === this._lastContextMenuKey) {
                return;
            }
            this._lastContextMenuKey = menuKey;
            if (!isOpen || !printerId) {
                this.contextMenuEl.classList.remove('is-visible');
                const activeElement = document.activeElement;
                if (activeElement && this.contextMenuEl.contains(activeElement) && typeof activeElement.blur === 'function') {
                    activeElement.blur();
                }
                this.contextMenuEl.style.left = '-9999px';
                this.contextMenuEl.style.top = '-9999px';
                setInertState(this.contextMenuEl, false);
                this.contextMenuEl.removeAttribute('data-printer-id');
                return;
            }
            const printer = this.printers.find((entry) => entry.id === printerId);
            if (!printer) {
                return;
            }
            this.contextMenuEl.dataset.printerId = printerId;
            this.configureContextMenuButtons(printer);
            this.contextMenuEl.classList.add('is-visible');
            setInertState(this.contextMenuEl, true);
            this.contextMenuEl.style.left = `${Math.max(8, position.x)}px`;
            this.contextMenuEl.style.top = `${Math.max(8, position.y)}px`;
        }

        ensureApiReady() {
            const hasApi = Boolean(appContext.services?.api);
            if (typeof printerApi.fetchPrinters === 'function' && hasApi) {
                return true;
            }
            console.error('Printer selector started before appContext.api was ready');
            if (!this.apiRetryScheduled) {
                this.apiRetryScheduled = true;
                scheduleApiRetry(() => {
                    this.apiRetryScheduled = false;
                    this.loadPrinters();
                });
            }
            return false;
        }

        async loadPrinters() {
            if (!this.ensureApiReady()) {
                return;
            }
            this.renderPlaceholder('Loading printer list...');
            try {
                const printers = await printerApi.fetchPrinters();
                this.printers = Array.isArray(printers) ? printers : [];
                printerActions?.setServerOffline?.(false);

                if (!this.printers.length) {
                    this.renderPlaceholder('No printers have been added yet.');
                    this.selectedId = null;
                    this.syncMasterSelection();
                    this.updateBanner();
                    this.emitChange();
                    return;
                }

                const serverActive = this.printers.find((printer) => printer.is_active);
                if (!this.selectedId || (serverActive && serverActive.id !== this.selectedId)) {
                    this.selectedId = (serverActive || this.printers[0])?.id ?? null;
                    this.persistSelection();
                    this.syncMasterSelection();
                }

                this.renderList();
                this.updateDefaultOptionVisibility();
                this.updateBanner();
                this.emitChange();
                this.syncMasterSelection();
            } catch (error) {
                console.error('Failed to load printers', error);
                printerActions?.setServerOffline?.(true);
                if (this.printers.length) {
                    this.printers = this.printers.map((printer) => ({ ...printer, online: false }));
                    this.renderList();
                    this.updateBanner();
                } else {
                    this.renderPlaceholder('Printer list could not be loaded.');
                }
                if (!wasOffline) {
                    showToast('Server offline. Reconnecting...', 'warning');
                }
            }
        }

        startAutoRefresh() {
            if (this.autoRefreshId || document.hidden) {
                return;
            }
            this.autoRefreshId = setInterval(() => this.refreshPrinters(), this.refreshIntervalMs);
        }

        stopAutoRefresh() {
            if (this.autoRefreshId) {
                clearInterval(this.autoRefreshId);
                this.autoRefreshId = null;
            }
        }

        async refreshPrinters() {
            if (!this.ensureApiReady()) {
                return;
            }
            if (this.isSwitching || this.isRefreshing) {
                return;
            }
            this.isRefreshing = true;
            try {
                const printers = await printerApi.fetchPrinters();
                this.printers = Array.isArray(printers) ? printers : [];
                printerActions?.setServerOffline?.(false);

                if (!this.printers.length) {
                    this.renderPlaceholder('No printers have been added yet.');
                    if (this.selectedId !== null) {
                        this.selectedId = null;
                        this.persistSelection();
                        this.syncMasterSelection();
                        this.emitChange();
                    }
                    this.updateBanner();
                    return;
                }

                const serverActive = this.printers.find((printer) => printer.is_active);
                const desiredId = (serverActive || this.printers.find((printer) => printer.id === this.selectedId) || this.printers[0])?.id ?? null;
                if (desiredId !== this.selectedId) {
                    this.selectedId = desiredId;
                    this.persistSelection();
                    this.syncMasterSelection();
                    this.emitChange();
                }

                this.renderList();
                this.updateBanner();
                this.syncMasterSelection();
            } catch (error) {
                console.error('Failed to refresh printer list', error);
                printerActions?.setServerOffline?.(true);
                if (this.printers.length) {
                    this.printers = this.printers.map((printer) => ({ ...printer, online: false }));
                    this.renderList();
                    this.updateBanner();
                }
            } finally {
            this.isRefreshing = false;
        }
        }

        renderPlaceholder(message) {
            if (!this.listEl) {
                return;
            }
            this.hideContextMenu();
            this.listEl.innerHTML = '';
            const empty = document.createElement('div');
            empty.className = 'printer-list-empty';
            empty.textContent = message;
            this.listEl.appendChild(empty);
        }

        renderList() {
            if (!this.listEl) {
                return;
            }
            this.hideContextMenu();
            this.listEl.innerHTML = '';
            this.updateEventBadge();

            if (!this.printers.length) {
                this.renderPlaceholder('No printers configured yet.');
                return;
            }

            this.printers.forEach((printer) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'printer-item';
                item.dataset.printerId = printer.id;

                const isActive = printer.id === this.selectedId;
                if (isActive) {
                    item.classList.add('is-active');
                }

                const isOffline = !printer.online && !printer.is_active;
                if (isOffline) {
                    item.classList.add('is-offline');
                    item.setAttribute('aria-disabled', 'true');
                    item.dataset.offline = '1';
                } else {
                    item.removeAttribute('aria-disabled');
                    item.dataset.offline = '0';
                }

                item.disabled = this.isSwitching;
                if (isOffline) {
                    item.title = 'Cannot activate because the printer is offline';
                } else if (this.isSwitching) {
                    item.title = 'Islem devam ediyor';
                } else {
                    item.title = '';
                }

                const heading = document.createElement('div');
                heading.className = 'printer-item-heading';

                const titleWrap = document.createElement('div');
                titleWrap.className = 'printer-item-title';

                const name = document.createElement('span');
                name.className = 'printer-name';
                name.textContent = printer.id;
                titleWrap.appendChild(name);

                const badgeText = this.getBadgeLabel(printer);
                if (badgeText) {
                    const badge = document.createElement('span');
                    badge.className = 'printer-badge';
                    badge.textContent = badgeText;
                    titleWrap.appendChild(badge);
                }
                if (printer.is_default) {
                    const defaultBadge = document.createElement('span');
                    defaultBadge.className = 'printer-badge printer-badge--default';
                    defaultBadge.textContent = 'Default';
                    titleWrap.appendChild(defaultBadge);
                }

                heading.appendChild(titleWrap);
                heading.appendChild(this.createStatusIndicator(printer));

                const ipMeta = document.createElement('p');
                ipMeta.className = 'printer-meta';
                ipMeta.textContent = `IP: ${printer.printer_ip}`;

                const serialMeta = document.createElement('p');
                serialMeta.className = 'printer-meta';
                serialMeta.textContent = `Serial: ${printer.serial}`;

                const modelMeta = document.createElement('p');
                modelMeta.className = 'printer-meta';
                modelMeta.textContent = `Model: ${printer.model ?? '-'}`;

                item.appendChild(heading);
                item.appendChild(ipMeta);
                item.appendChild(serialMeta);
                item.appendChild(modelMeta);
                const statusSection = this.buildStatusSection(printer);
                if (statusSection) {
                    item.appendChild(statusSection.row);
                    if (statusSection.details) {
                        item.appendChild(statusSection.details);
                    }
                }

                this.listEl.appendChild(item);
            });
        }

        bindListEvents() {
            if (!this.listEl || this.listEl.dataset.eventsBound === '1') {
                return;
            }
            this.listEl.dataset.eventsBound = '1';

            this.listEl.addEventListener('click', (event) => {
                const actionBtn = event.target.closest('[data-action="open-events"]');
                if (actionBtn) {
                    event.stopPropagation();
                    const printerId = actionBtn.dataset.printerId;
                    if (printerId) {
                        this.openEventsForPrinter(printerId);
                    }
                    return;
                }
                const item = event.target.closest('.printer-item');
                if (!item || !this.listEl.contains(item)) {
                    return;
                }
                if (this.longPressTriggered) {
                    this.longPressTriggered = false;
                    return;
                }
                if (item.dataset.offline === '1') {
                    showToast('Cannot activate because the printer is offline', 'warning');
                    return;
                }
                const printerId = item.dataset.printerId;
                if (printerId) {
                    this.selectPrinter(printerId);
                }
            });

            this.listEl.addEventListener('contextmenu', (event) => {
                const item = event.target.closest('.printer-item');
                if (!item || !this.listEl.contains(item)) {
                    return;
                }
                const printerId = item.dataset.printerId;
                const printer = this.printers.find((entry) => entry.id === printerId);
                if (printer) {
                    this.openContextMenu(event, printer);
                }
            });

            this.listEl.addEventListener(
                'touchstart',
                (event) => {
                    const item = event.target.closest('.printer-item');
                    if (!item || !this.listEl.contains(item)) {
                        return;
                    }
                    const printerId = item.dataset.printerId;
                    const printer = this.printers.find((entry) => entry.id === printerId);
                    if (printer) {
                        this.handleLongPressStart(event, printer);
                    }
                },
                { passive: true },
            );
            this.listEl.addEventListener('touchend', () => this.handleLongPressEnd(), { passive: true });
            this.listEl.addEventListener('touchcancel', () => this.handleLongPressEnd(), { passive: true });
            this.listEl.addEventListener('touchmove', (event) => this.handleLongPressMove(event), { passive: true });
        }

        buildStatusSection(printer) {
            const summary = printer.status_summary || null;
            const row = document.createElement('div');
            row.className = 'printer-status-row';

            const labelWrap = document.createElement('div');
            labelWrap.className = 'printer-status-main';
            const label = document.createElement('span');
            label.textContent = 'Status';
            const statusValue = document.createElement('strong');
            statusValue.textContent = getStateLabel(summary?.gcode_state);
            labelWrap.appendChild(label);
            labelWrap.appendChild(statusValue);
            if (summary?.hms_error) {
                const warning = document.createElement('span');
                warning.className = 'printer-status-warning';
                warning.title = summary.hms_error;
                warning.setAttribute('aria-label', summary.hms_error);
                warning.textContent = '!';
                labelWrap.appendChild(warning);
            }
            if (this.printerHasUnreadEvents(printer.id)) {
                const mail = document.createElement('button');
                mail.type = 'button';
                mail.className = 'printer-status-mail';
                mail.title = 'Unread events';
                mail.setAttribute('aria-label', 'Unread events');
                mail.dataset.action = 'open-events';
                mail.dataset.printerId = printer.id;
                mail.innerHTML = '&#128386;';
                labelWrap.appendChild(mail);
            }
            row.appendChild(labelWrap);

            if (!summary || printer.is_active) {
                return { row };
            }

            const details = document.createElement('div');
            details.className = 'printer-status-details';
            const dl = this.buildStatusDetails(summary);
            details.appendChild(dl);

            const suppressEvent = (event) => {
                event.stopPropagation();
            };
            ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach((type) => {
                const options = type.startsWith('touch') ? { passive: true } : undefined;
                details.addEventListener(type, suppressEvent, options);
            });

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'printer-status-expand';
            toggleBtn.dataset.printerId = printer.id;
            toggleBtn.dataset.expanded = this.openStatusDetailId === printer.id ? 'true' : 'false';
            toggleBtn.textContent = this.openStatusDetailId === printer.id ? 'Hide' : 'Details';
            row.appendChild(toggleBtn);

            if (this.openStatusDetailId === printer.id) {
                details.classList.remove('is-hidden');
                this.openStatusDetailEl = details;
            } else {
                details.classList.add('is-hidden');
            }

            toggleBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.toggleStatusDetails(printer.id, details);
            });

            return { row, details };
        }

        buildStatusDetails(summary) {
            const dl = document.createElement('dl');
            const entries = [
                { label: 'Layer', value: summary.layer || '-' },
                { label: 'Progress', value: Number.isFinite(summary.percent) ? `${summary.percent}%` : '-' },
                {
                    label: 'Remaining',
                    value:
                        summary.remaining_time && summary.remaining_time > 0
                            ? `${summary.remaining_time} min`
                            : '-',
                },
                { label: 'Finish Time', value: summary.finish_time || '-' },
                { label: 'Speed Mode', value: formatSpeedMode(summary.speed_level) },
                { label: 'File', value: summary.file || '-' },
            ];
            entries.forEach((entry) => {
                const dt = document.createElement('dt');
                dt.textContent = entry.label;
                const dd = document.createElement('dd');
                dd.textContent = entry.value;
                dl.appendChild(dt);
                dl.appendChild(dd);
            });
            return dl;
        }

        toggleStatusDetails(printerId, element) {
            if (!element) {
                return;
            }
            const isSame = this.openStatusDetailId === printerId;
            if (this.openStatusDetailEl && this.openStatusDetailEl !== element) {
                this.openStatusDetailEl.classList.add('is-hidden');
            }
            if (isSame) {
                this.openStatusDetailId = null;
                this.openStatusDetailEl = null;
                element.classList.add('is-hidden');
                this.refreshStatusToggleLabels();
                return;
            }
            element.classList.remove('is-hidden');
            this.openStatusDetailId = printerId;
            this.openStatusDetailEl = element;
            this.refreshStatusToggleLabels();
        }

        closeStatusDetails() {
            if (this.openStatusDetailEl) {
                this.openStatusDetailEl.classList.add('is-hidden');
            }
            this.openStatusDetailEl = null;
            this.openStatusDetailId = null;
            this.refreshStatusToggleLabels();
        }

        refreshStatusToggleLabels() {
            if (!this.listEl) {
                return;
            }
            this.listEl.querySelectorAll('.printer-status-expand').forEach((button) => {
                const targetId = button.dataset.printerId;
                const isExpanded = targetId && targetId === this.openStatusDetailId;
                button.dataset.expanded = isExpanded ? 'true' : 'false';
                button.textContent = isExpanded ? 'Hide' : 'Details';
            });
        }

        handleLongPressStart(event, printer) {
            if (!printer) {
                return;
            }
            if (event.target && event.target.closest('.printer-status-expand')) {
                return;
            }
            // Use contextmenu event for desktop
            if (event.type === 'contextmenu') {
                event.preventDefault();
                this.openContextMenu(event, printer);
                return;
            }
            
            // Handle long press for touch
            if (event.touches && event.touches.length > 0) {
                this.cancelLongPress(); // Clear the previous timer
                const touch = event.touches[0];
                this.longPressTouchId = touch.identifier;
                this.longPressPosition = { clientX: touch.clientX, clientY: touch.clientY };
                this.longPressStartPosition = { clientX: touch.clientX, clientY: touch.clientY };
                this.longPressEvent = event;
                this.longPressTimer = window.setTimeout(() => {
                    this.longPressTimer = null;
                    this.longPressTriggered = true;
                    
                    // Create synthetic event
                    const syntheticEvent = {
                        preventDefault: () => {},
                        clientX: this.longPressPosition.clientX,
                        clientY: this.longPressPosition.clientY,
                        target: event.target
                    };
                    
                    this.openContextMenu(syntheticEvent, printer);
                }, 420);
            }
        }

        cancelLongPress() {
            if (this.longPressTimer) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
            this.longPressEvent = null;
            this.longPressTouchId = null;
            this.longPressStartPosition = null;
            this.longPressTriggered = false;
        }

        handleLongPressMove(event) {
            if (!this.longPressTimer || !this.longPressStartPosition) {
                return;
            }
            const touches = event.touches || [];
            if (!touches.length) {
                return;
            }
            const touch = this.longPressTouchId === null
                ? touches[0]
                : Array.from(touches).find((entry) => entry.identifier === this.longPressTouchId);
            if (!touch) {
                return;
            }
            const dx = touch.clientX - this.longPressStartPosition.clientX;
            const dy = touch.clientY - this.longPressStartPosition.clientY;
            if (Math.hypot(dx, dy) > 8) {
                this.cancelLongPress();
            }
        }

        handleLongPressEnd() {
            if (this.longPressTriggered) {
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
                this.longPressEvent = null;
                this.longPressTouchId = null;
                this.longPressStartPosition = null;
                return;
            }
            this.cancelLongPress();
        }

        createStatusIndicator(printer) {
            const wrapper = document.createElement('div');
            const isOnline = Boolean(printer.online);
            wrapper.className = `printer-status ${isOnline ? 'is-online' : 'is-offline'}`;

            const dot = document.createElement('span');
            dot.className = 'printer-status-dot';
            wrapper.appendChild(dot);

            const label = document.createElement('span');
            label.className = 'printer-status-label';
            label.textContent = isOnline ? 'Online' : 'Offline';
            wrapper.appendChild(label);

            return wrapper;
        }

        getBadgeLabel(printer) {
            if (this.pendingId === printer.id) {
                return 'Switching';
            }
            if (printer.is_active) {
                return 'Active';
            }
            return null;
        }

        async selectPrinter(printerId) {
            this.hideContextMenu();
            if (!printerId || printerId === this.selectedId || this.isSwitching) {
                this.closeSidebarAfterSelection();
                return;
            }

            const target = this.printers.find((printer) => printer.id === printerId);
            if (target && !target.online && !target.is_active) {
                showToast('Cannot activate because the printer is offline', 'warning');
                return;
            }

            this.pendingId = printerId;
            this.renderList();

            try {
                await this.requestPrinterSwitch(printerId);
                await this.loadPrinters();
                this.closeSidebarAfterSelection();
                showToast(`Printer ${printerId} is now active`, 'success');
            } catch (error) {
                console.error('Failed to switch printer', error);
                showToast(error.message || 'Printer could not be switched', 'error');
            } finally {
        this.pendingId = null;
        this.isSwitching = false;
        this.renderList();
    }
        }

        async requestPrinterSwitch(printerId) {
            this.isSwitching = true;
            await printerApi.request('/api/status/select-printer', {
                skipPrinterId: true,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ printer_id: printerId }),
            });
        this.selectedId = printerId;
        this.persistSelection();
        this.syncMasterSelection();
        }

        async deletePrinter(printerId) {
            if (!printerId || this.isSwitching) {
                return;
            }
            const printer = this.printers.find((item) => item.id === printerId);
            const name = printer?.id ?? printerId;
            const confirmMessage = `Remove printer ${name}?`;
            if (!window.confirm(confirmMessage)) {
                return;
            }
            this.isSwitching = true;
            this.renderList();
            try {
                await printerApi.request(`/api/status/printers/${encodeURIComponent(printerId)}`, {
                    skipPrinterId: true,
                    method: 'DELETE',
                });
                showToast(`${name} silindi`, 'success');
                await this.loadPrinters();
            } catch (error) {
                console.error('Failed to delete printer', error);
                showToast(error?.message || 'Printer could not be removed', 'error');
            } finally {
                this.isSwitching = false;
                this.renderList();
            }
        }

        readStoredSelection() {
            try {
                return window.localStorage?.getItem(STORAGE_KEY);
            } catch (error) {
                console.warn('Unable to read stored selection', error);
                return null;
            }
        }

        persistSelection() {
            try {
                if (this.selectedId) {
                    window.localStorage?.setItem(STORAGE_KEY, this.selectedId);
                } else {
                    window.localStorage?.removeItem(STORAGE_KEY);
                }
            } catch (error) {
                console.warn('Unable to persist selection', error);
            }
        }

        syncMasterSelection() {
            const printer = this.getSelectedPrinter();
            if (printerActions?.setSelectedPrinter) {
                printerActions.setSelectedPrinter(this.selectedId, printer || null);
                if (typeof filamentActions?.refreshCatalog === 'function') {
                    filamentActions.refreshCatalog().catch((error) => {
                        console.warn('Failed to refresh filament catalog', error);
                    });
                }
                return;
            }
            if (typeof filamentActions?.refreshCatalog === 'function') {
                filamentActions.refreshCatalog().catch((error) => {
                    console.warn('Failed to refresh filament catalog', error);
                });
            }
            this.emitSelectionChanged();
        }

        emitSelectionChanged() {
            if (this.selectedId === this.lastEmittedSelectionId) {
                return;
            }
            this.lastEmittedSelectionId = this.selectedId;

            if (typeof document === 'undefined') {
                return;
            }

            try {
                const event =
                    typeof CustomEvent === 'function'
                        ? new CustomEvent('printer-selection-changed', {
                              detail: { printerId: this.selectedId },
                          })
                        : new Event('printer-selection-changed');
                document.dispatchEvent(event);
            } catch (error) {
                console.warn('Failed to emit printer-selection-changed', error);
            }
        }

        emitPrinterConfigUpdated() {
            if (typeof document === 'undefined') {
                return;
            }
            try {
                const event =
                    typeof CustomEvent === 'function'
                        ? new CustomEvent('printer-config-updated', {
                              detail: { printerId: this.selectedId },
                          })
                        : new Event('printer-config-updated');
                document.dispatchEvent(event);
            } catch (error) {
                console.warn('Failed to emit printer-config-updated', error);
            }
        }

        updateBanner() {
            const printer = this.getSelectedPrinter();
            if (!printer) {
                if (this.currentNameEl) {
                    this.currentNameEl.textContent = '-';
                }
                if (this.currentMetaEl) {
                    this.currentMetaEl.textContent = 'IP: -, Serial: -';
                }
                if (this.currentModelEl) {
                    this.currentModelEl.textContent = 'Model: -';
                }
                if (this.identityNameEl) {
                    this.identityNameEl.textContent = '-';
                }
                if (this.identityIpEl) {
                    this.identityIpEl.textContent = 'IP: -';
                }
                if (this.identitySerialEl) {
                    this.identitySerialEl.textContent = 'Serial: -';
                }
                if (this.identityModelEl) {
                    this.identityModelEl.textContent = 'Model: -';
                }
                if (this.countEl) {
                    this.countEl.textContent = '0 printers';
                }
                return;
            }

            if (this.currentNameEl) {
                this.currentNameEl.textContent = printer.id;
            }
            if (this.currentMetaEl) {
                this.currentMetaEl.textContent = `IP: ${printer.printer_ip} | Serial: ${printer.serial}`;
            }
            if (this.currentModelEl) {
                this.currentModelEl.textContent = `Model: ${printer.model ?? '-'}`;
            }
            if (this.identityNameEl) {
                this.identityNameEl.textContent = printer.id ?? '-';
            }
            if (this.identityIpEl) {
                this.identityIpEl.textContent = `IP: ${printer.printer_ip ?? '-'}`;
            }
            if (this.identitySerialEl) {
                this.identitySerialEl.textContent = `Serial: ${printer.serial ?? '-'}`;
            }
            if (this.identityModelEl) {
                this.identityModelEl.textContent = `Model: ${printer.model ?? '-'}`;
            }
            if (this.countEl) {
                const total = `${this.printers.length} printers`;
                this.countEl.textContent = total;
            }
        }

        openSidebar() {
            this.userCollapsed = false;
            this.isSidebarOpen = true;
            this.renderLayoutState();
        }

        collapseSidebar({ persist = false } = {}) {
            if (persist) {
                this.userCollapsed = true;
            }
            this.isSidebarOpen = false;
            this.renderLayoutState();
            this.closeStatusDetails();
        }

        closeSidebarAfterSelection() {
            if (this.isMobile()) {
                this.collapseSidebar({ persist: false });
            }
        }

        getSelectedPrinter() {
            return this.printers.find((printer) => printer.id === this.selectedId);
        }

        getSelectedPrinterId() {
            return this.selectedId;
        }

        resolvePrinterName(printerId) {
            const printer = this.printers.find((item) => item.id === printerId);
            return printer ? `${printer.id} (${printer.model ?? 'Unknown'})` : printerId;
        }

        onChange(callback) {
            if (typeof callback === 'function') {
                this.listeners.push(callback);
            }
        }

        emitChange() {
            const printer = this.getSelectedPrinter();
            this.listeners.forEach((callback) => {
                try {
                    callback(printer);
                } catch (error) {
                    console.error('Printer change listener failed', error);
                }
            });
        }


        handleDocumentClick(event) {
            if (!this.contextMenuEl || !this.contextMenuEl.classList.contains('is-visible')) {
                return;
            }
            if (this.contextMenuEl.contains(event.target)) {
                return;
            }
            if (event.target.closest('.printer-item')) {
                return;
            }
            this.hideContextMenu();
        }

        handleMainAreaClick(event) {
            if (!this.layoutEl || this.layoutEl.classList.contains('sidebar-collapsed')) {
                return;
            }
            if (event.target.closest('.printer-sidebar') || event.target.closest('#printer-menu-toggle')) {
                return;
            }
            this.collapseSidebar({ persist: true });
        }

        configureContextMenuButtons(printer) {
            if (!this.contextMenuEl) {
                return;
            }
            const activateBtn = this.contextMenuEl.querySelector('[data-action="activate"]');
            if (activateBtn) {
                const canActivate = !printer.is_active && (printer.online || printer.is_active);
                activateBtn.disabled = !canActivate;
                activateBtn.classList.toggle('is-disabled', activateBtn.disabled);
                const title = activateBtn.querySelector('.printer-context-menu__title');
                if (title) {
                    title.textContent = printer.is_active ? 'Already active' : 'Activate';
                }
                const desc = activateBtn.querySelector('.printer-context-menu__desc');
                if (desc) {
                    if (printer.is_active) {
                        desc.textContent = 'This printer is already active';
                    } else if (!printer.online) {
                        desc.textContent = 'Cannot activate because the printer is offline';
                    } else {
                        desc.textContent = 'Activate this printer';
                    }
                }
            }
            const defaultBtn = this.contextMenuEl.querySelector('[data-action="make-default"]');
            if (defaultBtn) {
                const isDefault = Boolean(printer?.is_default);
                defaultBtn.disabled = isDefault;
                defaultBtn.classList.toggle('is-disabled', defaultBtn.disabled);
                const desc = defaultBtn.querySelector('.printer-context-menu__desc');
                if (desc) {
                    desc.textContent = isDefault
                        ? 'This printer is already the default'
                        : 'Set this printer as the default';
                }
            }
            const deleteBtn = this.contextMenuEl.querySelector('[data-action="delete"]');
            if (deleteBtn) {
                const canDelete = this.printers.length > 1;
                deleteBtn.disabled = !canDelete;
                deleteBtn.classList.toggle('is-disabled', deleteBtn.disabled);
                const desc = deleteBtn.querySelector('.printer-context-menu__desc');
                if (desc) {
                    desc.textContent = canDelete ? 'Remove printer from list' : 'Cannot delete the last printer';
                }
            }
        }

        openContextMenu(event, printer) {
            if (!this.contextMenuEl) {
                return;
            }
            if (typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            
            this.contextMenuTarget = printer;
            const rect = this.contextMenuEl.getBoundingClientRect();
            const maxX = Math.max(8, window.innerWidth - rect.width - 8);
            const maxY = Math.max(8, window.innerHeight - rect.height - 8);
            const x = Math.min(event.clientX, maxX);
            const y = Math.min(event.clientY, maxY);
            this.contextMenuPrinterId = printer.id;
            this.contextMenuPosition = { x: Math.max(8, x), y: Math.max(8, y) };
            this.isContextMenuOpen = true;
            this.renderContextMenu();
        }

        hideContextMenu() {
            if (!this.contextMenuEl) {
                return;
            }
            this.isContextMenuOpen = false;
            this.contextMenuPrinterId = null;
            this.contextMenuPosition = null;
            this.renderContextMenu();
            this.contextMenuTarget = null;
            this.longPressTriggered = false;
        }

        handleContextMenuAction(event) {
            const button = event.target.closest('[data-action]');
            if (!button || button.disabled) {
                return;
            }
            const printerId = this.contextMenuPrinterId || this.contextMenuEl?.dataset?.printerId;
            this.hideContextMenu();
            if (!printerId) {
                return;
            }
            if (button.dataset.action === 'activate') {
                this.selectPrinter(printerId);
            } else if (button.dataset.action === 'delete') {
                this.deletePrinter(printerId);
            } else if (button.dataset.action === 'make-default') {
                this.makeDefaultPrinter(printerId);
            } else if (button.dataset.action === 'edit') {
                this.openEditPrinterModal(printerId);
            }
        }

        async makeDefaultPrinter(printerId) {
            if (!printerId) {
                return;
            }

            try {
                await parseApiResponse(
                    await printerApi.request(`/api/status/printers/${encodeURIComponent(printerId)}/default`, {
                        skipPrinterId: true,
                        method: 'POST',
                    })
                );
                await this.loadPrinters();
                showToast('Default printer updated', 'success');
            } catch (error) {
                console.error('Failed to set default printer', error);
                showToast(error?.message || 'Default printer could not be updated', 'error');
            }
        }

        _presentAddModal() {
            if (!this.modalEl) {
                return;
            }
            this.isModalOpen = true;
            this.renderModalState();
            globalProxy.appContext?.actions?.ui?.setModalGate?.('printer');
        }

        _applyModalContext(mode) {
            this.modalMode = mode;
            const context = MODAL_CONTEXTS[mode] || MODAL_CONTEXTS.add;
            this.modalSecondaryAction = context.secondaryAction || 'help';
            this._renderModalContext(mode);
        }

        _renderModalContext(mode) {
            const context = MODAL_CONTEXTS[mode] || MODAL_CONTEXTS.add;
            if (document.body) {
                document.body.dataset.modalMode = mode;
            }
            if (this.modalTitleEl) {
                this.modalTitleEl.textContent = context.title;
            }
            if (this.modalEyebrowEl) {
                this.modalEyebrowEl.textContent = context.eyebrow;
            }
            if (this.modalDescriptionEl) {
                this.modalDescriptionEl.textContent = context.description;
            }
            if (this.nameFieldEl) {
                context.showNameField
                    ? this.nameFieldEl.classList.remove('is-hidden')
                    : this.nameFieldEl.classList.add('is-hidden');
            }
            if (this.accessFieldEl) {
                context.showAccessField
                    ? this.accessFieldEl.classList.remove('is-hidden')
                    : this.accessFieldEl.classList.add('is-hidden');
            }
            if (this.modalHelpBtn && context.secondaryLabel) {
                this.modalHelpBtn.textContent = context.secondaryLabel;
            }
        }

        openModalForMode(mode) {
            if (!this.modalEl) {
                showToast('This feature is not available yet.', 'error');
                return;
            }

            this._applyModalContext(mode);
            this.resetAddPrinterModal();
            this._presentAddModal();
            this.updateVerifyState();
        }

        openAddPrinterModal() {
            this.openModalForMode('add');
        }

        openEditPrinterModal(printerId) {
            if (!this.modalEl) {
                showToast('This feature is not available yet.', 'error');
                return;
            }
            const printer = this.printers.find((item) => item.id === printerId);
            if (!printer) {
                showToast('Printer information not available', 'error');
                return;
            }
            this.resetAddPrinterModal();
            this.isEditing = true;
            this.editingPrinterId = printerId;
            this.setAddButtonLabel('Apply');
            this.populateFormFromPrinter(printer);
            this.captureInitialPayload(printer);
            this.updateDefaultOptionVisibility();
            this._applyModalContext('edit');
            this._presentAddModal();
            this.updateVerifyState();
        }

        closeAddPrinterModal({ force = false } = {}) {
            if (!this.modalEl) {
                return;
            }
            if (this.isAdding && !force) {
                return;
            }
            this.isModalOpen = false;
            this.renderModalState();
            this.resetAddPrinterModal();
            globalProxy.appContext?.actions?.ui?.clearModalGate?.('printer');
        }

        resetAddPrinterModal() {
            if (this.modalForm) {
                this.modalForm.reset();
            }
            this.setModalStatus('info', 'Fill in the information');
            this.showModalError('');
            this.modalPreview = null;
            this.setPreviewVisibility(false);
            this.modalSubmitLoading = false;
            this.modalSubmitDisabled = false;
            this.setSubmitLabel('Verify');
            this.hideAddArea();
            this.modalAddLoading = false;
            this.modalAddDisabled = false;
            this.isAdding = false;
            this.isVerified = false;
            this.verificationPayloadHash = null;
            this.isEditing = false;
            this.editingPrinterId = null;
            this.editingPrinterAccessCode = '';
            this.populateExternalCameraFields('');
            this.captureInitialPayload(null);
            this.printerIdInput?.removeAttribute('readonly');
            this.setAddButtonLabel('Add Printer');
            if (this.makeDefaultCheckbox) {
                this.makeDefaultCheckbox.checked = false;
            }
            this.updateDefaultOptionVisibility();
            this.updateVerifyState();
        }

        updateDefaultOptionVisibility() {
            if (!this.makeDefaultField || !this.makeDefaultCheckbox) {
                return;
            }
            const canSetDefault = !this.isEditing && this.printers.length > 0;
            this.makeDefaultField.classList.toggle('is-hidden', !canSetDefault);
            if (!canSetDefault) {
                this.makeDefaultCheckbox.checked = false;
            }
        }

        setModalStatus(status, text) {
            this.modalStatus = { type: status || 'info', text: text || '' };
        }

        setSubmitLabel(text) {
            this.modalSubmitLabel = text || 'Verify';
        }

        setAddButtonLabel(text) {
            this.modalAddLabel = text || 'Add Printer';
        }

        setPreviewVisibility(isVisible) {
            this.isPreviewVisible = Boolean(isVisible);
        }

        captureInitialPayload(printer = null) {
            this.initialPayload = {
                id: printer?.id || '',
                printer_ip: printer?.printer_ip || '',
                serial: printer?.serial || '',
                access_code: printer?.access_code || '',
                external_camera_url: printer?.external_camera_url || '',
            };
        }

        getFormChangeState(payload = null) {
            const currentPayload = payload || this._buildFormPayload();
            if (!currentPayload) {
                return null;
            }
            const baseline = this.initialPayload || {
                id: '',
                printer_ip: '',
                serial: '',
                access_code: '',
                external_camera_url: '',
            };
            const idChanged = currentPayload.id !== baseline.id;
            const connectionChanged =
                currentPayload.printer_ip !== baseline.printer_ip ||
                currentPayload.serial !== baseline.serial ||
                currentPayload.access_code !== baseline.access_code;
            const cameraChanged =
                (currentPayload.external_camera_url || '') !== (baseline.external_camera_url || '');
            const hasChanges = idChanged || connectionChanged || cameraChanged;
            const canApplyDirect =
                this.isEditing && !connectionChanged && (cameraChanged || idChanged);
            return {
                payload: currentPayload,
                idChanged,
                connectionChanged,
                cameraChanged,
                hasChanges,
                canApplyDirect,
            };
        }

        updateVerifyState() {
            const state = this.getFormChangeState();
            if (!state) {
                return;
            }
            const externalEnabled = Boolean(this.externalCameraToggle?.checked);
            const rawCameraUrl = (this.externalCameraUrlInput?.value || '').toString().trim();
            const rawCameraUsername = (this.externalCameraUsernameInput?.value || '').toString().trim();
            const rawCameraPassword = (this.externalCameraPasswordInput?.value || '').toString();
            if (externalEnabled && !rawCameraUrl) {
                this.modalSubmitDisabled = true;
                this.showModalError('External camera URL is required.');
                this.setSubmitLabel('Verify');
                return;
            }
            if (externalEnabled && rawCameraPassword && !rawCameraUsername) {
                this.modalSubmitDisabled = true;
                this.showModalError('External camera username is required.');
                this.setSubmitLabel('Verify');
                return;
            }
            const payloadHash = this._buildPayloadHash(state.payload);
            if (this.isVerified && payloadHash !== this.verificationPayloadHash) {
                this.isVerified = false;
                this.verificationPayloadHash = null;
                this.hideAddArea();
                this.setPreviewVisibility(false);
            }
            this.canApplyWithoutVerify = state.canApplyDirect;
            this.showModalError('');
            if (!state.hasChanges) {
                this.modalSubmitDisabled = true;
                this.setSubmitLabel('Verify');
                return;
            }
            if (state.canApplyDirect) {
                this.modalSubmitDisabled = false;
                this.setSubmitLabel('Apply');
                return;
            }
            this.modalSubmitDisabled = false;
            this.setSubmitLabel('Verify');
        }

        setButtonLoading(button, isLoading) {
            if (!button) {
                return;
            }
            const isSubmit = button === this.modalSubmitBtn;
            const isAdd = button === this.modalAddBtn;
            if (!isSubmit && !isAdd) {
                return;
            }
            if (isSubmit) {
                this.modalSubmitLoading = Boolean(isLoading);
                this.modalSubmitDisabled = Boolean(isLoading);
                return;
            }
            this.modalAddLoading = Boolean(isLoading);
            this.modalAddDisabled = Boolean(isLoading);
        }

        showAddArea() {
            if (this.modalAddArea) {
                this.modalAddArea.classList.remove('printer-modal-add-area--hidden');
            }
            if (this.modalAddBtn) {
                this.modalAddBtn.disabled = false;
            }
        }

        hideAddArea() {
            if (this.modalAddArea) {
                this.modalAddArea.classList.add('printer-modal-add-area--hidden');
            }
            if (this.modalAddBtn) {
                this.modalAddBtn.classList.remove('is-loading');
                this.modalAddBtn.disabled = true;
            }
        }

        _buildFormPayload() {
            if (!this.modalForm) {
                return null;
            }
            const formData = new FormData(this.modalForm);
            const rawAccessCode = (formData.get('access_code') || '').toString().trim();
            const accessCode =
                this.modalMode === 'edit'
                    ? rawAccessCode || this.editingPrinterAccessCode || ''
                    : rawAccessCode;
            const externalEnabled = Boolean(this.externalCameraToggle?.checked);
            const rawCameraUrl = (this.externalCameraUrlInput?.value || '').toString().trim();
            const rawCameraUsername = (this.externalCameraUsernameInput?.value || '').toString().trim();
            const rawCameraPassword = (this.externalCameraPasswordInput?.value || '').toString();
            let externalCameraUrl = null;
            if (externalEnabled && rawCameraUrl) {
                externalCameraUrl = this._buildExternalCameraUrl(
                    rawCameraUrl,
                    rawCameraUsername,
                    rawCameraPassword,
                );
            }
            return {
                id: (formData.get('printer_id') || '').toString().trim(),
                printer_ip: (formData.get('printer_ip') || '').toString().trim(),
                serial: (formData.get('serial') || '').toString().trim(),
                access_code: accessCode,
                external_camera_url: externalCameraUrl,
                make_default: Boolean(this.makeDefaultCheckbox?.checked),
            };
        }

        _buildPayloadHash(payload) {
            if (!payload) {
                return '';
            }
            return `${payload.id}:${payload.printer_ip}:${payload.serial}:${payload.access_code}:${payload.external_camera_url || ''}`;
        }

        _buildExternalCameraUrl(rawUrl, username, password) {
            const trimmed = (rawUrl || '').trim();
            if (!trimmed) {
                return '';
            }
            if (!username && !password) {
                return trimmed;
            }
            const schemeIndex = trimmed.indexOf('://');
            if (schemeIndex === -1) {
                return trimmed;
            }
            const encodedUser = encodeURIComponent(username || '');
            const encodedPass = password ? `:${encodeURIComponent(password)}` : '';
            return `${trimmed.slice(0, schemeIndex + 3)}${encodedUser}${encodedPass}@${trimmed.slice(schemeIndex + 3)}`;
        }

        _parseExternalCameraUrl(rawUrl) {
            const trimmed = (rawUrl || '').trim();
            if (!trimmed) {
                return { url: '', username: '', password: '' };
            }
            const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^@/]+)@(.+)$/);
            if (!match) {
                return { url: trimmed, username: '', password: '' };
            }
            const credentials = match[2];
            const remainder = match[1] + match[3];
            const [user, pass] = credentials.split(':');
            return {
                url: remainder,
                username: decodeURIComponent(user || ''),
                password: pass ? decodeURIComponent(pass) : '',
            };
        }

        updateExternalCameraFields() {
            const enabled = Boolean(this.externalCameraToggle?.checked);
            const fields = [
                this.externalCameraUrlField,
                this.externalCameraUsernameField,
                this.externalCameraPasswordField,
            ];
            fields.forEach((field) => {
                if (!field) {
                    return;
                }
                if (enabled) {
                    field.classList.remove('is-hidden');
                } else {
                    field.classList.add('is-hidden');
                }
            });
            if (this.externalCameraUrlInput) {
                if (enabled) {
                    this.externalCameraUrlInput.setAttribute('required', 'required');
                } else {
                    this.externalCameraUrlInput.removeAttribute('required');
                }
            }
        }

        populateExternalCameraFields(rawUrl) {
            const parsed = this._parseExternalCameraUrl(rawUrl);
            if (this.externalCameraToggle) {
                this.externalCameraToggle.checked = Boolean(parsed.url);
            }
            if (this.externalCameraUrlInput) {
                this.externalCameraUrlInput.value = parsed.url || '';
            }
            if (this.externalCameraUsernameInput) {
                this.externalCameraUsernameInput.value = parsed.username || '';
            }
            if (this.externalCameraPasswordInput) {
                this.externalCameraPasswordInput.value = parsed.password || '';
            }
            this.updateExternalCameraFields();
        }

        populateFormFromPrinter(printer) {
            if (!printer) {
                return;
            }
            if (this.printerIdInput) {
                this.printerIdInput.value = printer.id;
            }
            if (this.printerIpInput) {
                this.printerIpInput.value = printer.printer_ip || '';
            }
            if (this.printerSerialInput) {
                this.printerSerialInput.value = printer.serial || '';
            }
            if (this.printerAccessInput) {
                this.printerAccessInput.value = printer.access_code || '';
            }
            this.editingPrinterAccessCode = printer.access_code || '';
            this.populateExternalCameraFields(printer.external_camera_url || '');
            this.captureInitialPayload(printer);
        }

        showModalError(message) {
            this.modalError = message || '';
        }

        async handleVerifySubmit(event) {
            if (event) {
                event.preventDefault();
            }
            if (this.isAdding) {
                return;
            }

            const changeState = this.getFormChangeState();
            const payload = changeState?.payload || this._buildFormPayload();
            if (!payload || !payload.id || !payload.printer_ip || !payload.serial || payload.access_code.length !== 8) {
                this.showModalError('Please fill out all required fields.');
                return;
            }
            if (this.externalCameraToggle?.checked && !payload.external_camera_url) {
                this.showModalError('External camera URL is required.');
                return;
            }
            if (this.externalCameraToggle?.checked) {
                const username = this.externalCameraUsernameInput?.value?.trim() || '';
                const password = this.externalCameraPasswordInput?.value || '';
                if (password && !username) {
                    this.showModalError('External camera username is required.');
                    return;
                }
            }
            if (changeState?.canApplyDirect) {
                await this.applyUpdateWithoutVerify(payload);
                return;
            }

            const hasDuplicateId = this.printers.some(
                (printer) => printer.id === payload.id && printer.id !== this.editingPrinterId
            );
            if (hasDuplicateId) {
                this.showModalError('A printer with this ID already exists.');
                this.setModalStatus('error', 'Duplicate ID');
                return;
            }

            this.showModalError('');
            this.isAdding = true;
            this.setModalStatus('info', 'Connecting to printer...');
            this.setButtonLoading(this.modalSubmitBtn, true);
            this.hideAddArea();

            try {
                const rawResponse = await printerApi.request('/api/status/printers/verify', {
                    skipPrinterId: true,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const response = await parseApiResponse(rawResponse);
                this.renderModalDetails(response);
                this.verificationPayloadHash = this._buildPayloadHash(payload);
                this.isVerified = true;
                this.setPreviewVisibility(true);
                this.showAddArea();
                this.setAddButtonLabel(this.isEditing ? 'Apply' : 'Add Printer');
                this.setModalStatus('success', `${response?.printer?.model || payload.id} verified successfully`);
                this.setSubmitLabel('Verify again');
            } catch (error) {
                console.error('Printer verification failed', error);
                this.showModalError(error?.message || 'Printer could not be verified. Please check the details.');
                this.setModalStatus('error', 'Connnection Error');
                this.isVerified = false;
                this.verificationPayloadHash = null;
                this.hideAddArea();
                this.setPreviewVisibility(false);
                this.setSubmitLabel('Verify');
            } finally {
                this.setButtonLoading(this.modalSubmitBtn, false);
                this.isAdding = false;
                this.updateVerifyState();
            }
        }

        async applyUpdateWithoutVerify(payload) {
            if (this.isAdding) {
                return;
            }
            if (!this.isEditing || !this.editingPrinterId) {
                this.showModalError('No printer has been selected to update.');
                this.setModalStatus('error', 'Selection required');
                return;
            }
            this.showModalError('');
            this.isAdding = true;
            this.setModalStatus('info', 'Updating Printer...');
            this.setButtonLoading(this.modalSubmitBtn, true);
            const endpoint = `/api/status/printers/${encodeURIComponent(this.editingPrinterId)}`;
            try {
                const rawResponse = await printerApi.request(endpoint, {
                    skipPrinterId: true,
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...payload, skip_verify: true }),
                });
                await parseApiResponse(rawResponse);
                showToast(`${payload.id} updated successfully`, 'success');
                await this.loadPrinters();
                this.emitPrinterConfigUpdated();
                this.closeAddPrinterModal({ force: true });
            } catch (error) {
                console.error('Failed to update printer', error);
                this.showModalError(error?.message || 'Printer could not be updated. Please verify the details.');
                this.setModalStatus('error', 'Connnection Error');
            } finally {
                this.setButtonLoading(this.modalSubmitBtn, false);
                this.isAdding = false;
                this.updateVerifyState();
            }
        }

        async handleAddPrinterConfirm() {
            if (this.isAdding) {
                return;
            }
            const editingMode = this.isEditing;
            if (editingMode && !this.editingPrinterId) {
                this.showModalError('No printer has been selected to update.');
                this.setModalStatus('error', 'Selection required');
                return;
            }
            if (!this.isVerified) {
                this.showModalError('Please verify the printer details first.');
                this.setModalStatus('error', 'Verification required');
                return;
            }

            const payload = this._buildFormPayload();
            if (!payload) {
                this.showModalError('Please fill out all required fields.');
                return;
            }

            const payloadHash = this._buildPayloadHash(payload);
            if (payloadHash !== this.verificationPayloadHash) {
                this.showModalError('Form has been modified, please verify again.');
                this.setModalStatus('error', 'Information changed');
                this.isVerified = false;
                this.verificationPayloadHash = null;
                this.hideAddArea();
                this.setPreviewVisibility(false);
                this.setSubmitLabel('Verify');
                return;
            }

            const endpoint = editingMode
                ? `/api/status/printers/${encodeURIComponent(this.editingPrinterId)}`
                : '/api/status/printers';
            const method = editingMode ? 'PUT' : 'POST';

            this.showModalError('');
            this.isAdding = true;
            this.setModalStatus('info', editingMode ? 'Updating printer...' : 'Adding printer...');
            this.setButtonLoading(this.modalAddBtn, true);

            let added = false;
            try {
                const rawResponse = await printerApi.request(endpoint, {
                    skipPrinterId: true,
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const response = await parseApiResponse(rawResponse);
                this.renderModalDetails(response);
                showToast(
                    `${response?.printer?.model || payload.id} ${editingMode ? 'successfully updated' : 'successfully added'}`,
                    'success',
                );
                await this.loadPrinters();
                if (editingMode) {
                    this.emitPrinterConfigUpdated();
                }
                added = true;
            } catch (error) {
                const friendlyMessage = editingMode
                    ? 'Printer could not be updated. Please verify the details.'
                    : 'Printer could not be added. Please verify the details.';
                console.error(editingMode ? 'Failed to update printer' : 'Failed to add printer', error);
                this.showModalError(error?.message || friendlyMessage);
                this.setModalStatus('error', 'Connection error');
            } finally {
                this.setButtonLoading(this.modalAddBtn, false);
                this.isAdding = false;
                if (added) {
                    this.closeAddPrinterModal({ force: true });
                    if (this.isSetupMode && !editingMode) {
                        window.location.assign('/');
                    }
                }
            }
        }

        renderModalDetails(response) {
            if (!response) {
                return;
            }
            this.modalPreview = {
                model: response.printer?.model || '-',
                firmware: response.firmware || '-',
                modules: Array.isArray(response.modules) ? response.modules : [],
                emptyMessage: 'Module information not available.',
            };
        }

        handleVisibilityChange() {
            if (document.hidden) {
                this.stopAutoRefresh();
                return;
            }
            this.refreshPrinters();
            this.startAutoRefresh();
        }
    }

    const bindPrinterSelectorEvents = () => {
        if (printerSelectorEventsBound) {
            return true;
        }
        const selector = components.printerSelector;
        if (!selector) {
            return false;
        }
        printerSelectorEventsBound = true;
        bindSidebarEvents(selector);
        bindModalEvents({ selector, showToast });
        if (selector.contextMenuEl) {
            selector.contextMenuEl.addEventListener('click', (event) => selector.handleContextMenuAction(event));
        }
        if (selector.dashboardMainEl) {
            selector.dashboardMainEl.addEventListener('click', (event) => selector.handleMainAreaClick(event));
        }
        if (selector.eventMarkReadBtn) {
            selector.eventMarkReadBtn.addEventListener('click', () => {
                if (selector.activePrinter) {
                    selector.eventPanel?.markAllRead(selector.activePrinter.id);
                } else {
                    selector.eventPanel?.markAllRead();
                }
            });
        }

        bindPrinterEventPanelEvents(selector.eventPanel);
        return true;
    };

    const bindPrinterSelectorDocumentEvents = () => {
        if (printerSelectorDocumentEventsBound) {
            return true;
        }
        printerSelectorDocumentEventsBound = true;
        document.addEventListener('click', (event) => {
            const selector = components.printerSelector;
            if (selector) {
                selector.handleDocumentClick(event);
            }
        });
        document.addEventListener('contextmenu', (event) => {
            const selector = components.printerSelector;
            if (selector && !event.target.closest('.printer-item') && !event.target.closest('#printer-context-menu')) {
                selector.hideContextMenu();
            }
        });
        document.addEventListener('keydown', (event) => {
            const selector = components.printerSelector;
            if (selector && event.key === 'Escape') {
                selector.hideContextMenu();
            }
        });
        document.addEventListener('scroll', () => {
            const selector = components.printerSelector;
            if (selector) {
                selector.hideContextMenu();
            }
        }, true);
        document.addEventListener('visibilitychange', () => {
            const selector = components.printerSelector;
            if (selector) {
                selector.handleVisibilityChange();
            }
        });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                const selector = new PrinterSelector();
                components.printerSelector = selector;
                if (typeof global.CustomEvent === 'function') {
                    document.dispatchEvent(new CustomEvent('printer-selection-ready', { detail: selector }));
                } else {
                    document.dispatchEvent(new Event('printer-selection-ready'));
                }
                bindPrinterSelectorEvents();
            });
            return true;
        }
        const selector = new PrinterSelector();
        components.printerSelector = selector;
        if (typeof global.CustomEvent === 'function') {
            document.dispatchEvent(new CustomEvent('printer-selection-ready', { detail: selector }));
        } else {
            document.dispatchEvent(new Event('printer-selection-ready'));
        }
        bindPrinterSelectorEvents();
        return true;
    };

    const events = appContext.events || {};
    const eventKey = events.keys?.PRINTER_SELECTOR || 'printerSelector';
    if (typeof events.register === 'function') {
        events.register(eventKey, {
            component: bindPrinterSelectorEvents,
            document: bindPrinterSelectorDocumentEvents,
        });
    } else {
        events.bindPrinterSelectorEvents = bindPrinterSelectorEvents;
        events.bindPrinterSelectorDocumentEvents = bindPrinterSelectorDocumentEvents;
    }
}

const globalProxy =
    typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : {};

    let printerSelectorInitialized = false;
    let printerSelectorEventsBound = false;
let printerSelectorDocumentEventsBound = false;
let printerSelectorInitScheduled = false;

const canInitializePrinterSelector = () =>
    Boolean(
        globalProxy.document &&
            globalProxy.appContext?.stores?.core &&
            globalProxy.appContext?.services?.printers?.fetchPrinters,
    );

const schedulePrinterSelectorInit = () => {
    if (printerSelectorInitScheduled) {
        return;
    }
    printerSelectorInitScheduled = true;
    const retry = () => {
        printerSelectorInitScheduled = false;
        initPrinterSelector();
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(retry);
    } else {
        setTimeout(retry, 16);
    }
};

const initPrinterSelector = () => {
    if (printerSelectorInitialized) {
        return globalProxy.appContext?.components?.printerSelector || null;
    }
    if (!canInitializePrinterSelector()) {
        schedulePrinterSelectorInit();
        return null;
    }
    printerSelectorInitialized = true;
    initializePrinterSelector(globalProxy);
    const eventRegistry = globalProxy.appContext?.eventRegistry;
    if (eventRegistry?.bindEvent) {
        const eventKey = eventRegistry.keys?.PRINTER_SELECTOR || 'printerSelector';
        const phase = eventRegistry.phases?.DOCUMENT;
        eventRegistry.bindEvent(eventKey, phase);
    }
    return globalProxy.appContext?.components?.printerSelector || null;
};

export { initPrinterSelector };
export default initPrinterSelector;
