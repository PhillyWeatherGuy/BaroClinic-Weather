// js/layers/vectorContours.js
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
const SOURCE_ID = 'contour-master-source';
const LINE_LAYER_ID = 'contour-master-line-layer';
const LABEL_LAYER_ID = 'contour-master-label-layer';

// 🌟 In-Memory RAM Cache for 0.00ms Instant Scrubbing
const contourCache = new Map();

export function initVectorContours(map) {
    mapInstance = map;

    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
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
                'line-color': ['coalesce', ['get', 'color'], '#4169E1'],
                'line-width': ['coalesce', ['get', 'width'], 2.0],
                'line-opacity': ['coalesce', ['get', 'opacity'], 0.95]
            }
        });

        // 2. Inline Contour Labels ("32°F Freezing Line", "1052", etc.)
        map.addLayer({
            id: LABEL_LAYER_ID,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'symbol-placement': 'line',
                'text-field': ['get', 'name'],
                'text-size': 11,
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-max-angle': 45,
                'text-padding': 12
            },
            paint: {
                'text-color': ['coalesce', ['get', 'color'], '#FFFFFF'],
                'text-halo-color': '#0b0f19',
                'text-halo-width': 2.0
            }
        });
    }
}

/**
 * 🌟 AIRTIGHT UNLOADER: Wipes RAM cache & clears vector layer on parameter/model switch
 */
export function clearVectorContours() {
    contourCache.clear(); // Empties RAM cache
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (source) {
        source.setData({ type: 'FeatureCollection', features: [] });
    }
}

/**
 * 🌟 Instant 0.00ms Static Vector Contour Loader (RAM Cached)
 * @param {number|string} step Forecast step hour
 * @param {boolean} isPreload If true, silently saves to RAM without changing the map screen
 */
export async function updateVectorContours(step, isPreload = false) {
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (!source && !isPreload) return;

    let stepNum = 0;
    if (typeof step === 'number') stepNum = step;
    else if (typeof step === 'string') stepNum = parseInt(step.replace(/\D/g, ''), 10) || 0;

    const formattedStep = String(stepNum).padStart(3, '0');
    const model = stateManager.manifest?.model || 'ecmwf';
    const param = stateManager.manifest?.parameter || '2t';
    const targetDate = stateManager.manifest?.date;
    const runCycle = stateManager.manifest?.run ? stateManager.manifest.run.toLowerCase() : null;

    const cacheKey = `${model}_${param}_${targetDate}_${runCycle}_f${formattedStep}`;

    // 🌟 1. INSTANT 0.00ms RAM CACHE READ
    if (contourCache.has(cacheKey)) {
        if (!isPreload && source) {
            source.setData(contourCache.get(cacheKey));
        }
        return;
    }

    // 🌟 2. Network Fetch (Runs once per step, then saves to RAM)
    let contourUrl = `${stateManager.BASE_URL}${model}_${param}_f${formattedStep}_contours.json`;
    if (targetDate && runCycle) {
        contourUrl = `${stateManager.BASE_URL}${model}_${param}_${targetDate}_${runCycle}_f${formattedStep}_contours.json`;
    }

    try {
        const resp = await fetch(contourUrl);
        if (resp.ok) {
            const geojson = await resp.json();
            contourCache.set(cacheKey, geojson); // Save to RAM
            
            // 🌟 ONLY update map screen if NOT preloading and step matches active frame
            if (!isPreload && source) {
                const activeStep = stateManager.globalSteps?.[stateManager.currentStepIndex]?.step;
                if (activeStep === step || activeStep === stepNum) {
                    source.setData(geojson);
                }
            }
        } else {
            const fallbackUrl = `${stateManager.BASE_URL}${model}_${param}_f${formattedStep}_contours.json`;
            const fbResp = await fetch(fallbackUrl);
            if (fbResp.ok) {
                const fbGeojson = await fbResp.json();
                contourCache.set(cacheKey, fbGeojson);
                
                if (!isPreload && source) {
                    const activeStep = stateManager.globalSteps?.[stateManager.currentStepIndex]?.step;
                    if (activeStep === step || activeStep === stepNum) {
                        source.setData(fbGeojson);
                    }
                }
            }
        }
    } catch (err) {
        // Ignore fetch errors during preloading or rapid scrubbing
    }
}

/**
 * 🌟 SILENT BACKGROUND CONTOUR PRELOADER
 * Pre-fetches upcoming step JSON files into RAM silently in the background
 * WITHOUT animating or moving the map layer on screen!
 */
export async function preloadAllContours(currentGen) {
    if (!stateManager.globalSteps || stateManager.globalSteps.length <= 1) return;

    for (let i = 1; i < stateManager.globalSteps.length; i++) {
        // Abort background preloading if user switches parameters or model runs
        if (currentGen !== undefined && currentGen !== stateManager.loadGeneration) {
            break;
        }

        const stepInfo = stateManager.globalSteps[i];
        if (stepInfo) {
            await updateVectorContours(stepInfo.step, true); // 🌟 isPreload = true (SILENT SAVE TO RAM!)
        }
    }
}