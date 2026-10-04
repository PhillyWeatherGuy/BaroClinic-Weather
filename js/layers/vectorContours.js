// js/layers/vectorContours.js
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
let activeMasterContours = null;
let activeMasterKey = null;
let fetchPromise = null;
let activeContourBinary = null;
let latestRequestId = 0;
let modelsConfigCache = null;

// 🌟 In-memory cache for ready-to-render GeoJSON per step (0.0ms instant scrubbing)
const stepGeoJsonCache = new Map();

const SOURCE_ID = 'contour-master-source';
const CASING_LAYER_ID = 'contour-master-casing-layer';
const LINE_LAYER_ID = 'contour-master-line-layer';
const LABEL_LAYER_ID = 'contour-master-label-layer';
const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

/**
 * 🌟 Direct, fresh fetch of config/models.json
 */
async function getModelsConfig() {
    if (modelsConfigCache) return modelsConfigCache;
    try {
        const resp = await fetch(`./config/models.json?v=${Date.now()}`, { cache: 'no-store' });
        if (resp.ok) {
            modelsConfigCache = await resp.json();
        }
    } catch (e) {
        console.warn("Could not load config/models.json:", e);
    }
    return modelsConfigCache;
}

async function getContourConfig(paramId) {
    const id = (paramId || stateManager.paramConfig?.id || stateManager.activeParam || '2t').toLowerCase();
    if (stateManager.paramConfig?.id === id && stateManager.paramConfig?.contours) {
        return stateManager.paramConfig.contours;
    }
    const data = await getModelsConfig();
    return data?.parameters?.[id]?.contours || stateManager.paramConfig?.contours || null;
}

/**
 * 🌟 Reliably matches the active theme to what is shown on screen
 */
function isDarkThemeActive() {
    const themeBtn = typeof document !== 'undefined' ? document.getElementById('btn-theme-toggle') : null;
    if (themeBtn) {
        return !themeBtn.classList.contains('light-mode');
    }
    return stateManager.currentTheme === 'dark';
}

function pvaZoomWidthExpression(baseWidth, isGlow = false) {
    const expression = ['interpolate', ['linear'], ['zoom']];
    const zoomStops = [[2, 0.9, 2.4], [5, 1.0, 2.6], [8, 1.4, 3.2], [11, 1.8, 4.0], [14, 2.1, 4.8]];

    for (const [zoom, scale, glowWidth] of zoomStops) {
        const scaledWidth = ['*', baseWidth, scale];
        expression.push(zoom, isGlow
            ? ['+', scaledWidth, glowWidth]
            : ['case', ['has', 'outlineColor'], scaledWidth, baseWidth]);
    }

    return expression;
}

/**
 * 🌟 Purely Config-Driven Styler: plots whatever design rules exist in config/models.json
 */
function themeContourFeatures(featureCollection, cfg) {
    if (!featureCollection || !Array.isArray(featureCollection.features)) {
        return featureCollection;
    }
    if (!cfg) {
        return EMPTY_GEOJSON;
    }

    const isDark = isDarkThemeActive();
    const baseColor = isDark ? (cfg.color_dark || '#ffffff') : (cfg.color_light || '#000000');
    const hasGlow = Boolean(cfg.glow);
    const glowColor = hasGlow ? (isDark ? (cfg.glow_dark || '#00c8ff') : (cfg.glow_light || '#ffffff')) : null;
    const coarseInterval = cfg.zoom_filter?.coarse_interval;

    for (const feature of featureCollection.features) {
        if (!feature || !feature.properties) continue;

        // Clone properties to avoid mutating the master cache
        feature.properties = { ...feature.properties };

        const originalName = String(feature.properties.name || '');
        const rawLevel = parseFloat(originalName);

        // 1. Dynamic unit formatting from models.json (e.g. 273.15 -> 32°F / 0°C)
        if (cfg.unit_label === 'temperature') {
            const freezingLabel = stateManager.currentUnits === 'metric' ? '0°C' : '32°F';
            if (rawLevel === 273.15 || /freez|273\.15/i.test(originalName)) {
                feature.properties.name = freezingLabel;
            }
        }

        // 2. Zoom interval filtering (e.g. for MSLP isobars, tag 2 mb intermediate lines)
        const isIntermediate = Boolean(coarseInterval && !isNaN(rawLevel) && (Math.round(rawLevel) % coarseInterval !== 0));
        feature.properties.isIntermediate = isIntermediate;

        // 3. Styling from models.json
        let featureColor = baseColor;
        let featureWidth = cfg.width || 1.6;
        let featureOpacity = cfg.opacity || 0.95;
        let isSpecial = false;

        // 4. Special target lines from models.json (e.g. 540 in blue, 273.15 in blue)
        if (cfg.special_lines && Array.isArray(cfg.special_lines)) {
            for (const special of cfg.special_lines) {
                const matches = (!isNaN(rawLevel) && Math.abs(rawLevel - special.target) < 0.1) ||
                                (special.target === 273.15 && /freez|273\.15|0°C|32°F/i.test(originalName));
                if (matches) {
                    if (special.color) featureColor = special.color;
                    if (special.width) featureWidth = special.width;
                    if (special.opacity) featureOpacity = special.opacity;
                    isSpecial = true;
                    break;
                }
            }
        }

        feature.properties.color = featureColor;
        feature.properties.stroke = featureColor;
        feature.properties.width = featureWidth;
        feature.properties.opacity = featureOpacity;

        // 5. Casing & Glow
        if (hasGlow) {
            feature.properties.outlineColor = isDark ? glowColor : (cfg.glow_light || '#ffffff');
            feature.properties.outlineOpacity = isDark ? 0.8 : 0.95;
            feature.properties.outlineBlur = isDark ? 2.0 : 0;
        } else {
            delete feature.properties.outlineColor;
        }

        feature.properties.labelColor = isSpecial
            ? featureColor
            : (baseColor === '#ffffff' ? '#000000' : '#ffffff');
        feature.properties.labelHaloColor = baseColor;
    }

    return featureCollection;
}

export function initVectorContours(map) {
    mapInstance = map;

    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: EMPTY_GEOJSON
        });

        // Casing / Glow Layer
        map.addLayer({
            id: CASING_LAYER_ID,
            type: 'line',
            source: SOURCE_ID,
            filter: ['has', 'outlineColor'],
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': ['get', 'outlineColor'],
                'line-width': pvaZoomWidthExpression(['coalesce', ['get', 'width'], 1.6], true),
                'line-opacity': ['coalesce', ['get', 'outlineOpacity'], 0.8],
                'line-blur': ['coalesce', ['get', 'outlineBlur'], 2.0]
            }
        });

        // 1. Smooth Vector Line Layer (with Zoom-dependent 2mb/4mb isobar fade)
        map.addLayer({
            id: LINE_LAYER_ID,
            type: 'line',
            source: SOURCE_ID,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': ['coalesce', ['get', 'color'], ['get', 'stroke'], '#4169E1'],
                'line-width': pvaZoomWidthExpression(['coalesce', ['get', 'width'], 2.0]),
                'line-opacity': [
                    'case',
                    ['==', ['get', 'isIntermediate'], true],
                    [
                        'interpolate', ['linear'], ['zoom'],
                        4.0, 0.0,
                        5.5, ['coalesce', ['get', 'opacity'], 0.85]
                    ],
                    ['coalesce', ['get', 'opacity'], 0.95]
                ]
            }
        });

        // 2. Inline Contour Labels (with Zoom-dependent 2mb/4mb isobar fade)
        map.addLayer({
            id: LABEL_LAYER_ID,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'symbol-placement': 'line',
                'text-field': ['get', 'name'],
                'text-size': ['case', ['has', 'labelColor'], 14, 11],
                'text-font': ['Noto Sans Bold'],
                'text-max-angle': 45,
                'text-padding': 12
            },
            paint: {
                'text-color': ['coalesce', ['get', 'labelColor'], ['get', 'color'], '#FFFFFF'],
                'text-halo-color': ['coalesce', ['get', 'labelHaloColor'], '#0b0f19'],
                'text-halo-width': ['case', ['has', 'labelColor'], 2.5, 2.0],
                'text-opacity': [
                    'case',
                    ['==', ['get', 'isIntermediate'], true],
                    [
                        'interpolate', ['linear'], ['zoom'],
                        4.2, 0.0,
                        5.5, 1.0
                    ],
                    1.0
                ]
            }
        });
    }
}

/**
 * 🌟 AIRTIGHT UNLOADER: Wipes master RAM cache & clears vector layer on parameter/model switch
 */
export function clearVectorContours() {
    activeMasterContours = null;
    activeContourBinary = null;
    activeMasterKey = null;
    fetchPromise = null;
    stepGeoJsonCache.clear();
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (source) {
        source.setData(EMPTY_GEOJSON);
    }
}

function getMasterKeyComponents() {
    const model = (stateManager.manifest?.model || stateManager.activeModel || 'ecmwf').toLowerCase();
    const param = (stateManager.paramConfig?.id || stateManager.activeParam || stateManager.manifest?.parameter || '2t').toLowerCase();
    const targetDate = stateManager.manifest?.date || stateManager.currentDate;
    const runCycle = (stateManager.manifest?.run || stateManager.currentCycle || '').toLowerCase();
    return { model, param, targetDate, runCycle, key: `${model}_${param}_${targetDate}_${runCycle}` };
}

/**
 * 🌟 Helper to fetch the 1 Master Contour JSON file for the active run
 */
async function loadMasterContourFile() {
    const { model, param, targetDate, runCycle, key } = getMasterKeyComponents();

    const cfg = await getContourConfig(param);
    const sourceParam = (cfg?.source_param || (param === 'pva' ? 'z500' : param)).toLowerCase();
    const activeKey = `${model}_${sourceParam}_${targetDate}_${runCycle}`;

    if (activeMasterKey === activeKey && activeMasterContours) {
        return activeMasterContours;
    }

    if (fetchPromise && activeMasterKey === activeKey) {
        return await fetchPromise;
    }

    activeMasterKey = activeKey;

    const urlsToTry = [];
    if (targetDate && runCycle) {
        urlsToTry.push(`${stateManager.BASE_URL}${model}_${sourceParam}_${targetDate}_${runCycle}_contours.json?v=${Date.now()}`);
    }
    urlsToTry.push(`${stateManager.BASE_URL}${model}_${sourceParam}_contours.json?v=${Date.now()}`);

    if (sourceParam === '2t' || sourceParam.includes('temp')) {
        urlsToTry.push(`${stateManager.BASE_URL}${model}_tmp2m_contours.json?v=${Date.now()}`);
    }
    if (param === 'pva') {
        urlsToTry.push(`${stateManager.BASE_URL}${model}_z500_contours.json?v=${Date.now()}`);
    }

    fetchPromise = (async () => {
        for (const contourUrl of urlsToTry) {
            try {
                const resp = await fetch(contourUrl).catch(() => null);
                if (resp && resp.ok) {
                    const data = await resp.json().catch(() => null);
                    if (data && data.steps) {
                        activeMasterContours = data;
                        if (data.binary?.file && typeof DecompressionStream !== 'undefined') {
                            const binaryResp = await fetch(`${stateManager.BASE_URL}${data.binary.file}?v=${Date.now()}`).catch(() => null);
                            if (binaryResp?.ok) {
                                activeContourBinary = await decodeContourBinary(
                                    await binaryResp.arrayBuffer(),
                                    data.binary.scale || 1000
                                );
                            }
                        }
                        console.log(`✅ Loaded Master Contours from: ${contourUrl}`);
                        return activeMasterContours;
                    }
                }
            } catch (err) {}
        }
        activeMasterContours = null;
        return null;
    })();

    return await fetchPromise;
}

async function decodeContourBinary(buffer, coordinateScale = 1000) {
    let bytes = new Uint8Array(buffer);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const format = String.fromCharCode(...bytes.subarray(0, 4));
    if (format === 'CTV2') return decodeContourV2(view, coordinateScale);
    if (format !== 'CTV1') return null;
    let offset = 4;
    const stepCount = view.getUint32(offset, true);
    offset += 4;
    const steps = new Map();

    for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
        const step = view.getUint32(offset, true);
        const featureCount = view.getUint32(offset + 4, true);
        offset += 8;
        const features = [];
        for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
            const lineCount = view.getUint32(offset, true);
            offset += 4;
            const lines = [];
            for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
                const pointCount = view.getUint32(offset, true);
                offset += 4;
                const line = [];
                let x = 0;
                let y = 0;
                for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
                    x += view.getInt32(offset, true);
                    y += view.getInt32(offset + 4, true);
                    offset += 8;
                    line.push([x / 1000, y / 1000]);
                }
                lines.push(line);
            }
            features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines } });
        }
        steps.set(String(step), features);
    }
    return steps;
}

function decodeContourV2(view, coordinateScale) {
    let offset = 4;
    const stepCount = view.getUint32(offset, true);
    offset += 4;
    const steps = new Map();

    for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
        const step = view.getUint32(offset, true);
        const featureCount = view.getUint32(offset + 4, true);
        const payloadLength = view.getUint32(offset + 8, true);
        offset += 12;
        const payloadEnd = offset + payloadLength;
        const features = [];

        for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
            const lineCount = view.getUint32(offset, true);
            offset += 4;
            const lengths = [];
            let pointCount = 0;
            for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
                const length = view.getUint32(offset, true);
                offset += 4;
                lengths.push(length);
                pointCount += length;
            }

            const starts = [];
            for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
                starts.push([
                    view.getInt32(offset, true) / coordinateScale,
                    view.getInt32(offset + lineCount * 4, true) / coordinateScale
                ]);
                offset += 4;
            }
            offset += lineCount * 4;

            const deltaCount = pointCount - lineCount;
            const deltaX = [];
            const deltaY = [];
            for (let deltaIndex = 0; deltaIndex < deltaCount; deltaIndex++) {
                deltaX.push(view.getInt16(offset, true));
                offset += 2;
            }
            for (let deltaIndex = 0; deltaIndex < deltaCount; deltaIndex++) {
                deltaY.push(view.getInt16(offset, true));
                offset += 2;
            }

            const lines = [];
            let deltaIndex = 0;
            for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
                let x = starts[lineIndex][0];
                let y = starts[lineIndex][1];
                const line = [[x, y]];
                for (let pointIndex = 1; pointIndex < lengths[lineIndex]; pointIndex++) {
                    x += deltaX[deltaIndex] / coordinateScale;
                    y += deltaY[deltaIndex] / coordinateScale;
                    deltaIndex++;
                    line.push([x, y]);
                }
                lines.push(line);
            }
            features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines } });
        }

        if (offset !== payloadEnd) return null;
        steps.set(String(step), features);
    }
    return steps;
}

function binaryStepToGeoJson(step, masterData) {
    const features = activeContourBinary?.get(String(step));
    const metadata = masterData.steps?.[String(step)]?.features?.map(feature => feature.properties) || [];
    if (!features) return null;
    return {
        type: 'FeatureCollection',
        features: features.map((feature, index) => ({
            ...feature,
            properties: { ...(metadata[index] || {}) }
        }))
    };
}

/**
 * 🌟 Synchronous, Zero-Delay Step Renderer (pulls pre-built GeoJSON from RAM in 0.0ms)
 */
function renderCachedStep(stepNum, masterData, source, cfg) {
    const isDark = isDarkThemeActive();
    const units = stateManager.currentUnits;
    const zoom = mapInstance ? mapInstance.getZoom() : 5;
    const isCoarseZoom = (zoom < 5.0);
    const cacheKey = `${activeMasterKey}_${stepNum}_${isDark ? 'dark' : 'light'}_${units}_${isCoarseZoom ? 'c' : 'f'}`;

    if (stepGeoJsonCache.has(cacheKey)) {
        source.setData(stepGeoJsonCache.get(cacheKey));
        return;
    }

    if (masterData && masterData.steps) {
        const stepData = masterData.steps[String(stepNum)] ||
                         masterData.steps[String(stepNum).padStart(3, '0')] ||
                         masterData.steps[`F${String(stepNum).padStart(3, '0')}`] ||
                         masterData.steps[stepNum];

        if (stepData) {
            const decodedStepData = binaryStepToGeoJson(stepNum, masterData) || stepData;
            const themedStepData = themeContourFeatures(decodedStepData, cfg);
            stepGeoJsonCache.set(cacheKey, themedStepData);
            source.setData(themedStepData);
            return;
        }
    }
    source.setData(EMPTY_GEOJSON);
}

/**
 * 🌟 Instant Vector Contour Renderer with Synchronous Fast-Path & Stale Frame Dropping
 */
export async function updateVectorContours(step) {
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (!source) return;

    const param = (stateManager.paramConfig?.id || stateManager.activeParam || '2t').toLowerCase();
    const cfg = await getContourConfig(param);
    if (!cfg) {
        source.setData(EMPTY_GEOJSON);
        return;
    }

    let stepNum = typeof step === 'number' ? step : parseInt(String(step).replace(/\D/g, ''), 10) || 0;
    const requestId = ++latestRequestId;

    const sourceParam = (cfg.source_param || param).toLowerCase();
    const { model, targetDate, runCycle } = getMasterKeyComponents();
    const expectedKey = `${model}_${sourceParam}_${targetDate}_${runCycle}`;

    // 🌟 FAST-PATH: If already loaded in RAM, render completely synchronously in 0.0ms (no await delay)
    if (activeMasterContours && activeMasterKey === expectedKey) {
        renderCachedStep(stepNum, activeMasterContours, source, cfg);
        return;
    }

    // SLOW-PATH: Initial fetch / background load
    const masterData = await loadMasterContourFile();

    // Drop stale request if a newer scrub frame was requested while loading
    if (requestId !== latestRequestId) return;

    if (masterData) {
        renderCachedStep(stepNum, masterData, source, cfg);
    } else {
        source.setData(EMPTY_GEOJSON);
    }
}

/**
 * 🌟 BACKGROUND CONTOUR PRELOADER
 */
export async function preloadAllContours() {
    await loadMasterContourFile();
}
