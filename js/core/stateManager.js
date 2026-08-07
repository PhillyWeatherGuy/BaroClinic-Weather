export const stateManager = {
    BASE_URL: 'https://baroclinic-data-proxy.andrew-n-orsini.workers.dev/', 
    manifest: null,
    initTime: null, // 🌟 ADDED THIS
    loadedChunkBitmaps: [],
    globalSteps: [],
    activeFrameState: null,
    currentStepIndex: 0
};