export const stateManager = {
    BASE_URL: 'https://baroclinic-data-proxy.andrew-n-orsini.workers.dev/', 
    manifest: null,
    initTime: null,
    loadedChunkBitmaps: {}, // Changed from [] to {} for clean dictionary lookups
    globalSteps: [],
    activeFrameState: null,
    currentStepIndex: 0,
    activeModelRun: null
};