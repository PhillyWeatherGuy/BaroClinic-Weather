// js/core/stateManager.js
export const stateManager = {
    BASE_URL: 'https://baroclinic-data-proxy.andrew-n-orsini.workers.dev/', 
    manifest: null,
    paramConfig: null,       // 🌟 Dynamic active parameter object from models.json
    initTime: null,
    loadedChunkBitmaps: {},
    chunkPixelData: {},
    globalSteps: [],
    activeFrameState: null,
    currentStepIndex: 0,
    activeModelRun: null,
    activeModel: 'ecmwf',    // 🌟 Active Model ID
    activeParam: '2t',       // 🌟 Active Parameter ID
    currentMapStyle: null,   // 🌟 Active Basemap Style URL
    currentTheme: 'light',   // 🌟 Active Theme ('light' | 'dark')
    activeView: '2d',        // 🌟 Active Projection ('2d' | '3d' | 'polar')
    loadGeneration: 0        // 🌟 Cancellation token
};
