// js/layers/vectorContours.js
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
let activeMasterContours = null;
let activeMasterKey = null;
let fetchPromise = null;

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
    const zoomStops = [[2, 0.9, 3.2], [5, 1.0, 3.4], [8, 1.3, 3.8], [11, 1.65, 4.1], [14, 1.9, 4.4]];

    for (const [zoom, scale, glowWidth] of zoomStops) {
        const scaledWidth = ['*', baseWidth, scale];
        expression.push(zoom, isGlow
            ? ['+', scaledWidth, glowWidth]
            : ['case', ['has', 'outlineColor'], scaledWidth, baseWidth]);
    }

    return expression;
}

function themePvaContourFeatures(featureCollection) {
    if (!featureCollection || !Array.isArray(featureCollection.features)) {
        return featureCollection;
    }

    const activeParamId = (stateManager.paramConfig?.id || stateManager.activeParam || '').toLowerCase();
    if (activeParamId !== 'pva') {
        return featureCollection;
    }

    const contourColor = getPvaContourThemeColor();
    const glowColor = getPvaContourGlowColor();
    for (const feature of featureCollection.features) {
        if (!feature || !feature.properties) continue;
        const is540Line = Number(feature.properties.name) === 540;
        const featureColor = is540Line ? '#4169E1' : contourColor;
        feature.properties.color = featureColor;
        feature.properties.stroke = featureColor;
        feature.properties.outlineColor = glowColor;
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
                'line-opacity': 0.8,
                'line-blur': 2.0
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
                'line-width': pvaZoomWidthExpression(['coalesce', ['get', 'width'], 2.0]),
                'line-opacity': ['coalesce', ['get', 'opacity'], 0.95]
            }
        });

        // 2. Inline Contour Labels ("32°F Freezing Line", "540", etc.)
        map.addLayer({
            id: LABEL_LAYER_ID,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'symbol-placement': 'line',
                'text-field': ['get', 'name'],
                'text-size': ['case', ['has', 'labelColor'], 14, 11],
                // 🌟 Use Noto Sans Bold to avoid 404 on OpenFreeMap
                'text-font': ['Noto Sans Bold'],
                'text-max-angle': 45,
                'text-padding': 12
            },
            paint: {
                'text-color': ['coalesce', ['get', 'labelColor'], ['get', 'color'], '#FFFFFF'],
                'text-halo-color': ['coalesce', ['get', 'labelHaloColor'], '#0b0f19'],
                'text-halo-width': ['case', ['has', 'labelColor'], 2.5, 2.0]
            }
        });
    }
}

/**
 * 🌟 AIRTIGHT UNLOADER: Wipes master RAM cache & clears vector layer on parameter/model switch
 */
export function clearVectorContours() {
    activeMasterContours = null;
    activeMasterKey = null;
    fetchPromise = null;
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (source) {
        source.setData(EMPTY_GEOJSON);
    }
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

/**
 * 🌟 Instant 0.00ms Vector Contour Renderer from Master RAM Object
 */
export async function updateVectorContours(step) {
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (!source) return;

    let stepNum = typeof step === 'number' ? step : parseInt(String(step).replace(/\D/g, ''), 10) || 0;

    const masterData = await loadMasterContourFile();

    if (masterData && masterData.steps) {
        // 🌟 Support all common step key formats ("0", "000", "F000", 0)
        const stepData = masterData.steps[String(stepNum)] ||
                         masterData.steps[String(stepNum).padStart(3, '0')] ||
                         masterData.steps[`F${String(stepNum).padStart(3, '0')}`] ||
                         masterData.steps[stepNum] ||
                         masterData.steps[step];

        if (stepData) {
            const themedStepData = themePvaContourFeatures(stepData);
            source.setData(themedStepData);
            return;
        }
    }
    source.setData(EMPTY_GEOJSON);
}

/**
 * 🌟 BACKGROUND CONTOUR PRELOADER
 */
export async function preloadAllContours() {
    await loadMasterContourFile();
}
