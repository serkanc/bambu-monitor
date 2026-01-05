const bindSidebarEvents = (selector) => {
    if (!selector) {
        return;
    }
    const actions = selector.uiActions || selector;
    if (selector.menuToggle) {
        selector.menuToggle.addEventListener('click', () => actions.toggleSidebar());
    }
    if (selector.closeBtn) {
        selector.closeBtn.addEventListener('click', () => actions.closeSidebar({ persist: true }));
    }
    if (selector.backdropEl) {
        selector.backdropEl.addEventListener('click', () => actions.closeSidebar({ persist: false }));
    }
    if (selector.addBtn) {
        selector.addBtn.addEventListener('click', () => actions.openAddModal());
    }

    const resizeHandler = () => actions.handleViewportChange();
    if (typeof selector.breakpoint.addEventListener === 'function') {
        selector.breakpoint.addEventListener('change', resizeHandler);
    } else if (typeof selector.breakpoint.addListener === 'function') {
        selector.breakpoint.addListener(resizeHandler);
    }

    if (selector.sidebarEl) {
        selector.sidebarEl.addEventListener('scroll', () => actions.hideContextMenu());
    }
};

export { bindSidebarEvents };
export default bindSidebarEvents;
