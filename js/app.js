// js/app.js
import { stateManager } from './core/stateManager.js';
import { fetchManifest, loadChunkBitmap, purgeAllAppMemory } from './core/dataLoader.js';
import { getViewerPreferences } from './core/viewerPreferences.js';
import { createScalarShaderLayer } from './shaders/scalarShader.js';
import { createPrecipShaderLayer } from './shaders/precipShader.js';
import { createPrecipTypeShaderLayer } from './shaders/precipTypeShader.js';
import { initHubTransition } from './components/homeScreen.js';
import { createHrrrShaderLayer } from './shaders/hrrrShader.js';
import { createEnsembleShaderLayer } from './shaders/ensembleShader.js';
import { 
    initViewerUI, 
    syncTimelineWithManifest, 
    syncModelRunDropdown,
    setShaderLayerReference,
    updateSliderTrackAndBounds,
    setStepIndex,
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
import { initVectorContours, updateVectorContours, preloadAllContours, setContourActiveMember } from './layers/vectorContours.js';
import { initPolarMap, updatePolarFrame, updatePolarPalette, showPolarMap, hidePolarMap, clearPolarTextures, zoomPolarAtPoint } from './layers/polarMap.js';

// 🛰️ Real-Time Radar Engine
import { initRadarMode, destroyRadarMode, updateRadarUnitLabels } from './components/radarUI.js';
import { hideStormVolume } from './layers/stormVolume3D.js';

import { getPaletteForParameter as getLightPalette } from './config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from './config/darkPalettes.js';

let customShaderLayer = null;
let renderDebounceId = null;
let activeRenderId = 0;
let polarMapLoaded = false;
let isFirstLoad = true; // 🌟 Forces default model/param on initial site load

// 🌟 Dedicated Atmosphere Canvas (Placed BEHIND MapLibre canvas for draw-order occlusion)
let haloCanvas = null;
let haloCtx = null;
let lastGlobeMatrix = null;

// 🌟 THE "FROZEN BASEMAP" SANDWICH CACHE
let staticBasemapCanvas = null;
let staticOverlayCanvas = null;
let isBasemapCaptured = false;
let basemapLayerIds = []; // 🌟 Cached for lightning-fast toggling
let basemapMap = null;
let basemapMapReady = false;
// 🌟 Hidden map that renders ONLY the ensemble weather (empty style, camera synced to the live map)
let weatherMap = null;
let weatherMapReady = false;
let weatherMapContainer = null;

const popup = new maplibregl.Popup({ closeButton: false });

const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 768;

const map = new maplibregl.Map({
    container: 'map',
    style: './config/style_default.json',
    center: [-96.5, 38.5], 
    zoom: isMobileViewport ? 3.2 : 3.8,
    keyboard: false,
    preserveDrawingBuffer: true // 🌟 Required for real-time canvas copying
});

function syncBasemapMapCamera() {
    const proj = map.getProjection ? map.getProjection() : null;
    if (proj && basemapMap.setProjection && basemapMap.getProjection()?.type !== proj.type) basemapMap.setProjection(proj);
    if (!basemapMap || !basemapMapReady) return;
    basemapMap.jumpTo({
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch()
    });
}

function initBasemapMap() {
    if (basemapMap) return;

    const container = document.createElement('div');
    container.id = 'basemap-render-map';
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '0';
    container.style.width = '100vw';
    container.style.height = '100vh';
    container.style.pointerEvents = 'none';
    document.body.appendChild(container);

    basemapMap = new maplibregl.Map({
        container,
        style: stateManager.currentMapStyle || './config/style_default.json',
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        interactive: false,
        attributionControl: false,
        preserveDrawingBuffer: true
    });

    basemapMap.once('load', () => {
        basemapMapReady = true;
        setBasemapLabelsVisibility(basemapMap, false);
        syncBasemapMapCamera();
        isBasemapCaptured = false;
    });
}

function updateBasemapMapStyle(styleUrl) {
    if (!basemapMap || !styleUrl) return;
    basemapMapReady = false;
    basemapMap.once('style.load', () => {
        basemapMapReady = true;
        setBasemapLabelsVisibility(basemapMap, false);
        syncBasemapMapCamera();
        isBasemapCaptured = false;
    });
    basemapMap.setStyle(styleUrl);
}

function syncWeatherMapSize() {
    if (!weatherMapContainer) return false;
    const c = map.getCanvas();
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return false;
    if (weatherMapContainer.style.width !== `${w}px` || weatherMapContainer.style.height !== `${h}px`) {
        weatherMapContainer.style.width = `${w}px`;
        weatherMapContainer.style.height = `${h}px`;
        if (weatherMap) weatherMap.resize();
    }
    return true;
}

function syncWeatherMapCamera() {
    const proj = map.getProjection ? map.getProjection() : null;
    if (proj && weatherMap.setProjection && weatherMap.getProjection()?.type !== proj.type) weatherMap.setProjection(proj);
    if (!weatherMap || !weatherMapReady) return;
    weatherMap.jumpTo({
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch()
    });
}

function initWeatherMap() {
    if (weatherMap) return;

    weatherMapContainer = document.createElement('div');
    weatherMapContainer.id = 'weather-render-map';
    weatherMapContainer.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none;';
    document.body.appendChild(weatherMapContainer);
    syncWeatherMapSize();

    weatherMap = new maplibregl.Map({
        container: weatherMapContainer,
        style: { version: 8, sources: {}, layers: [] },
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        interactive: false,
        attributionControl: false,
        preserveDrawingBuffer: true
    });

    weatherMap.once('load', () => {
        weatherMapReady = true;
        syncWeatherMapCamera();
    });
}

function addEnsembleLayerToWeatherMap(layer) {
    const add = () => {
        if (customShaderLayer !== layer) return; // superseded by a newer initLayer()
        if (weatherMap.getLayer('weather-gpu-shader')) weatherMap.removeLayer('weather-gpu-shader');
        weatherMap.addLayer(layer);

        for (const chunkIdx in stateManager.loadedChunkBitmaps) {
            const volume = stateManager.loadedChunkBitmaps[chunkIdx];
            if (volume) layer.preloadChunkTexture(Number(chunkIdx), volume);
        }
        if (stateManager.activeFrameState) layer.updateFrame(stateManager.activeFrameState);
        renderAllEnsembleMembers();
    };
    if (weatherMapReady) add();
    else weatherMap.once('load', add);
}

/**
 * 🌟 DERIVES THE EXACT ON-SCREEN PIXEL BOUNDARY OF THE 3D GLOBE DIRECTLY FROM CAMERA MATRIX
 * Guaranteed to stay 100% locked to the perimeter across all zoom levels, rotations, and screen sizes!
 */
function getGlobeScreenCircle(matrix, w, h) {
    if (!matrix) return null;

    // 1. Globe Center (0, 0, 0, 1) in screen pixels
    const cx_clip = matrix[12];
    const cy_clip = matrix[13];
    const cw_clip = matrix[15] || 1.0;
    const cx = (cx_clip / cw_clip * 0.5 + 0.5) * w;
    const cy = (0.5 - cy_clip / cw_clip * 0.5) * h;

    // 2. Camera direction vector from matrix
    let vx = matrix[2], vy = matrix[6], vz = matrix[10];
    const vLen = Math.hypot(vx, vy, vz) || 1.0;
    vx /= vLen; vy /= vLen; vz /= vLen;

    // 3. Up vector orthogonal to camera line of sight
    let ux = 0.0, uy = 1.0, uz = 0.0;
    if (Math.abs(vy) > 0.9) {
        ux = 1.0; uy = 0.0; uz = 0.0;
    }
    const dotUV = ux * vx + uy * vy + uz * vz;
    ux -= dotUV * vx; uy -= dotUV * vy; uz -= dotUV * vz;
    const uLen = Math.hypot(ux, uy, uz) || 1.0;
    ux /= uLen; uy /= uLen; uz /= uLen;

    // 4. Project unit sphere horizon point (ux, uy, uz) to screen pixels
    const hx_clip = matrix[0] * ux + matrix[4] * uy + matrix[8] * uz + matrix[12];
    const hy_clip = matrix[1] * ux + matrix[5] * uy + matrix[9] * uz + matrix[13];
    const hw_clip = matrix[3] * ux + matrix[7] * uy + matrix[11] * uz + matrix[15];

    const hx = (hx_clip / hw_clip * 0.5 + 0.5) * w;
    const hy = (0.5 - hy_clip / hw_clip * 0.5) * h;

    const r = Math.hypot(hx - cx, hy - cy);
    return { cx, cy, r };
}

function updateAtmosphereHalo(matrix) {
    if (stateManager.activeView !== '3d' || !haloCanvas || !haloCtx || !matrix) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth * dpr;
    const h = window.innerHeight * dpr;

    if (haloCanvas.width !== w || haloCanvas.height !== h) {
        haloCanvas.width = w;
        haloCanvas.height = h;
    }

    const circle = getGlobeScreenCircle(matrix, w, h);
    if (!circle || isNaN(circle.r) || circle.r < 10) {
        haloCtx.clearRect(0, 0, w, h);
        return;
    }

    haloCtx.clearRect(0, 0, w, h);

    const cx = circle.cx;
    const cy = circle.cy;
    const r = circle.r;

    // 🌟 Thicker, multi-layered atmospheric rim glow drawn BEHIND the planet
    const outerR = r * 1.22;
    const grad = haloCtx.createRadialGradient(cx, cy, r * 0.96, cx, cy, outerR);
    grad.addColorStop(0.00, 'rgba(56, 189, 248, 0.0)');
    grad.addColorStop(0.18, 'rgba(224, 242, 254, 0.98)');
    grad.addColorStop(0.35, 'rgba(56, 189, 248, 0.85)');
    grad.addColorStop(0.60, 'rgba(14, 165, 233, 0.45)');
    grad.addColorStop(0.85, 'rgba(2, 132, 199, 0.15)');
    grad.addColorStop(1.00, 'rgba(2, 6, 23, 0.0)');

    haloCtx.fillStyle = grad;
    haloCtx.beginPath();
    haloCtx.arc(cx, cy, outerR, 0, Math.PI * 2);
    haloCtx.fill();
}

function initAtmosphereHaloCanvas() {
    if (haloCanvas) return;
    haloCanvas = document.createElement('canvas');
    haloCanvas.id = 'globe-atmosphere-halo';
    haloCanvas.style.position = 'absolute';
    haloCanvas.style.top = '0';
    haloCanvas.style.left = '0';
    haloCanvas.style.width = '100%';
    haloCanvas.style.height = '100%';
    haloCanvas.style.pointerEvents = 'none';
    
    haloCanvas.style.zIndex = '0';
    haloCanvas.style.display = 'none';

    const mapContainer = map.getContainer();
    if (mapContainer) {
        mapContainer.insertBefore(haloCanvas, mapContainer.firstChild);
    }
    haloCtx = haloCanvas.getContext('2d');
}

function updateModeNavigation(activeMode) {
    document.querySelectorAll('.mode-nav-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.mode === activeMode);
    });
}

function unloadActiveViewer() {
    destroyRadarMode(map);
    hideStormVolume();
    destroyCityOverlay();
    hidePolarMap();
    clearPolarTextures();
    purgeAllAppMemory(customShaderLayer);

    if (map.getLayer('weather-gpu-shader')) {
        map.removeLayer('weather-gpu-shader');
    }
    if (weatherMap && weatherMapReady && weatherMap.getLayer('weather-gpu-shader')) {
        weatherMap.removeLayer('weather-gpu-shader');
    }
    if (map.getLayer('radar-gpu-shader')) {
        map.removeLayer('radar-gpu-shader');
    }
}

function showComingSoonScreen(targetMode) {
    const comingSoonScreen = document.getElementById('coming-soon-screen');
    const comingSoonTitle = document.getElementById('coming-soon-title');
    const mapContainer = document.getElementById('map');
    const globeContainer = document.getElementById('globe-container');

    if (comingSoonTitle) {
        comingSoonTitle.textContent = targetMode === 'satellite' ? 'Satellite' : 'Tropics';
    }
    if (mapContainer) mapContainer.style.display = 'none';
    if (globeContainer) globeContainer.style.display = 'none';
    if (comingSoonScreen) comingSoonScreen.style.display = 'flex';
}

function hideComingSoonScreen() {
    const comingSoonScreen = document.getElementById('coming-soon-screen');
    const mapContainer = document.getElementById('map');
    if (comingSoonScreen) comingSoonScreen.style.display = 'none';
    if (mapContainer) mapContainer.style.display = 'block';
}

// 🌟 ULTRA-FAST 60 FPS 10-MEMBER SYNCHRONIZED RENDER ENGINE
let isDrawingEnsemble = false;
let isRenderingEnsemble = false;
let pendingEnsembleStep = null;
let cachedCardCanvases = null;
let cachedTargetSize = null;

function getCardCanvases() {
    if (cachedCardCanvases && cachedCardCanvases.length === 10) {
        return cachedCardCanvases;
    }
    const cards = document.querySelectorAll('.map-card');
    cachedCardCanvases = Array.from(cards).map(card => {
        let canvas = card.querySelector('canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.display = 'block';
            canvas.style.borderRadius = '6px';
            card.appendChild(canvas);
        }
        return { card, canvas, ctx: canvas.getContext('2d') };
    });
    return cachedCardCanvases;
}

function updateCachedDimensions() {
    const cardList = getCardCanvases();
    if (!cardList || cardList.length === 0) return null;
    const rect = cardList[0].card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const dpr = window.devicePixelRatio || 1;
    cachedTargetSize = {
        w: Math.floor(rect.width * dpr),
        h: Math.floor(rect.height * dpr)
    };
    return cachedTargetSize;
}

// 🌟 Border/coast lines only, on a transparent canvas, drawn ABOVE the weather in each card
function captureBasemapOverlay() {
    const mapCanvas = map.getCanvas();
    if (!staticOverlayCanvas) staticOverlayCanvas = document.createElement('canvas');
    staticOverlayCanvas.width = mapCanvas.width;   // also clears it
    staticOverlayCanvas.height = mapCanvas.height;

    const hidden = [];
    for (const layer of (basemapMap.getStyle().layers || [])) {
        const keep = layer.type === 'line' && /boundary|coast|outline/i.test(layer.id);
        if (keep || basemapMap.getLayoutProperty(layer.id, 'visibility') === 'none') continue;
        basemapMap.setLayoutProperty(layer.id, 'visibility', 'none');
        hidden.push(layer.id);
    }

    basemapMap._render();
    staticOverlayCanvas.getContext('2d').drawImage(basemapMap.getCanvas(), 0, 0);

    hidden.forEach(id => basemapMap.setLayoutProperty(id, 'visibility', 'visible'));
}
// 🌟 NEW: Snapshot the static basemap without the weather
function captureBasemap() {
    if (!map) return;
    const mapCanvas = map.getCanvas();
    if (!staticBasemapCanvas) {
        staticBasemapCanvas = document.createElement('canvas');
    }
    staticBasemapCanvas.width = mapCanvas.width;
    staticBasemapCanvas.height = mapCanvas.height;

    if (basemapMap && basemapMapReady) {
        basemapMap.resize();
        syncBasemapMapCamera();
        basemapMap._render();
        if (!basemapMap.areTilesLoaded()) return; // tiles for this camera aren't ready yet
        staticBasemapCanvas.getContext('2d').drawImage(basemapMap.getCanvas(), 0, 0);
        captureBasemapOverlay();
        isBasemapCaptured = true;
        return;
    }
    if (!map.isStyleLoaded()) return;
    // Temporarily hide our weather/contours to take a clean snapshot of the basemap
    const toggleWeather = (show) => {
        const vis = show ? 'visible' : 'none';
        if (map.style._layers['weather-gpu-shader']) map.style._layers['weather-gpu-shader'].visibility = vis;
        if (map.style._layers['contour-gpu-layer']) map.style._layers['contour-gpu-layer'].visibility = vis;
        if (map.style._layers['contour-master-label-layer']) map.style._layers['contour-master-label-layer'].visibility = vis;
    };

    toggleWeather(false);
    map._render(); 
    
    const ctx = staticBasemapCanvas.getContext('2d');
    ctx.drawImage(mapCanvas, 0, 0);
    
    toggleWeather(true);
    isBasemapCaptured = true;
}

// 🌟 NEW: Turn on/off cached basemap layers instantly using pre-filtered IDs
function toggleBasemapLayers(show) {
    if (!map || !map.isStyleLoaded() || basemapLayerIds.length === 0) return;
    const vis = show ? 'visible' : 'none';
    basemapLayerIds.forEach(id => {
        const layer = map.style._layers[id];
        if (layer) layer.visibility = vis;
    });
}

function toggleEnsembleContours(show) {
    if (!map || !map.isStyleLoaded()) return;
    const vis = show ? 'visible' : 'none';
    ['contour-gpu-layer', 'contour-master-label-layer'].forEach(id => {
        const layer = map.style._layers[id];
        if (layer) layer.visibility = vis;
    });
}

// 🌟 POLARWEATHER-STYLE SINGLE-PASS VIEWPORT RENDERER
export async function renderAllEnsembleMembers() {
    if (!isDrawingEnsemble || !customShaderLayer || typeof customShaderLayer.setGridMode !== 'function' || !weatherMapReady) return;
    if (isRenderingEnsemble) {
        pendingEnsembleStep = true;
        return;
    }

    isRenderingEnsemble = true;
    pendingEnsembleStep = false;

    try {
        const cardList = getCardCanvases();
        const mapCanvas = map.getCanvas();
        if (!mapCanvas || cardList.length === 0) return;

        let size = cachedTargetSize || updateCachedDimensions();
        if (!size) return;

        const targetW = size.w;
        const targetH = size.h;

        const srcAspect = mapCanvas.width / mapCanvas.height;
        const dstAspect = targetW / targetH;
        let sx = 0, sy = 0, sWidth = mapCanvas.width, sHeight = mapCanvas.height;

        if (srcAspect > dstAspect) {
            sWidth = mapCanvas.height * dstAspect;
            sx = (mapCanvas.width - sWidth) / 2;
        } else {
            sHeight = mapCanvas.width / dstAspect;
            sy = (mapCanvas.height - sHeight) / 2;
        }

        // 🌟 1. CAPTURE FROZEN BASEMAP (Only happens once when map stops moving)
        if (!isBasemapCaptured) {
            captureBasemap();
            if (!isBasemapCaptured) {
                // Basemap tiles for this camera aren't ready: keep the last frame, retry when idle
                if (basemapMap) basemapMap.once('idle', () => renderAllEnsembleMembers());
                return;
            }
        }

        // 🌟 2. Sync the hidden weather-only map to the live camera and size
        if (!syncWeatherMapSize()) return;
        syncWeatherMapCamera();
        const weatherCanvas = weatherMap.getCanvas();

        // Compute card bounds relative to the map canvas (WebGL bottom-left origin)
        const mapRect = mapCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const boxRects = cardList.map(item => {
            const rect = item.canvas.getBoundingClientRect();
            return {
                x: Math.floor((rect.left - mapRect.left) * dpr),
                y: Math.floor((mapRect.bottom - rect.bottom) * dpr),
                w: Math.floor(rect.width * dpr),
                h: Math.floor(rect.height * dpr)
            };
        });

        // Render all ten members in one MapLibre pass, one texture per scissored card.
        customShaderLayer.setGridMode(true, boxRects, {
            x: sx,
            y: sy,
            w: sWidth,
            h: sHeight,
            canvasW: weatherCanvas.width,
            canvasH: weatherCanvas.height
        });
        // Synchronous redraw of the hidden weather map: the grid is drawn into ITS canvas only
        if (typeof weatherMap.redraw === 'function') weatherMap.redraw();
        else weatherMap._render();

        customShaderLayer.setGridMode(false, null);

        // Assemble the frozen basemap and the matching scissored member into each card.
        cardList.forEach((item, memberIndex) => {
            const cvs = item.canvas;
            if (cvs.width !== targetW || cvs.height !== targetH) {
                cvs.width = targetW;
                cvs.height = targetH;
            }

            const box = boxRects[memberIndex];
            const weatherX = box?.x || 0;
            const weatherY = box ? weatherCanvas.height - box.y - box.h : 0;
            const weatherW = box?.w || weatherCanvas.width;
            const weatherH = box?.h || weatherCanvas.height;

            // Draw crisp frozen basemap background
            if (staticBasemapCanvas) {
                item.ctx.drawImage(
                    staticBasemapCanvas, 
                    sx, sy, sWidth, sHeight, 
                    0, 0, targetW, targetH
                );
            }
            // Overlay the scissored, transparent weather on top
            item.ctx.drawImage(
                weatherCanvas,
                weatherX, weatherY, weatherW, weatherH,
                0, 0, targetW, targetH
            );
            if (staticOverlayCanvas) {
                item.ctx.drawImage(staticOverlayCanvas, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH);
            }
        });

    } finally {
        isRenderingEnsemble = false;
        if (pendingEnsembleStep) {
            requestAnimationFrame(() => renderAllEnsembleMembers());
        }
    }
}

function syncEnsembleGrid() {
    const grid = document.getElementById('ensemble-grid');
    if (!grid) return;
    
    const shouldShow = stateManager.activeMode === 'modelViewer' && stateManager.activeModel === 'aifs_ens';
    grid.style.display = shouldShow ? 'grid' : 'none';
    
    isDrawingEnsemble = shouldShow;
    cachedCardCanvases = null;
    cachedTargetSize = null;
    
    if (shouldShow) {
        updateCachedDimensions();
        setTimeout(renderAllEnsembleMembers, 80);
    }
}

function drawEnsembleBoxes(targetMemberIndex = null) {
    if (!isDrawingEnsemble) return;

    const mapCanvas = map.getCanvas();
    if (!mapCanvas) return;

    const cardList = getCardCanvases();
    if (cardList.length === 0) return;

    let size = cachedTargetSize || updateCachedDimensions();
    if (!size) return;

    const targetW = size.w;
    const targetH = size.h;

    const srcAspect = mapCanvas.width / mapCanvas.height;
    const dstAspect = targetW / targetH;
    let sx = 0, sy = 0, sWidth = mapCanvas.width, sHeight = mapCanvas.height;

    if (srcAspect > dstAspect) {
        sWidth = mapCanvas.height * dstAspect;
        sx = (mapCanvas.width - sWidth) / 2;
    } else {
        sHeight = mapCanvas.width / dstAspect;
        sy = (mapCanvas.height - sHeight) / 2;
    }

    cardList.forEach((item, idx) => {
        if (targetMemberIndex !== null && idx !== targetMemberIndex) return;

        const cvs = item.canvas;
        if (cvs.width !== targetW || cvs.height !== targetH) {
            cvs.width = targetW;
            cvs.height = targetH;
        }

        try {
            item.ctx.drawImage(mapCanvas, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH);
        } catch (err) {}
    });
}

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

        if (typeof map.setProjection === 'function') {
            map.setProjection({ type: stateManager.activeView === '3d' ? 'globe' : 'mercator' });
        }

        if (stateManager.activeMode === 'radar') {
            applyRadarTheme(stateManager.currentTheme);
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

    map.once('style.load', onStyleReady);
    setTimeout(onStyleReady, 2000); // Fail-safe
    map.setStyle(styleUrl);
}

/**
 * 🌟 ZERO-RELOAD RADAR THEME SWITCHER
 */
function applyRadarTheme(theme) {
    if (!map || !map.isStyleLoaded()) return;
    const isDark = (theme === 'dark');

    if (map.getLayer('background')) {
        map.setPaintProperty('background', 'background-color', isDark ? 'rgb(59, 51, 59)' : '#EDEDED');
    }

    const waterColor = isDark ? 'rgba(2, 20, 37, 1)' : '#F5FDFF';
    if (map.getLayer('ocean_far')) {
        map.setPaintProperty('ocean_far', 'fill-color', waterColor);
    }
    if (map.getLayer('water')) {
        map.setPaintProperty('water', 'fill-color', waterColor);
    }

    const outlineColor = isDark ? '#ffffff' : '#000000';
    const outlineLayers = [
        'coastline_far',
        'water_outline',
        'boundary_county',
        'boundary_state',
        'boundary_country_z0-4',
        'boundary_country_z5-'
    ];
    outlineLayers.forEach(id => {
        if (map.getLayer(id)) {
            map.setPaintProperty(id, 'line-color', outlineColor);
        }
    });

    const fillLayers = ['landuse_residential', 'landcover_wood', 'landcover_ice_shelf', 'landcover_glacier', 'building', 'aeroway-area', 'road_area_pier'];
    fillLayers.forEach(id => {
        if (map.getLayer(id)) {
            map.setPaintProperty(id, 'fill-opacity', isDark ? 0.4 : 0);
        }
    });
    if (map.getLayer('landuse_park')) {
        map.setPaintProperty('landuse_park', 'fill-color', isDark ? 'rgb(32,32,32)' : '#EDEDED');
    }

    const streetColor = isDark ? '#181818' : '#ffffff';
    const streetCasing = isDark ? 'rgba(60, 60, 60, 0.8)' : 'rgba(0, 0, 0, 0.25)';

    ['highway_motorway_inner', 'highway_major_inner', 'highway_major_subtle', 'highway_motorway_subtle'].forEach(id => {
        if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', streetColor);
    });
    ['highway_motorway_casing', 'highway_major_casing'].forEach(id => {
        if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', streetCasing);
    });
    if (map.getLayer('highway_minor')) {
        map.setPaintProperty('highway_minor', 'line-color', isDark ? '#181818' : 'rgba(255, 255, 255, 0.8)');
    }

    const labelColor = isDark ? '#ffffff' : '#000000';
    const haloColor = isDark ? '#000000' : '#ffffff';
    const labelLayers = [
        'place_other', 'place_suburb', 'place_village', 'place_town',
        'place_city', 'place_city_large', 'place_state', 'place_country_other',
        'place_country_minor', 'place_country_major'
    ];
    labelLayers.forEach(id => {
        if (map.getLayer(id)) {
            map.setPaintProperty(id, 'text-color', labelColor);
            map.setPaintProperty(id, 'text-halo-color', haloColor);
        }
    });
}

/**
 * 🌟 NATIVE PROJECTION / VIEW SWITCHER
 */
export function applyView(targetView) {
    stateManager.activeView = targetView;

    document.body.classList.toggle('globe-view', targetView === '3d');
    if (!haloCanvas) initAtmosphereHaloCanvas();
    if (haloCanvas) {
        haloCanvas.style.display = targetView === '3d' ? 'block' : 'none';
        if (targetView !== '3d' && haloCtx) {
            haloCtx.clearRect(0, 0, haloCanvas.width, haloCanvas.height);
        }
    }

    if (targetView === '2d' || targetView === '3d') {
        hidePolarMap();
        clearPolarTextures();

        const globeDiv = document.getElementById('globe-container');
        if (globeDiv) globeDiv.style.display = 'none';

        const mapDiv = document.getElementById('map');
        if (mapDiv) mapDiv.style.display = 'block';

        if (map) {
            if (typeof map.setProjection === 'function') {
                map.setProjection({ type: targetView === '3d' ? 'globe' : 'mercator' });
            }
            map.resize();
            if (basemapMap) basemapMap.resize();
        }

        if (stateManager.activeFrameState && customShaderLayer) {
            customShaderLayer.updateFrame(stateManager.activeFrameState);
            try { updateCityCallouts(map, stateManager.activeFrameState, stateManager.manifest); } catch (e) {}
            if (stateManager.globalSteps && stateManager.globalSteps[stateManager.currentStepIndex]) {
                try { initVectorContours(map); } catch (e) {}
                updateVectorContours(stateManager.globalSteps[stateManager.currentStepIndex].step);
            }
        }
    } else if (targetView === 'polar') {
        const mapDiv = document.getElementById('map');
        if (mapDiv) mapDiv.style.display = 'none';

        const globeDiv = document.getElementById('globe-container');
        if (globeDiv) globeDiv.style.display = 'none';

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

    if ((activeView === '2d' || activeView === '3d') && map) {
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
    document.body.classList.toggle('light-mode', theme === 'light');

    if (stateManager.activeMode === 'radar') {
        applyRadarTheme(theme);
        return;
    }

    try {
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
    if (polarMapLoaded) {
        try { updatePolarPalette(newPalette); } catch (e) {}
    }
}

export function initLayer(shaderType = null) {
    if (map.getLayer('weather-gpu-shader')) {
        map.removeLayer('weather-gpu-shader');
    }
    if (weatherMap && weatherMapReady && weatherMap.getLayer('weather-gpu-shader')) {
        weatherMap.removeLayer('weather-gpu-shader');
    }
    if (customShaderLayer) {
        customShaderLayer.clearTextures();
        customShaderLayer = null;
    }

    const chosenShader = shaderType || stateManager.activeShader || 'scalar';

    if (stateManager.activeModel === 'aifs_ens') {
        initWeatherMap();
        customShaderLayer = createEnsembleShaderLayer(weatherMap);
        customShaderLayer.gridOnly = true; // never draw a full-screen copy on the hidden map
    } else if (stateManager.activeModel === 'hrrr' || stateManager.activeModel === 'rrfs') {
        customShaderLayer = createHrrrShaderLayer(map);
    } else if (chosenShader === 'precipType') {
        customShaderLayer = createPrecipTypeShaderLayer(map);
    } else if (chosenShader === 'precip') {
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

    let firstContentLayerId = null;
    const layers = map.getStyle().layers || [];
    for (const layer of layers) {
        if (layer.id !== 'background') {
            firstContentLayerId = layer.id;
            break;
        }
    }

    const originalRender = customShaderLayer.render.bind(customShaderLayer);
    customShaderLayer.render = (gl, matrixOrArgs) => {
        originalRender(gl, matrixOrArgs);
        if (stateManager.activeView === '3d') {
            const isV5 = Boolean(matrixOrArgs && (matrixOrArgs.defaultProjectionData || matrixOrArgs.shaderData));
            const projData = isV5 ? matrixOrArgs.defaultProjectionData : null;
            const matrix = isV5 
                ? (matrixOrArgs.modelViewProjectionMatrix || projData?.mainMatrix) 
                : matrixOrArgs;
            lastGlobeMatrix = matrix;
            updateAtmosphereHalo(matrix);
        }
    };

    if (stateManager.activeModel === 'aifs_ens') {
        // Weather lives on its own hidden map; the live map stays a clean basemap
        addEnsembleLayerToWeatherMap(customShaderLayer);
    } else if (!map.getLayer('weather-gpu-shader')) {
        map.addLayer(customShaderLayer, firstContentLayerId);
    }
}

async function renderFrame(globalIdx) {
    syncEnsembleGrid();
    if (!stateManager.manifest || !stateManager.globalSteps || stateManager.globalSteps.length === 0) return;
    
    const renderId = ++activeRenderId;
    const frameInfo = stateManager.globalSteps[globalIdx];
    if (!frameInfo) return;

    const chunkIdx = frameInfo.chunkIndex;
    const frameIdx = frameInfo.frameIndex !== undefined ? frameInfo.frameIndex : (frameInfo.col || 0);

    if (!stateManager.loadedChunkBitmaps[chunkIdx]) {
        try {
            const bitmap = await loadChunkBitmap(chunkIdx, stateManager.loadGeneration);
            if (renderId !== activeRenderId) return;

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

    if (renderId !== activeRenderId) return;

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

    if (activeView === '2d' || activeView === '3d') {
        // 🌟 Load and update vector contours for ALL models (including AIFS-ENS)
        try { initVectorContours(map); } catch (e) {}
        await updateVectorContours(frameInfo.step);

        if (renderId !== activeRenderId) return;

        // Skip heavy city text overlay in ensemble mode for speed
        if (stateManager.activeModel !== 'aifs_ens') {
            try {
                updateCityCallouts(map, stateManager.activeFrameState, stateManager.manifest);
            } catch (e) {}
        }

        if (customShaderLayer) {
            customShaderLayer.updateFrame(stateManager.activeFrameState);
        }
    } else if (activeView === 'polar' && polarMapLoaded) {
        updatePolarFrame(stateManager.activeFrameState);
    }

    // 🌟 ANIMATE ALL 10 MEMBERS SIMULTANEOUSLY DURING SCRUBBING
    if (isDrawingEnsemble) {
        renderAllEnsembleMembers();
    }
}

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
                if (err.name === 'AbortError') break;
                if (err.message !== "Load cancelled") {
                    console.warn(`Preload chunk ${i} skipped:`, err);
                }
                continue;
            }
        }
    }
}

async function loadInitialModelData() {
    const thisGen = stateManager.loadGeneration;
    try {
        const preferences = getViewerPreferences();

        if (isFirstLoad) {
            stateManager.activeModel = 'ecmwf';
            stateManager.activeParam = '2t';
            isFirstLoad = false;

            try {
                const resp = await fetch('./config/models.json');
                if (resp.ok) {
                    const data = await resp.json();
                    stateManager.paramConfig = data.parameters['2t'];
                    stateManager.activeShader = stateManager.paramConfig.shader || 'precip';
                }
            } catch(e) {}

            const paramBtn = document.getElementById('btn-param-menu');
            if (paramBtn) {
                const pSpan = paramBtn.querySelector('span');
                if (pSpan) pSpan.textContent = '2m Temperature';
            }
            const modelBtn = document.getElementById('btn-model-menu');
            if (modelBtn) {
                const mSpan = modelBtn.querySelector('span');
                if (mSpan) mSpan.textContent = 'ECMWF-IFS';
            }
        } else {
            if (preferences.model) stateManager.activeModel = preferences.model;
            if (preferences.param) stateManager.activeParam = preferences.param;
        }

        await fetchManifest(null, stateManager.activeModel, stateManager.activeParam);
        initLayer();
        try { initVectorContours(map); } catch (e) {}
        syncModelRunDropdown();

        if (stateManager.manifest && stateManager.manifest.chunks) {
            const bitmap0 = await loadChunkBitmap(0, thisGen);
            if (customShaderLayer && thisGen === stateManager.loadGeneration) {
                customShaderLayer.preloadChunkTexture(0, bitmap0);
            }

            syncTimelineWithManifest();
            const savedStep = Number.isInteger(preferences?.modelStep)
                ? Math.min(preferences.modelStep, stateManager.globalSteps.length - 1)
                : 0;
            setStepIndex(Math.max(0, savedStep));
            await renderFrame(Math.max(0, savedStep));
            hideToast();

            preloadRemainingChunks(thisGen).then(() => {
                if (thisGen === stateManager.loadGeneration) {
                    preloadAllContours(thisGen);
                }
            });
        }
    } catch (err) {
        if (err.message !== "Load cancelled") {
            showToast('❌ ' + err.message);
        }
    }
}

export async function switchAppMode(targetMode) {
    stateManager.activeMode = targetMode;
    console.log(`[App] Switching app mode to: ${targetMode}`);

    syncEnsembleGrid();

    updateModeNavigation(targetMode);
    unloadActiveViewer();

    const radarTools = document.getElementById('radar-tools-container');
    const timeline = document.getElementById('timeline-container');
    if (radarTools) {
        radarTools.style.display = (targetMode === 'radar') ? 'flex' : 'none';
    }
    if (timeline) timeline.style.display = 'flex';

    const modelBtn = document.getElementById('btn-model-menu');
    const paramBtn = document.getElementById('btn-param-menu');
    const modelBar = document.getElementById('model-category-bar');
    const paramBar = document.getElementById('param-category-bar');

    if (modelBar) modelBar.style.display = 'none';
    if (paramBar) paramBar.style.display = 'none';
    if (modelBtn) modelBtn.classList.remove('active', 'open');
    if (paramBtn) paramBtn.classList.remove('active', 'open');

    const desktopCats = document.getElementById('desktop-param-categories');
    if (desktopCats) {
        desktopCats.style.display = (targetMode === 'modelViewer' && window.innerWidth >= 1024) ? 'flex' : 'none';
    }

    if (targetMode === 'satellite' || targetMode === 'tropics') {
        if (timeline) timeline.style.display = 'none';
        if (radarTools) radarTools.style.display = 'none';
        if (modelBtn) modelBtn.style.display = 'none';
        if (paramBtn) modelBtn.style.display = 'none';
        showComingSoonScreen(targetMode);
        return;
    }

    if (modelBtn) modelBtn.style.display = '';
    if (paramBtn) {
        paramBtn.style.display = (targetMode === 'modelViewer' && window.innerWidth >= 1024) ? 'none' : '';
    }
    hideComingSoonScreen();

    if (targetMode === 'radar') {
        showToast("Loading Real-Time Radar...");
        if (modelBtn) modelBtn.querySelector('span').textContent = 'NEXRAD Composite';
        if (paramBtn) paramBtn.querySelector('span').textContent = 'Base Reflectivity (dBZ)';
        
        destroyCityOverlay();

        if (stateManager.currentMapStyle !== './config/style_radar.json') {
            stateManager.currentMapStyle = './config/style_radar.json';
            
            let loaded = false;
            const onReady = async () => {
                if (loaded) return;
                loaded = true;
                applyRadarTheme(stateManager.currentTheme);
                setBasemapLabelsVisibility(map, true);
                await initRadarMode(map);
                hideToast();
            };

            map.once('style.load', onReady);
            setTimeout(onReady, 2000);
            map.setStyle('./config/style_radar.json');
        } else {
            applyRadarTheme(stateManager.currentTheme);
            setBasemapLabelsVisibility(map, true);
            await initRadarMode(map);
            hideToast();
        }

    } else if (targetMode === 'modelViewer') {
        showToast("Loading Global Models...");
        
        if (modelBtn) {
            const mSpan = modelBtn.querySelector('span');
            if (mSpan) {
                if (stateManager.activeModel === 'hrrr') mSpan.textContent = 'HRRR';
                else if (stateManager.activeModel === 'rrfs') mSpan.textContent = 'RRFS';
                else if (stateManager.activeModel === 'aifs') mSpan.textContent = 'EC-AIFS';
                else if (stateManager.activeModel === 'aifs_ens') mSpan.textContent = 'AIFS-ENS';
                else mSpan.textContent = 'ECMWF-IFS';
            }
        }
        if (paramBtn) paramBtn.querySelector('span').textContent = stateManager.paramConfig?.name || '2m Temperature';

        setBasemapLabelsVisibility(map, false);
        if (map && map.getZoom() > 6) {
            map.easeTo({
                center: [-96.5, 38.5],
                zoom: (typeof window !== 'undefined' && window.innerWidth < 768) ? 3.2 : 3.8,
                duration: 600
            });
        }

        const targetStyle = stateManager.currentTheme === 'dark'
            ? (stateManager.paramConfig?.map_style_dark || './config/style_dark.json')
            : (stateManager.paramConfig?.map_style_light || './config/style_default.json');

        if (stateManager.currentMapStyle !== targetStyle) {
            stateManager.currentMapStyle = targetStyle;
            
            let loaded = false;
            const onReady = async () => {
                if (loaded) return;
                loaded = true;

                if (typeof map.setProjection === 'function') {
                    map.setProjection({ type: stateManager.activeView === '3d' ? 'globe' : 'mercator' });
                }

                try { initCityOverlay(map); } catch (e) {}
                try { initVectorContours(map); } catch (e) {}
                await loadInitialModelData();
                hideToast();
            };

            map.once('style.load', onReady);
            setTimeout(onReady, 2000);
            map.setStyle(targetStyle);
        } else {
            if (typeof map.setProjection === 'function') {
                map.setProjection({ type: stateManager.activeView === '3d' ? 'globe' : 'mercator' });
            }

            try { initCityOverlay(map); } catch (e) {}
            try { initVectorContours(map); } catch (e) {}
            await loadInitialModelData();
            hideToast();
        }
    }
}

initHubTransition((selectedMode) => {
    switchAppMode(selectedMode);
});

document.querySelectorAll('.mode-nav-btn').forEach((button) => {
    button.addEventListener('click', () => switchAppMode(button.dataset.mode));
});

initViewerUI(
    (stepIndex) => {
        if (renderDebounceId) cancelAnimationFrame(renderDebounceId);
        renderDebounceId = requestAnimationFrame(() => renderFrame(stepIndex));
    },
    (newTheme) => { applyTheme(newTheme); },
    (newView) => { applyView(newView); },
    (direction, x, y) => { handleKeyboardZoom(direction, x, y); },
    map,
    () => {
        updateCityCallouts(map, stateManager.activeFrameState, stateManager.manifest);
        updateRadarUnitLabels();
        const currentStep = stateManager.globalSteps[stateManager.currentStepIndex]?.step;
        if (currentStep !== undefined) updateVectorContours(currentStep);
        const location = popup.getLngLat();
        if (popup.isOpen() && location && stateManager.activeFrameState && stateManager.activeMode !== 'radar') {
            const value = sampleBilinearValue(location.lng, location.lat, stateManager.activeFrameState, stateManager.manifest);
            const formattedText = formatParameterValue(value, stateManager.manifest);
            const paramName = stateManager.manifest?.name || stateManager.manifest?.parameter || 'Value';
            popup.setHTML(`<div class="temp-f">${formattedText}</div><div class="temp-c">${paramName}</div>`);
        }
    }
);

map.on('error', (e) => {
    console.warn("MapLibre Basemap load warning:", e);
});

map.on('load', async () => {
    stateManager.currentMapStyle = './config/style_default.json';
    setBasemapLabelsVisibility(map, false);
    initBasemapMap();
    initWeatherMap();
    initAtmosphereHaloCanvas();
    try { initVectorContours(map); } catch (err) {}
    
    // 🌟 Cache basemap layer IDs for single-pass viewport mode
    basemapLayerIds = (map.getStyle().layers || [])
        .map(l => l.id)
        .filter(id => id !== 'weather-gpu-shader' && id !== 'contour-gpu-layer' && id !== 'contour-master-label-layer');
});

map.on('style.load', () => {
    if (basemapMap && stateManager.currentMapStyle) {
        updateBasemapMapStyle(stateManager.currentMapStyle);
    }
});

map.on('move', () => {
    syncBasemapMapCamera();
    if (isDrawingEnsemble) isBasemapCaptured = false;
});

map.on('render', () => {
    if (!isDrawingEnsemble || isRenderingEnsemble) return;

    if (map.isMoving()) {
        isBasemapCaptured = false; // 🌟 Force a fresh clean snapshot next time we stop
    }
});

map.on('moveend', () => {
    if (isDrawingEnsemble) {
        updateCachedDimensions();
        renderAllEnsembleMembers();
    }
});

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
