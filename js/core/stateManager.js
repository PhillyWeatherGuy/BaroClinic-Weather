export const stateManager = {
    BASE_URL: 'https://baroclinic-data-proxy.andrew-n-orsini.workers.dev/', 
    manifest: null,
    initTime: null,
    loadedChunkBitmaps: {},
    chunkPixelData: {}, // 🌟 INSTANT CPU MEMORY CACHE for zero-lag temperature lookups
    globalSteps: [],
    activeFrameState: null,
    currentStepIndex: 0,
    activeModelRun: null
};