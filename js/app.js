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
import { initCityOverlay, updateCityCallouts, sampleBilinearValue, formatParameterValue } from './layers/cityOverlay.js'; 
import { initThreeGlobe, updateThreeGlobeFrame, updateThreeGlobePalette, showThreeGlobe, hideThreeGlobe, clearThreeGlobeTextures } from './layers/threeGlobe.js';
import { initVectorContours, updateVectorContours, preloadAllContours } from './layers/vectorContours.js';

// 🌟 Dedicated 2D North Polar Stereographic Engine
import { initPolarMap, updatePolarFrame, updatePolarPalette, showPolarMap, hidePolarMap, clearPolarTextures, zoomPolarAtPoint } from './layers/polarMap.js';

// 🌟 Import Light and Dark Palette Resolvers
import { getPaletteForParameter as getLightPalette } from './config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from './config/darkPalettes.js';

let customShaderLayer = null;
let renderDebounceId = null;
let threeGlobeInitialized = false;
let polarMapInitialized = false;

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
            try { initLayer(); } catch (e) {}
            try { initVectorContours(map); } catch (e) {}
            try { initCityOverlay(map); } catch (e) {}

            if (stateManager.currentStepIndex !== undefined) {
                renderFrame(stateManager.currentStepIndex);
            }
        }
    };

    map.on('styledata', onStyleLoaded);
    map.setStyle(styleUrl);
}

/**
 * 🌟 DYNAMIC 3-WAY PROJECTION / VIEW SWITCHER (With Lazy Loading)
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
        console.log("🗺️ [App Engine] 2D MapLibre Mercator Activated");
    } else if (targetView === '3d') {
        hidePolarMap();
        clearPolarTextures();

        // 🌟 Lazy-initialize Three.js only when 3D Globe is opened
        if (!threeGlobeInitialized) {
            try {
                initThreeGlobe();
                threeGlobeInitialized = true;
            } catch (err) {
                console.error("Three.js globe init error:", err);
            }
        }

        showThreeGlobe('3d');

        if (stateManager.activeFrameState) {
            updateThreeGlobeFrame(stateManager.activeFrameState);
        }
        console.log("🌐 [App Engine] 3D Earth Globe Activated");
    } else if (targetView === 'polar') {
        hideThreeGlobe();
        clearThreeGlobeTextures();

        // 🌟 Lazy-initialize Polar Engine only when Polar view is opened
        if (!polarMapInitialized) {
            try {
                initPolarMap();
                polarMapInitialized = true;
            } catch (err) {
                console.error("Polar map init error:", err);
            }
        }

        showPolarMap();

        if (stateManager.activeFrameState) {
            updatePolarFrame(stateManager.activeFrameState);
        }
        console.log("❄️ [App Engine] 2D Polar Stereographic Activated");
    }
}

/**
 * 🌟 CURSOR-CENTERED KEYBOARD ZOOM HANDLER
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
 * 🌟 DYNAMIC THEME APPLIER
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
    if (threeGlobeInitialized) {
        try { updateThreeGlobePalette(newPalette); } catch (e) {}
    }
    if (polarMapInitialized) {
        try { updatePolarPalette(newPalette); } catch (e) {}
    }
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

    for (const chunkIdx in stateManager.loadedChunkBitmaps) {
        const bitmap = stateManager.loadedChunkBitmaps[chunkIdx];
        if (bitmap && customShaderLayer) {
            customShaderLayer.preloadChunkTexture(chunkIdx, bitmap);
        }
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
    const frameIdx = frameInfo.frameIndex !== undefined ? frameInfo.frameIndex : (frameInfo.col || 0);

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
    } else if (customShaderLayer && !customShaderLayer.chunkTextures[`${chunkIdx}_${frameIdx}`]) {
        customShaderLayer.preloadChunkTexture(chunkIdx, stateManager.loadedChunkBitmaps[chunkIdx]);
    }

    const chunkVolume = stateManager.loadedChunkBitmaps[chunkIdx];
    const currentFrameImg = (chunkVolume && chunkVolume.frames && chunkVolume.frames[frameIdx])
        ? chunkVolume.frames[frameIdx]
        : chunkVolume;

    stateManager.activeFrameState = {
        chunkIndex: chunkIdx,
        frameIndex: frameIdx,
        col: 0,
        row: 0,
        chunkImg: currentFrameImg,
        uvOffset: [0.0, 0.0],
        uvScale: [1.0, 1.0]
    };
    
    const activeView = stateManager.activeView || '2d';

    if (activeView === '2d') {
        if (customShaderLayer) {
            customShaderLayer.updateFrame(stateManager.activeFrameState);
        }
        try {
            updateCityCallouts(map, stateManager.activeFrameState, stateManager.manifest);
        } catch (e) {}
        updateVectorContours(frameInfo.step);
    } else if (activeView === '3d' && threeGlobeInitialized) {
        updateThreeGlobeFrame(stateManager.activeFrameState);
    } else if (activeView === 'polar' && polarMapInitialized) {
        updatePolarFrame(stateManager.activeFrameState);
    }
}

export async function preloadRemainingChunks(currentGen) {
    if (!stateManager.manifest || !stateManager.manifest.chunks) return;
    const totalChunks = stateManager.manifest.chunks.length;

    for (let i = 1; i < totalChunks; i++) {
        if (currentGen !== stateManager.loadGeneration) break;

        if (!stateManager.loadedChunkBitmaps[i]) {
            try {
                await new Promise(r => setTimeout(r, 100)); // Gentle 100ms yield on mobile
                if (currentGen !== stateManager.loadGeneration) break;

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
    (newTheme) => { applyTheme(newTheme); },
    (newView) => { applyView(newView); },
    (direction, x, y) => { handleKeyboardZoom(direction, x, y); }
);

map.on('load', async () => {
    stateManager.currentMapStyle = 'https://api.maptiler.com/maps/019fc9f8-1ca6-7efe-b666-aba0ef35bce8/style.json?key=f9fTA5Ce0HKefPDICSVG';
    initHubTransition();

    try {
        await fetchManifest(null, 'ecmwf', '2t');
    } catch (err) {
        showToast('❌ ' + err.message);
    }

    try { initLayer(); } catch (err) {}
    try { initVectorContours(map); } catch (err) {}
    try { initCityOverlay(map); } catch (err) {}
    try { syncModelRunDropdown(); } catch (err) {}

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
            preloadAllContours(stateManager.loadGeneration);
        } catch (err) {
            showToast('❌ ' + err.message);
        }
    }
});

// 🌟 Unified Bilinear Inspection on Click
map.on('click', (e) => {
    if (!stateManager.manifest || !stateManager.activeFrameState) return;

    const decodedVal = sampleBilinearValue(e.lngLat.lng, e.lngLat.lat, stateManager.activeFrameState, stateManager.manifest);
    const formattedText = formatParameterValue(decodedVal, stateManager.manifest);
    const paramName = stateManager.manifest.name || stateManager.manifest.parameter || 'Value';

    popup.setLngLat(e.lngLat)
         .setHTML(`<div class="temp-f">${formattedText}</div><div class="temp-c">${paramName}</div>`)
         .addTo(map);
});
