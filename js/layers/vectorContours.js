// js/layers/vectorContours.js
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
let activeMasterContours = null;
let activeMasterKey = null;
let fetchPromise = null;
let activeContourBinary = null;
let modelsConfigCache = null;

const SOURCE_ID = 'contour-master-source';
const CASING_LAYER_ID = 'contour-master-casing-layer';
const LINE_LAYER_ID = 'contour-master-line-layer';
const LABEL_LAYER_ID = 'contour-master-label-layer';
const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

/**
 * 🌟 Direct, race-condition-free loader for config/models.json
 */
async function getParamContourConfig() {
    if (stateManager.paramConfig?.contours) {
        return stateManager.paramConfig.contours;
    }
    if (!modelsConfigCache) {
        try {
            const resp = await fetch('./config/models.json');
            if (resp.ok) {
                modelsConfigCache = await resp.json();
            }
        } catch (e) {
            console.warn("Could not load config/models.json:", e);
        }
    }
    const currentParam = stateManager.paramConfig?.id || stateManager.activeParam || '2t';
    const paramObj = modelsConfigCache?.parameters?.[currentParam];
    if (paramObj && !stateManager.paramConfig) {
        stateManager.paramConfig = paramObj;
    }
    return paramObj?.contours || null;
}

function contourZoomWidthExpression(baseWidth, isGlow = false) {
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
 * 🌟 100% Config-Driven Styler: reads directly from models.json contours block
 */
function themeContourFeatures(featureCollection, cfg) {
    if (!featureCollection || !Array.isArray(featureCollection.features) || !cfg) {
        return featureCollection;
    }

    const isDark = (stateManager.currentTheme === 'dark');
    const baseColor = isDark ? (cfg.color_dark || '#ffffff') : (cfg.color_light || '#000000');
    const hasGlow = Boolean(cfg.glow);
    const glowColor = hasGlow ? (isDark ? (cfg.glow_dark || '#00c8ff') : (cfg.glow_light || '#ffffff')) : null;
    const coarseInterval = cfg.zoom_filter?.coarse_interval;

    for (const feature of featureCollection.features) {
        if (!feature || !feature.properties) continue;

        const nameStr = String(feature.properties.name || '');
        const nameVal = parseFloat(nameStr);

        // 1. Dynamic unit formatting (e.g. 32°F / 0°C for temperature)
        if (cfg.unit_label === 'temperature') {
            const freezingLabel = stateManager.currentUnits === 'metric' ? '0°C' : '32°F';
            if (nameVal === 273.15 || /freez|273\.15/i.test(nameStr)) {
                feature.properties.name = freezingLabel;
            }
        }

        // 2. Zoom interval filtering (e.g. 4 mb vs 2 mb for MSLP isobars)
        const isIntermediate = Boolean(coarseInterval && !isNaN(nameVal) && (Math.round(nameVal) % coarseInterval !== 0));
        feature.properties.isIntermediate = isIntermediate;

        // 3. Base styles from models.json
        let strokeColor = baseColor;
        let strokeWidth = cfg.width || 1.6;
        let strokeOpacity = cfg.opacity || 0.9;

        // 4. Special target line overrides (e.g. 540 line in heights or 273.15 in temp)
        if (cfg.special_lines && Array.isArray(cfg.special_lines)) {
            for (const special of cfg.special_lines) {
                if (!isNaN(nameVal) && Math.abs(nameVal - special.target) < 0.1) {
                    if (special.color) strokeColor = special.color;
                    if (special.width) strokeWidth = special.width;
                    if (special.opacity) strokeOpacity = special.opacity;
                    break;
                }
            }
        }

        if (isIntermediate) {
            strokeWidth = Math.max(1.0, strokeWidth - 0.4);
            strokeOpacity = Math.max(0.6, strokeOpacity - 0.15);
        }

        feature.properties.color = strokeColor;
        feature.properties.stroke = strokeColor;
        feature.properties.width = strokeWidth;
        feature.properties.opacity = strokeOpacity;

        // 5. Casing & Glow (only applied if models.json specifies "glow": true)
        if (hasGlow && glowColor) {
            feature.properties.outlineColor = glowColor;
            feature.properties.outlineOpacity = isDark ? 0.8 : 0.95;
            feature.properties.outlineBlur = isDark ? 2.0 : 0;
        } else {
            delete feature.properties.outlineColor;
        }

        // Labels
        feature.properties.labelColor = (strokeColor !== baseColor)
            ? strokeColor
            : (baseColor === '#ffffff' ? '#ffffff' : '#000000');
        feature.properties.labelHaloColor = isDark ? '#0b0f19' : '#ffffff';
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
                'line-width': contourZoomWidthExpression(['coalesce', ['get', 'width'], 1.6], true),
                'line-opacity': ['coalesce', ['get', 'outlineOpacity'], 0.8],
                'line-blur': ['coalesce', ['get', 'outlineBlur'], 2.0]
            }
        });

        // 1. Smooth Vector Line Layer
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
                'line-width': contourZoomWidthExpression(['coalesce', ['get', 'width'], 2.0]),
                'line-opacity': [
                    'case',
                    ['boolean', ['get', 'isIntermediate'], false],
                    [
                        'interpolate', ['linear'], ['zoom'],
                        4.0, 0.0,
                        5.5, ['coalesce', ['get', 'opacity'], 0.8]
                    ],
                    ['coalesce', ['get', 'opacity'], 0.95]
                ]
            }
        });

        // 2. Inline Contour Labels
        map.addLayer({
            id: LABEL_LAYER_ID,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'symbol-placement': 'line',
                'text-field': ['get', 'name'],
                'text-size': ['case', ['has', 'labelColor'], 13, 11],
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
                    ['boolean', ['get', 'isIntermediate'], false],
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

export function clearVectorContours() {
    activeMasterContours = null;
    activeContourBinary = null;
    activeMasterKey = null;
    fetchPromise = null;
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (source) {
        source.setData(EMPTY_GEOJSON);
    }
}

/**
 * 🌟 Helper to fetch the Master Contour JSON file driven by models.json
 */
async function loadMasterContourFile() {
    const model = (stateManager.manifest?.model || stateManager.activeModel || 'ecmwf').toLowerCase();
    const param = (stateManager.paramConfig?.id || stateManager.activeParam || stateManager.manifest?.parameter || '2t').toLowerCase();
    const targetDate = stateManager.manifest?.date || stateManager.currentDate;
    const runCycle = (stateManager.manifest?.run || stateManager.currentCycle || '').toLowerCase();

    const contourCfg = await getParamContourConfig();
    if (!contourCfg) {
        return null;
    }

    // 🌟 Uses source_param defined in models.json (e.g. 'z500' for pva, 'prate' for prate, '2t' for 2t)
    const contourParam = (contourCfg.source_param || param).toLowerCase();
    const currentKey = `${model}_${contourParam}_${targetDate}_${runCycle}`;

    if (activeMasterKey === currentKey && activeMasterContours) {
        return activeMasterContours;
    }

    if (fetchPromise && activeMasterKey === currentKey) {
        return await fetchPromise;
    }

    activeMasterKey = currentKey;

    const urlsToTry = [];
    if (targetDate && runCycle) {
        urlsToTry.push(`${stateManager.BASE_URL}${model}_${contourParam}_${targetDate}_${runCycle}_contours.json?v=${Date.now()}`);
    }
    urlsToTry.push(`${stateManager.BASE_URL}${model}_${contourParam}_contours.json?v=${Date.now()}`);

    if (contourParam === '2t') {
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
 * 🌟 Instant Vector Contour Renderer driven by models.json
 */
export async function updateVectorContours(step) {
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (!source) return;

    let stepNum = typeof step === 'number' ? step : parseInt(String(step).replace(/\D/g, ''), 10) || 0;

    // 🌟 Read config directly from models.json
    const contourCfg = await getParamContourConfig();
    if (!contourCfg) {
        source.setData(EMPTY_GEOJSON);
        return;
    }

    const masterData = await loadMasterContourFile();

    if (masterData && masterData.steps) {
        const stepData = masterData.steps[String(stepNum)] ||
                         masterData.steps[String(stepNum).padStart(3, '0')] ||
                         masterData.steps[`F${String(stepNum).padStart(3, '0')}`] ||
                         masterData.steps[stepNum] ||
                         masterData.steps[step];

        if (stepData) {
            const decodedStepData = binaryStepToGeoJson(stepNum, masterData) || stepData;
            const themedStepData = themeContourFeatures(decodedStepData, contourCfg);
            source.setData(themedStepData);
            return;
        }
    }
    source.setData(EMPTY_GEOJSON);
}

export async function preloadAllContours() {
    await loadMasterContourFile();
}
