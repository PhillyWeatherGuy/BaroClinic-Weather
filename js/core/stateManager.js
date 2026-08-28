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
    activeModel: 'ecmwf',    // 🌟 Active Model ID
    activeParam: '2t',       // 🌟 Active Parameter ID (e.g. '2t', 'tp')
    currentMapStyle: null,   // 🌟 Active MapTiler Basemap Style URL
    currentTheme: 'light',   // 🌟 Active Theme ('light' | 'dark')
    activeView: '2d',        // 🌟 Active Projection/View ('2d' | '3d' | 'polar')
    loadGeneration: 0        // 🌟 Cancellation token to abort stale background promises
};
