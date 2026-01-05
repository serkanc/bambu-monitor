import renderBreadcrumb from './file_explorer/breadcrumb.js';
import renderFileList from './file_explorer/file_list.js';
import bindFileExplorerModalEvents from './file_explorer/modal_events.js';
import bindFileExplorerDocumentHandlers from './file_explorer/document_events.js';
import initModalManager from '../core/modal_manager.js';

function bootstrapFileExplorer(global) {
    const appContext = global.appContext || (global.appContext = {});
    appContext.components = appContext.components || {};
    const components = appContext.components;
    const masterStore = appContext.stores?.core || null;
    const masterUtils = appContext.utils || {};
    const services = appContext.services || {};
    const fileActions = services.files || {};
    const fileExplorerActions = appContext.actions?.fileExplorer || null;
    const fileApi = fileExplorerActions || fileActions;
    const selectors = appContext.selectors || {};
    const modalManager = initModalManager(global);
    const dispatchTransferOverlayCommand = (action, payload = {}) => {
        if (typeof document === 'undefined' || !action) {
            return;
        }
        document.dispatchEvent(
            new CustomEvent('transfer-overlay-command', {
                detail: {
                    action,
                    payload,
                },
            }),
        );
    };
    const getSnapshot = () => (typeof masterStore?.getState === 'function' ? masterStore.getState() : {});
    const getExplorerState = () => getSnapshot().ui?.fileExplorer || {};
    const setExplorerState = (partial) => {
        if (!fileExplorerActions?.setState) {
            return;
        }
        fileExplorerActions.setState(partial);
    };
    const showToast =
        masterUtils.dom?.showToast || ((message, type) => console.log(type ?? 'info', message));
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
    const formatBytes =
        masterUtils.format?.formatBytes || ((value) => `${value} B`);
    const getTransferOverlay = () => components.transferOverlay || null;
    
    class FileExplorer {
        constructor() {
            this._bindStateProxy();
            this._initializeState();
            this.modal = {
                container: null,
                backdrop: null,
                dialog: null,
                closeBtn: null,
                name: null,
                meta: null,
                icon: null,
                downloadBtn: null,
                printBtn: null,
                deleteBtn: null,
            };
            this.contextMenu = null; // NEW: Context menu
            this.longPressTimer = null; // NEW: Long press timer
            this.isContextMenuOpen = false;
            this.activeUploadRequest = null;
            this.fileListElement = null;
            this._unsubscribe = null;
            this._lastRenderKey = '';
            this._lastModalKey = '';
            this._lastContextMenuKey = '';
            this._listEventsBound = false;
            this._lastSelectedPrinterId = null;
            this._lastStatusPrinterId = null;
            this._lastStateStreamPrinterId = null;
            this._lastFtpStatus = null;
            this._refreshInFlight = false;
            this.modalManager = modalManager;
            this.initialize();
        }

        _bindStateProxy() {
            this._stateKeys = [
                'currentPath',
                'activeFile',
                'isContextMenuOpen',
                'contextMenuPosition',
                'contextMenuFile',
                'isModalOpen',
                'isLoading',
                'lastError',
                'files',
            ];
            this._stateKeys.forEach((key) => {
                Object.defineProperty(this, key, {
                    get: () => this._getStateValue(key),
                    set: (value) => this._setStateValue(key, value),
                });
            });
        }

        _initializeState() {
            setExplorerState?.({
                currentPath: '/',
                activeFile: null,
                isContextMenuOpen: false,
                contextMenuPosition: null,
                contextMenuFile: null,
                isModalOpen: false,
                isLoading: false,
                pendingRefresh: false,
                hasLoadedOnce: false,
                lastError: null,
                files: [],
            });
        }

        _getStateValue(key) {
            const snapshot = getSnapshot();
            const map = {
                currentPath: selectors.fileExplorer?.getCurrentPath,
                activeFile: selectors.fileExplorer?.getActiveFile,
                files: selectors.fileExplorer?.getFiles,
                isLoading: selectors.fileExplorer?.getIsLoading,
                lastError: selectors.fileExplorer?.getLastError,
                isContextMenuOpen: selectors.fileExplorer?.getIsContextMenuOpen,
                contextMenuPosition: selectors.fileExplorer?.getContextMenuPosition,
                contextMenuFile: selectors.fileExplorer?.getContextMenuFile,
                isModalOpen: selectors.fileExplorer?.getIsModalOpen,
            };
            const selector = map[key];
            if (typeof selector === 'function') {
                return selector(snapshot);
            }
            return snapshot?.ui?.fileExplorer?.[key];
        }

        _setStateValue(key, value) {
            setExplorerState?.({ [key]: value });
        }

        _isPrinterBusy() {
            const snapshot = getSnapshot();
            if (selectors.statusPanel?.isPrinterBusy) {
                return Boolean(selectors.statusPanel.isPrinterBusy(snapshot));
            }
            const statusConstants = snapshot?.constants?.status || {};
            const busyStates =
                statusConstants.busyStates || ['RUNNING', 'SLICING', 'PAUSE', 'PREPARE', 'INIT'];
            const status = String(snapshot?.printStatus?.gcode_state || '').toUpperCase();
            return busyStates.map((value) => String(value).toUpperCase()).includes(status);
        }

        _getPrintDisabledReason() {
            if (this._isPrinterBusy()) {
                return 'Printer is busy';
            }
            return '';
        }

        _getFtpWaitMessage() {
            const snapshot = getSnapshot();
            const ftpStatus = snapshot?.ftpStatus || 'disconnected';
            return ftpStatus === 'reconnecting'
                ? 'Reconnecting...'
                : 'Waiting for FTP connection...';
        }

        initialize() {
            this.captureModalElements();
            this.registerModalManager();
            this.setupContextMenu(); // NEW: Context menu setup
            this.subscribeToStore();
        }

        registerModalManager() {
            if (!this.modal?.container || !this.modalManager?.register) {
                return;
            }
            if (this.modalManager.get?.('fileAction')?.element === this.modal.container) {
                return;
            }
            this.modalManager.register('fileAction', {
                element: this.modal.container,
                openClass: 'is-open',
                onClose: () => this.closeFileOptions(),
            });
        }


        captureModalElements() {
            this.modal.container = document.getElementById('file-action-modal');
            if (!this.modal.container) {
                return;
            }

            this.modal.backdrop = this.modal.container.querySelector('.file-action-backdrop');
            this.modal.dialog = this.modal.container.querySelector('.file-action-dialog');
            this.modal.closeBtn = document.getElementById('file-action-close');
            this.modal.name = document.getElementById('file-action-name');
            this.modal.meta = document.getElementById('file-action-meta');
            this.modal.icon = this.modal.container.querySelector('.file-action-icon');
            this.modal.downloadBtn = document.getElementById('file-download-btn');
            this.modal.printBtn = document.getElementById('file-print-btn');
            this.modal.deleteBtn = document.getElementById('file-delete-btn'); // NEW: Capture delete button
        }

        // NEW: Context menu setup
        setupContextMenu() {
            // Create context menu container
            this.contextMenu = document.createElement('div');
            this.contextMenu.className = 'file-context-menu';
            this.contextMenu.style.display = 'none';
            setInertState(this.contextMenu, false);
            document.body.appendChild(this.contextMenu);
            this.bindContextMenuEvents();
        }

        bindContextMenuEvents() {
            if (!this.contextMenu) {
                return;
            }
            this.contextMenu.addEventListener('click', (event) => {
                const menuItem = event.target?.closest?.('.file-context-menu__item');
                if (!menuItem) {
                    return;
                }
                event.stopPropagation();
                if (menuItem.dataset.disabled === 'true') {
                    const reason =
                        menuItem.dataset.disabledReason || 'Printer is busy';
                    showToast(reason, 'warning');
                    return;
                }
                const action = menuItem.dataset.action;
                const file = this.contextMenuFile;
                if (!action || !file) {
                    return;
                }
                this.handleContextAction(file, action);
                this.hideContextMenu();
            });
        }

        getSelectedPrinterId() {
            return components.printerSelector?.getSelectedPrinterId?.() ?? null;
        }

        handleStateStreamConnected() {
            const snapshot = typeof masterStore?.getState === 'function' ? masterStore.getState() : {};
            const selectedPrinterId =
                this.getSelectedPrinterId() ||
                snapshot?.selectedPrinterId ||
                snapshot?.currentPrinterId ||
                snapshot?.currentPrinter?.id ||
                null;
            if (!selectedPrinterId) {
                this._lastStateStreamPrinterId = null;
                return;
            }
            if (this._lastStateStreamPrinterId === selectedPrinterId) {
                return;
            }
            this._lastStateStreamPrinterId = selectedPrinterId;
            setExplorerState?.({
                pendingRefresh: true,
            });
        }

        async refresh(path) {
            if (path) {
                this.currentPath = this.normalizePath(path);
            }
            if (fileExplorerActions?.requestRefresh) {
                await fileExplorerActions.requestRefresh(this.currentPath);
                return;
            }
            if (!this.getSelectedPrinterId()) {
                this.showError('Select a printer first to load the file list.');
                return;
            }
        }

        async createFolder() {
            const folderName = prompt('Enter new folder name:');
            if (!folderName || !folderName.trim()) {
                alert('Folder name cannot be empty.');
                return;
            }

            try {
                const currentPath = this.currentPath || '/';
                const formData = new FormData();
                formData.append('path', currentPath);
                formData.append('folder_name', folderName.trim());

                console.log('Sending request:', { currentPath, folderName: folderName.trim() });

                const response = await fileApi.createFolder(formData);
                const result = await response.json().catch(() => ({}));
                console.log('Success response:', result);
                
                this.refresh();
                showToast('Folder created successfully', 'success');
                
            } catch (error) {
                console.error('Folder creation error:', error);
                showToast(error?.message || 'Folder could not be created', 'error');
            }
        }

        uploadFile() {
            const input = document.createElement('input');
            input.type = 'file';
            const acceptTypes = [
                '.gcode',
                '.3mf',
                'model/3mf',
                'application/vnd.ms-package.3dmanufacturing-3mf',
            ];
            const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
            const isIOS =
                /iPad|iPhone|iPod/.test(userAgent) ||
                (typeof navigator !== 'undefined' &&
                    navigator.platform === 'MacIntel' &&
                    navigator.maxTouchPoints > 1);
            const isTouchDevice =
                typeof window !== 'undefined' &&
                typeof window.matchMedia === 'function' &&
                window.matchMedia('(pointer: coarse)').matches;
            if (!isIOS && !isTouchDevice) {
                input.accept = acceptTypes.join(',');
            } else {
                input.removeAttribute('accept');
            }
            input.id = 'file-upload-input';
            input.name = 'file_upload';
            input.style.position = 'fixed';
            input.style.left = '-9999px';
            input.style.opacity = '0';
            document.body.appendChild(input);

            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) {
                    input.remove();
                    return;
                }
                const allowedExtensions = new Set(['.gcode', '.3mf']);
                const allowedMimeTypes = new Set([
                    'model/3mf',
                    'application/vnd.ms-package.3dmanufacturing-3mf',
                    'text/plain',
                ]);
                const fileName = file.name || '';
                const extIndex = fileName.lastIndexOf('.');
                const extension = extIndex >= 0 ? fileName.slice(extIndex).toLowerCase() : '';
                const mimeType = (file.type || '').toLowerCase();
                if (!allowedExtensions.has(extension) && !allowedMimeTypes.has(mimeType)) {
                    showToast(
                        'File type not allowed. Allowed types: .gcode, .3mf',
                        'error',
                    );
                    input.remove();
                    return;
                }

                showToast(`${file.name} is uploading...`, 'info');
                const overlay = getTransferOverlay();

                const formData = new FormData();
                formData.append('file', file);
                formData.append('path', this.currentPath || '/');
                let xhr = null;

                const cancelActiveUpload = () => {
                    if (xhr && xhr.readyState !== XMLHttpRequest.DONE) {
                        try {
                            xhr.abort();
                        } catch (_) {
                            // ignore abort errors
                        }
                    }
                    fileApi
                        .cancelUpload()
                        .catch(() => {});
                };

                overlay?.beginUpload(file.name, file.size, { onCancel: cancelActiveUpload });

                const cleanup = () => {
                    if (this.activeUploadRequest === xhr) {
                        this.activeUploadRequest = null;
                    }
                };

                const handleError = (detail) => {
                    cleanup();
                    const message = detail || 'Upload could not be completed';
                    const overlayInstance = getTransferOverlay();
                    overlayInstance?.failCurrent(message);
                    showToast(`${file.name} failed to upload: ${message}`, 'error');
                };

                xhr = fileApi.uploadFile(formData, {
                    onProgress: (event) => {
                        if (event.lengthComputable) {
                            overlay?.updateManualProgress(event.loaded, event.total);
                        } else {
                            overlay?.setStatus('File uploading...');
                        }
                    },
                    onLoad: () => {
                        cleanup();
                    if (xhr.status >= 200 && xhr.status < 300) {
                        if (overlay?.cancelRequested) {
                            overlay?.completeManual(false, 'Upload canceled');
                            showToast('Upload canceled', 'info');
                            this.refresh();
                            return;
                        }
                        this.refresh();
                        showToast(`${file.name} uploaded successfully`, 'success');
                        overlay?.markClientUploadComplete?.();
                    } else if (xhr.status === 0) {
                        overlay?.completeManual(false, 'Upload canceled');
                        showToast('Upload canceled', 'info');
                        this.refresh();
                    } else {
                        let detail = xhr.responseText || 'File could not be uploaded';
                        try {
                            const parsed = JSON.parse(xhr.responseText || '{}');
                            detail = parsed.detail || detail;
                            } catch (_) {
                                // response not JSON
                            }
                            handleError(detail);
                        }
                    },
                    onError: () => {
                        handleError('Connection error');
                    },
                    onAbort: () => {
                        cleanup();
                        overlay?.completeManual(false, 'Upload canceled');
                        showToast('Upload canceled', 'info');
                        this.refresh();
                    },
                });
                this.activeUploadRequest = xhr;
                input.remove();
            };

            input.click();
        }
        renderFiles(files, currentPath = this.currentPath) {
            this.renderBreadcrumb(currentPath);
            this.renderFileList(Array.isArray(files) ? files : []);
        }

        renderView(state) {
            const snapshot = state || getSnapshot();
            const uiState = snapshot?.ui?.fileExplorer || {};
            const isLoading = Boolean(uiState.isLoading);
            const lastError = uiState.lastError || '';
            const files = Array.isArray(uiState.files) ? uiState.files : [];
            const currentPath = uiState.currentPath || '/';

                const pendingRefresh = Boolean(uiState.pendingRefresh);
                const ftpStatus = snapshot?.ftpStatus || 'disconnected';
                if (ftpStatus !== 'connected') {
                    this.showLoading(this._getFtpWaitMessage());
                    return;
                }
                if (isLoading) {
                    this.showLoading('Loading files...');
                    return;
                }
                if (lastError) {
                    this.showError(lastError);
                    return;
                }
                if (!uiState.hasLoadedOnce && !files.length) {
                    this.showLoading('Loading files...');
                    return;
                }
            this.renderFiles(files, currentPath);
        }

        renderModalState(state = getSnapshot()) {
            if (!this.modal.container) {
                return;
            }
            const uiState = state?.ui?.fileExplorer || {};
            const isOpen = Boolean(uiState.isModalOpen);
            const file = uiState.activeFile || null;
            const key = [
                isOpen ? '1' : '0',
                file?.path || '',
                file?.name || '',
                file?.size || '',
                file?.modified || '',
                this._getPrintDisabledReason(),
            ].join('|');
            if (key === this._lastModalKey) {
                return;
            }
            this._lastModalKey = key;

            const { container, dialog, name, meta, icon, downloadBtn, printBtn, deleteBtn } = this.modal;
            if (!isOpen || !file) {
                if (this.modalManager?.isOpen?.('fileAction')) {
                    this.modalManager.close('fileAction', { force: true });
                }
                return;
            }

            if (name) {
                name.textContent = file.name || '';
            }

            if (meta) {
                const metaText = this.buildMetaText(file);
                meta.textContent = metaText;
                meta.style.display = metaText ? 'block' : 'none';
            }

            if (icon) {
                icon.innerHTML = this.getFileIcon(file.name || '');
            }

            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download';
            }

            if (printBtn) {
                const is3mfFile = file.name && file.name.toLowerCase().endsWith('.3mf');
                const disabledReason = is3mfFile ? this._getPrintDisabledReason() : '';
                printBtn.style.display = is3mfFile ? 'block' : 'none';
                printBtn.disabled = !is3mfFile || Boolean(disabledReason);
                if (disabledReason) {
                    printBtn.setAttribute('title', disabledReason);
                } else {
                    printBtn.removeAttribute('title');
                }
            }

            if (deleteBtn) {
                deleteBtn.style.display = 'block';
                deleteBtn.disabled = false;
                deleteBtn.textContent = 'Delete';
            }

            if (!this.modalManager?.isOpen?.('fileAction')) {
                this.modalManager?.open?.('fileAction');
            }

            if (dialog) {
                dialog.focus({ preventScroll: true });
            }
        }

        renderContextMenu(state = getSnapshot()) {
            if (!this.contextMenu) {
                return;
            }
            const uiState = state?.ui?.fileExplorer || {};
            const isOpen = Boolean(uiState.isContextMenuOpen);
            const file = uiState.contextMenuFile || null;
            const position = uiState.contextMenuPosition || null;
            const key = [
                isOpen ? '1' : '0',
                file?.path || '',
                position?.x ?? '',
                position?.y ?? '',
            ].join('|');
            if (key === this._lastContextMenuKey) {
                return;
            }
            this._lastContextMenuKey = key;

            if (!isOpen || !file) {
                this.contextMenu.style.display = 'none';
                const activeElement = document.activeElement;
                if (activeElement && this.contextMenu.contains(activeElement) && typeof activeElement.blur === 'function') {
                    activeElement.blur();
                }
                this.contextMenu.style.left = '-9999px';
                this.contextMenu.style.top = '-9999px';
                this.contextMenu.innerHTML = '';
                setInertState(this.contextMenu, false);
                (this.fileListElement || document.getElementById('file-list'))?.classList.remove(
                    'file-list--context-open',
                );
                return;
            }

            const menuItems = this.buildContextMenuItems(file);
            this.contextMenu.innerHTML = menuItems
                .map((item) => {
                    const dangerClass = item.danger ? 'danger' : '';
                    const disabledClass = item.disabled ? 'is-disabled' : '';
                    const disabledAttr = item.disabled ? 'data-disabled="true"' : '';
                    const disabledReason = item.disabledReason
                        ? `data-disabled-reason="${item.disabledReason}"`
                        : '';
                    return `
                        <div class="file-context-menu__item ${dangerClass} ${disabledClass}" data-action="${item.action}" ${disabledAttr} ${disabledReason}>
                            <span class="file-context-menu__icon">${item.icon}</span>
                            <span class="file-context-menu__text">${item.text}</span>
                        </div>
                    `;
                })
                .join('');

            const contextRoot = this.fileListElement || document.getElementById('file-list');
            contextRoot?.classList.add('file-list--context-open');

            this.contextMenu.style.display = 'block';
            this.contextMenu.style.left = '0px';
            this.contextMenu.style.top = '0px';
            setInertState(this.contextMenu, true);

            const x = position?.x ?? 0;
            const y = position?.y ?? 0;
            const menuRect = this.contextMenu.getBoundingClientRect();
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            const margin = 12;

            let left = x;
            let top = y;
            if (left + menuRect.width + margin > viewportWidth) {
                left = viewportWidth - menuRect.width - margin;
            }
            if (top + menuRect.height + margin > viewportHeight) {
                top = viewportHeight - menuRect.height - margin;
            }

            left = Math.max(margin, left);
            top = Math.max(margin, top);

            this.contextMenu.style.left = `${left}px`;
            this.contextMenu.style.top = `${top}px`;
        }

        buildContextMenuItems(file) {
            const icons = {
                open: `
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 7h5l2 2h11v9a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    </svg>
                `,
                download: `
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5v10m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `,
                rename: `
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 20h4.5L18.9 9.6l-4.5-4.5L4 15.5V20zM19.3 7.1l-1.4-1.4a.996.996 0 0 0-1.4 0l-1.8 1.8 4.5 4.5 1.8-1.8c.4-.4.4-1 0-1.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `,
                print: `
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 9V4h12v5m-1 6h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1m0 0v4h10v-4H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `,
                delete: `
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 7h12M9 7v10m6-10v10M9 7V5h6v2m-8 0l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `,
            };

            const menuItems = [];
            if (file.isDirectory) {
                menuItems.push(
                    { icon: icons.open, text: 'Open', action: 'open' },
                    { icon: icons.rename, text: 'Rename', action: 'rename' },
                    { icon: icons.delete, text: 'Delete', action: 'delete', danger: true },
                );
            } else {
                menuItems.push({ icon: icons.download, text: 'Download', action: 'download' });
                menuItems.push({ icon: icons.rename, text: 'Rename', action: 'rename' });
                if (file.name && file.name.toLowerCase().endsWith('.3mf')) {
                    const disabledReason = this._getPrintDisabledReason();
                    menuItems.push({
                        icon: icons.print,
                        text: 'Print',
                        action: 'print',
                        disabled: Boolean(disabledReason),
                        disabledReason,
                    });
                }
                menuItems.push({ icon: icons.delete, text: 'Delete', action: 'delete', danger: true });
            }

            return menuItems;
        }

        subscribeToStore() {
            if (this._unsubscribe || typeof masterStore?.subscribe !== 'function') {
                return;
            }
            this._unsubscribe = masterStore.subscribe((snapshot) => {
                const pendingRefresh = Boolean(snapshot?.ui?.fileExplorer?.pendingRefresh);
                const ftpStatus = snapshot?.ftpStatus || 'disconnected';
                const selectedPrinterId = this.getSelectedPrinterId();
                const statusPrinterId = snapshot?.lastStatusPrinterId || null;
                const prevStatusPrinterId = this._lastStatusPrinterId;
                const prevFtpStatus = this._lastFtpStatus;
                const statusMatches = selectedPrinterId && statusPrinterId === selectedPrinterId;

                const justConnected =
                    ftpStatus === 'connected' &&
                    prevFtpStatus !== 'connected' &&
                    statusMatches;

                this._lastStatusPrinterId = statusPrinterId;
                this._lastFtpStatus = ftpStatus;

                if (justConnected) {
                    setExplorerState?.({
                        pendingRefresh: true,
                        pendingRefreshReason: null,
                    });
                }

                if (pendingRefresh && statusMatches && ftpStatus === 'connected') {
                    fileExplorerActions?.requestRefresh?.(this.currentPath);
                }
                if (selectedPrinterId && this._lastSelectedPrinterId === null) {
                    this._lastSelectedPrinterId = selectedPrinterId;
                } else if (selectedPrinterId && selectedPrinterId !== this._lastSelectedPrinterId) {
                    this._lastSelectedPrinterId = selectedPrinterId;
                    this.resetToHome();
                    return;
                }
                const modalGate = snapshot?.ui?.modalGate?.active;
                if (modalGate && modalGate !== 'fileAction') {
                    return;
                }
                const uiState = snapshot?.ui?.fileExplorer || {};
                this.renderModalState(snapshot);
                this.renderContextMenu(snapshot);
                const key = [
                    uiState.currentPath || '/',
                    (uiState.files || []).length,
                    uiState.isLoading ? '1' : '0',
                    uiState.lastError || '',
                    uiState.activeFile ? uiState.activeFile.path || '' : '',
                    snapshot?.ftpStatus || 'disconnected',
                ].join('|');
                if (key !== this._lastRenderKey) {
                    this._lastRenderKey = key;
                    this.renderView(snapshot);
                }
            });
        }

        renderBreadcrumb(currentPath = '/') {
            renderBreadcrumb({
                currentPath,
                normalizePath: this.normalizePath.bind(this),
                escapeHtml: this.escapeHtml.bind(this),
                onNavigate: this.navigateTo.bind(this),
                documentRef: document,
            });
        }

        renderFileList(files) {
            this.fileListElement = document.getElementById('file-list');
            renderFileList({
                files,
                buildFileRow: this.buildFileRow.bind(this),
                attachFileInteractivity: this.attachFileInteractivity.bind(this),
                documentRef: document,
            });
        }

        buildFileRow(file) {
            const isDirectory = Boolean(file?.is_directory);
            const isParentDir = file?.name === '..';
            const displayName = isParentDir ? 'Parent folder' : file?.name || '';
            const sizeLabel = this.getSizeLabel(file);
            const modifiedLabel = file?.modified
                ? `<span class="file-modified">${this.escapeHtml(file.modified)}</span>`
                : '';
            const icon = isDirectory
                ? isParentDir
                    ? '&#8617;'
                    : '&#128193;'
                : this.getFileIcon(file?.name || '');
            const chevron = isDirectory ? '&#8250;' : '&#8230;';
            const resolvedPath = this.resolvePath(file?.path, file?.name, isParentDir);

            return `
                <div class="file-item ${isDirectory ? 'folder' : 'file'}" 
                     data-path="${encodeURIComponent(resolvedPath)}" 
                     data-name="${encodeURIComponent(file?.name || '')}" 
                     data-size="${encodeURIComponent(sizeLabel || '')}" 
                     data-modified="${encodeURIComponent(file?.modified || '')}" 
                     data-directory="${isDirectory}">
                    <div class="file-icon">${icon}</div>
                    <div class="file-info">
                        <div class="file-name" title="${this.escapeAttribute(displayName)}">${this.escapeHtml(displayName)}</div>
                        <div class="file-details">
                            <span class="file-size">${this.escapeHtml(sizeLabel)}</span>
                            ${modifiedLabel}
                        </div>
                    </div>
                    <div class="file-chevron">${chevron}</div>
                </div>
            `;
        }

        attachFileInteractivity() {
            const container = document.getElementById('file-list');
            if (!container) {
                return;
            }
            if (this._listEventsBound && this.fileListElement === container) {
                return;
            }
            this.fileListElement = container;
            if (this._listEventsBound) {
                return;
            }
            this._listEventsBound = true;

            const getItemFromEvent = (event) => event.target?.closest?.('.file-item');
            const getRetryFromEvent = (event) => event.target?.closest?.('.retry-btn');
            const buildFileFromItem = (item) => {
                const pathValue = item.dataset.path ? decodeURIComponent(item.dataset.path) : '/';
                const nameValue = decodeURIComponent(item.dataset.name || '');
                const sizeValue = decodeURIComponent(item.dataset.size || '');
                const modifiedValue = decodeURIComponent(item.dataset.modified || '');
                const isDirectory = item.dataset.directory === 'true';
                return {
                    path: pathValue,
                    name: nameValue,
                    size: sizeValue,
                    modified: modifiedValue,
                    isDirectory,
                };
            };

            container.addEventListener('click', (e) => {
                const retryBtn = getRetryFromEvent(e);
                if (retryBtn) {
                    e.preventDefault();
                    this.refresh();
                    return;
                }
                const item = getItemFromEvent(e);
                if (!item) {
                    return;
                }
                if (this.isContextMenuOpen) {
                    this.hideContextMenu();
                    return;
                }
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                    return;
                }
                const file = buildFileFromItem(item);
                if (file.isDirectory) {
                    this.navigateTo(file.path);
                    return;
                }
                this.openFileOptions(file);
            });

            container.addEventListener('contextmenu', (e) => {
                const item = getItemFromEvent(e);
                if (!item) {
                    return;
                }
                e.preventDefault();
                this.handleRightClick(e, item);
            });

            container.addEventListener(
                'touchstart',
                (e) => {
                    const item = getItemFromEvent(e);
                    if (!item) {
                        return;
                    }
                    this.startLongPress(e, item);
                },
                { passive: true },
            );
            container.addEventListener('touchend', () => this.cancelLongPress(), { passive: true });
            container.addEventListener('touchmove', () => this.cancelLongPress(), { passive: true });
            container.addEventListener('touchcancel', () => this.cancelLongPress(), { passive: true });
        }

        // NEW: Handle right click
        handleRightClick(event, item) {
            const pathValue = item.dataset.path ? decodeURIComponent(item.dataset.path) : '/';
            const nameValue = decodeURIComponent(item.dataset.name || '');
            const sizeValue = decodeURIComponent(item.dataset.size || '');
            const modifiedValue = decodeURIComponent(item.dataset.modified || '');
            const isDirectory = item.dataset.directory === 'true';
            const isParentDir = nameValue === '..';

            if (isParentDir) return; // Do not show context menu in parent folder

            const file = {
                path: pathValue,
                name: nameValue,
                size: sizeValue,
                modified: modifiedValue,
                isDirectory: isDirectory
            };

            this.showContextMenu(event, file);
        }

        // NEW: Start long press
        startLongPress(event, item) {
            this.longPressTimer = setTimeout(() => {
                this.handleRightClick({
                    clientX: event.touches[0].clientX,
                    clientY: event.touches[0].clientY,
                    preventDefault: () => {}
                }, item);
            }, 500); // 500ms = 0.5 saniye
        }

        // NEW: Cancel long press
        cancelLongPress() {
            if (this.longPressTimer) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
        }

        // YENI: Context menu goster
        showContextMenu(event, file) {
            const x = event?.clientX ?? event?.touches?.[0]?.clientX ?? 0;
            const y = event?.clientY ?? event?.touches?.[0]?.clientY ?? 0;
            setExplorerState?.({
                isContextMenuOpen: true,
                contextMenuFile: file || null,
                contextMenuPosition: { x, y },
                activeFile: file || null,
            });
        }
        // NEW: Hide context menu
        hideContextMenu() {
            setExplorerState?.({
                isContextMenuOpen: false,
                contextMenuPosition: null,
                contextMenuFile: null,
            });
        }

        // NEW: Context menu action
        handleContextAction(file, action) {
            switch(action) {
                case 'open':
                    if (file.isDirectory) {
                        this.navigateTo(file.path);
                    }
                    break;
                    
                case 'download':
                    this.downloadFile(file.path);
                    break;
                    
                case 'print':
                    this.handlePrintRequest(file);
                    break;
                    
                case 'rename':
                    this.promptRename(file);
                    break;

                case 'delete':
                    this.deleteFile(file);
                    break;
            }
        }

        async promptRename(file) {
            if (!file?.name || !file?.path) {
                return;
            }
            const currentName = file.name;
            const newName = window.prompt('Enter new name', currentName);
            if (newName === null) {
                return;
            }
            const trimmed = (newName || '').trim();
            if (!trimmed) {
                showToast('New name cannot be empty', 'error');
                return;
            }
            if (trimmed === currentName) {
                showToast('Name must be different', 'info');
                return;
            }
            if (/[\\/]/.test(trimmed)) {
                showToast('Name cannot contain slash or backslash', 'error');
                return;
            }

            const formData = new FormData();
            formData.append('path', file.path);
            formData.append('new_name', trimmed);

            try {
                const response = await fileApi.renameFile(formData);
                const payload = await response.json().catch(() => ({}));
                const actionMessage = `${currentName} → ${trimmed}`;
                const successMessage = payload?.message
                    ? `${actionMessage} (${payload.message})`
                    : actionMessage;
                showToast(successMessage, 'success');
                this.refresh();
            } catch (error) {
                console.error('Rename failed', error);
                showToast(error?.message || 'Rename error', 'error');
            }
        }

        // Update deleteFile function
        async deleteFile(file) {
            try {
                const response = await fileApi.requestWithPrinter(
                    `/api/ftps/files/delete?path=${encodeURIComponent(file.path)}`,
                    { method: 'DELETE' }
                );
                
                if (!response.ok) {
                    throw new Error('Permission denied');
                }

                showToast(`File "${file.name}" deleted`, 'success');
                this.closeFileOptions();
                this.refresh();
                
            } catch (error) {
                showToast(`Deletion failed: ${error.message}`, 'error');
            }
        }

        navigateTo(path) {
            this.currentPath = this.normalizePath(path);
            this.refresh();
        }

        openFileOptions(file) {
            if (!this.modal.container) {
                if (fileExplorerActions?.setActiveFile) {
                    fileExplorerActions.setActiveFile(file);
                } else {
                    this.activeFile = file;
                }
                this.downloadFile(file.path);
                return;
            }

            setExplorerState?.({
                isModalOpen: true,
                activeFile: file || null,
            });
        }

        closeFileOptions() {
            setExplorerState?.({
                isModalOpen: false,
                activeFile: null,
            });
        }

        resetToHome() {
            this.hideContextMenu();
            this.closeFileOptions();
            this._lastStateStreamPrinterId = null;
            setExplorerState?.({
                currentPath: '/',
                activeFile: null,
                files: [],
                lastError: null,
                isLoading: false,
                pendingRefresh: true,
                hasLoadedOnce: false,
            });
        }

        async handlePrintRequest(file) {
            const disabledReason = this._getPrintDisabledReason();
            if (disabledReason) {
                showToast(disabledReason, 'warning');
                return;
            }
            const printerId = this.getSelectedPrinterId();
            if (!printerId) {
                showToast("Printer not selected!", "error");
                return;
            }

            const targetFile = file || this.activeFile;
            if (!targetFile) {
                showToast("No file selected!", "error");
                return;
            }

            this.closeFileOptions();
            showToast("Preparing...", "info");

            const fallbackName = targetFile.name ? `/${targetFile.name}` : '/';
            const remotePath = targetFile.path || fallbackName;

            const prepareUrl = `/api/printjob/prepare?filename=${encodeURIComponent(remotePath)}`;
            await fileApi.fetchPrinter(prepareUrl, { method: "POST" });

            this.pollPrintJobStatus(printerId, true, targetFile);
        }

        async pollPrintJobStatus(printerId, first = false, file = null) {
            try {
            const status = await fileApi.fetchPrinter('/api/printjob/status');

                if (first) {
                    const filename = file?.name || status.filename || "Preparing";
                    dispatchTransferOverlayCommand('beginDownload', {
                        options: {
                            filename,
                            totalBytes: null,
                            cancellable: true,
                            onCancel: async () => {
                                try {
                                    await fileApi.fetchPrinter('/api/printjob/cancel', { method: 'POST' });
                                } catch (err) {
                                    console.warn("Prepare cancel failed:", err);
                                }
                            },
                        },
                    });
                }

                const stepText = (status.step || "").toLowerCase();
                const downloadBytes =
                    typeof status.download_bytes === "number" ? status.download_bytes : null;
                const downloadTotal =
                    typeof status.download_total === "number" ? status.download_total : null;
                const isDownloading = stepText.includes("download") && downloadBytes !== null;

                if (isDownloading) {
                    dispatchTransferOverlayCommand('updateManualProgress', {
                        sent: downloadBytes,
                        total: downloadTotal ?? undefined,
                    });
                } else {
                    const progress = status.progress ?? 0;
                    dispatchTransferOverlayCommand('updatePercentProgress', {
                        percent: progress,
                    });
                }

                if (status.step) {
                    dispatchTransferOverlayCommand('setStatus', {
                        status: status.step,
                    });
                }

                dispatchTransferOverlayCommand('setCancellable', {
                    cancellable: Boolean(status.active && isDownloading),
                });

                if (status.status === "completed") {
                    dispatchTransferOverlayCommand('completeManual', {
                        success: true,
                        message: "Preparation complete",
                    });
                    const rawPath =
                        status.file_path ||
                        (status.metadata_result && status.metadata_result.file_path) ||
                        status.filename ||
                        "";
                    const normalizedPath = rawPath.replace(/^\/+/, "");
                    const pendingUrl = normalizedPath ? `ftp:///${normalizedPath}` : "";
                    if (components.printSetup) {
                        components.printSetup.setPendingFileURL(pendingUrl);
                        components.printSetup.open(status.metadata_result);
                    }
                    this.updateMasterTransferState({
                        type: 'print',
                        file: file?.name || status.filename || null,
                        status: 'completed',
                    });
                    return;
                }

                if (status.status === "error") {
                    dispatchTransferOverlayCommand('failCurrent', {
                        message: status.message || "Preparation error occurred",
                    });
                    showToast("❌ Error: " + (status.message || "Preparation failed"), "error");
                    return;
                }

                if (status.status === "cancelled") {
                    dispatchTransferOverlayCommand('completeManual', {
                        success: false,
                        message: status.message || "Preparation canceled",
                    });
                    showToast(status.message || "Preparation canceled.", "info");
                    return;
                }

                setTimeout(() => this.pollPrintJobStatus(printerId, false, file), 800);
            } catch (err) {
                console.error("PrintJob polling failed", err);
                dispatchTransferOverlayCommand('failCurrent', {
                    message: "Connection error or timeout",
                });
                showToast("Preparation status could not be read.", "error");
            }
        }
        async downloadFile(filePath) {
            if (!filePath) {
                return;
            }

            const overlay = getTransferOverlay();
            const downloadBtn = this.modal?.downloadBtn;
            const originalText = downloadBtn?.textContent;

            if (downloadBtn) {
                downloadBtn.disabled = true;
                downloadBtn.textContent = '⏳ Downloading...';
                downloadBtn.classList.add('loading');
            }

            let filename = filePath.split('/').pop() || 'dosya.gcode';
            const controller = new AbortController();

            try {
                const response = await fileApi.downloadFile(filePath, controller.signal);


                const contentDisposition = response.headers.get('Content-Disposition');
                if (contentDisposition) {
                    const match = contentDisposition.match(/filename="(.+?)"/);
                    if (match) filename = decodeURIComponent(match[1]);
                }

                const ext = filename.toLowerCase().split('.').pop();
                const mimeTypes = {
                    gcode: 'text/x-gcode',
                    g: 'text/x-gcode',
                    nc: 'text/x-gcode',
                    '3mf': 'model/3mf',
                    stl: 'model/stl',
                    obj: 'model/obj',
                    txt: 'text/plain',
                    json: 'application/json',
                };

                const totalHeader = response.headers.get('X-File-Size') || response.headers.get('Content-Length');
                const totalBytes = totalHeader ? Number(totalHeader) : null;

                overlay?.beginDownload({
                    filename,
                    totalBytes,
                    onCancel: () => controller.abort(),
                });

                let downloadedBlob;
                if (response.body && response.body.getReader) {
                    const reader = response.body.getReader();
                    const chunks = [];
                    let received = 0;
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                        received += value.length;
                        overlay?.updateManualProgress(received, totalBytes);
                    }
                    downloadedBlob = new Blob(chunks, {
                        type: mimeTypes[ext] || 'application/octet-stream',
                    });
                } else {
                    downloadedBlob = await response.blob();
                }

                this.saveBlob(downloadedBlob, filename);
                overlay?.completeManual(true, 'Download complete');
                showToast(`${filename} download completed.`, 'success');
            } catch (error) {
                if (error.name === 'AbortError') {
                    showToast('Download canceled', 'info');
                    overlay?.completeManual(false, 'Download canceled');
                } else {
                    console.error('Download error:', error);
                    showToast(`Download failed: ${error.message}`, 'error');
                    overlay?.failCurrent('Dowmload could not be completed');
                }
            } finally {
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = originalText || 'Download';
                    downloadBtn.classList.remove('loading');
                }
                this.closeFileOptions?.();
            }
        }

        saveBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 100);
        }

        showLoading(message = 'Loading files...') {
            const container = document.getElementById('file-list');
            if (!container) {
                return;
            }

            const icon = '<span class="loading-icon" aria-hidden="true">⏳</span>';
            const safeMessage = this.escapeHtml(message);
            container.innerHTML = `<div class="loading">${icon} ${safeMessage}</div>`;
        }

        showError(message) {
            const container = document.getElementById('file-list');
            if (!container) {
                return;
            }

            container.innerHTML = `
                <div class="empty-state">
                    <div style="font-size: 32px; margin-bottom: 12px;">&#128194;</div>
                    <p>${this.escapeHtml(message)}</p>
                    <button class="retry-btn" data-action="retry">Try Again</button>
                </div>
            `;
        }

        buildMetaText(file) {
            const parts = [];

            if (file.size && file.size !== '-' && file.size.toLowerCase() !== 'folder') {
                parts.push(file.size);
            }

            if (file.modified) {
                parts.push(file.modified);
            }

            if (file.path) {
                parts.push(file.path);
            }

            return parts.join(' • ');
        }

        getSizeLabel(file) {
            if (!file) {
                return '-';
            }

            if (file.is_directory) {
                return file.name === '..' ? 'Parent folder' : 'Folder';
            }

            if (typeof file.size === 'number' && Number.isFinite(file.size)) {
                return formatBytes(file.size);
            }

            if (typeof file.size === 'string' && file.size.trim() !== '') {
                return file.size;
            }

            return '-';
        }

        normalizePath(path) {
            if (!path || path === '') {
                return '/';
            }

            let normalized = path;
            try {
                normalized = decodeURIComponent(path);
            } catch (_error) {
                normalized = path;
            }

            normalized = normalized.trim();
            if (normalized === '') {
                return '/';
            }

            if (!normalized.startsWith('/')) {
                normalized = `/${normalized}`;
            }

            if (normalized.length > 1 && normalized.endsWith('/')) {
                normalized = normalized.replace(/\/+$/, '');
            }

            return normalized.replace(/\/{2,}/g, '/') || '/';
        }

        resolvePath(pathValue, name, isParentDir) {
            if (isParentDir) {
                return this.getParentPath(this.currentPath);
            }

            if (pathValue && typeof pathValue === 'string' && pathValue.trim() !== '') {
                return this.normalizePath(pathValue);
            }

            const base = this.currentPath === '/' ? '' : this.currentPath;
            return this.normalizePath(`${base}/${name || ''}`);
        }

        getParentPath(path) {
            const normalized = this.normalizePath(path);
            if (normalized === '/') {
                return '/';
            }

            const segments = normalized.split('/').filter(Boolean);
            segments.pop();
            return segments.length ? `/${segments.join('/')}` : '/';
        }

        getFileIcon(fileName) {
            const extension = (fileName.split('.').pop() || '').toLowerCase();
            const iconMap = {
                gcode: '🖨',
                gcodes: '🖨',
                '3mf': '🧱',
                stl: '🧩',
                txt: '📄',
                log: '📜',
                csv: '📊',
                json: '🧾',
                zip: '🗜️',
                gz: '🗜️',
                png: '🖼️',
                jpg: '🖼️',
                jpeg: '🖼️',
                bmp: '🖼️'
            };
            return iconMap[extension] || '&#128196;';
        }

        escapeHtml(text) {
            if (masterUtils.format?.escapeHtml) {
                return masterUtils.format.escapeHtml(text);
            }
            const div = document.createElement('div');
            div.textContent = text ?? '';
            return div.innerHTML;
        }

        escapeAttribute(value) {
            if (masterUtils.format?.escapeAttribute) {
                return masterUtils.format.escapeAttribute(value);
            }
            const raw = value === undefined || value === null ? '' : String(value);
            return raw
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        updateMasterTransferState(partial) {
            if (fileExplorerActions?.setTransferMeta) {
                fileExplorerActions.setTransferMeta(partial);
                return;
            }
        }
    }

    const fileExplorerInstance = new FileExplorer();
    const getExplorerInstance = () => components.fileExplorer || fileExplorerInstance;
    const bindFileExplorerEvents = () => {
        const explorer = getExplorerInstance();
        const container = document.querySelector('.file-explorer-container');
        if (container && !container.dataset.fileExplorerActionsBound) {
            container.addEventListener('click', (event) => {
                const actionEl = event.target?.closest?.('[data-file-explorer-action]');
                if (!actionEl) {
                    return;
                }
                const action = actionEl.dataset.fileExplorerAction;
                const path = actionEl.dataset.fileExplorerPath || '/';
                if (!explorer) {
                    return;
                }
                switch (action) {
                    case 'navigate':
                        explorer.navigateTo?.(path);
                        break;
                    case 'create-folder':
                        explorer.createFolder?.();
                        break;
                    case 'upload':
                        explorer.uploadFile?.();
                        break;
                    case 'refresh':
                        explorer.refresh?.();
                        break;
                    default:
                        break;
                }
            });
            container.dataset.fileExplorerActionsBound = '1';
        }
        bindFileExplorerModalEvents(explorer);
    };

    const bindFileExplorerDocumentEvents = () => {
        const explorer = getExplorerInstance();
        bindFileExplorerDocumentHandlers(explorer);
    };

    const events = appContext.events || {};
    const eventKey = events.keys?.FILE_EXPLORER || 'fileExplorer';
    if (typeof events.register === 'function') {
        events.register(eventKey, {
            component: bindFileExplorerEvents,
            document: bindFileExplorerDocumentEvents,
        });
    } else {
        events.bindFileExplorerEvents = bindFileExplorerEvents;
        events.bindFileExplorerDocumentEvents = bindFileExplorerDocumentEvents;
    }
    components.fileExplorer = fileExplorerInstance;
}

const globalProxy =
    typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : {};

let fileExplorerInitialized = false;
let fileExplorerInitScheduled = false;

const hasFileExplorerDependencies = () =>
    Boolean(
        globalProxy.document &&
            globalProxy.appContext?.stores?.core &&
            globalProxy.appContext?.services?.files?.listFiles,
    );

const scheduleFileExplorerInit = () => {
    if (fileExplorerInitScheduled) {
        return;
    }
    fileExplorerInitScheduled = true;
    const retry = () => {
        fileExplorerInitScheduled = false;
        initFileExplorer();
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(retry);
    } else {
        setTimeout(retry, 16);
    }
};

const initFileExplorer = () => {
    if (fileExplorerInitialized) {
        return globalProxy.appContext?.components?.fileExplorer || null;
    }
    if (!hasFileExplorerDependencies()) {
        scheduleFileExplorerInit();
        return null;
    }
    bootstrapFileExplorer(globalProxy);
    fileExplorerInitialized = true;
    return globalProxy.appContext?.components?.fileExplorer || null;
};

export { initFileExplorer };
export default initFileExplorer;
