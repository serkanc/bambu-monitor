import { ensureAppContext, registerServiceModule } from '../core/registry.js';
import initCoreUtils from '../core/utils.js';
import initAppClient from '../api/appClient.js';
import createAuthService from '../services/authService.js';

const globalProxy = typeof window !== 'undefined' ? window : globalThis;
ensureAppContext(globalProxy);
initCoreUtils(globalProxy);
initAppClient(globalProxy);
const authService = createAuthService(globalProxy);
registerServiceModule(globalProxy, 'auth', { auth: authService });

const initLogin = () => {
    if (typeof document === 'undefined') {
        return null;
    }
    const formEl = document.getElementById('login-form');
    const usernameEl = document.getElementById('login-username');
    const passwordEl = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const submitEl = document.getElementById('login-submit');

    if (!formEl || !usernameEl || !passwordEl) {
        return null;
    }

    const showError = (message) => {
        if (errorEl) {
            errorEl.textContent = message || '';
        }
    };

    const setLoading = (isLoading) => {
        if (submitEl) {
            submitEl.disabled = isLoading;
            submitEl.textContent = isLoading ? 'Signing in...' : 'Sign in';
        }
    };

    formEl.addEventListener('submit', async (event) => {
        event.preventDefault();
        showError('');
        const username = usernameEl.value.trim();
        const password = passwordEl.value.trim();
        if (!username || !password) {
            showError('Enter your username and password.');
            return;
        }
        setLoading(true);
        try {
            if (!authService?.login) {
                throw new Error('Auth service unavailable');
            }
            await authService.login(username, password);
            window.location.href = '/';
        } catch (error) {
            showError(error?.message || 'Login failed.');
        } finally {
            setLoading(false);
        }
    });

    return null;
};

initLogin();

export default initLogin;
