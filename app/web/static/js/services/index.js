import createApiService from './api.js';
import createStatusService from './statusService.js';
import createControlsService from './controlsService.js';
import createFilamentService from './filamentService.js';
import createPrinterService from './printerService.js';
import createFileService from './fileService.js';
import createStateStreamService from './stateStreamService.js';
import createAuthService from './authService.js';
import createCameraService from './cameraService.js';
import { registerServiceModule } from '../core/registry.js';

const initServices = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const services = {
        api: createApiService(global),
        status: createStatusService(global),
        controls: createControlsService(global),
        filaments: createFilamentService(global),
        printers: createPrinterService(global),
        files: createFileService(global),
        stateStream: createStateStreamService(global),
        auth: createAuthService(global),
        camera: createCameraService(global),
    };
    registerServiceModule(global, 'api', { api: services.api });
    registerServiceModule(global, 'status', { status: services.status });
    registerServiceModule(global, 'controls', { controls: services.controls });
    registerServiceModule(global, 'filaments', { filaments: services.filaments });
    registerServiceModule(global, 'printers', { printers: services.printers });
    registerServiceModule(global, 'files', { files: services.files });
    registerServiceModule(global, 'stateStream', { stateStream: services.stateStream });
    registerServiceModule(global, 'auth', { auth: services.auth });
    registerServiceModule(global, 'camera', { camera: services.camera });
    registerServiceModule(global, 'core', services);
    return services;
};

export { initServices };
export default initServices;
