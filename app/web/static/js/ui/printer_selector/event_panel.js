class PrinterEventPanel {
    constructor(options = {}) {
        const globalScope =
            typeof window !== 'undefined'
                ? window
                : typeof globalThis !== 'undefined'
                    ? globalThis
                    : {};
        const appContext = globalScope.appContext || {};
        this.panelEl = options.panelEl;
        this.backdropEl = options.backdropEl;
        this.toggleBtn = options.toggleBtn;
        this.clearBtn = options.clearBtn;
        this.closeBtn = options.closeBtn;
        this.listEl = options.listEl;
        this.appContext = appContext;
        this.actions = options.actions || appContext.actions?.eventPanel || null;
        this.apiProvider = options.apiProvider || null;
        this.store = options.store || appContext.stores?.core || null;
        this.selectors = options.selectors || appContext.selectors?.printerSelector || {};
        this.showToast = options.showToast || ((msg, type) => console.log(type, msg));
        this.setInertState =
            appContext.utils?.dom?.setInertState ||
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
        this.resolvePrinterName = options.resolvePrinterName || ((id) => id);
        this.onUnreadChange = typeof options.onUnreadChange === 'function' ? options.onUnreadChange : null;
        this.getStateLabel = typeof options.getStateLabel === 'function' ? options.getStateLabel : (value) => value;
        this.pollIntervalMs = 6000;
        this.pollTimer = null;
        this.listEventsBound = false;
        this.unsubscribe = null;
        this.lastRenderKey = '';
        this.lastPanelKey = '';
    }

    _createDateFromUtcString(value) {
        if (!value) {
            return null;
        }
        const raw = String(value).trim();
        if (!raw) {
            return null;
        }
        const hasTimezone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(raw);
        const normalized = hasTimezone ? raw : `${raw}Z`;
        const parsed = new Date(normalized);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    _getSnapshot() {
        return typeof this.store?.getState === 'function' ? this.store.getState() : {};
    }

    _getEventPanelState() {
        if (typeof this.selectors?.getEventPanelState === 'function') {
            return this.selectors.getEventPanelState(this._getSnapshot());
        }
        return this._getSnapshot()?.ui?.printerSelector?.eventPanel || {};
    }

    _getEvents() {
        if (typeof this.selectors?.getEventPanelEvents === 'function') {
            return this.selectors.getEventPanelEvents(this._getSnapshot());
        }
        return this._getEventPanelState().events || [];
    }

    _getUnreadIds() {
        if (typeof this.selectors?.getEventPanelUnreadIds === 'function') {
            return this.selectors.getEventPanelUnreadIds(this._getSnapshot());
        }
        return this._getEventPanelState().unreadIds || [];
    }

    _getExpandedIds() {
        if (typeof this.selectors?.getEventPanelExpandedIds === 'function') {
            return this.selectors.getEventPanelExpandedIds(this._getSnapshot());
        }
        return this._getEventPanelState().expandedIds || [];
    }

    _buildUnreadMap(events, unreadSet) {
        const map = {};
        events.forEach((event) => {
            if (unreadSet.has(event.id)) {
                map[event.printer_id] = true;
            }
        });
        return map;
    }

    start() {
        this.refreshEvents();
        this.startPolling();
        this.bindListEvents();
        this.subscribeToStore();
        this.renderPanelState(this._getSnapshot());
        this.renderEvents();
    }

    getApi() {
        const liveActions =
            this.actions ||
            this.appContext?.actions?.eventPanel ||
            this.appContext?.actionsByModule?.eventPanel?.eventPanel;
        if (liveActions) {
            return liveActions;
        }
        if (typeof this.apiProvider === 'function') {
            return this.apiProvider();
        }
        return this.apiProvider || null;
    }

    startPolling() {
        if (this.pollTimer) {
            return;
        }
        this.pollTimer = setInterval(() => this.refreshEvents(), this.pollIntervalMs);
    }

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    subscribeToStore() {
        if (this.unsubscribe || typeof this.store?.subscribe !== 'function') {
            return;
        }
        this.unsubscribe = this.store.subscribe((snapshot) => {
            const panelState = snapshot?.ui?.printerSelector?.eventPanel || {};
            const events = panelState.events || [];
            const unreadIds = panelState.unreadIds || [];
            const expandedIds = panelState.expandedIds || [];
            const isLoading = panelState.isLoading ? '1' : '0';
            this.renderPanelState(snapshot);
            const key = [
                events.map((event) => event.id).join(','),
                unreadIds.join(','),
                expandedIds.join(','),
                isLoading,
            ].join('|');
            if (key !== this.lastRenderKey) {
                this.lastRenderKey = key;
                this.renderEvents();
            }
        });
    }

    renderPanelState(snapshot = this._getSnapshot()) {
        const panelState = snapshot?.ui?.printerSelector?.eventPanel || {};
        const isOpen = Boolean(panelState.isOpen);
        const key = isOpen ? '1' : '0';
        if (key === this.lastPanelKey) {
            return;
        }
        this.lastPanelKey = key;
        if (this.panelEl) {
            this.panelEl.classList.toggle('is-open', isOpen);
            this.setInertState(this.panelEl, isOpen);
        }
        if (this.backdropEl) {
            this.backdropEl.classList.toggle('is-visible', isOpen);
            this.setInertState(this.backdropEl, isOpen);
        }
    }

    async refreshEvents() {
        const api = this.getApi();
        if (!api?.fetchEvents) {
            return;
        }
        try {
            const result = await api.fetchEvents();
            const newEvents = result?.newEvents || [];
            newEvents.forEach((event) => {
                const printerName = this.resolvePrinterName(event.printer_id);
                this.showToast(`${printerName}: ${event.message}`, 'info');
            });
            if (result?.unreadByPrinter) {
                this.emitUnreadChange(result.unreadByPrinter);
            }
        } catch (error) {
            console.error('Failed to fetch events', error);
        }
    }

    renderEvents() {
        if (!this.listEl) {
            return;
        }
        this.listEl.innerHTML = '';
        const events = this._getEvents();
        const unreadIds = new Set(this._getUnreadIds());
        const expandedIds = new Set(this._getExpandedIds());
        if (!events.length) {
            const empty = document.createElement('div');
            empty.className = 'event-list-empty';
            empty.textContent = 'No events yet.';
            this.listEl.appendChild(empty);
            return;
        }
        events.forEach((event) => {
            const card = document.createElement('div');
            card.className = 'event-card';
            const isUnread = unreadIds.has(event.id);
            if (isUnread) {
                card.classList.add('is-unread');
            }

            const details = [
                `Status: ${this.getStateLabel(event.gcode_state)}`,
                event.layer ? `Layer: ${event.layer}` : null,
                Number.isFinite(event.percent) ? `Progress: ${event.percent}%` : null,
                event.remaining_time ? `Remaining: ${event.remaining_time} min` : null,
                event.finish_time ? `Finish: ${event.finish_time}` : null,
                event.speed_level !== undefined && event.speed_level !== null
                    ? `Speed: ${event.speed_level}`
                    : null,
                event.file ? `File: ${event.file}` : null,
            ].filter(Boolean);
            const detailsContainer = document.createElement('div');
            const isExpanded = expandedIds.has(event.id);
            detailsContainer.className = isExpanded
                ? 'event-card-details is-expanded'
                : 'event-card-details is-collapsed';
            const detailsInner = document.createElement('div');
            detailsInner.className = 'event-card-details-list';
            details.forEach((line) => {
                const div = document.createElement('div');
                div.textContent = line;
                detailsInner.appendChild(div);
            });
            detailsContainer.appendChild(detailsInner);

            const header = document.createElement('div');
            header.className = 'event-card-header';
            const headerInfo = document.createElement('div');
            headerInfo.className = 'event-card-header-info';
            const title = document.createElement('span');
            title.className = 'event-card-header-title';
            title.textContent = this.resolvePrinterName(event.printer_id);
            const ts = this._createDateFromUtcString(event.created_at);
            const meta = document.createElement('div');
            meta.className = 'event-card-header-meta';
            const timeText = ts
                ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '-';
            const dateText = ts
                ? ts.toLocaleDateString('tr-TR', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                })
                : '';
            meta.textContent = dateText ? `${timeText} · ${dateText}` : timeText;
            headerInfo.appendChild(title);
            headerInfo.appendChild(meta);
            header.appendChild(headerInfo);

            const headerActions = document.createElement('div');
            headerActions.className = 'event-card-header-actions';
            const toggleDetails = document.createElement('button');
            toggleDetails.type = 'button';
            toggleDetails.className = 'event-card-details-toggle';
            toggleDetails.setAttribute('aria-expanded', String(isExpanded));
            toggleDetails.innerHTML = isExpanded ? '&#9652;' : '&#9662;';
            headerActions.appendChild(toggleDetails);

            if (!isUnread) {
                const action = document.createElement('button');
                action.type = 'button';
                action.className = 'event-card-action';
                action.innerHTML = '&#10003;';
                action.addEventListener('click', (eventObj) => {
                    eventObj.stopPropagation();
                    this.markEventRead(event.id);
                });
                headerActions.appendChild(action);
            }
            header.appendChild(headerActions);

            const message = document.createElement('p');
            message.className = 'event-card-message';
            message.textContent = event.message;

            card.appendChild(header);
            card.appendChild(message);
            card.appendChild(detailsContainer);
            card.dataset.eventId = event.id;
            this.listEl.appendChild(card);
        });
    }

    async clearEvents() {
        const api = this.getApi();
        if (!api?.clearEvents) {
            return;
        }
        try {
            const result = await api.clearEvents();
            this.showToast('Events cleared', 'success');
            this.emitUnreadChange(result?.unreadByPrinter || {});
        } catch (error) {
            console.error('Failed to clear events', error);
            this.showToast('Failed to clear events', 'error');
        }
    }

    togglePanel() {
        const isOpen = Boolean(this._getEventPanelState()?.isOpen);
        if (this.actions?.setOpen) {
            this.actions.setOpen(!isOpen);
        }
    }

    openPanel() {
        if (this.actions?.setOpen) {
            this.actions.setOpen(true);
        }
    }

    closePanel() {
        if (this.actions?.setOpen) {
            this.actions.setOpen(false);
        }
    }

    markEventRead(eventId) {
        if (!eventId) {
            return;
        }
        const result = this.actions?.markEventRead?.(eventId);
        this.emitUnreadChange(result?.unreadByPrinter || null);
    }

    markAllRead(printerId = null) {
        const result = this.actions?.markAllRead?.(printerId);
        this.emitUnreadChange(result?.unreadByPrinter || null);
    }

    emitUnreadChange(unreadByPrinter = null) {
        if (this.onUnreadChange) {
            const map = unreadByPrinter || this._buildUnreadMap(this._getEvents(), new Set(this._getUnreadIds()));
            this.onUnreadChange({
                unreadByPrinter: map,
                hasUnread: Object.keys(map).length > 0,
            });
        }
    }

    bindListEvents() {
        if (!this.listEl || this.listEventsBound) {
            return;
        }
        this.listEventsBound = true;
        this.listEl.addEventListener('click', (event) => {
            const target = event.target;
            const card = target.closest('.event-card');
            if (!card) {
                return;
            }
            const eventId = card.dataset.eventId;
            if (target.closest('.event-card-details-toggle')) {
                event.stopPropagation();
                if (this.actions?.toggleExpanded) {
                    this.actions.toggleExpanded(eventId);
                }
                return;
            }
            if (target.closest('.event-card-action')) {
                event.stopPropagation();
                this.markEventRead(eventId);
                return;
            }
            this.markEventRead(eventId);
        });
    }
}

const bindPrinterEventPanelEvents = (panel) => {
    if (!panel) {
        return;
    }
    if (panel.toggleBtn) {
        panel.toggleBtn.addEventListener('click', () => panel.togglePanel());
    }
    if (panel.backdropEl) {
        panel.backdropEl.addEventListener('click', () => panel.closePanel());
    }
    if (panel.closeBtn) {
        panel.closeBtn.addEventListener('click', () => panel.closePanel());
    }
    if (panel.clearBtn) {
        panel.clearBtn.addEventListener('click', () => panel.clearEvents());
    }
};

export { PrinterEventPanel, bindPrinterEventPanelEvents };
export default PrinterEventPanel;
