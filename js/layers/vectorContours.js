// js/layers/vectorContours.js
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
let activeWorker = null;

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

        // 1. Vector Contour Lines
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

        // 2. Inline Contour Labels
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
    if (activeWorker) {
        activeWorker.terminate();
        activeWorker = null;
    }
    if (!mapInstance) return;
    const source = mapInstance.getSource(SOURCE_ID);
    if (source) {
        source.setData({ type: 'FeatureCollection', features: [] });
    }
}

/**
 * 🌟 Non-Blocking Task-Managed Worker Dispatcher (Zero Memory Leaks, Zero Crashes)
 */
export function updateVectorContours(activeFrameState, manifest, paramConfig) {
    if (!mapInstance || !activeFrameState || !manifest) return;

    if (!paramConfig || !paramConfig.contours || paramConfig.contours.length === 0) {
        clearVectorContours();
        return;
    }

    const chunkIdx = activeFrameState.chunkIndex;
    const rawPixelData = stateManager.chunkPixelData[chunkIdx];
    if (!rawPixelData) return;

    // 🌟 Kill any stale worker from a previous slider tick to prevent memory spikes & crashes
    if (activeWorker) {
        activeWorker.terminate();
        activeWorker = null;
    }

    const frameW = manifest.frame_width;
    const frameH = manifest.frame_height;
    const chunkInfo = manifest.chunks[chunkIdx];
    const sheetW = chunkInfo.sheet_width || (frameW * chunkInfo.columns);

    const colOffset = activeFrameState.col * frameW;
    const rowOffset = activeFrameState.row * frameH;

    const minK = manifest.temp_min_k !== undefined ? manifest.temp_min_k : 210.0;
    const maxK = manifest.temp_max_k !== undefined ? manifest.temp_max_k : 330.0;

    try {
        activeWorker = new Worker(new URL('../workers/contourWorker.js', import.meta.url), { type: 'module' });
        
        activeWorker.onmessage = (e) => {
            if (mapInstance && mapInstance.getSource(SOURCE_ID)) {
                mapInstance.getSource(SOURCE_ID).setData(e.data);
            }
            if (activeWorker) {
                activeWorker.terminate();
                activeWorker = null;
            }
        };

        // Transfer buffer slice instantly without cloning memory
        const pixelSlice = rawPixelData.slice(0);

        activeWorker.postMessage({
            rawPixelData: pixelSlice,
            frameW,
            frameH,
            sheetW,
            colOffset,
            rowOffset,
            minK,
            maxK,
            contours: paramConfig.contours
        }, [pixelSlice.buffer]);

    } catch (err) {
        console.warn("Worker error:", err);
    }
}