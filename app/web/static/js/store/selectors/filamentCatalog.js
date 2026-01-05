const createFilamentCatalogSelectors = () => ({
    getItems: (snapshot) => snapshot?.filamentCatalog || [],
    getUpdatedAt: (snapshot) => snapshot?.filamentCatalogUpdatedAt || null,
});

export { createFilamentCatalogSelectors };
export default createFilamentCatalogSelectors;
