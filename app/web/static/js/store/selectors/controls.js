const createControlsSelectors = (pendingSelectors) => ({
    getActiveTab: (snapshot) => snapshot?.ui?.controls?.activeTab || 'movement',
    getLastActiveTab: (snapshot) => snapshot?.ui?.controls?.lastActiveTab || 'movement',
    getMovementStep: (snapshot) => snapshot?.ui?.controls?.movementStep ?? 1,
    getExtruderStep: (snapshot) => snapshot?.ui?.controls?.extruderStep ?? 10,
    getChamberLight: (snapshot, now) => pendingSelectors.resolve(snapshot?.ui?.controls?.chamberLight, now),
    getSpeedLevel: (snapshot, now) => pendingSelectors.resolve(snapshot?.ui?.controls?.speedLevel, now),
});

export { createControlsSelectors };
export default createControlsSelectors;
