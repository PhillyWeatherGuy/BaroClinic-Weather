// js/workers/contourWorker.js

/**
 * 🌟 2D Gaussian Kernel Blur (Runs in Background Worker Thread)
 */
function applyGaussianFilter2D(src, width, height) {
    const dst = new Uint8Array(src.length);
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

self.onmessage = function (e) {
    const { rawPixelData, frameW, frameH, sheetW, colOffset, rowOffset, minK, maxK, contours } = e.data;

    if (!rawPixelData || !contours || contours.length === 0) {
        self.postMessage({ type: 'FeatureCollection', features: [] });
        return;
    }

    // Run Gaussian Pre-Filter in background thread
    const pixelData = applyGaussianFilter2D(rawPixelData, sheetW, frameH);

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

    for (let cIdx = 0; cIdx < contours.length; cIdx++) {
        const contourDef = contours[cIdx];
        const targetValues = [];

        if (contourDef.type === 'single' || contourDef.value !== undefined) {
            let valK = 273.15;
            if (contourDef.unit === '°F') valK = (contourDef.value - 32.0) * (5.0 / 9.0) + 273.15;
            else if (contourDef.unit === '°C') valK = contourDef.value + 273.15;

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

    self.postMessage({
        type: 'FeatureCollection',
        features: features
    });
};
