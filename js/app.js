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

// 🌟 Universal overlays
import { 
    initCityOverlay, 
    updateCityCallouts, 
    sampleBilinearValue, 
    formatParameterValue,
    destroyCityOverlay,
    setBasemapLabelsVisibility 
} from './layers/cityOverlay.js'; 
import { initThreeGlobe, updateThreeGlobeFrame, updateThreeGlobePalette, showThreeGlobe, hideThreeGlobe, clearThreeGlobeTextures } from './layers/threeGlobe.js';
import { initVectorContours, updateVectorContours, preloadAllContours } from './layers/vectorContours.js';
import { initPolarMap, updatePolarFrame, updatePolarPalette, showPolarMap, hidePolarMap, clearPolarTextures, zoomPolarAtPoint } from './layers/polarMap.js';

// 🛰️ Real-Time Radar Engine
import { initRadarMode, destroyRadarMode } from './components/radarUI.js';

import { getPaletteForParameter as getLightPalette } from './config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from './config/darkPalettes.js';

let customShaderLayer = null;
let renderDebounceId = null;
let threeGlobeLoaded = false;
let polarMapLoaded = false;

const popup = new maplibregl.Popup({ closeButton: false });

const map = new maplibregl.Map({
    container: 'map',
    style: './config/style_default.json',
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

    let loaded = false;
    const onStyleReady = () => {
        if (loaded) return;
        loaded = true;
        console.log("✅ New basemap style loaded. Re-attaching weather layers...");

        if (stateManager.activeMode === 'radar') {
            setBasemapLabelsVisibility(map, true);
            initRadarMode(map);
        } else {
            setBasemapLabelsVisibility(map, false);
            try { initLayer(); } catch (e) {}
            try { initVectorContours(map); } catch (e) {}
            try { initCityOverlay(map); } catch (e) {}

            if (stateManager.currentStepIndex !== undefined) {
                renderFrame(stateManager.currentStepIndex);
            }
        }
    };

    // 🌟 Register 'style.load' before setStyle so the completion event is never missed
    map.once('style.load', onStyleReady);
    setTimeout(onStyleReady, 2000); // Fail-safe
    map.setStyle(styleUrl);
}

/**
 * 🌟 LAZY-LOADED 3-WAY PROJECTION / VIEW SWITCHER
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
    } else if (targetView === '3d') {
        hidePolarMap();
        clearPolarTextures();

        // 🌟 Lazy-load 3D Globe assets only when clicked
        if (!threeGlobeLoaded) {
            try {
                initThreeGlobe();
                threeGlobeLoaded = true;
            } catch (err) {
                console.error("Three.js globe init error:", err);
            }
        }

        showThreeGlobe('3d');

        if (stateManager.activeFrameState) {
            updateThreeGlobeFrame(stateManager.activeFrameState);
        }
    } else if (targetView === 'polar') {
        hideThreeGlobe();
        clearThreeGlobeTextures();

        // 🌟 Lazy-load Polar Map assets only when clicked
        if (!polarMapLoaded) {
            try {
                initPolarMap();
                polarMapLoaded = true;
            } catch (err) {}
        }

        showPolarMap();

        if (stateManager.activeFrameState) {
            updatePolarFrame(stateManager.activeFrameState);
        }
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
    } else if (activeView === 'polar' && polarMapLoaded) {
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
        // 🌟 1. Read active paramConfig directly from memory to prevent lookup mismatches
        let paramConfig = stateManager.paramConfig;

        if (!paramConfig) {
            const resp = await fetch('./config/models.json');
            if (resp.ok) {
                const data = await resp.json();
                const params = data?.parameters || {};
                paramConfig = params[stateManager.activeParam] ||
                    Object.values(params).find(p => p.id === stateManager.activeParam || p.name === stateManager.activeParam) ||
                    params['2t'];
            }
        }

        if (paramConfig) {
            const targetStyle = theme === 'dark'
                ? (paramConfig.map_style_dark || './config/style_dark.json')
                : (paramConfig.map_style_light || './config/style_default.json');

            if (targetStyle) {
                updateBasemapStyle(targetStyle);
            }
        }
    } catch (err) {
        console.warn("Could not resolve theme basemap URL:", err);
    }

    const paramId = stateManager.paramConfig?.palette || stateManager.paramConfig?.id || stateManager.activeParam;
    const paletteFunc = (theme === 'dark') ? getDarkPalette : getLightPalette;
    const newPalette = paletteFunc(paramId);

    if (customShaderLayer && typeof customShaderLayer.updatePalette === 'function') {
        customShaderLayer.updatePalette(newPalette);
    }
    if (threeGlobeLoaded) {
        try { updateThreeGlobePalette(newPalette); } catch (e) {}
    }
    if (polarMapLoaded) {
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

    // 🌟 Place weather layer underneath ALL basemap content layers so the entire transparent basemap sits on top
    let firstContentLayerId = null;
    const layers = map.getStyle().layers || [];
    for (const layer of layers) {
        if (layer.id !== 'background') {
            firstContentLayerId = layer.id;
            break;
        }
    }

    if (!map.getLayer('weather-gpu-shader')) {
        map.addLayer(customShaderLayer, firstContentLayerId);
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
    } else if (activeView === '3d' && threeGlobeLoaded) {
        updateThreeGlobeFrame(stateManager.activeFrameState);
    } else if (activeView === 'polar' && polarMapLoaded) {
        updatePolarFrame(stateManager.activeFrameState);
    }
}

/**
 * 🌟 CONTINUOUS BACKGROUND PRELOADER
 */
export async function preloadRemainingChunks(currentGen) {
    if (!stateManager.manifest || !stateManager.manifest.chunks) return;
    const totalChunks = stateManager.manifest.chunks.length;

    for (let i = 1; i < totalChunks; i++) {
        if (currentGen !== stateManager.loadGeneration) break;

        if (!stateManager.loadedChunkBitmaps[i] && !stateManager.chunkPixelData[i]) {
            try {
                await new Promise(r => setTimeout(r, 50));
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
                    console.warn(`Preload chunk ${i} skipped:`, err);
                }
                continue;
            }
        }
    }
}

/**
 * 🌟 LOAD INITIAL MODEL FORECAST DATA
 */
async function loadInitialModelData() {
    const thisGen = stateManager.loadGeneration;
    try {
        await fetchManifest(null, 'ecmwf', '2t');
        initLayer();
        syncModelRunDropdown();

        if (stateManager.manifest && stateManager.manifest.chunks) {
            const bitmap0 = await loadChunkBitmap(0, thisGen);
            if (customShaderLayer && thisGen === stateManager.loadGeneration) {
                customShaderLayer.preloadChunkTexture(0, bitmap0);
            }

            syncTimelineWithManifest();
            await renderFrame(0);
            hideToast();

            preloadRemainingChunks(thisGen);
            preloadAllContours(thisGen);
        }
    } catch (err) {
        if (err.message !== "Load cancelled") {
            showToast('❌ ' + err.message);
        }
    }
}

/**
 * 🌟 DYNAMIC APP MODE SWITCHER (Models vs Radar vs Satellite)
 */
export async function switchAppMode(targetMode) {
    stateManager.activeMode = targetMode;
    console.log(`[App] Switching app mode to: ${targetMode}`);

    // 1. Destroy any active radar or forecast model state
    destroyRadarMode(map);
    purgeAllAppMemory(customShaderLayer);
    if (map.getLayer('weather-gpu-shader')) {
        map.removeLayer('weather-gpu-shader');
    }
    if (map.getLayer('radar-gpu-shader')) {
        map.removeLayer('radar-gpu-shader');
    }

    // 2. Launch selected mode
    if (targetMode === 'radar') {
        showToast("Loading Real-Time Radar...");
        const modelBtn = document.getElementById('btn-model-menu');
        const paramBtn = document.getElementById('btn-param-menu');
        if (modelBtn) modelBtn.querySelector('span').textContent = 'NEXRAD Composite';
        if (paramBtn) paramBtn.querySelector('span').textContent = 'Base Reflectivity (dBZ)';
        
        // 🛑 Complete shutdown of city callout badges in Radar mode
        destroyCityOverlay();

        // 🌟 Load style_radar.json, then run radar when style is ready
        if (stateManager.currentMapStyle !== './config/style_radar.json') {
            stateManager.currentMapStyle = './config/style_radar.json';
            
            let loaded = false;
            const onReady = async () => {
                if (loaded) return;
                loaded = true;
                setBasemapLabelsVisibility(map, true);
                await initRadarMode(map);
                hideToast();
            };

            // Register completion event BEFORE setStyle
            map.once('style.load', onReady);
            setTimeout(onReady, 2000); // Fail-safe: radar will NEVER hang
            map.setStyle('./config/style_radar.json');
        } else {
            setBasemapLabelsVisibility(map, true);
            await initRadarMode(map);
            hideToast();
        }

    } else if (targetMode === 'modelViewer') {
        showToast("Loading Global Models...");
        
        // 🌟 Turn OFF native basemap labels for Model Viewer
        setBasemapLabelsVisibility(map, false);

        const targetStyle = stateManager.currentTheme === 'dark'
            ? (stateManager.paramConfig?.map_style_dark || './config/style_dark.json')
            : (stateManager.paramConfig?.map_style_light || './config/style_default.json');

        // 🌟 Switch back to model basemap if coming from radar
        if (stateManager.currentMapStyle !== targetStyle) {
            stateManager.currentMapStyle = targetStyle;
            
            let loaded = false;
            const onReady = async () => {
                if (loaded) return;
                loaded = true;
                try { initCityOverlay(map); } catch (e) {}
                await loadInitialModelData();
                hideToast();
            };

            map.once('style.load', onReady);
            setTimeout(onReady, 2000); // Fail-safe
            map.setStyle(targetStyle);
        } else {
            try { initCityOverlay(map); } catch (e) {}
            await loadInitialModelData();
            hideToast();
        }
    }
}

// 🌟 Initialize Splash Transition with Mode Handler
initHubTransition((selectedMode) => {
    switchAppMode(selectedMode);
});

initViewerUI(
    (stepIndex) => {
        if (renderDebounceId) cancelAnimationFrame(renderDebounceId);
        renderDebounceId = requestAnimationFrame(() => renderFrame(stepIndex));
    },
    (newTheme) => { applyTheme(newTheme); },
    (newView) => { applyView(newView); },
    (direction, x, y) => { handleKeyboardZoom(direction, x, y); }
);

map.on('error', (e) => {
    console.warn("MapLibre Basemap load warning:", e);
});

map.on('load', async () => {
    stateManager.currentMapStyle = './config/style_default.json';
    // 🌟 Ensure basemap labels start hidden by default for Model Viewer
    setBasemapLabelsVisibility(map, false);
    try { initVectorContours(map); } catch (err) {}
});

// 🌟 Unified Bilinear Inspection on Click
map.on('click', (e) => {
    if (stateManager.activeMode === 'radar') return;
    if (!stateManager.manifest || !stateManager.activeFrameState) return;

    const decodedVal = sampleBilinearValue(e.lngLat.lng, e.lngLat.lat, stateManager.activeFrameState, stateManager.manifest);
    const formattedText = formatParameterValue(decodedVal, stateManager.manifest);
    const paramName = stateManager.manifest.name || stateManager.manifest.parameter || 'Value';

    popup.setLngLat(e.lngLat)
         .setHTML(`<div class="temp-f">${formattedText}</div><div class="temp-c">${paramName}</div>`)
         .addTo(map);
});
