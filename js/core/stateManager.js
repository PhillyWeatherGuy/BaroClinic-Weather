export const stateManager = {
    BASE_URL: 'https://baroclinic-data-proxy.andrew-n-orsini.workers.dev/', 
    manifest: null,
    initTime: null,
    loadedChunkBitmaps: {},
    chunkPixelData: {},
    globalSteps: [],
    activeFrameState: null,
    currentStepIndex: 0,
    activeModelRun: null,
    loadGeneration: 0 // 🌟 Cancellation token to abort stale background promises
};