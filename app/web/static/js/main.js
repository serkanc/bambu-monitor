import { ensureAppContext } from './core/registry.js';
import initCoreUtils from './core/utils.js';
import initLogger from './core/logger.js';
import initFeatureFlags from './core/feature_flags.js';
import initDomUtils from './utils/dom.js';
import initFormatUtils from './utils/format.js';
import initTimeUtils from './utils/time.js';
import initPendingState from './utils/pendingState.js';
import initPrintSetupUtils from './utils/print_setup_utils.js';
import initAppClient from './api/appClient.js';
import initStore from './core/store.js';
import initActions from './core/actions.js';
import initTelemetry from './core/telemetry.js';
import initSmoke from './core/smoke.js';
import initEventRegistry from './core/event_registry.js';
import initModalManager from './core/modal_manager.js';
import initStateStream from './core/state_stream.js';
import initTransferOverlay from './ui/transfer_overlay.js';
import initPrintSetup from './ui/print_setup.js';
import initSkipObjectsModal from './ui/skip_objects_modal.js';
import initServices from './services/index.js';
import initSetupWizard from './ui/setup_wizard.js';
import initSettingsModal from './ui/settings_modal.js';

import { initStatusPanel } from './ui/status_panel.js';
import { initStatus } from './ui/status.js';
import { initFilesUpdater } from './ui/files_updater.js';
import { initControls } from './ui/controls.js';
import { initPrinterSelector } from './ui/printer_selector.js';
import { initFileExplorer } from './ui/file_explorer.js';
import { initCameraViewer } from './ui/camera_viewer.js';
import { initCameraUI } from './ui/camera.js';
const globalContext = typeof window !== 'undefined' ? window : globalThis;
ensureAppContext(globalContext);
const logger = initLogger(globalContext);
initFeatureFlags(globalContext);
const telemetry = initTelemetry(globalContext);
const smoke = initSmoke(globalContext);
initCoreUtils(globalContext);
initDomUtils(globalContext);
initModalManager(globalContext);
initFormatUtils(globalContext);
initTimeUtils(globalContext);
initPendingState(globalContext);
initPrintSetupUtils(globalContext);
initAppClient(globalContext);
initStore(globalContext);
initServices(globalContext);
initActions(globalContext);
const eventRegistry = initEventRegistry(globalContext);
initTransferOverlay(globalContext);
initPrintSetup(globalContext);
globalContext.appContext = globalContext.appContext || {};
globalContext.appContext.serviceHooks =
    globalContext.appContext.serviceHooks ||
    {
        slowThresholdMs: 1500,
        onError: (error, ctx = {}) => {
            const name = ctx?.name || 'unknown';
            const scoped = logger?.child ? logger.child('service') : null;
            if (scoped?.error) {
                scoped.error(name, error);
                return;
            }
            console.error(`[service] ${name}`, error);
        },
        onMetric: (metric) => {
            if (!metric) {
                return;
            }
            const threshold = globalContext.appContext?.serviceHooks?.slowThresholdMs ?? 1500;
            if (!metric.ok || metric.durationMs > threshold) {
                const scoped = logger?.child ? logger.child('service-metric') : null;
                if (scoped?.warn) {
                    scoped.warn(metric);
                    return;
                }
                console.warn('[service-metric]', metric);
            }
        },
    };

const bootstrapApp = () => {
    const isSetupMode =
        typeof document !== 'undefined' &&
        (document.body?.dataset?.firstRun === 'true' || window.location.pathname === '/setup');
    globalContext.appContext = globalContext.appContext || {};
    globalContext.appContext.flags = globalContext.appContext.flags || {};
    globalContext.appContext.flags.setupMode = isSetupMode;
    telemetry?.mark?.('app-bootstrap-start');
    if (isSetupMode) {
        telemetry?.time?.('init.setupWizard', () => initSetupWizard());
        telemetry?.time?.('init.printerSelector', () => initPrinterSelector());
        const eventKey = eventRegistry?.keys?.PRINTER_SELECTOR || 'printerSelector';
        const phase = eventRegistry?.phases?.COMPONENT;
        eventRegistry?.bindEvent?.(eventKey, phase);
        telemetry?.mark?.('app-bootstrap-end');
        telemetry?.measure?.('app.bootstrap', 'app-bootstrap-start', 'app-bootstrap-end');
        return;
    }
    telemetry?.time?.('init.statusPanel', () => initStatusPanel());
    const statusMonitor = telemetry?.time?.('init.statusMonitor', () => initStatus());
    const stateStream = telemetry?.time?.('init.stateStream', () => initStateStream());
    telemetry?.time?.('init.printerSelector', () => initPrinterSelector());
    telemetry?.time?.('init.filesUpdater', () => initFilesUpdater());
    telemetry?.time?.('init.skipObjects', () => initSkipObjectsModal());
    telemetry?.time?.('init.controls', () => initControls());
    telemetry?.time?.('init.fileExplorer', () => initFileExplorer());
    telemetry?.time?.('init.cameraViewer', () => initCameraViewer());
    const cameraUI = telemetry?.time?.('init.cameraUI', () => initCameraUI());
    telemetry?.time?.('init.settingsModal', () => initSettingsModal());
    const bindAllEvents = () => {
        if (eventRegistry?.bindAllEvents) {
            eventRegistry.bindAllEvents();
        }
    };
    bindAllEvents();
    let bindAttempts = 0;
    const scheduleRebind = () => {
        bindAttempts += 1;
        if (bindAttempts > 8) {
            return;
        }
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                bindAllEvents();
                scheduleRebind();
            });
        } else {
            setTimeout(() => {
                bindAllEvents();
                scheduleRebind();
            }, 50);
        }
    };
    scheduleRebind();
    statusMonitor?.init?.();
    stateStream?.init?.();
    cameraUI?.init?.();
    smoke?.autoRun?.();
    telemetry?.mark?.('app-bootstrap-end');
    telemetry?.measure?.('app.bootstrap', 'app-bootstrap-start', 'app-bootstrap-end');
};

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrapApp);
    } else {
        bootstrapApp();
    }
}

export {
    initStatusPanel,
    initStatus,
    initFilesUpdater,
    initControls,
    initPrinterSelector,
    initFileExplorer,
    initCameraViewer,
    initCameraUI,
    initPrintSetup,
    initSkipObjectsModal,
    initTransferOverlay,
};
