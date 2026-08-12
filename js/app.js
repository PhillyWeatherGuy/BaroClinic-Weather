// js/app.js
import { stateManager } from './core/stateManager.js';
import { fetchManifest, loadChunkBitmap, preloadRemainingChunks } from './core/dataLoader.js';
import { createScalarShaderLayer } from './shaders/scalarShader.js';
import { initHubTransition } from './components/homeScreen.js'; 
import { 
    initViewerUI, 
    syncTimelineWithManifest, 
    syncModelRunDropdown,
    setShaderLayerReference,
    updateSliderTrackAndBounds,
    initGlobeToggle,
    showToast, 
    hideToast 
} from './components/viewerUI.js';

import { initCityTempOverlay, updateCityTemperatures } from './layers/cityTempOverlay.js';
import { initThreeGlobe, updateThreeGlobeFrame } from './layers/threeGlobe.js'; // 🌟 Three.js 3D Globe
import { initVectorContours, updateVectorContours, preloadAllContours } from './layers/vectorContours.js'; // 🌟 Parameter Contour Loader & Preloader

let customShaderLayer = null;
let renderDebounceId = null;

const popup = new maplibregl.Popup({ closeButton: false });

const map = new maplibregl.Map({
    container: 'map',
    style: 'https://api.maptiler.com/maps/019fc9f8-1ca6-7efe-b666-aba0ef35bce8/style.json?key=f9fTA5Ce0HKefPDICSVG',
    center: [-74.4, 39.3], 
    zoom: 7
});

function initLayer() {
    customShaderLayer = createScalarShaderLayer(map);
    setShaderLayerReference(customShaderLayer);
    
    let firstOverlayId = null;
    const layers = map.getStyle().layers || [];
    for (const layer of layers) {
        if (layer.type === 'line' || layer.type === 'symbol') {
            firstOverlayId = layer.id;
            break;
        }
    }
    map.addLayer(customShaderLayer, firstOverlayId);
}

async function renderFrame(globalIdx) {
    if (!stateManager.manifest || !stateManager.globalSteps || stateManager.globalSteps.length === 0) return;
    
    const frameInfo = stateManager.globalSteps[globalIdx];
    if (!frameInfo) return;

    const chunkIdx = frameInfo.chunkIndex;
    const chunkInfo = stateManager.manifest.chunks[chunkIdx];

    if (!stateManager.loadedChunkBitmaps[chunkIdx]) {
        try {
            const bitmap = await loadChunkBitmap(chunkIdx, stateManager.loadGeneration);
            if (customShaderLayer) {
                customShaderLayer.preloadChunkTexture(chunkIdx, bitmap);
            }
            updateSliderTrackAndBounds();
        } catch (err) {
            return;
        }
    }

    stateManager.activeFrameState = {
        chunkIndex: chunkIdx,
        col: frameInfo.col,
        row: frameInfo.row,
        chunkImg: stateManager.loadedChunkBitmaps[chunkIdx],
        uvOffset: [frameInfo.col / chunkInfo.columns, frameInfo.row / chunkInfo.rows],
        uvScale: [1.0 / chunkInfo.columns, 1.0 / chunkInfo.rows]
    };
    
    if (customShaderLayer) {
        customShaderLayer.updateFrame(stateManager.activeFrameState);
    }

    // 🌟 Update 3D Three.js Globe Frame Texture
    updateThreeGlobeFrame(stateManager.activeFrameState);

    // 🌟 Update 2D City Temperature Callouts
    updateCityTemperatures(map, stateManager.activeFrameState, stateManager.manifest);

    // 🌟 Fetch Static Vector Contours from CDN (~5ms / 0ms if RAM cached)
    updateVectorContours(frameInfo.step);
}

initViewerUI((stepIndex) => {
    if (renderDebounceId) cancelAnimationFrame(renderDebounceId);
    renderDebounceId = requestAnimationFrame(() => renderFrame(stepIndex));
});

map.on('load', async () => {
    initHubTransition();

    // 🌟 Initialize Three.js 3D Globe Engine
    try {
        initThreeGlobe();
    } catch (err) {
        console.error("Three.js globe init error:", err);
    }

    try {
        await fetchManifest();
    } catch (err) {
        showToast('❌ ' + err.message);
    }

    // 1. Initialize Base Weather Heatmap Layer
    try {
        initLayer();
    } catch (err) {}

    // 2. Initialize Master Vector Contour Layer
    try {
        initVectorContours(map);
    } catch (err) {
        console.error("Vector contours init error:", err);
    }

    // 3. Initialize Top Overlay Callouts
    try {
        initCityTempOverlay(map);
    } catch (err) {}

    try {
        syncModelRunDropdown();
    } catch (err) {}

    try {
        initGlobeToggle(map);
    } catch (err) {}

    if (stateManager.manifest && stateManager.manifest.chunks) {
        try {
            const bitmap0 = await loadChunkBitmap(0, stateManager.loadGeneration);
            if (customShaderLayer) {
                customShaderLayer.preloadChunkTexture(0, bitmap0);
            }

            syncTimelineWithManifest();
            await renderFrame(0);
            hideToast();

            // 🌟 Background preload image chunks & parameter-specific vector contours
            preloadRemainingChunks(stateManager.loadGeneration, customShaderLayer, updateSliderTrackAndBounds);
            preloadAllContours(stateManager.loadGeneration);
        } catch (err) {
            showToast('❌ ' + err.message);
        }
    }
});

// 🌟 Direct Uint8 Pixel Inspection on Click
map.on('click', (e) => {
    if (!stateManager.manifest || !stateManager.activeFrameState) return;

    const chunkIdx = stateManager.activeFrameState.chunkIndex;
    const pixelData = stateManager.chunkPixelData[chunkIdx];
    if (!pixelData) return;

    let lng = ((e.lngLat.