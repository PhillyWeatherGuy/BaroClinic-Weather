// js/layers/vectorContours.js
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
let activeMasterContours = null;
let activeMasterKey = null;
let fetchPromise = null;
let activeContourBinary = null;

let currentVisibleStep = 0;
const loadedSteps = new Set(); // Tracks which steps have layers generated

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

const getSourceId = (step) => `contour-source-${step}`;
const getCasingId = (step) => `contour-casing-${step}`;
const getLineId = (step) => `contour-line-${step}`;
const getLabelId = (step) => `contour-label-${step}`;

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
}

/**
 * 🌟 Creates isolated Source & Layers for a specific step
 */
function addStepLayers(map, step, geojson) {
    const sourceId = getSourceId(step);
    
    if (map.getSource(sourceId)) return;

    map.addSource(sourceId, {
        type: 'geojson',
        data: geojson
    });

    map.addLayer({
        id: getCasingId(step),
        type: 'line',
        source: sourceId,
        filter: ['has', 'outlineColor'],
        layout: {
            'line-join': 'round',
            'line-cap': 'round',
            'visibility': 'visible'
        },
        paint: {
            'line-color': ['get', 'outlineColor'],
            'line-width': pvaZoomWidthExpression(['coalesce', ['get', 'width'], 1.6], true),
            'line-opacity': ['coalesce', ['get', 'outlineOpacity'], 0.8],
            'line-blur': ['coalesce', ['get', 'outlineBlur'], 2.0]
        }
    });

    map.addLayer({
        id: getLineId(step),
        type: 'line',
        source: sourceId,
        layout: {
            'line-join': 'round',
            'line-cap': 'round',
            'visibility': 'visible'
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

    map.addLayer({
        id: getLabelId(step),
        type: 'symbol',
        source: sourceId,
        layout: {
            'symbol-placement': 'line',
            'text-field': ['get', 'name'],
            'text-size': ['case', ['has', 'labelColor'], 14, 11],
            'text-font': ['Noto Sans Bold'],
            'text-max-angle': 45,
            'text-padding': 12,
            'visibility': 'visible'
        },
        paint: {
            'text-color': ['coalesce', ['get', 'labelColor'], ['get', 'color'], '#FFFFFF'],
            'text-halo-color': ['coalesce', ['get', 'labelHaloColor'], '#0b0f19'],
            'text-halo-width': ['case', ['has', 'labelColor'], 2.5, 2.0]
        }
    });
}

function setStepVisibility(step, isVisible) {
    if (!mapInstance || !loadedSteps.has(step)) return;
    const vis = isVisible ? 'visible' : 'none';
    if (mapInstance.getLayer(getCasingId(step))) mapInstance.setLayoutProperty(getCasingId(step), 'visibility', vis);
    if (mapInstance.getLayer(getLineId(step))) mapInstance.setLayoutProperty(getLineId(step), 'visibility', vis);
    if (mapInstance.getLayer(getLabelId(step))) mapInstance.setLayoutProperty(getLabelId(step), 'visibility', vis);
}

/**
 * 🌟 AIRTIGHT UNLOADER: Wipes master RAM cache & completely destroys all step layers
 */
export function clearVectorContours() {
    activeMasterContours = null;
    activeContourBinary = null;
    activeMasterKey = null;
    fetchPromise = null;

    if (mapInstance) {
        loadedSteps.forEach(step => {
            if (mapInstance.getLayer(getCasingId(step))) mapInstance.removeLayer(getCasingId(step));
            if (mapInstance.getLayer(getLineId(step))) mapInstance.removeLayer(getLineId(step));
            if (mapInstance.getLayer(getLabelId(step))) mapInstance.removeLayer(getLabelId(step));
            if (mapInstance.getSource(getSourceId(step))) mapInstance.removeSource(getSourceId(step));
        });
    }

    loadedSteps.clear();
    currentVisibleStep = 0;
}

/**
 * 🌟 Helper to fetch the 1 Master Contour JSON file for the active run
 */
async function loadMasterContourFile() {
    const model = (stateManager.manifest?.model || stateManager.activeModel || 'ecmwf').toLowerCase();
    
    // 🌟 Use clean parameter ID (e.g. '2t', 'pva') instead of long display names
    const param = (stateManager.paramConfig?.id || stateManager.activeParam || stateManager.manifest?.parameter || '2t').toLowerCase();
    const targetDate = stateManager.manifest?.date || stateManager.currentDate;
    const runCycle = (stateManager.manifest?.run || stateManager.currentCycle || '').toLowerCase();

    const currentKey = `${model}_${param}_${targetDate}_${runCycle}`;

    if (activeMasterKey === currentKey && activeMasterContours) {
        return activeMasterContours;
    }

    if (fetchPromise && activeMasterKey === currentKey) {
        return await fetchPromise;
    }

    activeMasterKey = currentKey;

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
            properties: metadata[index] || {}
        }))
    };
}

/**
 * 🌟 Hybrid Visibility Toggle Renderer
 * If layer exists: toggles visibility instantly (0ms lag)
 * If layer missing: decodes and loads into map (first-time hit)
 */
export async function updateVectorContours(step) {
    if (!mapInstance) return;

    let stepNum = typeof step === 'number' ? step : parseInt(String(step).replace(/\D/g, ''), 10) || 0;

    // 🌟 FAST PATH: Layer already exists. Toggle visibility instantly in 0ms
    if (loadedSteps.has(stepNum)) {
        if (currentVisibleStep !== stepNum && loadedSteps.has(currentVisibleStep)) {
            setStepVisibility(currentVisibleStep, false);
        }
        setStepVisibility(stepNum, true);
        currentVisibleStep = stepNum;
        return;
    }

    // 🌟 SLOW PATH: First time seeing this frame
    const masterData = await loadMasterContourFile();

    if (masterData && masterData.steps) {
        const stepData = masterData.steps[String(stepNum)] ||
                         masterData.steps[String(stepNum).padStart(3, '0')] ||
                         masterData.steps[`F${String(stepNum).padStart(3, '0')}`] ||
                         masterData.steps[stepNum] ||
                         masterData.steps[step];

        if (stepData) {
            const decodedStepData = binaryStepToGeoJson(stepNum, masterData) || stepData;
            const themedStepData = themeContourFeatures(decodedStepData);
            
            // Hide the old frame
            if (currentVisibleStep !== stepNum && loadedSteps.has(currentVisibleStep)) {
                setStepVisibility(currentVisibleStep, false);
            }

            // Create new layer and show it
            addStepLayers(mapInstance, stepNum, themedStepData);
            loadedSteps.add(stepNum);
            currentVisibleStep = stepNum;
        }
    }
}

/**
 * 🌟 BACKGROUND CONTOUR PRELOADER
 * Silently loads and themes layers in the background (visibility: 'none') 
 * so scrubbing is instant before you even touch the slider.
 */
export async function preloadAllContours() {
    if (!mapInstance || stateManager.activeMode !== 'modelViewer') return;

    const masterData = await loadMasterContourFile();
    if (!masterData || !masterData.steps || !activeContourBinary) return;

    const steps = Object.keys(masterData.steps);
    let idx = 0;

    function warmNextSlice() {
        if (stateManager.activeMode !== 'modelViewer') return;
        const limit = Math.min(idx + 2, steps.length);

        for (; idx < limit; idx++) {
            const stepNum = parseInt(steps[idx], 10);
            if (isNaN(stepNum)) continue;
            
            if (!loadedSteps.has(stepNum)) {
                const decoded = binaryStepToGeoJson(stepNum, masterData);
                if (decoded) {
                    const themed = themeContourFeatures(decoded);
                    addStepLayers(mapInstance, stepNum, themed);
                    setStepVisibility(stepNum, false); // Hidden until requested
                    loadedSteps.add(stepNum);
                }
            }
        }

        if (idx < steps.length) {
            setTimeout(warmNextSlice, 50); // Pause briefly so UI stays smooth
        }
    }

    setTimeout(warmNextSlice, 200);
}
