// js/layers/vectorContours.js
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
let activeMasterContours = null;
let activeMasterKey = null;
let fetchPromise = null;
let activeContourBinary = null;
let currentVisibleStep = 0;

// 🌟 In-memory cache: stores decoded & themed GeoJSON per step for instant recall
const stepCache = new Map();

const SOURCE_ID = 'contour-master-source';
const CASING_LAYER_ID = 'contour-master-casing-layer';
const LINE_LAYER_ID = 'contour-master-line-layer';
const LABEL_LAYER_ID = 'contour-master-label-layer';
const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

function getPvaContourThemeColor() {
    return stateManager.currentTheme === 'dark' ? '#ffffff' : '#000000';
}

function getPvaContourGlowColor() {
    return stateManager.currentTheme === 'dark' ? '#00c8ff' : '#007c91';
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

function themeContourFeatures(featureCollection) {
    if (!featureCollection || !Array.isArray(featureCollection.features)) {
        return featureCollection;
    }

    const activeParamId = (stateManager.paramConfig?.id || stateManager.activeParam || '').toLowerCase();
    
    // 1. 2m Temperature (Freezing Line) - Untouched
    if (activeParamId === '2t') {
        const freezingLabel = stateManager.currentUnits === 'metric' ? '0°C' : '32°F';
        for (const feature of featureCollection.features) {
            const name = String(feature?.properties?.name || '');
            if (feature?.properties && (Number(name) === 273.15 || /freez|273\.15/i.test(name))) {
                feature.properties.name = freezingLabel;
            }
        }
        return featureCollection;
    }

    // 2. Surface Precipitation Rate (MSLP Isobars)
    if (activeParamId === 'prate') {
        const isDark = stateManager.currentTheme === 'dark';
        const mslpColor = isDark ? '#ffffff' : '#000000';

        for (const feature of featureCollection.features) {
            if (!feature || !feature.properties) continue;
            const val = parseFloat(feature.properties.name);
            feature.properties.isIntermediate = !isNaN(val) && (Math.round(val) % 4 !== 0);
            feature.properties.color = mslpColor;
            feature.properties.stroke = mslpColor;
            feature.properties.labelColor = mslpColor;
            feature.properties.labelHaloColor = isDark ? '#0b0f19' : '#ffffff';
            feature.properties.width = 1.5;
            feature.properties.opacity = 0.9;
        }
        return featureCollection;
    }

    // 3. 500mb PVA / Vorticity Heights - Untouched
    if (activeParamId !== 'pva') {
        return featureCollection;
    }

    const contourColor = getPvaContourThemeColor();
    const glowColor = getPvaContourGlowColor();
    const isDarkTheme = stateManager.currentTheme === 'dark';
    for (const feature of featureCollection.features) {
        if (!feature || !feature.properties) continue;
        const is540Line = Number(feature.properties.name) === 540;
        const featureColor = is540Line ? '#4169E1' : contourColor;
        feature.properties.color = featureColor;
        feature.properties.stroke = featureColor;
        feature.properties.outlineColor = isDarkTheme ? glowColor : '#ffffff';
        feature.properties.outlineOpacity = isDarkTheme ? 0.8 : 0.95;
        feature.properties.outlineBlur = isDarkTheme ? 2.0 : 0;
        feature.properties.labelColor = is540Line ? featureColor : (contourColor === '#ffffff' ? '#000000' : '#ffffff');
        feature.properties.labelHaloColor = contourColor;
        if (is540Line) {
            feature.properties.width = Math.max(Number(feature.properties.width) || 1.6, 2.4);
        }
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

        // 1. Smooth Vector Line Layer (with GPU 4mb/2mb zoom hierarchy for prate)
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

        // 2. Inline Contour Labels (with GPU 4mb/2mb zoom hierarchy for prate)
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
    currentVisibleStep = 0;
    stepCache.clear();
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

    if (activeMasterKey === key && activeMasterContours) {
        return activeMasterContours;
    }

    if (fetchPromise && activeMasterKey === key) {
        return await fetchPromise;
    }

    activeMasterKey = key;

    const urlsToTry = [];
    if (param === 'pva') {
        if (targetDate && runCycle) {
            urlsToTry.push(`${stateManager.BASE_URL}${model}_z500_${targetDate}_${runCycle}_contours.json?v=${Date.now()}`);
        }
        urlsToTry.push(`${stateManager.BASE_URL}${model}_z500_contours.json?v=${Date.now()}`);
    }
    if (targetDate && runCycle) {
        urlsToTry.push(`${stateManager.BASE_URL}${model}_${param}_${targetDate}_${runCycle}_contours.json?v=${Date.now()}`);
    }
    urlsToTry.push(`${stateManager.BASE_URL}${model}_${param}_contours.json?v=${Date.now()}`);
    if (param === '2t' || param.includes('temp')) {
        urlsToTry.push(`${stateManager.BASE_URL}${model}_tmp2m_contours.json?v=${Date.now()}`);
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
 * 🌟 Renders only the requested step (pulls from RAM cache if visited before, or decodes on-demand)
 */
function renderSingleStep(stepNum, masterData, source) {
    const isDark = stateManager.currentTheme === 'dark';
    const units = stateManager.currentUnits;
    const cacheKey = `${activeMasterKey}_${stepNum}_${isDark ? 'dark' : 'light'}_${units}`;

    // 1. FAST PATH: Already in memory from a previous scrub or background pre-warm
    if (stepCache.has(cacheKey)) {
        source.setData(stepCache.get(cacheKey));
        return;
    }

    // 2. ON-DEMAND PATH: Decodes and themes only this single step, then caches it in RAM
    if (masterData && masterData.steps) {
        const stepData = masterData.steps[String(stepNum)] ||
                         masterData.steps[String(stepNum).padStart(3, '0')] ||
                         masterData.steps[`F${String(stepNum).padStart(3, '0')}`] ||
                         masterData.steps[stepNum];

        if (stepData) {
            const decodedStepData = binaryStepToGeoJson(stepNum, masterData) || stepData;
            const themedStepData = themeContourFeatures(decodedStepData);
            stepCache.set(cacheKey, themedStepData);
            source.setData(themedStepData);
            return;
        }
    }
    source.setData(EMPTY_GEOJSON);
}

/**
 * 🌟 Instant Step Renderer: loads on-demand first time, 0.0ms from memory on return
 */
export async function updateVectorContours(step) {
    if (!mapInstance || stateManager.activeMode !== 'modelViewer') {
        clearVectorContours();
        return;
    }

    const param = (stateManager.paramConfig?.id || stateManager.activeParam || '').toLowerCase();
    const hasContours = (param === '2t' || param === 'prate' || param === 'pva');
    if (!hasContours) {
        clearVectorContours();
        return;
    }

    let stepNum = typeof step === 'number' ? step : parseInt(String(step).replace(/\D/g, ''), 10) || 0;
    currentVisibleStep = stepNum;

    if (!mapInstance.getSource(SOURCE_ID)) {
        initVectorContours(mapInstance);
    }

    const source = mapInstance.getSource(SOURCE_ID);
    if (!source) return;

    const { key } = getMasterKeyComponents();

    // If master file is already in RAM, render/cache this step immediately
    if (activeMasterContours && activeMasterKey === key) {
        renderSingleStep(stepNum, activeMasterContours, source);
        return;
    }

    // Initial load: fetch file and render ONLY this current frame
    const masterData = await loadMasterContourFile();
    if (masterData) {
        renderSingleStep(currentVisibleStep, masterData, source);
    }
}

/**
 * 🌟 Progressive Background Pre-warmer: warms up remaining steps in idle slices without blocking UI
 */
export async function preloadAllContours() {
    if (stateManager.activeMode !== 'modelViewer') return;
    const param = (stateManager.paramConfig?.id || stateManager.activeParam || '').toLowerCase();
    if (param !== '2t' && param !== 'prate' && param !== 'pva') return;

    const masterData = await loadMasterContourFile();
    if (!masterData || !masterData.steps || !activeContourBinary) return;

    const steps = Object.keys(masterData.steps);
    let idx = 0;

    function warmNextSlice() {
        if (stateManager.activeMode !== 'modelViewer') return;
        const limit = Math.min(idx + 5, steps.length);
        const isDark = stateManager.currentTheme === 'dark';
        const units = stateManager.currentUnits;

        for (; idx < limit; idx++) {
            const stepNum = parseInt(steps[idx], 10);
            if (isNaN(stepNum)) continue;
            const cacheKey = `${activeMasterKey}_${stepNum}_${isDark ? 'dark' : 'light'}_${units}`;
            if (!stepCache.has(cacheKey)) {
                const decoded = binaryStepToGeoJson(stepNum, masterData);
                if (decoded) {
                    stepCache.set(cacheKey, themeContourFeatures(decoded));
                }
            }
        }

        if (idx < steps.length) {
            setTimeout(warmNextSlice, 25);
        }
    }

    setTimeout(warmNextSlice, 150);
}
