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

        // 2. 🌟 Inline Contour Labels (Matches Matplotlib clabel inline=True)
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
 * 🌟 2D Gaussian Kernel Blur (Python scipy.ndimage.gaussian_filter equivalent in JS)
 */
function applyGaussianFilter2D(src, width, height) {
    const dst = new Uint8Array(src.length);
    // 3x3 Gaussian smoothing kernel
    for (let y = 1; y < height - 1; y++) {
        const yOffset = y * width;
        for (let x = 1; x < width - 1; x++) {
            const sum = 
                src[yOffset - width + x - 1] * 1 + src[yOffset - width + x] * 2 + src[yOffset - width + x + 1] * 1 +
                src[yOffset + x - 1]         * 2 + src[yOffset + x]         * 4 + src[yOffset + x + 1]         * 2 +
                src[yOffset + width + x - 1] * 1 + src[yOffset + width + x] * 2 + src[yOffset + width + x + 1] * 1;
            dst[yOffset + x] = Math.round(sum / 16);
        }
    }
    return dst;
}

/**
 * 🌟 Chaikin's Corner-Smoothing Curve Algorithm
 */
function chaikinSmoothPath(points, iterations = 1) {
    if (points.length < 3) return points;
    let current = points;
    for (let iter = 0; iter < iterations; iter++) {
        const next = [current[0]];
        for (let i = 0; i < current.length - 1; i++) {
            const p0 = current[i];
            const p1 = current[i + 1];
            const q = [0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]];
            const r = [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]];
            next.push(q, r);
        }
        next.push(current[current.length - 1]);
        current = next;
    }
    return current;
}

/**
 * 🌟 MASTER VECTOR CONTOUR ENGINE
 */
export function updateVectorContours(activeFrameState, manifest, paramConfig) {
    if (!mapInstance || !activeFrameState || !manifest) return;

    const source = mapInstance.getSource(SOURCE_ID);
    if (!source) return;

    if (!paramConfig || !paramConfig.contours || paramConfig.contours.length === 0) {
        clearVectorContours();
        return;
    }

    const chunkIdx = activeFrameState.chunkIndex;
    const rawPixelData = stateManager.chunkPixelData[chunkIdx];
    if (!rawPixelData) return;

    const minK = manifest.temp_min_k !== undefined ? manifest.temp_min_k : 210.0;
    const maxK = manifest.temp_max_k !== undefined ? manifest.temp_max_k : 330.0;

    const frameW = manifest.frame_width;
    const frameH = manifest.frame_height;
    const chunkInfo = manifest.chunks[chunkIdx];
    const sheetW = chunkInfo.sheet_width || (frameW * chunkInfo.columns);

    const colOffset = activeFrameState.col * frameW;
    const rowOffset = activeFrameState.row * frameH;

    // 🌟 Step 1: Pre-smooth data matrix with Gaussian Filter (eliminates pixel noise)
    const pixelData = applyGaussianFilter2D(rawPixelData, sheetW, (chunkInfo.rows || 1) * frameH);

    const edgeTable = [
        [],             // 0
        [3, 2],         // 1: BL
        [2, 1],         // 2: BR
        [3, 1],         // 3: BL, BR
        [1, 0],         // 4: TR
        [3, 0, 2, 1],   // 5: BL, TR
        [2, 0],         // 6: BR, TR
        [3, 0],         // 7: BL, BR, TR
        [0, 3],         // 8: TL
        [0, 2],         // 9: TL, BL
        [0, 3, 2, 1],   // 10: TL, BR
        [0, 1],         // 11: TL, BL, BR
        [1, 3],         // 12: TR, TL
        [1, 2],         // 13: TR, TL, BL
        [2, 3],         // 14: TR, BR, TL
        []              // 15
    ];

    const features = [];

    for (let cIdx = 0; cIdx < paramConfig.contours.length; cIdx++) {
        const contourDef = paramConfig.contours[cIdx];
        const targetValues = [];

        if (contourDef.type === 'single' || contourDef.value !== undefined) {
            let valK = 273.15;
            if (contourDef.unit === '°F') valK = (contourDef.value - 32.0) * (5.0 / 9.0) + 273.15;
            else if (contourDef.unit === '°C') valK = contourDef.value + 273.15;
            else valK = contourDef.value;

            targetValues.push({ valueK: valK, def: contourDef });
        }

        for (let tIdx = 0; tIdx < targetValues.length; tIdx++) {
            const targetObj = targetValues[tIdx];
            const targetK = targetObj.valueK;

            if (targetK < minK || targetK > maxK) continue;

            const targetByte = ((targetK - minK) / (maxK - minK)) * 255.0;
            const segments = [];
            const stride = 1;

            for (let y = 0; y < frameH - stride; y += stride) {
                const sheetY0 = (rowOffset + y) * sheetW;
                const sheetY1 = (rowOffset + y + stride) * sheetW;

                const lat0 = 90.0 - (y / frameH) * 180.0;
                const lat1 = 90.0 - ((y + stride) / frameH) * 180.0;

                for (let x = 0; x < frameW - stride; x += stride) {
                    const sheetX0 = colOffset + x;
                    const sheetX1 = colOffset + x + stride;

                    const v0 = pixelData[sheetY0 + sheetX0];
                    const v1 = pixelData[sheetY0 + sheetX1];
                    const v2 = pixelData[sheetY1 + sheetX1];
                    const v3 = pixelData[sheetY1 + sheetX0];

                    let caseIdx = 0;
                    if (v0 >= targetByte) caseIdx |= 8;
                    if (v1 >= targetByte) caseIdx |= 4;
                    if (v2 >= targetByte) caseIdx |= 2;
                    if (v3 >= targetByte) caseIdx |= 1;

                    if (caseIdx === 0 || caseIdx === 15) continue;

                    const lng0 = -180.0 + (x / frameW) * 360.0;
                    const lng1 = -180.0 + ((x + stride) / frameW) * 360.0;

                    const interpolate = (vA, vB) => Math.max(0, Math.min(1, (targetByte - vA) / (vB - vA || 0.0001)));

                    const getEdgePoint = (edge) => {
                        if (edge === 0) {
                            const t = interpolate(v0, v1);
                            return [lng0 + t * (lng1 - lng0), lat0];
                        } else if (edge === 1) {
                            const t = interpolate(v1, v2);
                            return [lng1, lat0 + t * (lat1 - lat0)];
                        } else if (edge === 2) {
                            const t = interpolate(v3, v2);
                            return [lng0 + t * (lng1 - lng0), lat1];
                        } else {
                            const t = interpolate(v0, v3);
                            return [lng0, lat0 + t * (lat1 - lat0)];
                        }
                    };

                    const edges = edgeTable[caseIdx];
                    for (let e = 0; e < edges.length; e += 2) {
                        const p1 = getEdgePoint(edges[e]);
                        const p2 = getEdgePoint(edges[e + 1]);
                        
                        // 🌟 Step 2: Apply Chaikin Curve Smoothing
                        const smoothedSeg = chaikinSmoothPath([p1, p2], 1);
                        segments.push(smoothedSeg);
                    }
                }
            }

            if (segments.length > 0) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'MultiLineString',
                        coordinates: segments
                    },
                    properties: {
                        name: targetObj.def.name || '32°F',
                        color: targetObj.def.color || '#4169E1',
                        width: targetObj.def.width || 2.0,
                        opacity: targetObj.def.opacity || 0.95
                    }
                });
            }
        }
    }

    source.setData({
        type: 'FeatureCollection',
        features: features
    });
}