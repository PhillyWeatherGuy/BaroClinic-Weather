// js/layers/vectorContours.js
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
let activeMasterContours = null;
let activeMasterKey = null;
let fetchPromise = null;
let activeContourBinary = null;
let currentVisibleStep = 0;

// 🌟 Track which steps have their own dedicated GPU layers
const loadedSteps = new Set();

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
        const zoom = mapInstance ? mapInstance.getZoom() : 5;

        // When zoomed out (< 5.0), show only 4 mb intervals; when zoomed in, show all 2 mb intervals
        if (zoom < 5.0) {
            featureCollection.features = featureCollection.features.filter(f => {
                const val = parseFloat(f?.properties?.name);
                return isNaN(val) || Math.round(val) % 4 === 0;
            });
        }

        for (const feature of featureCollection.features) {
            if (!feature || !feature.properties) continue;
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

// 🌟 Instantly toggles visibility of a step's layers
function toggleStepVisibility(stepNum, isVisible) {
    if (!mapInstance || !loadedSteps.has(stepNum)) return;
    const visibility = isVisible ? 'visible' : 'none';
    
    const casingId = `${CASING_LAYER_ID}-${stepNum}`;
    const lineId = `${LINE_LAYER_ID}-${stepNum}`;
    const labelId = `${LABEL_LAYER_ID}-${stepNum}`;

    if (mapInstance.getLayer(casingId)) mapInstance.setLayoutProperty(casingId, 'visibility', visibility);
    if (mapInstance.getLayer(lineId)) mapInstance.setLayoutProperty(lineId, 'visibility', visibility);
    if (mapInstance.getLayer(labelId)) mapInstance.setLayoutProperty(labelId, 'visibility', visibility);
}

// 🌟 Creates dedicated GPU layers for a specific step
function createOrUpdateStepLayers(stepNum, geoJson) {
    if (!mapInstance) return;
    
    const srcId = `${SOURCE_ID}-${stepNum}`;
    const casingId = `${CASING_LAYER_ID}-${stepNum}`;
    const lineId = `${LINE_LAYER_ID}-${stepNum}`;
    const labelId = `${LABEL_LAYER_ID}-${stepNum}`;

    if (!mapInstance.getSource(srcId)) {
        mapInstance.addSource(srcId, { type: 'geojson', data: geoJson });

        mapInstance.addLayer({
            id: casingId,
            type: 'line',
            source: srcId,
            filter: ['has', 'outlineColor'],
            layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'visible' },
            paint: {
                'line-color': ['get', 'outlineColor'],
                'line-width': pvaZoomWidthExpression(['coalesce', ['get', 'width'], 1.6], true),
                'line-opacity': ['coalesce', ['get', 'outlineOpacity'], 0.8],
                'line-blur': ['coalesce', ['get', 'outlineBlur'], 2.0]
            }
        });

        mapInstance.addLayer({
            id: lineId,
            type: 'line',
            source: srcId,
            layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'visible' },
            paint: {
                'line-color': ['coalesce', ['get', 'color'], ['get', 'stroke'], '#4169E1'],
                'line-width': pvaZoomWidthExpression(['coalesce', ['get', 'width'], 2.0]),
                'line-opacity': ['coalesce', ['get', 'opacity'], 0.95]
            }
        });

        mapInstance.addLayer({
            id: labelId,
            type: 'symbol',
            source: srcId,
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

        loadedSteps.add(stepNum);
    } else {
        // If updating a step (e.g. after zooming on prate), update data and make visible
        mapInstance.getSource(srcId).setData(geoJson);
        toggleStepVisibility(stepNum, true);
    }
}

export function initVectorContours(map) {
    mapInstance = map;

    // Refresh 2 mb vs 4 mb filtering when zooming on prate
    if (!map._contoursZoomBound) {
        map._contoursZoomBound = true;
        map.on('zoomend', () => {
            const activeParam = (stateManager.paramConfig?.id || stateManager.activeParam || '').toLowerCase();
            if (activeParam === 'prate' && stateManager.currentStepIndex !== undefined) {
                const step = stateManager.globalSteps?.[stateManager.currentStepIndex]?.step;
                // Passing true forces it to re-run the JS zoom filter for the current frame
                if (step !== undefined) updateVectorContours(step, true);
            }
        });
    }
}

/**
 * 🌟 AIRTIGHT UNLOADER: Wipes master RAM cache & completely removes all dynamically created layers
 */
export function clearVectorContours() {
    activeMasterContours = null;
    activeContourBinary = null;
    activeMasterKey = null;
    fetchPromise = null;

    if (mapInstance) {
        loadedSteps.forEach(stepNum => {
            try {
                if (mapInstance.getLayer(`${CASING_LAYER_ID}-${stepNum}`)) mapInstance.removeLayer(`${CASING_LAYER_ID}-${stepNum}`);
                if (mapInstance.getLayer(`${LINE_LAYER_ID}-${stepNum}`)) mapInstance.removeLayer(`${LINE_LAYER_ID}-${stepNum}`);
                if (mapInstance.getLayer(`${LABEL_LAYER_ID}-${stepNum}`)) mapInstance.removeLayer(`${LABEL_LAYER_ID}-${stepNum}`);
                if (mapInstance.getSource(`${SOURCE_ID}-${stepNum}`)) mapInstance.removeSource(`${SOURCE_ID}-${stepNum}`);
            } catch (e) {}
        });
    }
    
    loadedSteps.clear();
    currentVisibleStep = 0;
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
            properties: metadata[index] || {}
        }))
    };
}

/**
 * 🌟 Instant 0.00ms GPU Step Switcher
 */
export async function updateVectorContours(step, forceUpdate = false) {
    if (!mapInstance) return;

    let stepNum = typeof step === 'number' ? step : parseInt(String(step).replace(/\D/g, ''), 10) || 0;

    // Hide previous step if moving to a new one
    if (currentVisibleStep !== stepNum) {
        toggleStepVisibility(currentVisibleStep, false);
        currentVisibleStep = stepNum;
    }

    // 🌟 FAST PATH: Instantly toggle visibility of an existing layer (0.0ms scrub)
    if (!forceUpdate && loadedSteps.has(stepNum)) {
        toggleStepVisibility(stepNum, true);
        return;
    }

    // 🌟 SLOW PATH: Decode and create dedicated layer for this step
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
            createOrUpdateStepLayers(stepNum, themedStepData);
        }
    }
}

/**
 * 🌟 BACKGROUND CONTOUR PRELOADER
 */
export async function preloadAllContours() {
    await loadMasterContourFile();
}
