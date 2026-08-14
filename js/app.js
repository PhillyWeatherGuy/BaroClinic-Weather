// js/app.js
import { stateManager } from './core/stateManager.js';
import { fetchManifest, loadChunkBitmap } from './core/dataLoader.js';
import { createScalarShaderLayer } from './shaders/scalarShader.js';
import { createPrecipShaderLayer } from './shaders/precipShader.js'; // 🌟 Added precipitation shader
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

import { initCityOverlay, updateCityCallouts } from './layers/cityOverlay.js'; // 🌟 Master Dynamic City Overlay
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

/**
 * 🌟 DYNAMIC BASEMAP STYLE SWITCHER
 * Switches MapTiler basemap style URL and re-attaches layers when style loads
 */
export function updateBasemapStyle(styleUrl) {
    if (!map || !styleUrl || stateManager.currentMapStyle === styleUrl) return;

    console.log(`[Map] Switching basemap style to: ${styleUrl}`);
    stateManager.currentMapStyle = styleUrl;

    const onStyleLoaded = () => {
        if (map.isStyleLoaded()) {
            map.off('styledata', onStyleLoaded);
            console.log("✅ New basemap style loaded. Re-attaching weather layers...");
            try {
                initLayer();
            } catch (e) {}
            try {
                initVectorContours(map);
            } catch (e) {}
            try {
                initCityOverlay(map);
            } catch (e) {}

            if (stateManager.currentStepIndex !== undefined) {
                renderFrame(stateManager.currentStepIndex);
            }
        }
    };

    map.on('styledata', onStyleLoaded);
    map.setStyle(styleUrl);
}

export function initLayer(shaderType = null) {
    if (map.getLayer('weather-gpu-shader')) {
        map.removeLayer('weather-gpu-shader');
    }
    if (customShaderLayer) {
        customShaderLayer.clearTextures();
        customShaderLayer = null;
    }

    // 🌟 Check activeShader dynamically instead of hardcoding 'tp' to precipShader
    const chosenShader = shaderType || stateManager.activeShader || 'scalar';

    if (chosenShader === 'precip') {
        customShaderLayer = createPrecipShaderLayer(map);
    } else {
        customShaderLayer = createScalarShaderLayer(map);
    }
    setShaderLayerReference(customShaderLayer);
    
    // 🌟 Re-upload any existing bitmaps in RAM straight to the GPU layer
    for (const chunkIdx in stateManager.loadedChunkBitmaps) {
        const bitmap = stateManager.loadedChunkBitmaps[chunkIdx];
        if (bitmap && customShaderLayer) {
            customShaderLayer.preloadChunkTexture(chunkIdx, bitmap);
        }
    }

    let firstOverlayId = null;
    const layers = map.getStyle().layers || [];
    for (const layer of layers) {
        if (layer.type === 'line' || layer.type === 'symbol') {
            firstOverlayId = layer.id;
            break;
        }
    }

    if (!map.getLayer('weather-gpu-shader')) {
        map.addLayer(customShaderLayer, firstOverlayId);
    }
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
    } else if (customShaderLayer && !customShaderLayer.chunkTextures[chunkIdx]) {
        // 🌟 SAFETY FIX: If bitmap is in RAM but missing from GPU VRAM, upload it immediately
        customShaderLayer.preloadChunkTexture(chunkIdx, stateManager.loadedChunkBitmaps[chunkIdx]);
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

    // 🌟 Update 2D City Callouts (Master Overlay handles units dynamically)
    try {
        updateCityCallouts(map, stateManager.activeFrameState, stateManager.manifest);
    } catch (e) {}

    // 🌟 Fetch Static Vector Contours from CDN (~5ms / 0ms if RAM cached)
    updateVectorContours(frameInfo.step);
}

/**
 * 🌟 SEQUENTIAL PRELOADER: Updates slider red/blue progress as each chunk finishes downloading
 */
export async function preloadRemainingChunks(currentGen) {
    if (!stateManager.manifest || !stateManager.manifest.chunks) return;
    const totalChunks = stateManager.manifest.chunks.length;

    for (let i = 1; i < totalChunks; i++) {
        if (currentGen !== stateManager.loadGeneration) break;

        if (!stateManager.loadedChunkBitmaps[i]) {
            try {
                const bitmap = await loadChunkBitmap(i, currentGen);
                if (currentGen === stateManager.loadGeneration) {
                    if (customShaderLayer) {
                        customShaderLayer.preloadChunkTexture(i, bitmap);
                    }
                }
                updateSliderTrackAndBounds();
            } catch (err) {
                if (err.message !== "Load cancelled") {
                    console.warn(`Background preload chunk ${i} paused:`, err);
                }
                break;
            }
        }
    }
}

initViewerUI((stepIndex) => {
    if (renderDebounceId) cancelAnimationFrame(renderDebounceId);
    renderDebounceId = requestAnimationFrame(() => renderFrame(stepIndex));
});

map.on('load', async () => {
    stateManager.currentMapStyle = 'https://api.maptiler.com/maps/019fc9f8-1ca6-7efe-b666-aba0ef35bce8/style.json?key=f9fTA5Ce0HKefPDICSVG';
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

    // 3. Initialize Master City Overlay
    try {
        initCityOverlay(map);
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
            preloadRemainingChunks(stateManager.loadGeneration);
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

    let lng = ((e.lngLat.lng % 360) + 360) % 360;
    if (lng > 180) lng -= 360;

    const normX = (lng + 180.0) / 360.0;
    // Equirectangular latitude conversion matching source chunk projection (+90°N to -90°S)
    const normY = (90.0 - e.lngLat.lat) / 180.0;

    if (normY < 0 || normY > 1) return;

    const frameW = stateManager.manifest.frame_width;
    const frameH = stateManager.manifest.frame_height;
    const chunkInfo = stateManager.manifest.chunks[chunkIdx];
    const sheetW = chunkInfo.sheet_width || (frameW * chunkInfo.columns);

    const px = Math.floor(normX * frameW);
    const py = Math.floor(normY * frameH);

    const sheetX = stateManager.activeFrameState.col * frameW + px;
    const sheetY = stateManager.activeFrameState.row * frameH + py;

    const pixelIdx = sheetY * sheetW + sheetX;
    const rawGrayValue = pixelData[pixelIdx];

    if (rawGrayValue === undefined) return;

    if (stateManager.activeParam === 'tp') {
        const minVal = stateManager.manifest.temp_min_k !== undefined ? stateManager.manifest.temp_min_k : 0.0;
        const maxVal = stateManager.manifest.temp_max_k !== undefined ? stateManager.manifest.temp_max_k : 0.762;
        let inches = minVal + (rawGrayValue / 255.0) * (maxVal - minVal);
        if (maxVal < 5.0) inches = inches * 39.3701;

        popup.setLngLat(e.lngLat)
             .setHTML(`<div class="temp-f">${inches.toFixed(2)}"</div><div class="temp-c">Total Accum. Precip</div>`)
             .addTo(map);
    } else {
        const minK = stateManager.manifest.temp_min_k !== undefined ? stateManager.manifest.temp_min_k : 210.0;
        const maxK = stateManager.manifest.temp_max_k !== undefined ? stateManager.manifest.temp_max_k : 330.0;
        const tempK = minK + (rawGrayValue / 255.0) * (maxK - minK);
        const tempC = tempK - 273.15;

        popup.setLngLat(e.lngLat)
             .setHTML(`<div class="temp-f">${((tempC * 9/5) + 32).toFixed(1)}°F</div><div class="temp-c">${tempC.toFixed(1)}°C</div>`)
             .addTo(map);
    }
});