const normalizeStateCode = (value) => {
    if (!value) {
        return '';
    }
    return String(value).trim().toUpperCase();
};

const parseSlotIndex = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const resolveBusyStateSet = (snapshot) => {
    const statusConstants = snapshot?.constants?.status || {};
    const busyStates = statusConstants.busyStates || [
        'RUNNING',
        'SLICING',
        'PAUSE',
        'PREPARE',
        'INIT',
    ];
    return new Set(busyStates.map((value) => normalizeStateCode(value)));
};

const resolveAmsStatusMain = (snapshot) =>
    normalizeStateCode(snapshot?.ams?.ams_status_main);

const resolveAmsTransferState = (snapshot) => {
    const amsData = snapshot?.ams || {};
    const target = parseSlotIndex(amsData.tray_tar);
    const current = parseSlotIndex(amsData.tray_now);

    const isTransferActive = target !== current;
    const isAmsUnloading = isTransferActive && target === 255;
    const isExternalSpoolLoading = isTransferActive && target === 254;
    const isExternalSpoolUnloading = current === 254 && target === 255;
    const isAmsLoading = isTransferActive && target !== null && target >= 0 && target <= 253;

    return {
        targetSlot: target,
        currentSlot: current,
        isAmsLoading,
        isAmsUnloading,
        isExternalSpoolLoading,
        isExternalSpoolUnloading,
        isTransferActive,
    };
};

const createStatusPanelSelectors = (pendingSelectors) => ({
    getActiveTab: (snapshot) => snapshot?.ui?.statusPanel?.activeTab || 'status',
    getSelectedSlot: (snapshot) => snapshot?.ui?.statusPanel?.selectedSlot || null,
    getChamberLight: (snapshot, now) =>
        pendingSelectors.resolve(snapshot?.ui?.statusPanel?.chamberLight, now),
    getFeatureToggleValue: (snapshot, key, now) => {
        if (!key) {
            return null;
        }
        const pending = snapshot?.ui?.statusPanel?.featureTogglePending?.[key];
        if (pending) {
            return pendingSelectors.resolve(pending, now);
        }
        return null;
    },
    getStatusConstants: (snapshot) => snapshot?.constants?.status || {},
    isPrinterBusy: (snapshot) => {
        const status = normalizeStateCode(snapshot?.printStatus?.gcode_state);
        return resolveBusyStateSet(snapshot).has(status);
    },
    isAmsReady: (snapshot) => {
        const status = resolveAmsStatusMain(snapshot);
        return status === 'IDLE' || status === 'ASSIST';
    },
    getAmsTransferState: (snapshot) => resolveAmsTransferState(snapshot),
});

export { createStatusPanelSelectors };
export default createStatusPanelSelectors;
