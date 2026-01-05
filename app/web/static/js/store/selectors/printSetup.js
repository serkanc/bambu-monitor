const createPrintSetupSelectors = () => ({
    getIsOpen: (snapshot) => Boolean(snapshot?.ui?.printSetup?.isOpen),
    getMetadata: (snapshot) => snapshot?.ui?.printSetup?.metadata || null,
    getCurrentPlateIndex: (snapshot) => snapshot?.ui?.printSetup?.currentPlateIndex ?? 0,
    getAmsMapping: (snapshot) => snapshot?.ui?.printSetup?.amsMapping || [],
    getCurrentTrayMeta: (snapshot) => snapshot?.ui?.printSetup?.currentTrayMeta || [],
    getCurrentFilamentGroups: (snapshot) => snapshot?.ui?.printSetup?.currentFilamentGroups || [],
    getTypeMismatchMessages: (snapshot) => snapshot?.ui?.printSetup?.typeMismatchMessages || [],
    getBusyWarningText: (snapshot) => snapshot?.ui?.printSetup?.busyWarningText || '',
    getAmsExternalWarningText: (snapshot) => snapshot?.ui?.printSetup?.amsExternalWarningText || '',
    getNozzleWarningText: (snapshot) => snapshot?.ui?.printSetup?.nozzleWarningText || '',
    getNozzleMismatch: (snapshot) => Boolean(snapshot?.ui?.printSetup?.nozzleMismatch),
    getPlateMappings: (snapshot) => snapshot?.ui?.printSetup?.plateMappings || {},
    getAutoAssignedPlates: (snapshot) => snapshot?.ui?.printSetup?.autoAssignedPlates || {},
    getPlateFiles: (snapshot) => snapshot?.ui?.printSetup?.plateFiles || [],
    getPlateFilamentIds: (snapshot) => snapshot?.ui?.printSetup?.plateFilamentIds || [],
    getMaxFilamentId: (snapshot) => snapshot?.ui?.printSetup?.maxFilamentId ?? 0,
    getPlatePreviewUrls: (snapshot) => snapshot?.ui?.printSetup?.platePreviewUrls || [],
    getExternalSlotValue: (snapshot) => snapshot?.ui?.printSetup?.externalSlotValue ?? -2,
    getExternalFocusIndex: (snapshot) => snapshot?.ui?.printSetup?.externalFocusIndex ?? null,
    getPendingFileURL: (snapshot) => snapshot?.ui?.printSetup?.pendingFileURL ?? null,
    getIsSubmitting: (snapshot) => Boolean(snapshot?.ui?.printSetup?.isSubmitting),
    getLastError: (snapshot) => snapshot?.ui?.printSetup?.lastError || null,
    getPrinter: (snapshot) => snapshot?.printer || null,
    getAms: (snapshot) => snapshot?.ams || null,
});

export { createPrintSetupSelectors };
export default createPrintSetupSelectors;
