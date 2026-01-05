let transferOverlayInitialized = false;
let transferOverlayInstance = null;

const initTransferOverlay = (global = typeof window !== 'undefined' ? window : globalThis) => {
	if (transferOverlayInitialized) {
		return transferOverlayInstance;
	}
	transferOverlayInitialized = true;
	const appContext = global.appContext || (global.appContext = {});
	appContext.components = appContext.components || {};
	const components = appContext.components;
	const masterStore = appContext.stores?.core ?? null;
	const transferActions = appContext.actions?.transferOverlay || null;
	const apiService = appContext.services?.api ?? null;
	const masterApi = apiService || null;
	const masterUtils = appContext.utils ?? {};
	const getSnapshot = () =>
		typeof masterStore?.getState === "function" ? masterStore.getState() : {};
	const setTransferState = (partial = {}) => {
		if (transferActions?.setState) {
			transferActions.setState(partial);
			return;
		}
		masterStore?.setTransferOverlayUiState?.(partial);
	};
	const requestWithPrinter = (path, options = {}) => {
		if (masterApi?.request) {
			return masterApi.request(path, options);
		}
		return Promise.reject(new Error('API client unavailable'));
	};
	const fetchJson = (path, options = {}) => {
		if (masterApi?.fetchWithPrinter) {
			return masterApi.fetchWithPrinter(path, options);
		}
		return Promise.reject(new Error('API client unavailable'));
	};
	const showToast =
		masterUtils.dom?.showToast || ((message, type) => console.log(type ?? 'info', message));
	const formatBytesHelper = masterUtils.format?.formatBytes;

	class TransferOverlay {
		constructor() {
			this.overlay = null;
			this.fileNameEl = null;
			this.statusTextEl = null;
			this.progressFillEl = null;
			this.progressPercentEl = null;
			this.progressCountEl = null;
			this.speedEl = null;
			this.etaEl = null;
			this.cancelBtn = null;

			this.pollTimer = null;
			this.pollInFlight = false;
			this.totalBytes = null;
			this.onCancel = null;
			this.manualStart = 0;
			this.manualLastUpdate = 0;
			this.manualLastBytes = 0;
			this.cancelInFlight = false;
			this.cancelRequested = false;
			this.clientUploadInProgress = false;
			this.lastCompletedUploadGeneration = 0;
			this.sessionExpectedGeneration = null;
			this.sessionGeneration = null;
			this.sessionStartTime = 0;
			this._unsubscribe = null;
			this._lastRenderKey = '';
			this._lastVisible = false;
			this._hideTimer = null;
		}

		mount() {
			this.overlay = document.getElementById("transfer-overlay");
			if (!this.overlay) {
				return;
			}
			this.overlay.setAttribute("aria-hidden", this.overlay.getAttribute("aria-hidden") ?? "true");
			this.overlay.setAttribute("inert", "true");
			this.fileNameEl = document.getElementById("transfer-file-name");
			this.statusTextEl = document.getElementById("transfer-status-text");
			this.progressFillEl = document.getElementById("transfer-progress-fill");
			this.progressPercentEl = document.getElementById("transfer-progress-percent");
			this.progressCountEl = document.getElementById("transfer-progress-count");
			this.speedEl = document.getElementById("transfer-speed");
			this.etaEl = document.getElementById("transfer-eta");
			this.cancelBtn = document.getElementById("transfer-cancel-btn");
		}

		subscribeToStore() {
			if (!masterStore || typeof masterStore.subscribe !== "function" || this._unsubscribe) {
				return;
			}
			this._unsubscribe = masterStore.subscribe((snapshot) => {
				const uiState = snapshot?.ui?.transferOverlay || {};
				const progress = uiState.progress || {};
				const key = [
					uiState.isVisible ? "1" : "0",
					uiState.mode || "",
					uiState.filename || "",
					uiState.statusText || "",
					Number.isFinite(progress.sent) ? progress.sent : "",
					Number.isFinite(progress.total) ? progress.total : "",
					Number.isFinite(progress.percent) ? progress.percent : "",
					progress.indeterminate ? "1" : "0",
					Number.isFinite(uiState.speedBps) ? uiState.speedBps : "",
					Number.isFinite(uiState.etaSeconds) ? uiState.etaSeconds : "",
					uiState.isCancellable ? "1" : "0",
					uiState.error || "",
				].join("|");
				if (key !== this._lastRenderKey) {
					this._lastRenderKey = key;
					this.render(snapshot);
				}
			});
		}

		getOverlayState(snapshot = getSnapshot()) {
			return snapshot?.ui?.transferOverlay || {};
		}

		isOverlayActive(snapshot = getSnapshot()) {
			return Boolean(this.getOverlayState(snapshot).isVisible);
		}

		render(snapshot) {
			if (!this.overlay) {
				return;
			}
			const state = this.getOverlayState(snapshot);
			const progress = state.progress || {};
			const isVisible = Boolean(state.isVisible);
			const filename = state.filename || "-";
			const statusText = state.statusText || "";
			const sent = Number.isFinite(progress.sent) ? Number(progress.sent) : 0;
			const total = Number.isFinite(progress.total) ? Number(progress.total) : null;
			const percent = progress.indeterminate
				? null
				: Number.isFinite(progress.percent)
					? Number(progress.percent)
					: null;
			const speedBps = Number.isFinite(state.speedBps) ? Number(state.speedBps) : null;
			const etaSeconds = Number.isFinite(state.etaSeconds) ? Number(state.etaSeconds) : null;

			this.renderVisibility(isVisible);

			if (this.fileNameEl) {
				this.fileNameEl.textContent = filename;
			}
			if (this.statusTextEl) {
				this.statusTextEl.textContent = statusText;
			}
			if (this.progressFillEl) {
				this.progressFillEl.style.width = percent !== null ? `${percent}%` : "100%";
				this.progressFillEl.classList.toggle("is-indeterminate", percent === null);
			}
			if (this.progressPercentEl) {
				this.progressPercentEl.textContent = percent !== null ? `${Math.round(percent)}%` : "-";
			}
			if (this.progressCountEl) {
				this.progressCountEl.textContent = this.formatCount(sent, total);
			}
			if (this.speedEl) {
				this.speedEl.textContent =
					speedBps !== null ? `${this.formatBytes(speedBps)}/sn` : "-";
			}
			if (this.etaEl) {
				this.etaEl.textContent = etaSeconds !== null ? this.formatEta(etaSeconds) : "-";
			}
			this.renderCancellable(state.isCancellable);

			this.renderFocus(isVisible);
		}

		renderVisibility(isVisible) {
			const setInertState = masterUtils.dom?.setInertState;
			if (isVisible) {
				document.body.classList.add("transfer-overlay-active");
				this.overlay.classList.add("is-visible");
				window.appContext?.actions?.ui?.setModalGate?.('transfer');
				if (setInertState) {
					setInertState(this.overlay, true);
				} else {
					this.overlay.setAttribute("aria-hidden", "false");
					this.overlay.removeAttribute("inert");
					this.overlay.inert = false;
				}
			} else {
				document.body.classList.remove("transfer-overlay-active");
				this.overlay.classList.remove("is-visible");
				window.appContext?.actions?.ui?.clearModalGate?.('transfer');
				if (setInertState) {
					setInertState(this.overlay, false);
				} else {
					this.overlay.setAttribute("aria-hidden", "true");
					this.overlay.setAttribute("inert", "true");
					this.overlay.inert = true;
				}
			}
		}

		renderCancellable(cancellable) {
			if (this.cancelBtn) {
				this.cancelBtn.style.display = cancellable ? "inline-flex" : "none";
			}
		}

		renderFocus(isVisible) {
			if (isVisible && !this._lastVisible) {
				const dialogPanel = this.overlay.querySelector(".transfer-overlay__panel");
				if (dialogPanel) {
					if (!dialogPanel.hasAttribute("tabindex")) {
						dialogPanel.setAttribute("tabindex", "-1");
					}
					if (typeof dialogPanel.focus === "function") {
						dialogPanel.focus();
					}
				}
			}
			if (!isVisible && this._lastVisible) {
				const activeElement = document.activeElement;
				if (activeElement && this.overlay.contains(activeElement) && typeof activeElement.blur === "function") {
					activeElement.blur();
				}
			}
			this._lastVisible = isVisible;
		}

		beginUpload(filename, totalBytes, options = {}) {
			if (!this.overlay) {
				return;
			}
			this.resetState();
			if (this._hideTimer) {
				clearTimeout(this._hideTimer);
			}
			this.totalBytes = Number.isFinite(totalBytes) ? Number(totalBytes) : null;
			this.manualStart = Date.now();
			this.manualLastUpdate = this.manualStart;
			this.manualLastBytes = 0;
			this.sessionExpectedGeneration = this.lastCompletedUploadGeneration ?? 0;
			this.sessionGeneration = null;
			this.sessionStartTime = Date.now();
			this.onCancel = typeof options.onCancel === "function" ? options.onCancel : null;
			this.cancelRequested = false;
			this.clientUploadInProgress = true;
			if (transferActions?.beginUpload) {
				transferActions.beginUpload({
					filename,
					totalBytes: this.totalBytes,
					statusText: "Preparing file for upload...",
					cancellable: true,
				});
			} else {
				setTransferState({
					isVisible: true,
					mode: "upload",
					filename: filename || null,
					statusText: "Preparing file for upload...",
					isCancellable: true,
					progress: {
						sent: 0,
						total: this.totalBytes,
						percent: 0,
						indeterminate: !Number.isFinite(this.totalBytes),
					},
					speedBps: null,
					etaSeconds: null,
					error: null,
				});
			}
			this.startUploadPolling();
		}

		markClientUploadComplete() {
			if (!this.isOverlayActive()) {
				return;
			}
			this.clientUploadInProgress = false;
			this.sessionStartTime = Date.now();
			if (transferActions?.setStatus) {
				transferActions.setStatus("File received. Uploading to printer...");
			} else {
				setTransferState({ statusText: "File received. Uploading to printer..." });
			}
			this.startUploadPolling();
		}

		beginDownload({ filename, totalBytes, cancellable = true, onCancel = null }) {
			if (!this.overlay) {
				return;
			}
			this.resetState();
			if (this._hideTimer) {
				clearTimeout(this._hideTimer);
			}
			this.totalBytes = Number.isFinite(totalBytes) ? Number(totalBytes) : null;
			this.manualStart = Date.now();
			this.manualLastUpdate = this.manualStart;
			this.manualLastBytes = 0;
			this.onCancel = onCancel;
			if (transferActions?.beginDownload) {
				transferActions.beginDownload({
					filename,
					totalBytes: this.totalBytes,
					statusText: "Downloading...",
					cancellable,
				});
			} else {
				setTransferState({
					isVisible: true,
					mode: "download",
					filename: filename || null,
					statusText: "Downloading...",
					isCancellable: Boolean(cancellable),
					progress: {
						sent: 0,
						total: this.totalBytes,
						percent: 0,
						indeterminate: !Number.isFinite(this.totalBytes),
					},
					speedBps: null,
					etaSeconds: null,
					error: null,
				});
			}
		}

		updateManualProgress(sent, total) {
			if (!this.isOverlayActive()) {
				return;
			}
			if (this.getOverlayState().mode === "upload" && !this.clientUploadInProgress) {
				return;
			}
			if (Number.isFinite(total)) {
				this.totalBytes = Number(total);
			}
			const now = Date.now();
			const elapsed = Math.max((now - this.manualStart) / 1000, 0.001);
			const speed = sent / elapsed;
			const eta = this.totalBytes && speed > 0 ? Math.max((this.totalBytes - sent) / speed, 0) : null;
			const mode = this.getOverlayState().mode || "";
			const statusText =
				mode === "download"
					? "Downloading file..."
					: "Preparing file for upload...";
			if (transferActions?.updateManualProgress) {
				transferActions.updateManualProgress({
					sent,
					total: this.totalBytes,
					speedBps: speed,
					etaSeconds: eta,
					statusText,
				});
			} else {
				setTransferState({
					statusText,
					progress: {
						sent,
						total: this.totalBytes,
						percent:
							Number.isFinite(this.totalBytes) && this.totalBytes > 0
								? Math.min(Math.round((sent / this.totalBytes) * 100), 100)
								: 0,
						indeterminate: !Number.isFinite(this.totalBytes),
					},
					speedBps: speed,
					etaSeconds: eta,
				});
			}
			this.manualLastUpdate = now;
			this.manualLastBytes = sent;
		}

		completeManual(success = true, message = "") {
			if (!this.isOverlayActive()) {
				return;
			}
			const finalMessage = message || (success ? "Operation completed" : "Operation could not be completed");
			if (transferActions?.completeManual) {
				transferActions.completeManual(success, finalMessage);
			} else {
				setTransferState({
					statusText: finalMessage,
					error: success ? null : finalMessage,
				});
			}
			this.requestHideOverlay(success ? 600 : 0);
		}

		updatePercentProgress(percent) {
			if (!this.isOverlayActive()) {
				return;
			}
			const safePercent = Math.max(0, Math.min(Number(percent) || 0, 100));
			if (transferActions?.updatePercentProgress) {
				transferActions.updatePercentProgress({ percent: safePercent });
			} else {
				setTransferState({
					progress: {
						sent: 0,
						total: null,
						percent: safePercent,
						indeterminate: false,
					},
					speedBps: null,
					etaSeconds: null,
				});
			}
		}

		failCurrent(message) {
			if (!this.overlay) {
				return;
			}
			if (transferActions?.failCurrent) {
				transferActions.failCurrent(message || "Operation could not be completed");
			} else {
				setTransferState({
					statusText: message || "Operation could not be completed",
					error: message || "Operation could not be completed",
				});
			}
			this.requestHideOverlay(800);
		}

		handleCancel() {
			if (!this.isOverlayActive() || this.cancelInFlight) {
				return;
			}
			const confirmCancel =
				typeof window !== "undefined" && typeof window.confirm === "function"
					? window.confirm("Cancel transfer? Press OK to confirm.")
					: true;
			if (!confirmCancel) {
				showToast("Cancellation aborted", "info");
				return;
			}
			showToast("Cancelling transfer...", "info");
			if (typeof this.onCancel === "function") {
				this.cancelInFlight = true;
				this.cancelRequested = true;
				if (transferActions?.setStatus) {
					transferActions.setStatus("Cancelling...");
				} else {
					setTransferState({ statusText: "Cancelling..." });
				}
				try {
					this.onCancel();
				} catch (error) {
					console.warn("Cancel handler failed:", error);
				} finally {
					setTimeout(() => {
						this.cancelInFlight = false;
					}, 500);
				}
				return;
			}
			if (this.getOverlayState().mode === "upload") {
				this.cancelUploadRequest();
			}
		}

		shouldCancelBackendUpload() {
			const state = this.getOverlayState();
			return Boolean(state.isVisible && state.mode === "upload" && !this.clientUploadInProgress);
		}

		async cancelUploadRequest() {
			if (this.cancelInFlight) {
				return;
			}
			this.cancelInFlight = true;
			this.cancelRequested = true;
			if (transferActions?.setStatus) {
				transferActions.setStatus("Sending cancellation request...");
			} else {
				setTransferState({ statusText: "Sending cancellation request..." });
			}
			try {
				await requestWithPrinter("/api/ftps/files/upload/cancel", {
					method: "POST",
				});
			} catch (error) {
				if (error?.status === 409) {
					this.cancelInFlight = false;
					return;
				}
				console.error("Upload cancel request failed:", error);
				showToast("Cancellation request failed", "error");
				this.cancelInFlight = false;
				return;
			}
			this.cancelInFlight = false;
		}

		requestHideOverlay(delay = 0) {
			if (this._hideTimer) {
				clearTimeout(this._hideTimer);
			}
			const finalize = () => {
				this.cancelRequested = false;
				if (transferActions?.hideOverlay) {
					transferActions.hideOverlay();
				} else {
					setTransferState({
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
				}
				this.resetState();
			};
			if (delay > 0) {
				this._hideTimer = setTimeout(finalize, delay);
			} else {
				finalize();
			}
		}

		resetState() {
			this.totalBytes = null;
			this.onCancel = null;
			this.cancelInFlight = false;
			this.cancelRequested = false;
			this.clientUploadInProgress = false;
			this.sessionGeneration = null;
			this.sessionExpectedGeneration = null;
			this.sessionStartTime = 0;
			this.stopUploadPolling();
		}

		startUploadPolling() {
			this.stopUploadPolling();
			const poll = async () => {
				if (this.pollInFlight) {
					return;
				}
				this.pollInFlight = true;
				try {
			const data = await fetchJson("/api/ftps/files/upload/status", { timeout: 5000 });
					this.applyUploadStatus(data);
				} catch (error) {
					console.warn("Upload status polling failed:", error);
				} finally {
					this.pollInFlight = false;
				}
			};
			poll();
			this.pollTimer = setInterval(poll, 900);
		}

		setStatus(text) {
			if (transferActions?.setStatus) {
				transferActions.setStatus(text || "");
				return;
			}
			setTransferState({ statusText: text || "" });
		}

		stopUploadPolling() {
			if (this.pollTimer) {
				clearInterval(this.pollTimer);
			}
			this.pollTimer = null;
			this.pollInFlight = false;
		}

		applyUploadStatus(data) {
			const overlayState = this.getOverlayState();
			if (!data || !overlayState.isVisible || overlayState.mode !== "upload") {
				return;
			}
			const generation = Number.isFinite(data.generation) ? Number(data.generation) : null;
			if (this.sessionGeneration !== null && generation !== null && generation > this.sessionGeneration) {
				this.sessionGeneration = generation;
			}
			if (this.sessionGeneration === null) {
				const expected = this.sessionExpectedGeneration ?? 0;
				if (generation !== null) {
					if (generation > expected) {
						this.sessionGeneration = generation;
					} else if (!data.active) {
						return;
					}
				} else if (!data.active) {
					return;
				}
			}
			const filename = data.filename || null;
			const sent = this._toNumber(data.sent, 0);
			const totalRaw = this._toNumber(data.total, this.totalBytes);
			const total = Number.isFinite(totalRaw) ? totalRaw : this.totalBytes;
			this.totalBytes = total;
			const speed = this._toNumber(data.speed_bps, null);
			const eta = this._toNumber(data.eta_seconds, null);

			const status = data.status || (data.active ? "running" : "idle");
			if (this.clientUploadInProgress && !data.active) {
				return;
			}
			if (this.clientUploadInProgress && status === "running" && data.active) {
				this.clientUploadInProgress = false;
			} else if (this.clientUploadInProgress && status === "preparing") {
				return;
			}
			let statusMessage = data.message || this.describeStatus(status);
			if (data.active && status === "running") {
				statusMessage = "File is being transferred to the printer...";
			}
			if (transferActions?.updateManualProgress) {
				transferActions.updateManualProgress({
					sent,
					total,
					speedBps: speed,
					etaSeconds: eta,
					statusText: statusMessage,
				});
				if (filename) {
					transferActions.setState({ filename });
				}
			} else {
				setTransferState({
					filename,
					statusText: statusMessage,
					progress: {
						sent,
						total,
						percent:
							Number.isFinite(total) && total > 0
								? Math.min(Math.round((sent / total) * 100), 100)
								: 0,
						indeterminate: !Number.isFinite(total),
					},
					speedBps: speed,
					etaSeconds: eta,
				});
			}

			if (!data.active && ["completed", "cancelled", "error"].includes(status)) {
				if (status === "cancelled" && !this.cancelRequested) {
					return;
				}
				const updatedAtMs = this._parseTimestamp(data.updated_at);
				if (this.sessionStartTime && updatedAtMs && updatedAtMs < this.sessionStartTime - 250) {
					return;
				}
				this.stopUploadPolling();
				if (generation !== null) {
					this.lastCompletedUploadGeneration = Math.max(
						this.lastCompletedUploadGeneration ?? 0,
						generation
					);
				}
				const finalMessage = data.message || this.describeStatus(status);
				if (transferActions?.completeManual) {
					transferActions.completeManual(status === "completed", finalMessage);
				} else {
					setTransferState({
						statusText: finalMessage,
						error: status === "completed" ? null : finalMessage,
					});
				}
				this.requestHideOverlay(800);
				this.cancelRequested = false;
			}
		}

		describeStatus(status) {
			switch (status) {
				case "preparing":
					return "Preparing file for upload...";
				case "completed":
					return "Upload complete";
				case "cancelled":
					return "Upload canceled";
				case "error":
					return "Upload failed";
				case "cancelling":
					return "Cancelling...";
				default:
					return "Operation in progress...";
			}
		}

		_toNumber(value, fallback) {
			if (value === null || value === undefined || value === '') {
				return fallback ?? null;
			}
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : fallback ?? null;
		}

		_parseTimestamp(value) {
			const parsed = Number(value);
			if (!Number.isFinite(parsed)) {
				return null;
			}
			return parsed > 1e12 ? parsed : parsed * 1000;
		}

		formatCount(sent, total) {
			const sentLabel = this.formatBytes(sent);
			if (!total || total <= 0) {
				return `${sentLabel}`;
			}
			return `${sentLabel} / ${this.formatBytes(total)}`;
		}

		formatBytes(value) {
			if (formatBytesHelper) {
				return formatBytesHelper(value);
			}
			const size = Number(value);
			if (!Number.isFinite(size)) {
				return "-";
			}
			const units = ["B", "KB", "MB", "GB", "TB"];
			const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
			const formatted = size / 1024 ** exponent;
			const formattedValue = formatted.toFixed(formatted < 10 && exponent > 0 ? 1 : 0);
			return `${formattedValue} ${units[exponent]}`;
		}

        formatEta(seconds) {
            const totalSeconds = Math.max(Number(seconds) || 0, 0);
            if (!Number.isFinite(totalSeconds) || totalSeconds === 0) {
                return "-";
            }
            const minutes = Math.floor(totalSeconds / 60);
            const secs = Math.floor(totalSeconds % 60);
            if (minutes > 0) {
                return `${minutes} dk ${secs.toString().padStart(2, "0")} sn`;
            }
            return `${secs} sn`;
        }

    }

	transferOverlayInstance = new TransferOverlay();

	const handleTransferOverlayCommand = (event) => {
		const command = event?.detail;
		if (!command) {
			return;
		}
		const payload = command.payload ?? {};
		switch (command.action) {
			case 'beginUpload':
				transferOverlayInstance.beginUpload(
					payload.filename,
					payload.totalBytes,
					payload.options ?? {},
				);
				break;
			case 'beginDownload':
				transferOverlayInstance.beginDownload(payload.options ?? {});
				break;
			case 'updateManualProgress':
				transferOverlayInstance.updateManualProgress(payload.sent, payload.total);
				break;
			case 'updatePercentProgress':
				transferOverlayInstance.updatePercentProgress(payload.percent ?? 0);
				break;
			case 'setStatus':
				transferOverlayInstance.setStatus(payload.status ?? '');
				break;
			case 'setCancellable':
				if (transferActions?.setCancellable) {
					transferActions.setCancellable(Boolean(payload.cancellable));
				} else {
					setTransferState({ isCancellable: Boolean(payload.cancellable) });
				}
				break;
			case 'completeManual':
				transferOverlayInstance.completeManual(Boolean(payload.success), payload.message ?? '');
				break;
			case 'failCurrent':
				transferOverlayInstance.failCurrent(payload.message ?? '');
				break;
			case 'hideOverlay':
				transferOverlayInstance.requestHideOverlay(Number.isFinite(payload.delay) ? payload.delay : 0);
				break;
			default:
				break;
		}
	};

	const bindTransferOverlayEvents = () => {
		if (transferOverlayInstance.cancelBtn) {
			transferOverlayInstance.cancelBtn.addEventListener("click", () => transferOverlayInstance.handleCancel());
		}
	};

	const bindTransferOverlayDocumentEvents = () => {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", () => {
				transferOverlayInstance.mount();
				transferOverlayInstance.subscribeToStore();
				transferOverlayInstance.render(getSnapshot());
				bindTransferOverlayEvents();
			});
		} else {
			transferOverlayInstance.mount();
			transferOverlayInstance.subscribeToStore();
			transferOverlayInstance.render(getSnapshot());
			bindTransferOverlayEvents();
		}
		document.addEventListener('transfer-overlay-command', handleTransferOverlayCommand);
	};

	const events = appContext.events || {};
	const eventKey = events.keys?.TRANSFER_OVERLAY || 'transferOverlay';
	if (typeof events.register === 'function') {
		events.register(eventKey, {
			component: bindTransferOverlayEvents,
			document: bindTransferOverlayDocumentEvents,
		});
	} else {
		events.bindTransferOverlayEvents = bindTransferOverlayEvents;
		events.bindTransferOverlayDocumentEvents = bindTransferOverlayDocumentEvents;
	}

	if (typeof global !== 'undefined') {
		components.transferOverlay = transferOverlayInstance;
	}
	return transferOverlayInstance;
};

export { initTransferOverlay };
export default initTransferOverlay;
