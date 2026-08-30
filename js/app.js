// js/app.js
import { stateManager } from './core/stateManager.js';
import { fetchManifest, loadChunkBitmap, purgeAllAppMemory } from './core/dataLoader.js';
import { createScalarShaderLayer } from './shaders/scalarShader.js';
import { createPrecipShaderLayer } from './shaders/precipShader.js';
import { initHubTransition } from './components/homeScreen.js'; 
import { 
    initViewerUI, 
    syncTimelineWithManifest, 
    syncModelRunDropdown,
    setShaderLayerReference,
    updateSliderTrackAndBounds,
    showToast, 
    hideToast 
} from './components/viewerUI.js';

// 🌟 Universal overlays & 3D Globe
import { initCityOverlay, updateCityCallouts, decodePixelValue, formatParameterValue } from './layers/cityOverlay.js'; 
import { initThreeGlobe, updateThreeGlobeFrame, updateThreeGlobePalette, showThreeGlobe, hideThreeGlobe, clearThreeGlobeTextures } from './layers/threeGlobe.js';
import { initVectorContours, updateVectorContours, preloadAllContours } from './layers/vectorContours.js';

// 🌟 Dedicated 2D North Polar Stereographic Engine
import { initPolarMap, updatePolarFrame, updatePolarPalette, showPolarMap, hidePolarMap, clearPolarTextures, zoomPolarAtPoint } from './layers/polarMap.js';

// 🌟 Import Light and Dark Palette Resolvers
import { getPaletteForParameter as getLightPalette } from './config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from './config/darkPalettes.js';

let customShaderLayer = null;
let renderDebounceId = null;

const popup = new maplibregl.Popup({ closeButton: false });

const map = new maplibregl.Map({
    container: 'map',
    style: 'https://api.maptiler.com/maps/019fc9f8-1ca6-7efe-b666-aba0ef35bce8/style.json?key=f9fTA5Ce0HKefPDICSVG',
    center: [-74.4, 39.3], 
    zoom: 7,
    keyboard: false
});

/**
 * 🌟 DYNAMIC BASEMAP STYLE SWITCHER
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

/**
 * 🌟 DYNAMIC 3-WAY PROJECTION / VIEW SWITCHER (With VRAM Unloading)
 */
export function applyView(targetView) {
    stateManager.activeView = targetView;

    if (targetView === '2d') {
        hideThreeGlobe();
        hidePolarMap();
        
        clearThreeGlobeTextures();
        clearPolarTextures();

        const mapDiv = document.getElementById('map');
        if (mapDiv) mapDiv.style.display = 'block';
        if (map) map.resize();

        if (stateManager.activeFrameState && customShaderLayer) {
            customShaderLayer.updateFrame(stateManager.activeFrameState);
            try { updateCityCallouts(map, stateManager.activeFrameState, stateManager.manifest); } catch (e) {}
            if (stateManager.globalSteps && stateManager.globalSteps[stateManager.currentStepIndex]) {
                updateVectorContours(stateManager.globalSteps[stateManager.currentStepIndex].step);
            }
        }
        console.log("🗺️ [App Engine] 2D MapLibre Mercator Activated (3D VRAM Cleared)");
    } else if (targetView === '3d') {
        hidePolarMap();
        clearPolarTextures();

        showThreeGlobe('3d');

        if (stateManager.activeFrameState) {
            updateThreeGlobeFrame(stateManager.activeFrameState);
        }
        console.log("🌐 [App Engine] 3D Earth Globe Activated (Polar VRAM Cleared)");
    } else if (targetView === 'polar') {
        hideThreeGlobe();
        clearThreeGlobeTextures();

        showPolarMap();

        if (stateManager.activeFrameState) {
            updatePolarFrame(stateManager.activeFrameState);
        }
        console.log("❄️ [App Engine] 2D Polar Stereographic Activated (3D VRAM Cleared)");
    }
}

/**
 * 🌟 CURSOR-CENTERED KEYBOARD ZOOM HANDLER (+ / - Keys)
 */
export function handleKeyboardZoom(direction, x, y) {
    const activeView = stateManager.activeView || '2d';

    if (activeView === '2d' && map) {
        const targetLngLat = map.unproject([x, y]);
        const deltaZoom = direction > 0 ? 0.65 : -0.65;
        map.easeTo({
            zoom: map.getZoom() + deltaZoom,
            around: targetLngLat,
            duration: 150
        });
    } else if (activeView === 'polar') {
        if (typeof zoomPolarAtPoint === 'function') {
            zoomPolarAtPoint(direction, x, y);
        }
    }
}

/**
 * 🌟 DYNAMIC THEME APPLIER (DARK / LIGHT MODE)
 */
export async function applyTheme(theme) {
    try {
        const resp = await fetch('./config/models.json');
        if (resp.ok) {
            const data = await resp.json();
            const paramConfig = data?.parameters?.[stateManager.activeParam];
            if (paramConfig) {
                const targetStyle = theme === 'dark'
                    ? (paramConfig.map_style_dark || paramConfig.map_style)
                    : (paramConfig.map_style_light || paramConfig.map_style);
                if (targetStyle) {
                    updateBasemapStyle(targetStyle);
                }
            }
        }
    } catch (err) {
        console.warn("Could not resolve theme basemap URL:", err);
    }

    const paletteFunc = (theme === 'dark') ? getDarkPalette : getLightPalette;
    const newPalette = paletteFunc(stateManager.activeParam);

    if (customShaderLayer && typeof customShaderLayer.updatePalette === 'function') {
        customShaderLayer.updatePalette(newPalette);
    }
    try {
        updateThreeGlobePalette(newPalette);
    } catch (e) {}
    try {
        updatePolarPalette(newPalette);
    } catch (e) {}
}

export function initLayer(shaderType = null) {
    if (map.getLayer('weather-gpu-shader')) {
        map.removeLayer('weather-gpu-shader');
    }
    if (customShaderLayer) {
        customShaderLayer.clearTextures();
        customShaderLayer = null;
    }

    const chosenShader = shaderType || stateManager.activeShader || 'scalar';

    if (chosenShader === 'precip') {
        customShaderLayer = createPrecipShaderLayer(map);
    } else {
        customShaderLayer = createScalarShaderLayer(map);
    }
    setShaderLayerReference(customShaderLayer);
    
    const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
    if (customShaderLayer && typeof customShaderLayer.updatePalette === 'function') {
        customShaderLayer.updatePalette(paletteFunc(stateManager.activeParam));
    }

    let firstOverlayId = null;
    const layers = map.getStyle().layers || [];
    for (const layer of layers) {
        const id = layer.id.toLowerCase();
        if (layer.type === 'symbol' || id.includes('admin') || id.includes('boundary') || id.includes('border') || id.includes('road')) {
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
            await loadChunkBitmap(chunkIdx, stateManager.loadGeneration);
            updateSliderTrackAndBounds();
        } catch (err) {
            return;
        }
    }

    const chunkObj = stateManager.loadedChunkBitmaps[chunkIdx];
    if (!chunkObj) return;

    const frameW = stateManager.manifest.frame_width || 1440;
    const frameH = stateManager.manifest.frame_height || 721;
    const frameSize = frameW * frameH;
    const fOffset = frameInfo.frameOffset !== undefined ? frameInfo.frameOffset : frameInfo.col;

    let activeFrameImg;
    let uvOffset = [0.0, 0.0];
    let uvScale = [1.0, 1.0];
    let frameSlice = null;

    // 🌟 Check if chunk is sequential binary time-buffer (.bin)
    if (chunkObj.isBinaryChunk || chunkObj.isBinary) {
        const byteStart = fOffset * frameSize;
        const byteEnd = byteStart + frameSize;
        frameSlice = chunkObj.data.subarray(byteStart, byteEnd);

        activeFrameImg = {
            data: frameSlice,
            width: frameW,
            height: frameH,
            isSingleFrame: true
        };
        uvOffset = [0.0, 0.0];
        uvScale = [1.0, 1.0];
    } else {
        // Fallback for legacy 2D spritesheet image
        activeFrameImg = chunkObj;
        const cols = chunkInfo.columns || 1;
        const rows = chunkInfo.rows || 1;
        uvOffset = [frameInfo.col / cols, frameInfo.row / rows];
        uvScale = [1.0 / cols, 1.0 / rows];
    }

    stateManager.activeFrameState = {
        chunkIndex: chunkIdx,
        frameOffset: fOffset,
        frameSlice: frameSlice,
        col: frameInfo.col,
        row: frameInfo.row,
        chunkImg: activeFrameImg,
        uvOffset: uvOffset,
        uvScale: uvScale,
        frameWidth: frameW,
        frameHeight: frameH
    };
    
    // 🌟 Update only the currently ACTIVE view engine
    const activeView = stateManager.activeView || '2d';

    if (activeView === '2d') {
        if (customShaderLayer) {
            customShaderLayer.updateFrame(stateManager.activeFrameState);
        }
        try {
            updateCityCallouts(map, stateManager.activeFrameState, stateManager.manifest);
        } catch (e) {}
        updateVectorContours(frameInfo.step);
    } else if (activeView === '3d') {
        updateThreeGlobeFrame(stateManager.activeFrameState);
    } else if (activeView === 'polar') {
        updatePolarFrame(stateManager.activeFrameState);
    }
}

/**
 * 🌟 SEQUENTIAL PRELOADER
 */
export async function preloadRemainingChunks(currentGen) {
    if (!stateManager.manifest || !stateManager.manifest.chunks) return;
    const totalChunks = stateManager.manifest.chunks.length;

    for (let i = 1; i < totalChunks; i++) {
        if (currentGen !== stateManager.loadGeneration) break;

        if (!stateManager.loadedChunkBitmaps[i]) {
            try {
                await loadChunkBitmap(i, currentGen);
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

initViewerUI(
    (stepIndex) => {
        if (renderDebounceId) cancelAnimationFrame(renderDebounceId);
        renderDebounceId = requestAnimationFrame(() => renderFrame(stepIndex));
    },
    (newTheme) => {
        applyTheme(newTheme);
    },
    (newView) => {
        applyView(newView);
    },
    (direction, x, y) => {
        handleKeyboardZoom(direction, x, y);
    }
);

map.on('load', async () => {
    stateManager.currentMapStyle = 'https://api.maptiler.com/maps/019fc9f8-1ca6-7efe-b666-aba0ef35bce8/style.json?key=f9fTA5Ce0HKefPDICSVG';
    initHubTransition();

    // 1. Initialize 3D Globe Engine
    try {
        initThreeGlobe();
    } catch (err) {
        console.error("Three.js globe init error:", err);
    }

    // 2. Initialize 2D Polar Stereographic Engine
    try {
        initPolarMap();
    } catch (err) {
        console.error("Polar map init error:", err);
    }

    // 3. Explicitly fetch ECMWF 2m Temperature on initial startup
    try {
        await fetchManifest(null, 'ecmwf', '2t');
    } catch (err) {
        showToast('❌ ' + err.message);
    }

    // 4. Initialize Base Weather Heatmap Layer
    try {
        initLayer();
    } catch (err) {}

    // 5. Initialize Master Vector Contour Layer
    try {
        initVectorContours(map);
    } catch (err) {
        console.error("Vector contours init error:", err);
    }

    // 6. Initialize Master City Overlay
    try {
        initCityOverlay(map);
    } catch (err) {}

    try {
        syncModelRunDropdown();
    } catch (err) {}

    if (stateManager.manifest && stateManager.manifest.chunks) {
        try {
            await loadChunkBitmap(0, stateManager.loadGeneration);
            syncTimelineWithManifest();
            await renderFrame(0);
            hideToast();

            preloadRemainingChunks(stateManager.loadGeneration);
            preloadAllContours(stateManager.loadGeneration);
        } catch (err) {
            showToast('❌ ' + err.message);
        }
    }
});

// 🌟 Smooth Bilinear Interpolation on Click
map.on('click', (e) => {
    if (!stateManager.manifest || !stateManager.activeFrameState) return;

    const frameState = stateManager.activeFrameState;
    const frameW = frameState.frameWidth || stateManager.manifest.frame_width || 1440;
    const frameH = frameState.frameHeight || stateManager.manifest.frame_height || 721;

    let pixelData = frameState.frameSlice;
    if (!pixelData) {
        const chunkIdx = frameState.chunkIndex;
        pixelData = stateManager.chunkPixelData[chunkIdx];
    }
    if (!pixelData) return;

    let lng = ((e.lngLat.lng % 360) + 360) % 360;
    if (lng > 180) lng -= 360;

    const normX = (lng + 180.0) / 360.0;
    const normY = (90.0 - e.lngLat.lat) / 180.0;

    if (normY < 0 || normY > 1) return;

    const contX = (((normX % 1) + 1) % 1) * frameW;
    const contY = Math.min(Math.max(normY * (frameH - 1), 0), frameH - 1);

    const x0 = Math.floor(contX) % frameW;
    const x1 = (x0 + 1) % frameW;
    const y0 = Math.floor(contY);
    const y1 = Math.min(y0 + 1, frameH - 1);

    const fracX = contX - Math.floor(contX);
    const fracY = contY - y0;

    let v00, v10, v01, v11;

    if (frameState.frameSlice) {
        // Clean single-frame buffer indexing
        v00 = pixelData[y0 * frameW + x0];
        v10 = pixelData[y0 * frameW + x1];
        v01 = pixelData[y1 * frameW + x0];
        v11 = pixelData[y1 * frameW + x1];
    } else {
        // Legacy spritesheet fallback
        const chunkInfo = stateManager.manifest.chunks[frameState.chunkIndex];
        const sheetW = chunkInfo.sheet_width || (frameW * (chunkInfo.columns || 1));
        const colOffset = frameState.col * frameW;
        const rowOffset = frameState.row * frameH;
        v00 = pixelData[(rowOffset + y0) * sheetW + (colOffset + x0)];
        v10 = pixelData[(rowOffset + y0) * sheetW + (colOffset + x1)];
        v01 = pixelData[(rowOffset + y1) * sheetW + (colOffset + x0)];
        v11 = pixelData[(rowOffset + y1) * sheetW + (colOffset + x1)];
    }

    if (v00 === undefined) return;

    const d00 = decodePixelValue(v00, stateManager.manifest);
    const d10 = decodePixelValue(v10 ?? v00, stateManager.manifest);
    const d01 = decodePixelValue(v01 ?? v00, stateManager.manifest);
    const d11 = decodePixelValue(v11 ?? v00, stateManager.manifest);

    const top = d00 * (1.0 - fracX) + d10 * fracX;
    const bottom = d01 * (1.0 - fracX) + d11 * fracX;
    const decodedVal = top * (1.0 - fracY) + bottom * fracY;

    const formattedText = formatParameterValue(decodedVal, stateManager.manifest);
    const paramName = stateManager.manifest.name || stateManager.manifest.parameter || 'Value';

    popup.setLngLat(e.lngLat)
         .setHTML(`<div class="temp-f">${formattedText}</div><div class="temp-c">${paramName}</div>`)
         .addTo(map);
});
