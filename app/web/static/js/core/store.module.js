const globalObject = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : {};
const store = globalObject.appContext?.stores?.core ?? null;
const selectors = globalObject.appContext?.selectors ?? {};

export { store, selectors };
export default store;
