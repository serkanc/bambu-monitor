const createFileExplorerSelectors = () => ({
    getCurrentPath: (snapshot) => snapshot?.ui?.fileExplorer?.currentPath || '/',
    getActiveFile: (snapshot) => snapshot?.ui?.fileExplorer?.activeFile || null,
    getFiles: (snapshot) => snapshot?.ui?.fileExplorer?.files || [],
    getIsLoading: (snapshot) => Boolean(snapshot?.ui?.fileExplorer?.isLoading),
    getLastError: (snapshot) => snapshot?.ui?.fileExplorer?.lastError || null,
    getIsContextMenuOpen: (snapshot) => Boolean(snapshot?.ui?.fileExplorer?.isContextMenuOpen),
    getContextMenuPosition: (snapshot) => snapshot?.ui?.fileExplorer?.contextMenuPosition || null,
    getContextMenuFile: (snapshot) => snapshot?.ui?.fileExplorer?.contextMenuFile || null,
    getIsModalOpen: (snapshot) => Boolean(snapshot?.ui?.fileExplorer?.isModalOpen),
});

export { createFileExplorerSelectors };
export default createFileExplorerSelectors;
