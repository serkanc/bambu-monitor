const createPendingSelectors = () => ({
    resolve: (pendingState, now) => {
        if (!pendingState) {
            return null;
        }
        const time = typeof now === 'number' ? now : Date.now();
        if (pendingState.pending !== null && pendingState.expiresAt > time) {
            return pendingState.pending;
        }
        return pendingState.base;
    },
    isPending: (pendingState, now) => {
        if (!pendingState) {
            return false;
        }
        const time = typeof now === 'number' ? now : Date.now();
        return pendingState.pending !== null && pendingState.expiresAt > time;
    },
});

export { createPendingSelectors };
export default createPendingSelectors;
