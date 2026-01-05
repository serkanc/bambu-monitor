const bindFileExplorerDocumentEvents = (explorer) => {
    if (typeof document === 'undefined' || !explorer) {
        return;
    }
    const actions = explorer.uiActions || explorer;
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            actions.closeFileOptions();
        }
    });
    document.addEventListener('click', (event) => {
        if (explorer.contextMenu && !explorer.contextMenu.contains(event.target)) {
            actions.hideContextMenu();
        }
    });
    document.addEventListener('scroll', () => actions.hideContextMenu(), true);
    document.addEventListener('printer-selection-ready', () => {
        if (typeof actions.resetToHome === 'function') {
            actions.resetToHome();
            return;
        }
        actions.navigateTo('/');
    });
    document.addEventListener('printer-selection-changed', () => {
        if (typeof actions.resetToHome === 'function') {
            actions.resetToHome();
            return;
        }
        actions.navigateTo('/');
    });
    document.addEventListener('printer-config-updated', () => {
        if (typeof actions.resetToHome === 'function') {
            actions.resetToHome();
            return;
        }
        actions.navigateTo('/');
    });
    document.addEventListener('state-stream-connected', () => {
        if (typeof explorer.handleStateStreamConnected === 'function') {
            explorer.handleStateStreamConnected();
        }
    });
};

export { bindFileExplorerDocumentEvents };
export default bindFileExplorerDocumentEvents;
