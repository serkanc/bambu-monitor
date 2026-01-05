const bindModalEvents = ({ selector, showToast }) => {
    if (!selector) {
        return;
    }
    const actions = selector.uiActions || selector;
    if (selector.modalBackdrop) {
        selector.modalBackdrop.addEventListener('click', () => {
            if (selector.modalMode === 'setup') {
                return;
            }
            actions.closeModal();
        });
    }
    if (selector.modalCloseBtn) {
        selector.modalCloseBtn.addEventListener('click', () => actions.closeModal());
    }
    if (selector.modalHelpBtn) {
        selector.modalHelpBtn.addEventListener('click', () => actions.handleModalHelp());
    }
    if (selector.modalForm) {
        selector.modalForm.addEventListener('submit', (event) => actions.handleVerifySubmit(event));
        const formUpdate = () => actions.updateVerifyState();
        selector.modalForm.addEventListener('input', formUpdate);
        selector.modalForm.addEventListener('change', formUpdate);
    }
    if (selector.externalForm) {
        selector.externalForm.addEventListener('submit', (event) => {
            event.preventDefault();
        });
    }
    if (selector.modalAddBtn) {
        selector.modalAddBtn.addEventListener('click', () => actions.handleAddPrinterConfirm());
    }
    const extraFields = [
        selector.externalCameraToggle,
        selector.externalCameraUrlInput,
        selector.externalCameraUsernameInput,
        selector.externalCameraPasswordInput,
        selector.makeDefaultCheckbox,
    ].filter(Boolean);
    if (extraFields.length) {
        const extraUpdate = () => actions.updateVerifyState();
        extraFields.forEach((field) => {
            field.addEventListener('input', extraUpdate);
            field.addEventListener('change', extraUpdate);
        });
    }
    if (selector.externalCameraToggle) {
        selector.externalCameraToggle.addEventListener('change', () => {
            actions.updateExternalCameraFields();
            actions.updateVerifyState();
        });
    }
};

export { bindModalEvents };
export default bindModalEvents;
