const ensureAppContext = (global = typeof window !== 'undefined' ? window : globalThis) => {
    const context = global.appContext || (global.appContext = {});
    context.servicesByModule = context.servicesByModule || {};
    context.storesByModule = context.storesByModule || {};
    context.actionsByModule = context.actionsByModule || {};
    context.selectorsByModule = context.selectorsByModule || {};
    context.services = context.services || {};
    context.stores = context.stores || {};
    context.events = context.events || {};
    context.utils = context.utils || {};
    context.actions = context.actions || {};
    context.selectors = context.selectors || {};
    context.components = context.components || {};
    return context;
};

const registerServiceModule = (global, moduleName, services) => {
    if (!moduleName || !services) {
        return ensureAppContext(global);
    }
    const context = ensureAppContext(global);
    context.servicesByModule[moduleName] = services;
    context.services = {
        ...context.services,
        ...services,
    };
    return context;
};

const registerStoreModule = (global, moduleName, store) => {
    if (!moduleName || !store) {
        return ensureAppContext(global);
    }
    const context = ensureAppContext(global);
    context.storesByModule[moduleName] = store;
    context.stores = {
        ...context.stores,
        [moduleName]: store,
    };
    return context;
};

const registerActionModule = (global, moduleName, actions) => {
    if (!moduleName || !actions) {
        return ensureAppContext(global);
    }
    const context = ensureAppContext(global);
    context.actionsByModule[moduleName] = actions;
    context.actions = {
        ...context.actions,
        ...actions,
    };
    return context;
};

const registerSelectorModule = (global, moduleName, selectors) => {
    if (!moduleName || !selectors) {
        return ensureAppContext(global);
    }
    const context = ensureAppContext(global);
    context.selectorsByModule[moduleName] = selectors;
    context.selectors = {
        ...context.selectors,
        ...selectors,
    };
    return context;
};

const getServiceModule = (global, moduleName) => {
    const context = ensureAppContext(global);
    return context.servicesByModule[moduleName] || null;
};

const getStoreModule = (global, moduleName) => {
    const context = ensureAppContext(global);
    return context.storesByModule[moduleName] || null;
};

const getActionModule = (global, moduleName) => {
    const context = ensureAppContext(global);
    return context.actionsByModule[moduleName] || null;
};

const getSelectorModule = (global, moduleName) => {
    const context = ensureAppContext(global);
    return context.selectorsByModule[moduleName] || null;
};

export {
    ensureAppContext,
    registerServiceModule,
    registerStoreModule,
    registerActionModule,
    registerSelectorModule,
    getServiceModule,
    getStoreModule,
    getActionModule,
    getSelectorModule,
};
export default ensureAppContext;
