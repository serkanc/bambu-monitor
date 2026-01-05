const renderBreadcrumb = ({
    currentPath = '/',
    normalizePath,
    escapeHtml,
    onNavigate,
    documentRef,
}) => {
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    if (!doc) {
        return;
    }
    const breadcrumbContainer = doc.getElementById('file-breadcrumb');
    if (!breadcrumbContainer) {
        return;
    }

    const safePath = normalizePath ? normalizePath(currentPath) : currentPath;
    const segments = safePath.split('/').filter(Boolean);

    let html = `<span class="breadcrumb-item" data-path="${encodeURIComponent('/')}">&#8962; Home</span>`;
    let accumulatedPath = '';

    segments.forEach((segment) => {
        accumulatedPath += `/${segment}`;
        html += `<span class="breadcrumb-separator">/</span>`;
        html += `<span class="breadcrumb-item" data-path="${encodeURIComponent(accumulatedPath)}">${escapeHtml ? escapeHtml(segment) : segment}</span>`;
    });

    breadcrumbContainer.innerHTML = html;
    if (!breadcrumbContainer.dataset.listenerAttached) {
        breadcrumbContainer.addEventListener('click', (event) => {
            const item = event.target?.closest?.('.breadcrumb-item');
            if (!item || !breadcrumbContainer.contains(item)) {
                return;
            }
            const target = item.dataset.path ? decodeURIComponent(item.dataset.path) : '/';
            if (typeof onNavigate === 'function') {
                onNavigate(target);
            }
        });
        breadcrumbContainer.dataset.listenerAttached = 'true';
    }
};

export { renderBreadcrumb };
export default renderBreadcrumb;
