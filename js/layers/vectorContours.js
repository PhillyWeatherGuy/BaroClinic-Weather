// js/layers/vectorContours.js
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
const SOURCE_ID = 'contour-master-source';
const LAYER_ID = 'contour-master-layer';

export function initVectorContours(map) {
    mapInstance = map;

    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // Master Layer with data-driven styling for multi-color/width contours
        map.addLayer({
            id: LAYER_ID,
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
 * 🌟 MASTER VECTOR CONTOUR ENGINE (Marching Squares + Sub-Pixel Interpolation)
 * Extracts smooth vector isolines for ANY parameter based on models.json definitions
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
    const pixelData = stateManager.chunkPixelData[chunkIdx];
    if (!pixelData) return;

    const minK = manifest.temp_min_k !== undefined ? manifest.temp_min_k : 210.0;
    const maxK = manifest.temp_max_k !== undefined ? manifest.temp_max_k : 330.0;

    const frameW = manifest.frame_width;
    const frameH = manifest.frame_height;
    const chunkInfo = manifest.chunks[chunkIdx];
    const sheetW = chunkInfo.sheet_width || (frameW * chunkInfo.columns);

    const colOffset = activeFrameState.col * frameW;
    const rowOffset = activeFrameState.row * frameH;

    // Marching Squares Edge Table
    const edgeTable = [
        [],             // 0
        [3, 2],         // 1: BL
        [2, 1],         // 2: BR
        [3, 1],         // 3: BL, BR
        [1, 0],         // 4: TR
        [3, 0, 2, 1],   // 5: BL, TR (saddle)
        [2, 0],         // 6: BR, TR
        [3, 0],         // 7: BL, BR, TR
        [0, 3],         // 8: TL
        [0, 2],         // 9: TL, BL
        [0, 3, 2, 1],   // 10: TL, BR (saddle)
        [0, 1],         // 11: TL, BL, BR
        [1, 3],         // 12: TR, TL
        [1, 2],         // 13: TR, TL, BL
        [2, 3],         // 14: TR, BR, TL
        []              // 15
    ];

    const features = [];

    // Process every contour rule in paramConfig.contours
    for (let cIdx = 0; cIdx < paramConfig.contours.length; cIdx++) {
        const contourDef = paramConfig.contours[cIdx];
        const targetValues = [];

        if (contourDef.type === 'single' || contourDef.value !== undefined) {
            let valK = 273.15;
            if (contourDef.unit === '°F') valK = (contourDef.value - 32.0) * (5.0 / 9.0) + 273.15;
            else if (contourDef.unit === '°C') valK = contourDef.value + 273.15;
            else valK = contourDef.value;

            targetValues.push({ valueK: valK, def: contourDef });
        } else if (contourDef.type === 'interval' && contourDef.interval) {
            const minVal = contourDef.min_val || 0;
            const maxVal = contourDef.max_val || 2000;
            for (let v = minVal; v <= maxVal; v += contourDef.interval) {
                let valK = v;
                if (contourDef.unit === '°F') valK = (v - 32.0) * (5.0 / 9.0) + 273.15;
                else if (contourDef.unit === '°C') valK = v + 273.15;

                targetValues.push({ valueK: valK, def: contourDef });
            }
        }

        // Extract segments for each target value
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

                    const v0 = pixelData[sheetY0 + sheetX0]; // TL
                    const v1 = pixelData[sheetY0 + sheetX1]; // TR
                    const v2 = pixelData[sheetY1 + sheetX1]; // BR
                    const v3 = pixelData[sheetY1 + sheetX0]; // BL

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
                        if (edge === 0) { // Top
                            const t = interpolate(v0, v1);
                            return [lng0 + t * (lng1 - lng0), lat0];
                        } else if (edge === 1) { // Right
                            const t = interpolate(v1, v2);
                            return [lng1, lat0 + t * (lat1 - lat0)];
                        } else if (edge === 2) { // Bottom
                            const t = interpolate(v3, v2);
                            return [lng0 + t * (lng1 - lng0), lat1];
                        } else { // Left
                            const t = interpolate(v0, v3);
                            return [lng0, lat0 + t * (lat1 - lat0)];
                        }
                    };

                    const edges = edgeTable[caseIdx];
                    for (let e = 0; e < edges.length; e += 2) {
                        const p1 = getEdgePoint(edges[e]);
                        const p2 = getEdgePoint(edges[e + 1]);
                        segments.push([p1, p2]);
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
                        name: targetObj.def.name || 'Contour Line',
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
