// js/app.js
import { stateManager } from './core/stateManager.js';
import { fetchManifest, loadChunkBitmap } from './core/dataLoader.js';
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

// 🌟 Responsive Zoom: Fits CONUS on Mobile (3.2) and Desktop (4.2)
const initialZoom = window.innerWidth < 768 ? 3.2 : 4.2;

const map = new maplibregl.Map({
    container: 'map',
    style: 'https://cdn.jsdelivr.net/gh/phillyweatherguy/BaroClinic-Weather---Backend@main/custom-style-transparent.json',
    center: [-98.5795, 39.8283], // 🌟 Centered on Continental United States (Lebanon, KS)
    zoom: initialZoom
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

    const minK = stateManager.manifest.temp_min_k !== undefined ? stateManager.manifest.temp_min_k : 210.0;
    const maxK = stateManager.manifest.temp_max_k !== undefined ? stateManager.manifest.temp_max_k : 330.0;
    const tempK = minK + (rawGrayValue / 255.0) * (maxK - minK);
    const tempC = tempK - 273.15;

    popup.setLngLat(e.lngLat)
         .setHTML(`<div class="temp-f">${((tempC * 9/5) + 32).toFixed(1)}°F</div><div class="temp-c">${tempC.toFixed(1)}°C</div>`)
         .addTo(map);
});