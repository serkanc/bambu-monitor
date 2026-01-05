import createApiService from './api.js';

const createFileService = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const api = createApiService(global);
    const appClient = global?.appContext?.api || null;
    const getAuthHeaders = () => appClient?.getAuthHeaders?.() || {};

    return {
        listFiles(path, options = {}) {
            return api.fetchWithPrinter(path, options);
        },
        fetchPrinter(path, options = {}) {
            return api.fetchWithPrinter(path, options);
        },
        requestWithPrinter(path, options = {}) {
            return api.request(path, options);
        },
        createFolder(formData) {
            if (!formData) {
                throw new Error('Missing form data');
            }
            return api.request('/api/ftps/files/create-folder', {
                method: 'POST',
                body: formData,
                skipPrinterId: true,
            });
        },
        renameFile(formData) {
            if (!formData) {
                throw new Error('Missing form data');
            }
            return api.request('/api/ftps/files/rename', {
                method: 'POST',
                body: formData,
                skipPrinterId: true,
            });
        },
        uploadFile(formData, handlers = {}) {
            const xhr = new XMLHttpRequest();
            if (handlers.onProgress) {
                xhr.upload.onprogress = handlers.onProgress;
            }
            if (handlers.onLoad) {
                xhr.onload = handlers.onLoad;
            }
            if (handlers.onError) {
                xhr.onerror = handlers.onError;
            }
            if (handlers.onAbort) {
                xhr.onabort = handlers.onAbort;
            }
            xhr.open('POST', '/api/ftps/files/upload');
            const authHeaders = getAuthHeaders();
            Object.entries(authHeaders).forEach(([key, value]) => {
                xhr.setRequestHeader(key, value);
            });
            xhr.send(formData);
            return xhr;
        },
        cancelUpload() {
            return api.request('/api/ftps/files/upload/cancel', {
                method: 'POST',
                skipPrinterId: true,
            });
        },
        downloadFile(filePath, signal) {
            if (!filePath) {
                throw new Error('Missing file path');
            }
            return api.request(`/api/ftps/files/download?file_path=${encodeURIComponent(filePath)}`, {
                signal,
                skipPrinterId: true,
            });
        },
    };
};

export { createFileService };
export default createFileService;
