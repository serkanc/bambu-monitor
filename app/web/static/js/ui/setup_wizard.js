const globalProxy = typeof window !== 'undefined' ? window : globalThis;

const initSetupWizard = () => {
    if (typeof document === 'undefined') {
        return null;
    }
    const appContext = globalProxy.appContext || {};
    const authService = appContext.services?.auth || null;
    const setupStep = document.body?.dataset?.setupStep || '';
    const passwordRequired = document.body?.dataset?.passwordRequired === 'true';
    const formEl = document.getElementById('setup-admin-form');
    const passwordEl = document.getElementById('setup-admin-password');
    const confirmEl = document.getElementById('setup-admin-confirm');
    const errorEl = document.getElementById('setup-admin-error');
    const submitEl = document.getElementById('setup-admin-submit');
    const nextEl = document.getElementById('setup-next');
    const openPrinterBtn = document.getElementById('setup-open-printer-modal');

    const showError = (message) => {
        if (errorEl) {
            errorEl.textContent = message || '';
        }
    };

    const setLoading = (isLoading) => {
        if (submitEl) {
            submitEl.disabled = isLoading;
            submitEl.textContent = isLoading ? 'Saving...' : 'Save Password';
        }
    };

    const openPrinterModal = () => {
        const selector = appContext.components?.printerSelector;
        if (selector?.openModalForMode) {
            selector.openModalForMode('setup');
        }
    };

    const advanceToPrinter = () => {
        document.body.dataset.setupStep = 'printer';
        document.body.dataset.passwordRequired = 'false';
        if (formEl) {
            formEl.hidden = true;
        }
        if (nextEl) {
            nextEl.hidden = false;
        }
        openPrinterModal();
    };

    if (!passwordRequired) {
        advanceToPrinter();
        return null;
    }

    if (!formEl || !passwordEl || !confirmEl) {
        return null;
    }

    if (openPrinterBtn) {
        openPrinterBtn.addEventListener('click', () => {
            openPrinterModal();
        });
    }

    formEl.addEventListener('submit', async (event) => {
        event.preventDefault();
        showError('');
        const password = passwordEl.value.trim();
        const confirm = confirmEl.value.trim();
        if (!password || password.length < 6) {
            showError('Password must be at least 6 characters.');
            return;
        }
        if (password !== confirm) {
            showError('Passwords do not match.');
            return;
        }
        setLoading(true);
        try {
            if (!authService?.setupPassword) {
                throw new Error('Auth service unavailable');
            }
            await authService.setupPassword(password);
            advanceToPrinter();
        } catch (error) {
            showError(error?.message || 'Failed to set password.');
        } finally {
            setLoading(false);
        }
    });

    return null;
};

export default initSetupWizard;
export { initSetupWizard };
