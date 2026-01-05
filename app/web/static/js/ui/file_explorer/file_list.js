const renderFileList = ({ files = [], buildFileRow, attachFileInteractivity, documentRef }) => {
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    if (!doc) {
        return;
    }
    const container = doc.getElementById('file-list');
    if (!container) {
        return;
    }

    if (!files.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 32px; margin-bottom: 12px;">&#128194;</div>
                <p>This folder is empty</p>
            </div>
        `;
        return;
    }

    if (typeof buildFileRow === 'function') {
        container.innerHTML = files.map((file) => buildFileRow(file)).join('');
    } else {
        container.innerHTML = '';
    }
    if (typeof attachFileInteractivity === 'function') {
        attachFileInteractivity();
    }
};

export { renderFileList };
export default renderFileList;
