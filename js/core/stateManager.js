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
    activeRadarProduct: 'N0B', // 🌟 Active Single-Site Radar Product ('N0B' | 'N0U' | 'DAA' | 'N3P' | 'DTA')
    currentMapStyle: null,   // 🌟 Active Basemap Style URL
    currentTheme: 'light',   // 🌟 Active Theme ('light' | 'dark')
    activeView: '2d',        // 🌟 Active Projection ('2d' | '3d' | 'polar')
    loadGeneration: 0,       // 🌟 Cancellation token

    // 🛰️ Volumetric 3D & Multi-Tilt State
    activeRadarStation: 'KDIX', // Active radar site ID for Level 2 volume fetches
    activeTiltIndex: 0,         // Active elevation tilt index (0 = 0.5°, 1 = 0.9°, etc.)
    availableTilts: [],         // Elevation angles detected in active Level 2 volume
    boxSelectActive: false,     // Flag when map is armed to drag-select a storm
    selectedStormBounds: null,  // [minLng, minLat, maxLng, maxLat] of selected storm cell
    is3DVolumeActive: false     // Flag when 3D storm inspection viewport is open
};
