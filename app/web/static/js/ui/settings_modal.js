import initModalManager from '../core/modal_manager.js';

const globalProxy = typeof window !== 'undefined' ? window : globalThis;

const maskToken = (token) => {
    if (!token) {
        return '****';
    }
    const prefix = token.slice(0, 4);
    const suffix = token.slice(-4);
    return `${prefix}******${suffix}`;
};


const copyToClipboard = async (text) => {
    if (!text) {
        return false;
    }
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (error) {
        console.warn('Clipboard copy failed', error);
    }
    return false;
};

const initSettingsModal = () => {
    if (typeof document === 'undefined') {
        return null;
    }
    const authService = globalProxy.appContext?.services?.auth || null;
    const logoutBtn = document.getElementById('sidebar-logout-btn');
    const debugBtn = document.getElementById('sidebar-logs-btn');
    const modalEl = document.getElementById('settings-modal');
    const passwordForm = document.getElementById('settings-password-form');
    const currentInput = document.getElementById('settings-current-password');
    const newInput = document.getElementById('settings-new-password');
    const confirmInput = document.getElementById('settings-confirm-password');
    const passwordError = document.getElementById('settings-password-error');
    const passwordSubmit = document.getElementById('settings-password-submit');
    const apiTokenEl = document.getElementById('settings-api-token');
    const apiCopyBtn = document.getElementById('settings-api-copy');
    const apiRotateBtn = document.getElementById('settings-api-rotate');
    const adminRotateBtn = document.getElementById('settings-admin-rotate');
    const logoutAllToggle = document.getElementById('settings-logout-all');
    const allowlistEl = document.getElementById('settings-allowlist');
    const allowlistSaveBtn = document.getElementById('settings-allowlist-save');
    const sessionRotateBtn = document.getElementById('settings-session-rotate');
    const tabButtons = Array.from(document.querySelectorAll('.settings-tab'));
    const tabPanels = Array.from(document.querySelectorAll('.settings-section[data-panel]'));
    const cacheSizeEl = document.getElementById('settings-cache-size');
    const cacheRefreshBtn = document.getElementById('settings-cache-refresh');
    const cacheCleanBtn = document.getElementById('settings-cache-clean');
    const cacheAgeSelect = document.getElementById('settings-cache-age');
    const cacheCleanResult = document.getElementById('settings-cache-clean-result');
    const cacheUploadToggle = document.getElementById('settings-cache-upload-toggle');

    if (!modalEl) {
        return null;
    }

    const modalManager = initModalManager(globalProxy);
    let apiTokenValue = '';
    const formatBytes =
        globalProxy.appContext?.utils?.format?.formatBytes || ((value) => `${value ?? 0} B`);

    const setActiveTab = (tabId) => {
        const nextTab = tabId || 'security';
        tabButtons.forEach((button) => {
            const isActive = button.dataset.tab === nextTab;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        tabPanels.forEach((panel) => {
            const isActive = panel.dataset.panel === nextTab;
            panel.hidden = !isActive;
        });
    };

    const loadTokens = async () => {
        try {
            if (!authService?.getTokens) {
                throw new Error('Auth service unavailable');
            }
            const payload = await authService.getTokens();
            apiTokenValue = payload?.api_token || '';
            if (apiTokenEl) {
                apiTokenEl.textContent = maskToken(apiTokenValue);
            }
            if (authService?.getAllowlist && allowlistEl) {
                const allowlistPayload = await authService.getAllowlist();
                allowlistEl.value = (allowlistPayload?.allowlist || []).join('\n');
            }
        } catch (error) {
            console.error(error);
        }
    };

    const loadCacheStatus = async () => {
        if (!authService?.getCacheStatus) {
            return;
        }
        try {
            const payload = await authService.getCacheStatus();
            const bytes = Number(payload?.size_bytes ?? 0);
            if (cacheSizeEl) {
                cacheSizeEl.textContent = formatBytes(Number.isFinite(bytes) ? bytes : 0);
            }
        } catch (error) {
            console.error(error);
            if (cacheSizeEl) {
                cacheSizeEl.textContent = 'Unavailable';
            }
        }
    };

    const loadCacheSettings = async () => {
        if (!authService?.getCacheSettings || !cacheUploadToggle) {
            return;
        }
        try {
            const payload = await authService.getCacheSettings();
            cacheUploadToggle.checked = Boolean(payload?.cache_upload_enabled);
        } catch (error) {
            console.error(error);
        }
    };

    modalManager?.register?.('settings', {
        element: modalEl,
        openClass: 'is-open',
        onOpen: () => {
            setActiveTab('security');
            loadTokens();
            loadCacheStatus();
            loadCacheSettings();
        },
    });

    tabButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const tabId = button.dataset.tab || 'security';
            setActiveTab(tabId);
        });
    });

    debugBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        window.open('/debug', '_blank', 'noopener');
    });

    logoutBtn?.addEventListener('click', async (event) => {
        event.preventDefault();
        if (authService?.logout) {
            await authService.logout();
        }
        window.location.href = '/login';
    });

    passwordForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (passwordError) {
            passwordError.textContent = '';
        }
        const currentPassword = currentInput?.value?.trim() || '';
        const newPassword = newInput?.value?.trim() || '';
        const confirmPassword = confirmInput?.value?.trim() || '';
        if (!currentPassword || !newPassword) {
            if (passwordError) {
                passwordError.textContent = 'Please enter your current and new password.';
            }
            return;
        }
        if (newPassword !== confirmPassword) {
            if (passwordError) {
                passwordError.textContent = 'New passwords do not match.';
            }
            return;
        }
        if (passwordSubmit) {
            passwordSubmit.disabled = true;
            passwordSubmit.textContent = 'Updating...';
        }
        try {
            if (!authService?.changePassword) {
                throw new Error('Auth service unavailable');
            }
            await authService.changePassword(currentPassword, newPassword);
            if (logoutAllToggle?.checked) {
                await authService?.rotateSessionSecret?.();
            }
            if (passwordError) {
                passwordError.textContent = logoutAllToggle?.checked
                    ? 'Password updated. Restart server to force logout.'
                    : 'Password updated.';
            }
            passwordForm.reset();
        } catch (error) {
            if (passwordError) {
                passwordError.textContent = error?.message || 'Password update failed.';
            }
        } finally {
            if (passwordSubmit) {
                passwordSubmit.disabled = false;
                passwordSubmit.textContent = 'Update Password';
            }
        }
    });

    apiCopyBtn?.addEventListener('click', async () => {
        const copied = await copyToClipboard(apiTokenValue);
        if (apiCopyBtn) {
            apiCopyBtn.textContent = copied ? 'Copied' : 'Copy';
            setTimeout(() => {
                apiCopyBtn.textContent = 'Copy';
            }, 1500);
        }
    });

    apiRotateBtn?.addEventListener('click', async () => {
        if (apiRotateBtn) {
            apiRotateBtn.disabled = true;
            apiRotateBtn.textContent = 'Rotating...';
        }
        try {
            if (!authService?.rotateApiToken) {
                throw new Error('Auth service unavailable');
            }
            const payload = await authService.rotateApiToken();
            apiTokenValue = payload?.api_token || '';
            globalProxy.__APP_CONFIG__ = globalProxy.__APP_CONFIG__ || {};
            globalProxy.__APP_CONFIG__.apiToken = apiTokenValue;
            if (apiTokenEl) {
                apiTokenEl.textContent = maskToken(apiTokenValue);
            }
        } catch (error) {
            console.error(error);
        } finally {
            if (apiRotateBtn) {
                apiRotateBtn.disabled = false;
                apiRotateBtn.textContent = 'Rotate';
            }
        }
    });

    adminRotateBtn?.addEventListener('click', async () => {
        if (adminRotateBtn) {
            adminRotateBtn.disabled = true;
            adminRotateBtn.textContent = 'Rotating...';
        }
        try {
            if (!authService?.rotateAdminToken) {
                throw new Error('Auth service unavailable');
            }
            await authService.rotateAdminToken();
        } catch (error) {
            console.error(error);
        } finally {
            if (adminRotateBtn) {
                adminRotateBtn.disabled = false;
                adminRotateBtn.textContent = 'Rotate';
            }
        }
    });

    allowlistSaveBtn?.addEventListener('click', async () => {
        const entries = (allowlistEl?.value || '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (allowlistSaveBtn) {
            allowlistSaveBtn.disabled = true;
            allowlistSaveBtn.textContent = 'Saving...';
        }
        try {
            if (!authService?.updateAllowlist) {
                throw new Error('Auth service unavailable');
            }
            await authService.updateAllowlist(entries);
        } catch (error) {
            console.error(error);
        } finally {
            if (allowlistSaveBtn) {
                allowlistSaveBtn.disabled = false;
                allowlistSaveBtn.textContent = 'Save Allowlist';
            }
        }
    });

    sessionRotateBtn?.addEventListener('click', async () => {
        if (sessionRotateBtn) {
            sessionRotateBtn.disabled = true;
            sessionRotateBtn.textContent = 'Rotating...';
        }
        try {
            if (!authService?.rotateSessionSecret) {
                throw new Error('Auth service unavailable');
            }
            await authService.rotateSessionSecret();
        } catch (error) {
            console.error(error);
        } finally {
            if (sessionRotateBtn) {
                sessionRotateBtn.disabled = false;
                sessionRotateBtn.textContent = 'Rotate';
            }
        }
    });

    cacheRefreshBtn?.addEventListener('click', async () => {
        if (!cacheRefreshBtn) {
            return;
        }
        cacheRefreshBtn.disabled = true;
        cacheRefreshBtn.textContent = 'Refreshing...';
        await loadCacheStatus();
        cacheRefreshBtn.disabled = false;
        cacheRefreshBtn.textContent = 'Refresh';
    });

    cacheCleanBtn?.addEventListener('click', async () => {
        if (!cacheCleanBtn) {
            return;
        }
        if (!authService?.cleanCache) {
            return;
        }
        const days = Number(cacheAgeSelect?.value ?? 0);
        if (!Number.isFinite(days) || days <= 0) {
            return;
        }
        cacheCleanBtn.disabled = true;
        cacheCleanBtn.textContent = 'Cleaning...';
        if (cacheCleanResult) {
            cacheCleanResult.textContent = '';
        }
        try {
            const payload = await authService.cleanCache(days);
            const removedBytes = Number(payload?.removed_bytes ?? 0);
            const removedBundles = Number(payload?.removed_bundles ?? 0);
            if (cacheCleanResult) {
                cacheCleanResult.textContent = `Removed ${removedBundles} bundle(s) (${formatBytes(removedBytes)}).`;
            }
            await loadCacheStatus();
        } catch (error) {
            console.error(error);
            if (cacheCleanResult) {
                cacheCleanResult.textContent = 'Cleanup failed.';
            }
        } finally {
            cacheCleanBtn.disabled = false;
            cacheCleanBtn.textContent = 'Clean Cache';
        }
    });

    cacheUploadToggle?.addEventListener('change', async () => {
        if (!authService?.updateCacheSettings) {
            return;
        }
        try {
            await authService.updateCacheSettings({
                cache_upload_enabled: Boolean(cacheUploadToggle.checked),
            });
        } catch (error) {
            console.error(error);
            cacheUploadToggle.checked = !cacheUploadToggle.checked;
        }
    });

    return null;
};

export default initSettingsModal;
export { initSettingsModal };
