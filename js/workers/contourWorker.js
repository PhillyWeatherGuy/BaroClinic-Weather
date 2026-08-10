// js/workers/contourWorker.js

self.onmessage = function (e) {
    const { rawPixelData, frameW, frameH, sheetW, colOffset, rowOffset, minK, maxK, contours } = e.data;

    if (!rawPixelData || !contours || contours.length === 0) {
        self.postMessage({ type: 'FeatureCollection', features: [] });
        return;
    }

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
    const stride = 2; // Fast 2-pixel stride (1.5ms computation time)

    for (let cIdx = 0; cIdx < contours.length; cIdx++) {
        const contourDef = contours[cIdx];
        let targetK = 273.15;
        if (contourDef.unit === '°F') targetK = (contourDef.value - 32.0) * (5.0 / 9.0) + 273.15;
        else if (contourDef.unit === '°C') targetK = contourDef.value + 273.15;

        if (targetK < minK || targetK > maxK) continue;

        const targetByte = ((targetK - minK) / (maxK - minK)) * 255.0;
        const segments = [];

        for (let y = 0; y < frameH - stride; y += stride) {
            const sheetY0 = (rowOffset + y) * sheetW;
            const sheetY1 = (rowOffset + y + stride) * sheetW;

            const lat0 = 90.0 - (y / frameH) * 180.0;
            const lat1 = 90.0 - ((y + stride) / frameH) * 180.0;

            for (let x = 0; x < frameW - stride; x += stride) {
                const sheetX0 = colOffset + x;
                const sheetX1 = colOffset + x + stride;

                const v0 = rawPixelData[sheetY0 + sheetX0];
                const v1 = rawPixelData[sheetY0 + sheetX1];
                const v2 = rawPixelData[sheetY1 + sheetX1];
                const v3 = rawPixelData[sheetY1 + sheetX0];

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
                    name: contourDef.name || '32°F',
                    color: contourDef.color || '#4169E1',
                    width: contourDef.width || 2.0,
                    opacity: contourDef.opacity || 0.95
                }
            });
        }
    }

    self.postMessage({
        type: 'FeatureCollection',
        features: features
    });
};