import { ensureAppContext, registerActionModule } from './registry.js';
import { applyStatusPayload } from '../domain/status_payload.js';

const initActions = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const context = ensureAppContext(global);
    const store = context.stores?.core || null;
    const components = context.components || {};
    const services = context.services || {};

    const api = services.api || null;
    const statusService = services.status || null;
    const controlService = services.controls || null;
    const filamentService = services.filaments || null;
    const printerService = services.printers || null;
    const fileService = services.files || null;

    const statusPanel = {
        async refreshStatus() {
            if (!store) {
                return;
            }
            if (!statusService?.fetchStatus && !api?.fetchWithPrinter) {
                throw new Error('API client unavailable');
            }
            const payload = statusService?.fetchStatus
                ? await statusService.fetchStatus()
                : await api.fetchWithPrinter('/api/status');
            applyStatusPayload(store, payload);
            if (components.printSetup) {
                if (typeof components.printSetup.buildAmsMappingUI === 'function') {
                    components.printSetup.buildAmsMappingUI();
                }
                if (typeof components.printSetup.refreshPrinterStatus === 'function') {
                    components.printSetup.refreshPrinterStatus();
                }
            }
        },
        async toggleFeature(payload) {
            if (statusService?.toggleFeature) {
                return statusService.toggleFeature(payload);
            }
            throw new Error('API client unavailable');
        },
        async triggerAmsCommand(payload) {
            if (statusService?.triggerAmsCommand) {
                return statusService.triggerAmsCommand(payload);
            }
            throw new Error('API client unavailable');
        },
        async setAmsMaterial(payload) {
            if (statusService?.setAmsMaterial) {
                return statusService.setAmsMaterial(payload);
            }
            throw new Error('API client unavailable');
        },
        async toggleChamberLight(mode) {
            if (statusService?.toggleChamberLight) {
                return statusService.toggleChamberLight(mode);
            }
            throw new Error('API client unavailable');
        },
        async setNozzleAccessory(payload) {
            if (statusService?.setNozzleAccessory) {
                return statusService.setNozzleAccessory(payload);
            }
            throw new Error('API client unavailable');
        },
    };

    const stateStream = {
        applySnapshot(snapshot) {
            if (!store || typeof store.applyStateSnapshot !== 'function') {
                return;
            }
            store.applyStateSnapshot(snapshot);
        },
        applyDiff(changes) {
            if (!store || typeof store.applyStateDiff !== 'function') {
                return;
            }
            store.applyStateDiff(changes || {});
        },
    };

    const controls = {
        async postCommand(payload) {
            if (controlService?.postCommand) {
                return controlService.postCommand(payload);
            }
            throw new Error('API client unavailable');
        },
        async setChamberLight(mode) {
            if (controlService?.setChamberLight) {
                return controlService.setChamberLight(mode);
            }
            throw new Error('API client unavailable');
        },
        async skipObjects(objList, sequenceId = '0') {
            if (controlService?.skipObjects) {
                return controlService.skipObjects(objList, sequenceId);
            }
            throw new Error('API client unavailable');
        },
        setUiState(partial = {}) {
            if (!store || typeof store.setControlsUiState !== 'function') {
                return;
            }
            if (!partial || typeof partial !== 'object') {
                return;
            }
            store.setControlsUiState(partial);
        },
        setBaseValue(key, value) {
            if (!store || typeof store.setControlsBaseValue !== 'function') {
                return;
            }
            store.setControlsBaseValue(key, value);
        },
        setPendingValue(key, value, ttlMs) {
            if (!store || typeof store.setControlsPendingValue !== 'function') {
                return;
            }
            store.setControlsPendingValue(key, value, ttlMs);
        },
        clearPending(key) {
            if (!store || typeof store.clearControlsPending !== 'function') {
                return;
            }
            store.clearControlsPending(key);
        },
        mirrorPrintControlState(status, action) {
            if (!store || typeof store.setState !== 'function') {
                return;
            }
            const nextState = {
                status,
                action,
                printerId: store.getState?.().selectedPrinterId || api?.getActivePrinterId?.() || null,
                updatedAt: new Date().toISOString(),
            };
            if (typeof store.update === 'function') {
                store.update('printControlState', () => nextState);
                return;
            }
            store.setState({ printControlState: nextState });
        },
    };

    const printerSelector = {
        async fetchPrinters() {
            if (printerService?.fetchPrinters) {
                return printerService.fetchPrinters();
            }
            throw new Error('API client unavailable');
        },
        async request(path, options = {}) {
            if (printerService?.request) {
                return printerService.request(path, options);
            }
            throw new Error('API client unavailable');
        },
        setUiState(partial = {}) {
            if (!store || typeof store.setPrinterSelectorState !== 'function') {
                return;
            }
            if (!partial || typeof partial !== 'object') {
                return;
            }
            store.setPrinterSelectorState(partial);
        },
        setPrinters(printers) {
            if (!store || typeof store.setPrinterSelectorState !== 'function') {
                return;
            }
            store.setPrinterSelectorState({
                printers: Array.isArray(printers) ? printers : [],
            });
        },
        setSelectedPrinter(printerId, printer) {
            if (!store || typeof store.setState !== 'function') {
                return;
            }
            const currentState = store.getState?.() || {};
            const currentId = currentState.currentPrinterId || currentState.selectedPrinterId || null;
            const fileExplorerState = currentState.ui?.fileExplorer || {};
            const shouldRefresh =
                Boolean(printerId) &&
                (printerId !== currentId ||
                    (!fileExplorerState.hasLoadedOnce && !fileExplorerState.pendingRefresh));
            store.setState({
                currentPrinterId: printerId || null,
                currentPrinter: printer || null,
                selectedPrinterId: printerId || null,
                ui: {
                    ...(currentState.ui || {}),
                    fileExplorer: {
                        ...fileExplorerState,
                        pendingRefresh: shouldRefresh ? true : fileExplorerState.pendingRefresh,
                    },
                },
            });
        },
        setServerOffline(isOffline) {
            if (!store || typeof store.setServerOffline !== 'function') {
                return;
            }
            store.setServerOffline(Boolean(isOffline));
        },
        async getEvents(params = {}) {
            if (printerService?.getEvents) {
                return printerService.getEvents(params);
            }
            throw new Error('API client unavailable');
        },
        async clearEvents(params = {}) {
            if (printerService?.clearEvents) {
                return printerService.clearEvents(params);
            }
            throw new Error('API client unavailable');
        },
    };

    const getEventPanelState = () => store?.getState?.().ui?.printerSelector?.eventPanel || {};
    const setEventPanelState = (partial) => {
        if (!store || typeof store.setPrinterSelectorState !== 'function' || !partial) {
            return;
        }
        const current = getEventPanelState();
        store.setPrinterSelectorState({
            eventPanel: {
                ...current,
                ...partial,
            },
        });
    };
    const setPrinterUnreadMap = (unreadByPrinter) => {
        if (!store || typeof store.setPrinterSelectorState !== 'function') {
            return;
        }
        store.setPrinterSelectorState({
            printerUnreadMap: unreadByPrinter || {},
        });
    };
    const buildUnreadMap = (events, unreadSet) => {
        const map = {};
        (events || []).forEach((event) => {
            if (unreadSet.has(event.id)) {
                map[event.printer_id] = true;
            }
        });
        return map;
    };

    const eventPanel = {
        async fetchEvents(params = {}) {
            if (!printerService?.getEvents) {
                throw new Error('API client unavailable');
            }
            setEventPanelState({ isLoading: true });
            try {
                const payload = await printerService.getEvents({ limit: 50, ...params });
                const events = Array.isArray(payload?.events) ? payload.events : [];
                const current = getEventPanelState();
                const previousSeen = new Set(current.seenEventIds || []);
                const unreadSet = new Set(current.unreadIds || []);
                const ids = new Set(events.map((event) => event.id));
                const wasSynced = Boolean(current.synced);
                const newEvents = wasSynced
                    ? events.filter((event) => !previousSeen.has(event.id))
                    : [];
                newEvents.forEach((event) => unreadSet.add(event.id));
                Array.from(unreadSet).forEach((id) => {
                    if (!ids.has(id)) {
                        unreadSet.delete(id);
                    }
                });
                setEventPanelState({
                    events,
                    seenEventIds: Array.from(ids),
                    unreadIds: Array.from(unreadSet),
                    synced: true,
                    lastFetchedAt: new Date().toISOString(),
                });
                const unreadByPrinter = buildUnreadMap(events, unreadSet);
                setPrinterUnreadMap(unreadByPrinter);
                return {
                    events,
                    newEvents,
                    unreadByPrinter,
                };
            } finally {
                setEventPanelState({ isLoading: false });
            }
        },
        async clearEvents() {
            if (!printerService?.clearEvents) {
                throw new Error('API client unavailable');
            }
            await printerService.clearEvents();
            setEventPanelState({
                events: [],
                seenEventIds: [],
                unreadIds: [],
                expandedIds: [],
                synced: false,
            });
            setPrinterUnreadMap({});
            return { unreadByPrinter: {} };
        },
        markEventRead(eventId) {
            if (!eventId) {
                return { unreadByPrinter: buildUnreadMap(getEventPanelState().events || [], new Set(getEventPanelState().unreadIds || [])) };
            }
            const current = getEventPanelState();
            const unreadSet = new Set(current.unreadIds || []);
            if (!unreadSet.has(eventId)) {
                return { unreadByPrinter: buildUnreadMap(current.events || [], unreadSet) };
            }
            unreadSet.delete(eventId);
            setEventPanelState({ unreadIds: Array.from(unreadSet) });
            const unreadByPrinter = buildUnreadMap(current.events || [], unreadSet);
            setPrinterUnreadMap(unreadByPrinter);
            return { unreadByPrinter };
        },
        markAllRead(printerId = null) {
            const current = getEventPanelState();
            const events = current.events || [];
            if (!events.length) {
                return { unreadByPrinter: buildUnreadMap(events, new Set(current.unreadIds || [])) };
            }
            const unreadSet = new Set(current.unreadIds || []);
            events.forEach((event) => {
                if (printerId && event.printer_id !== printerId) {
                    return;
                }
                unreadSet.delete(event.id);
            });
            setEventPanelState({ unreadIds: Array.from(unreadSet) });
            const unreadByPrinter = buildUnreadMap(events, unreadSet);
            setPrinterUnreadMap(unreadByPrinter);
            return { unreadByPrinter };
        },
        toggleExpanded(eventId) {
            if (!eventId) {
                return;
            }
            const current = getEventPanelState();
            const expandedSet = new Set(current.expandedIds || []);
            if (expandedSet.has(eventId)) {
                expandedSet.delete(eventId);
            } else {
                expandedSet.add(eventId);
            }
            setEventPanelState({ expandedIds: Array.from(expandedSet) });
        },
        setOpen(isOpen) {
            setEventPanelState({ isOpen: Boolean(isOpen) });
        },
    };

    let fileExplorerRequestId = 0;
    let fileExplorerController = null;
    let fileExplorerRefreshInFlight = false;

    const fileExplorer = {
        setState(partial = {}) {
            if (!store || typeof store.setFileExplorerState !== 'function') {
                return;
            }
            if (!partial || typeof partial !== 'object') {
                return;
            }
            store.setFileExplorerState(partial);
        },
        getState() {
            return store?.getState?.().ui?.fileExplorer || {};
        },
        async loadFiles(path, options = {}) {
            const currentPath = path || '/';
            if (!fileService?.listFiles) {
                this.setState({ isLoading: false, lastError: 'File service unavailable.' });
                throw new Error('File service unavailable.');
            }
            fileExplorerRequestId += 1;
            const requestId = fileExplorerRequestId;
            if (fileExplorerController) {
                fileExplorerController.abort();
            }
            fileExplorerController = new AbortController();
            const { signal } = fileExplorerController;
            const timeoutMs =
                Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
                    ? options.timeoutMs
                    : 10000;
            const timeoutId = setTimeout(() => fileExplorerController?.abort(), timeoutMs);
            if (options.signal) {
                if (options.signal.aborted) {
                    fileExplorerController.abort();
                } else {
                    options.signal.addEventListener(
                        'abort',
                        () => fileExplorerController?.abort(),
                        { once: true },
                    );
                }
            }
            this.setState({
                isLoading: true,
                lastError: null,
                currentPath,
                pendingRefresh: false,
            });
            try {
                const payload = await fileService.listFiles(
                    `/api/ftps/files?path=${encodeURIComponent(currentPath)}`,
                    { ...options, signal },
                );
                if (requestId !== fileExplorerRequestId) {
                    return { stale: true };
                }
                const nextPath = payload?.current_path || currentPath;
                const files = Array.isArray(payload?.files) ? payload.files : [];
                const isFallback = payload?.is_connected === false && payload?.is_fallback;
                const currentState = this.getState() || {};
                const displayFiles = isFallback ? currentState.files || [] : files;
                const hasLoadedOnce = Boolean(currentState.hasLoadedOnce) || !isFallback;
                this.setState({
                    currentPath: nextPath,
                    files: displayFiles,
                    isLoading: false,
                    lastError: null,
                    pendingRefresh: Boolean(isFallback),
                    pendingRefreshReason: isFallback ? 'fallback' : null,
                    hasLoadedOnce,
                });
                return {
                    payload,
                    files: displayFiles,
                    currentPath: nextPath,
                    isFallback,
                };
            } catch (error) {
                if (requestId !== fileExplorerRequestId) {
                    return { stale: true };
                }
                const message =
                    error?.name === 'AbortError'
                        ? 'File loading timed out. Please try again.'
                        : error?.message || 'Files could not be loaded';
                this.setState({
                    isLoading: false,
                    lastError: message,
                    pendingRefresh: false,
                    pendingRefreshReason: null,
                });
                throw error;
            } finally {
                clearTimeout(timeoutId);
            }
        },
        async requestRefresh(path, options = {}) {
            const currentState = this.getState() || {};
            const snapshot = store?.getState?.() || {};
            const ftpStatus = snapshot.ftpStatus || 'disconnected';
            const selectedPrinterId =
                snapshot.selectedPrinterId ||
                snapshot.currentPrinterId ||
                snapshot.currentPrinter?.id ||
                null;
            const statusPrinterId = snapshot.lastStatusPrinterId || null;
            const currentPath = path || currentState.currentPath || '/';

            if (!selectedPrinterId) {
                this.setState({
                    isLoading: false,
                    lastError: 'Select a printer first to load the file list.',
                    pendingRefresh: false,
                    pendingRefreshReason: null,
                });
                return { skipped: true, reason: 'no_printer' };
            }

            if (ftpStatus !== 'connected' || statusPrinterId !== selectedPrinterId) {
                this.setState({
                    currentPath,
                    isLoading: false,
                    lastError: null,
                    pendingRefresh: true,
                    pendingRefreshReason: 'ftp',
                });
                return {
                    pending: true,
                    reason: ftpStatus !== 'connected' ? 'ftp_disconnected' : 'status_mismatch',
                };
            }

            if (currentState.isLoading || fileExplorerRefreshInFlight) {
                if (currentState.pendingRefresh) {
                    this.setState({ pendingRefresh: false, pendingRefreshReason: null });
                }
                return { skipped: true, reason: 'loading' };
            }

            fileExplorerRefreshInFlight = true;
            if (currentState.pendingRefresh) {
                this.setState({ pendingRefresh: false, pendingRefreshReason: null });
            }
            try {
                return await this.loadFiles(currentPath, options);
            } finally {
                fileExplorerRefreshInFlight = false;
            }
        },
        async listFiles(path, options = {}) {
            if (fileService?.listFiles) {
                return fileService.listFiles(path, options);
            }
            throw new Error('API client unavailable');
        },
        async fetchPrinter(path, options = {}) {
            if (fileService?.fetchPrinter) {
                return fileService.fetchPrinter(path, options);
            }
            throw new Error('API client unavailable');
        },
        async requestWithPrinter(path, options = {}) {
            if (fileService?.requestWithPrinter) {
                return fileService.requestWithPrinter(path, options);
            }
            throw new Error('API client unavailable');
        },
        async createFolder(formData) {
            if (fileService?.createFolder) {
                return fileService.createFolder(formData);
            }
            throw new Error('API client unavailable');
        },
        async renameFile(formData) {
            if (fileService?.renameFile) {
                return fileService.renameFile(formData);
            }
            throw new Error('API client unavailable');
        },
        uploadFile(formData, handlers = {}) {
            if (fileService?.uploadFile) {
                return fileService.uploadFile(formData, handlers);
            }
            throw new Error('API client unavailable');
        },
        async cancelUpload() {
            if (fileService?.cancelUpload) {
                return fileService.cancelUpload();
            }
            throw new Error('API client unavailable');
        },
        async downloadFile(filePath, signal) {
            if (fileService?.downloadFile) {
                return fileService.downloadFile(filePath, signal);
            }
            throw new Error('API client unavailable');
        },
        setActiveFile(file) {
            this.setState({ activeFile: file || null });
        },
        setContextMenuOpen(isOpen) {
            this.setState({ isContextMenuOpen: Boolean(isOpen) });
        },
        setTransferMeta(partial = {}) {
            if (!store || typeof store.setState !== 'function' || !partial) {
                return;
            }
            if (typeof store.update === 'function') {
                store.update('transfer', (current) => ({
                    ...(current || {}),
                    ...partial,
                }));
                return;
            }
            const currentState = typeof store.getState === 'function' ? store.getState() : {};
            const existing = currentState?.transfer || {};
            store.setState({
                transfer: {
                    ...existing,
                    ...partial,
                },
            });
        },
    };

    const transferOverlay = {
        setState(partial = {}) {
            if (!store || typeof store.setTransferOverlayUiState !== 'function') {
                return;
            }
            if (!partial || typeof partial !== 'object') {
                return;
            }
            store.setTransferOverlayUiState(partial);
        },
        getState() {
            return store?.getState?.().ui?.transferOverlay || {};
        },
        beginUpload({ filename, totalBytes, statusText, cancellable = true } = {}) {
            this.setState({
                isVisible: true,
                mode: 'upload',
                filename: filename || null,
                statusText: statusText || 'Preparing file...',
                isCancellable: Boolean(cancellable),
                progress: {
                    sent: 0,
                    total: Number.isFinite(totalBytes) ? Number(totalBytes) : null,
                    percent: 0,
                    indeterminate: !Number.isFinite(totalBytes),
                },
                speedBps: null,
                etaSeconds: null,
                error: null,
            });
        },
        beginDownload({ filename, totalBytes, statusText, cancellable = true } = {}) {
            this.setState({
                isVisible: true,
                mode: 'download',
                filename: filename || null,
                statusText: statusText || 'Downloading...',
                isCancellable: Boolean(cancellable),
                progress: {
                    sent: 0,
                    total: Number.isFinite(totalBytes) ? Number(totalBytes) : null,
                    percent: 0,
                    indeterminate: !Number.isFinite(totalBytes),
                },
                speedBps: null,
                etaSeconds: null,
                error: null,
            });
        },
        updateManualProgress({ sent, total, speedBps, etaSeconds, statusText } = {}) {
            this.setState({
                statusText: statusText || undefined,
                progress: {
                    sent: Number.isFinite(sent) ? Number(sent) : 0,
                    total: Number.isFinite(total) ? Number(total) : null,
                    percent: Number.isFinite(sent) && Number.isFinite(total) && total > 0
                        ? Math.min(Math.round((sent / total) * 100), 100)
                        : 0,
                    indeterminate: !Number.isFinite(total),
                },
                speedBps: Number.isFinite(speedBps) ? Number(speedBps) : null,
                etaSeconds: Number.isFinite(etaSeconds) ? Number(etaSeconds) : null,
            });
        },
        updatePercentProgress({ percent, statusText } = {}) {
            const safePercent = Math.max(0, Math.min(Number(percent) || 0, 100));
            this.setState({
                statusText: statusText || undefined,
                progress: {
                    sent: 0,
                    total: null,
                    percent: safePercent,
                    indeterminate: false,
                },
                speedBps: null,
                etaSeconds: null,
            });
        },
        setStatus(statusText) {
            this.setState({ statusText: statusText || '' });
        },
        setCancellable(cancellable) {
            this.setState({ isCancellable: Boolean(cancellable) });
        },
        completeManual(success, message) {
            this.setState({
                statusText: message || (success ? 'Operation completed' : 'Operation failed'),
                error: success ? null : message || 'Operation failed',
            });
        },
        failCurrent(message) {
            this.setState({
                statusText: message || 'Operation could not be completed',
                error: message || 'Operation could not be completed',
            });
        },
        hideOverlay() {
            this.setState({
                isVisible: false,
                mode: null,
                filename: null,
                statusText: '',
                progress: {
                    sent: 0,
                    total: null,
                    percent: 0,
                    indeterminate: false,
                },
                speedBps: null,
                etaSeconds: null,
                isCancellable: false,
                error: null,
            });
        },
    };

    const printSetup = {
        setState(partial = {}) {
            if (!store || typeof store.setPrintSetupUiState !== 'function') {
                return;
            }
            if (!partial || typeof partial !== 'object') {
                return;
            }
            store.setPrintSetupUiState(partial);
        },
        getState() {
            return store?.getState?.().ui?.printSetup || {};
        },
        async requestWithPrinter(path, options = {}) {
            if (api?.request) {
                return api.request(path, options);
            }
            throw new Error('API client unavailable');
        },
        async executePrint(payload) {
            if (api?.request) {
                return api.request('/api/printjob/execute', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            throw new Error('API client unavailable');
        },
    };

    const filamentCatalog = {
        async refreshCatalog() {
            if (!store || typeof store.setFilamentCatalog !== 'function') {
                return;
            }
            if (!filamentService?.fetchCatalog) {
                throw new Error('API client unavailable');
            }
            try {
                const payload = await filamentService.fetchCatalog();
                store.setFilamentCatalog(payload);
            } catch (error) {
                console.error('Failed to fetch filament catalog', error);
            }
        },
        async fetchCustomCandidates() {
            if (!filamentService?.fetchCustomCandidates) {
                throw new Error('API client unavailable');
            }
            return filamentService.fetchCustomCandidates();
        },
        async fetchCustomFilaments() {
            if (!filamentService?.fetchCustomFilaments) {
                throw new Error('API client unavailable');
            }
            return filamentService.fetchCustomFilaments();
        },
        async saveCustomFilament(payload) {
            if (!filamentService?.saveCustomFilament) {
                throw new Error('API client unavailable');
            }
            return filamentService.saveCustomFilament(payload);
        },
        async deleteCustomFilament(trayInfoIdx) {
            if (!filamentService?.deleteCustomFilament) {
                throw new Error('API client unavailable');
            }
            return filamentService.deleteCustomFilament(trayInfoIdx);
        },
    };

    const ui = {
        setModalGate(active) {
            if (!store || typeof store.setModalGateUiState !== 'function') {
                return;
            }
            store.setModalGateUiState({
                active: active || null,
                updatedAt: new Date().toISOString(),
            });
        },
        clearModalGate(active) {
            if (!store || typeof store.setModalGateUiState !== 'function') {
                return;
            }
            if (!active) {
                store.setModalGateUiState({ active: null, updatedAt: new Date().toISOString() });
                return;
            }
            const current = store.getState?.().ui?.modalGate?.active || null;
            if (current === active) {
                store.setModalGateUiState({ active: null, updatedAt: new Date().toISOString() });
            }
        },
    };

    registerActionModule(global, 'statusPanel', { statusPanel });
    registerActionModule(global, 'stateStream', { stateStream });
    registerActionModule(global, 'controls', { controls });
    registerActionModule(global, 'printerSelector', { printerSelector });
    registerActionModule(global, 'eventPanel', { eventPanel });
    registerActionModule(global, 'fileExplorer', { fileExplorer });
    registerActionModule(global, 'transferOverlay', { transferOverlay });
    registerActionModule(global, 'printSetup', { printSetup });
    registerActionModule(global, 'filamentCatalog', { filamentCatalog });
    registerActionModule(global, 'ui', { ui });

    return context.actions;
};

export { initActions };
export default initActions;
