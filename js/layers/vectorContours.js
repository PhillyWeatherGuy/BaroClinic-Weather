// js/layers/vectorContours.js
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
const SOURCE_ID = 'contour-master-source';
const LINE_LAYER_ID = 'contour-master-line-layer';
const LABEL_LAYER_ID = 'contour-master-label-layer';

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

        // 2. Inline Line Labels ("32°F Freezing Line", "1052", etc.)
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

export function clearVectorContours() {
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (source) {
        source.setData({ type: 'FeatureCollection', features: [] });
    }
}

/**
 * 🌟 Static GeoJSON Vector Contour Loader
 * Fetches pre-computed 32°F vector isolines directly from Backblaze B2 CDN (~5ms)
 */
export async function updateVectorContours(step) {
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (!source) return;

    let stepNum = 0;
    if (typeof step === 'number') stepNum = step;
    else if (typeof step === 'string') stepNum = parseInt(step.replace(/\D/g, ''), 10) || 0;

    const formattedStep = String(stepNum).padStart(3, '0');
    const model = stateManager.manifest?.model || 'ecmwf';
    const param = stateManager.manifest?.parameter || '2t';
    const targetDate = stateManager.manifest?.date;
    const runCycle = stateManager.manifest?.run ? stateManager.manifest.run.toLowerCase() : null;

    // Try run-specific filename first (e.g., ecmwf_2t_20260810_00z_f006_contours.json)
    let contourUrl = `${stateManager.BASE_URL}${model}_${param}_f${formattedStep}_contours.json`;
    if (targetDate && runCycle) {
        contourUrl = `${stateManager.BASE_URL}${model}_${param}_${targetDate}_${runCycle}_f${formattedStep}_contours.json`;
    }

    try {
        const resp = await fetch(contourUrl);
        if (resp.ok) {
            const geojson = await resp.json();
            source.setData(geojson);
        } else {
            // Fallback to static reference copy
            const fallbackUrl = `${stateManager.BASE_URL}${model}_${param}_f${formattedStep}_contours.json`;
            const fbResp = await fetch(fallbackUrl);
            if (fbResp.ok) {
                const fbGeojson = await fbResp.json();
                source.setData(fbGeojson);
            } else {
                clearVectorContours();
            }
        }
    } catch (err) {
        clearVectorContours();
    }
}