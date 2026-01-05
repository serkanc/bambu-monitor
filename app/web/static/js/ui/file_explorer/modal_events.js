const bindFileExplorerModalEvents = (explorer) => {
    if (!explorer?.modal?.container) {
        return;
    }

    const actions = explorer.uiActions || explorer;
    const { backdrop, closeBtn, downloadBtn, printBtn, deleteBtn } = explorer.modal;

    if (backdrop && !backdrop.dataset?.modalClose) {
        backdrop.addEventListener('click', () => actions.closeFileOptions());
    }

    if (closeBtn && !closeBtn.dataset?.modalClose) {
        closeBtn.addEventListener('click', () => actions.closeFileOptions());
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (explorer.activeFile) {
                actions.downloadFile(explorer.activeFile.path);
            }
        });
    }

    if (printBtn) {
        printBtn.addEventListener('click', () => actions.handlePrintRequest());
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (explorer.activeFile) {
                actions.deleteFile(explorer.activeFile);
            }
        });
    }
};

export { bindFileExplorerModalEvents };
export default bindFileExplorerModalEvents;
