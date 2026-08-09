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

    try {
        initLayer();
    } catch (err) {}

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

            preloadRemainingChunks(stateManager.loadGeneration);
        } catch (err) {
            showToast('❌ ' + err.message);
        }
    }
});

// Canvas for pixel inspection
const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = 1;
sampleCanvas.height = 1;
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

map.on('click', (e) => {
    if (!stateManager.manifest || !stateManager.activeFrameState || !stateManager.activeFrameState.chunkImg) return;

    let lng = ((e.lngLat.lng % 360) + 360) % 360;
    if (lng > 180) lng -= 360;

    const normX = (lng + 180) / 360;
    const latRad = e.lngLat.lat * Math.PI / 180;
    const mercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const normY = 0.5 - (mercY / (2 * Math.PI));

    if (normY < 0 || normY > 1) return;

    const frameW = stateManager.manifest.frame_width;
    const frameH = stateManager.manifest.frame_height;

    sampleCtx.clearRect(0, 0, 1, 1);
    sampleCtx.drawImage(
        stateManager.activeFrameState.chunkImg,
        stateManager.activeFrameState.col * frameW + Math.floor(normX * frameW), 
        stateManager.activeFrameState.row * frameH + Math.floor(normY * frameH), 1, 1,
        0, 0, 1, 1
    );

    const rawGrayValue = sampleCtx.getImageData(0, 0, 1, 1).data[0];
    const minK = stateManager.manifest.temp_min_k || 210.0;
    const maxK = stateManager.manifest.temp_max_k || 330.0;
    const tempK = minK + (rawGrayValue / 255.0) * (maxK - minK);
    const tempC = tempK - 273.15;

    popup.setLngLat(e.lngLat)
         .setHTML(`<div class="temp-f">${((tempC * 9/5) + 32).toFixed(1)}°F</div><div class="temp-c">${tempC.toFixed(1)}°C</div>`)
         .addTo(map);
});