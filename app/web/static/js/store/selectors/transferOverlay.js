const createTransferOverlaySelectors = () => {
    const getTransferOverlayState = (snapshot = {}) => snapshot.ui?.transferOverlay || {};

    return {
        getState: getTransferOverlayState,
        isVisible: (snapshot) => Boolean(getTransferOverlayState(snapshot).isVisible),
        getMode: (snapshot) => getTransferOverlayState(snapshot).mode || null,
        getFilename: (snapshot) => getTransferOverlayState(snapshot).filename || null,
        getStatusText: (snapshot) => getTransferOverlayState(snapshot).statusText || '',
        getProgress: (snapshot) => getTransferOverlayState(snapshot).progress || {},
        getSpeedBps: (snapshot) => getTransferOverlayState(snapshot).speedBps ?? null,
        getEtaSeconds: (snapshot) => getTransferOverlayState(snapshot).etaSeconds ?? null,
        isCancellable: (snapshot) => Boolean(getTransferOverlayState(snapshot).isCancellable),
        getError: (snapshot) => getTransferOverlayState(snapshot).error || null,
    };
};

export { createTransferOverlaySelectors };
export default createTransferOverlaySelectors;
