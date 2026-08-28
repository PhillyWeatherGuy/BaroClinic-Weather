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
    showToast, 
    hideToast 
} from './components/viewerUI.js';

// 🌟 Imported universal decoders from cityOverlay.js
import { initCityOverlay, updateCityCallouts, decodePixelValue, formatParameterValue } from './layers/cityOverlay.js'; 
import { initThreeGlobe, updateThreeGlobeFrame, updateThreeGlobePalette, showThreeGlobe, hideThreeGlobe } from './layers/threeGlobe.js'; // 🌟 Three.js 3D Globe & Polar Engine
import { initVectorContours, updateVectorContours, preloadAllContours } from './layers/vectorContours.js'; // 🌟 Parameter Contour Loader & Preloader

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

/**
 * 🌟 DYNAMIC PROJECTION / VIEW SWITCHER (2D Map, 3D Globe, Polar Stereographic)
 */
export function applyView(targetView) {
    stateManager.activeView = targetView;
    if (targetView === '2d') {
        hideThreeGlobe();
        if (map) map.resize();
    } else if (targetView === '3d') {
        showThreeGlobe('3d');
    } else if (targetView === 'polar') {
        showThreeGlobe('polar');
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
    
    // 🌟 Apply theme-aware palette immediately on creation
    const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
    if (customShaderLayer && typeof customShaderLayer.updatePalette === 'function') {
        customShaderLayer.updatePalette(paletteFunc(stateManager.activeParam));
    }

    // 🌟 Re-upload any existing bitmaps in RAM straight to the GPU layer
    for (const chunkIdx in stateManager.loadedChunkBitmaps) {
        const bitmap = stateManager.loadedChunkBitmaps[chunkIdx];
        if (bitmap && customShaderLayer) {
            customShaderLayer.preloadChunkTexture(chunkIdx, bitmap);
        }
    }

    // 🌟 Place weather layer above ocean/land fills, but below borders and labels
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
    }
);

map.on('load', async () => {
    stateManager.currentMapStyle = 'https://api.maptiler.com/maps/019fc9f8-1ca6-7efe-b666-aba0ef35bce8/style.json?key=f9fTA5Ce0HKefPDICSVG';
    initHubTransition();

    // 🌟 Initialize Three.js 3D Globe Engine
    try {
        initThreeGlobe();
    } catch (err) {
        console.error("Three.js globe init error:", err);
    }

    // 🌟 Explicitly fetch ECMWF 2m Temperature on initial startup
    try {
        await fetchManifest(null, 'ecmwf', '2t');
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

// 🌟 Smooth Bilinear Interpolation on Click (Matches GPU shader gradients 1:1)
map.on('click', (e) => {
    if (!stateManager.manifest || !stateManager.activeFrameState) return;

    const chunkIdx = stateManager.activeFrameState.chunkIndex;
    const pixelData = stateManager.chunkPixelData[chunkIdx];
    if (!pixelData) return;

    let lng = ((e.lngLat.lng % 360) + 360) % 360;
    if (lng > 180) lng -= 360;

    const normX = (lng + 180.0) / 360.0;
    const normY = (90.0 - e.lngLat.lat) / 180.0;

    if (normY < 0 || normY > 1) return;

    const frameW = stateManager.manifest.frame_width;
    const frameH = stateManager.manifest.frame_height;
    const chunkInfo = stateManager.manifest.chunks[chunkIdx];
    const sheetW = chunkInfo.sheet_width || (frameW * chunkInfo.columns);

    // 🌟 Continuous sub-pixel coordinates
    const contX = (((normX % 1) + 1) % 1) * frameW;
    const contY = Math.min(Math.max(normY * (frameH - 1), 0), frameH - 1);

    const x0 = Math.floor(contX) % frameW;
    const x1 = (x0 + 1) % frameW;
    const y0 = Math.floor(contY);
    const y1 = Math.min(y0 + 1, frameH - 1);

    const fracX = contX - Math.floor(contX);
    const fracY = contY - y0;

    const colOffset = stateManager.activeFrameState.col * frameW;
    const rowOffset = stateManager.activeFrameState.row * frameH;

    // Sample the 4 surrounding corner pixels
    const idx00 = (rowOffset + y0) * sheetW + (colOffset + x0);
    const idx10 = (rowOffset + y0) * sheetW + (colOffset + x1);
    const idx01 = (rowOffset + y1) * sheetW + (colOffset + x0);
    const idx11 = (rowOffset + y1) * sheetW + (colOffset + x1);

    const v00 = pixelData[idx00];
    const v10 = pixelData[idx10];
    const v01 = pixelData[idx01];
    const v11 = pixelData[idx11];

    if (v00 === undefined) return;

    // Decode all 4 corners into physical values
    const d00 = decodePixelValue(v00, stateManager.manifest);
    const d10 = decodePixelValue(v10 ?? v00, stateManager.manifest);
    const d01 = decodePixelValue(v01 ?? v00, stateManager.manifest);
    const d11 = decodePixelValue(v11 ?? v00, stateManager.manifest);

    // 🌟 Bilinear Interpolation across the 4 corners
    const top = d00 * (1.0 - fracX) + d10 * fracX;
    const bottom = d01 * (1.0 - fracX) + d11 * fracX;
    const decodedVal = top * (1.0 - fracY) + bottom * fracY;

    // Format display string based on dynamic manifest rules
    const formattedText = formatParameterValue(decodedVal, stateManager.manifest);
    const paramName = stateManager.manifest.name || stateManager.manifest.parameter || 'Value';

    popup.setLngLat(e.lngLat)
         .setHTML(`<div class="temp-f">${formattedText}</div><div class="temp-c">${paramName}</div>`)
         .addTo(map);
});
