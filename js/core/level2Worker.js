// js/core/level2Worker.js
import { unzlibSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import seekBzip from 'https://cdn.jsdelivr.net/npm/seek-bzip@1.0.6/+esm';

// Ultra-HD 9x Grid: 384 (East-West) x 96 (Altitude) x 384 (North-South) ~ 14 MB
const GRID_X = 384;
const GRID_Y = 96;
const GRID_Z = 384;
const MAX_ALTITUDE_METERS = 20000.0;

const EARTH_RADIUS_METERS = 6371000.0;
const KE_EARTH_RADIUS = (4.0 / 3.0) * EARTH_RADIUS_METERS;
const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;
const TARGET_RADIALS = 720;

/**
 * 🛰️ Decompresses Level 2 Archive II Chunks
 */
function decompressLevel2(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const decompressedChunks = [];

    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        try {
            return unzlibSync(bytes);
        } catch (e) {}
    }

    let pos = (bytes.length > 24 && bytes[0] === 0x41 && bytes[1] === 0x52 && bytes[2] === 0x32 && bytes[3] === 0x56) ? 24 : 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    while (pos + 4 < bytes.length) {
        let chunkSize = view.getInt32(pos, false);
        pos += 4;
        if (chunkSize === 0) continue;

        if (chunkSize < 0) {
            chunkSize = -chunkSize;
            if (pos + chunkSize > bytes.length) break;
            decompressedChunks.push(bytes.subarray(pos, pos + chunkSize));
            pos += chunkSize;
            continue;
        }

        if (pos + chunkSize > bytes.length) break;

        if (bytes[pos] === 0x42 && bytes[pos + 1] === 0x5a && bytes[pos + 2] === 0x68) {
            try {
                const sub = bytes.subarray(pos, pos + chunkSize);
                const out = seekBzip.decode(sub);
                if (out && out.length > 0) decompressedChunks.push(new Uint8Array(out));
            } catch (e) {}
        }
        pos += chunkSize;
    }

    if (decompressedChunks.length === 0) {
        try {
            const out = seekBzip.decode(bytes);
            return new Uint8Array(out);
        } catch (e) {
            throw new Error("Could not decompress Level 2 payload");
        }
    }

    const totalBytes = decompressedChunks.reduce((acc, c) => acc + c.length, 0);
    const fullBuffer = new Uint8Array(totalBytes);
    let writeOffset = 0;
    for (const chunk of decompressedChunks) {
        fullBuffer.set(chunk, writeOffset);
        writeOffset += chunk.length;
    }
    return fullBuffer;
}

/**
 * 🛰️ Parses Message 31 sweeps from Level 2 buffer & de-duplicates SAILS cuts
 */
function parseSweepsFromLevel2(rawBytes, stationId) {
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const sCode = (stationId.length === 3 ? 'K' + stationId : stationId).toUpperCase();
    const c0 = sCode.charCodeAt(0), c1 = sCode.charCodeAt(1), c2 = sCode.charCodeAt(2), c3 = sCode.charCodeAt(3);

    const sweepsByElevation = new Map();
    const limit = rawBytes.length - 120;

    for (let i = 0; i <= limit; i++) {
        if (rawBytes[i] === c0 && rawBytes[i + 1] === c1 && rawBytes[i + 2] === c2 && rawBytes[i + 3] === c3) {
            const hdrPos = i;
            const azAngle = view.getFloat32(hdrPos + 12, false);
            const elIndex = view.getUint8(hdrPos + 22);
            const elAngle = view.getFloat32(hdrPos + 24, false);
            const dataBlockCount = view.getUint16(hdrPos + 30, false);

            if (azAngle >= 0.0 && azAngle <= 360.0 && elIndex >= 1 && elIndex <= 35 && elAngle >= -2.0 && elAngle <= 45.0 && dataBlockCount >= 2 && dataBlockCount <= 16) {
                let refOffset = -1;
                for (let b = 0; b < dataBlockCount; b++) {
                    const ptrPos = hdrPos + 32 + (b * 4);
                    if (ptrPos + 4 > rawBytes.length) break;
                    const ptr = view.getUint32(ptrPos, false);
                    if (ptr > 0 && hdrPos + ptr + 4 <= rawBytes.length) {
                        const blkPos = hdrPos + ptr;
                        if ((rawBytes[blkPos] === 68 && rawBytes[blkPos + 1] === 82 && rawBytes[blkPos + 2] === 69 && rawBytes[blkPos + 3] === 70) ||
                            (rawBytes[blkPos] === 82 && rawBytes[blkPos + 1] === 69 && rawBytes[blkPos + 2] === 70)) {
                            refOffset = blkPos;
                            break;
                        }
                    }
                }

                if (refOffset > 0 && refOffset + 28 <= rawBytes.length) {
                    const numGates = view.getUint16(refOffset + 8, false);
                    const firstGateMeters = view.getUint16(refOffset + 10, false);
                    const gateSpacingMeters = view.getUint16(refOffset + 12, false);
                    const scale = view.getFloat32(refOffset + 20, false) || 2.0;
                    const offsetVal = view.getFloat32(refOffset + 24, false) || 66.0;

                    if (!sweepsByElevation.has(elIndex)) {
                        sweepsByElevation.set(elIndex, {
                            elIndex,
                            elAngle: parseFloat(elAngle.toFixed(2)),
                            firstGateMeters,
                            gateSpacingMeters,
                            scale,
                            offsetVal,
                            numGates,
                            radials: new Array(TARGET_RADIALS),
                            filledRays: new Uint8Array(TARGET_RADIALS)
                        });
                    }

                    const sweep = sweepsByElevation.get(elIndex);
                    const rayIdx = Math.min(TARGET_RADIALS - 1, Math.max(0, Math.round(azAngle * 2) % TARGET_RADIALS));
                    const gateBytes = rawBytes.subarray(refOffset + 28, refOffset + 28 + numGates);
                    sweep.radials[rayIdx] = new Uint8Array(gateBytes);
                    sweep.filledRays[rayIdx] = 1;

                    i += 100;
                }
            }
        }
    }

    for (const sweep of sweepsByElevation.values()) {
        for (let r = 0; r < TARGET_RADIALS; r++) {
            if (!sweep.filledRays[r]) {
                const prev = (r - 1 + TARGET_RADIALS) % TARGET_RADIALS;
                const next = (r + 1) % TARGET_RADIALS;
                if (sweep.filledRays[prev]) {
                    sweep.radials[r] = sweep.radials[prev];
                    sweep.filledRays[r] = 1;
                } else if (sweep.filledRays[next]) {
                    sweep.radials[r] = sweep.radials[next];
                    sweep.filledRays[r] = 1;
                }
            }
        }
    }

    // Sort by elevation angle and de-duplicate repeat/SAILS angles (< 0.15° difference)
    const sorted = Array.from(sweepsByElevation.values()).sort((a, b) => a.elAngle - b.elAngle);
    const uniqueSweeps = [];
    for (let i = 0; i < sorted.length; i++) {
        if (uniqueSweeps.length === 0 || Math.abs(sorted[i].elAngle - uniqueSweeps[uniqueSweeps.length - 1].elAngle) > 0.18) {
            uniqueSweeps.push(sorted[i]);
        }
    }

    return uniqueSweeps;
}

/**
 * 🌟 Bilinear Polar Sampling with Continuous Low-Threshold Support
 */
function sampleSweepBilinear(sweep, slantRangeMeters, azDeg) {
    if (!sweep) return 0.0;

    const normRay = (((azDeg % 360.0) + 360.0) % 360.0) * 2.0;
    const r0 = Math.floor(normRay) % TARGET_RADIALS;
    const r1 = (r0 + 1) % TARGET_RADIALS;
    const rayT = normRay - Math.floor(normRay);

    const rad0 = sweep.radials[r0];
    const rad1 = sweep.radials[r1] || rad0;
    if (!rad0) return 0.0;

    const normBin = (slantRangeMeters - sweep.firstGateMeters) / sweep.gateSpacingMeters;
    if (normBin < 0 || normBin >= sweep.numGates - 1) return 0.0;

    const b0 = Math.floor(normBin);
    const b1 = b0 + 1;
    const binT = normBin - b0;

    const v00 = rad0[b0] > 1 ? (rad0[b0] - sweep.offsetVal) / sweep.scale : 0.0;
    const v01 = rad0[b1] > 1 ? (rad0[b1] - sweep.offsetVal) / sweep.scale : 0.0;
    const v10 = (rad1 && rad1[b0] > 1) ? (rad1[b0] - sweep.offsetVal) / sweep.scale : v00;
    const v11 = (rad1 && rad1[b1] > 1) ? (rad1[b1] - sweep.offsetVal) / sweep.scale : v01;

    const top = v00 * (1.0 - binT) + v01 * binT;
    const bottom = v10 * (1.0 - binT) + v11 * binT;
    const dbz = top * (1.0 - rayT) + bottom * rayT;

    return dbz > 1.5 ? dbz : 0.0;
}

/**
 * 🌟 High-Speed Separable 3D Gaussian/Box Filter (GR2Analyst "Smoothing" Engine)
 * Runs in ~20ms in the worker; melts discrete voxel boundaries and sweep terraces into smooth fluid
 */
function smoothVolume3D(src, X, Y, Z) {
    const temp = new Uint8Array(X * Y * Z);
    const XY = X * Y;

    // Pass 1: Horizontal X-axis Smoothing
    for (let z = 0; z < Z; z++) {
        const zOff = z * XY;
        for (let y = 0; y < Y; y++) {
            const rowOff = zOff + y * X;
            temp[rowOff] = (src[rowOff] * 3 + src[rowOff + 1]) >> 2;
            temp[rowOff + X - 1] = (src[rowOff + X - 1] * 3 + src[rowOff + X - 2]) >> 2;
            for (let x = 1; x < X - 1; x++) {
                const idx = rowOff + x;
                temp[idx] = (src[idx - 1] + (src[idx] << 1) + src[idx + 1] + 1) >> 2;
            }
        }
    }

    // Pass 2: Vertical Y-axis Smoothing
    for (let z = 0; z < Z; z++) {
        const zOff = z * XY;
        for (let x = 0; x < X; x++) {
            const colOff = zOff + x;
            src[colOff] = (temp[colOff] * 3 + temp[colOff + X]) >> 2;
            const topIdx = colOff + (Y - 1) * X;
            src[topIdx] = (temp[topIdx] * 3 + temp[topIdx - X]) >> 2;

            for (let y = 1; y < Y - 1; y++) {
                const idx = colOff + y * X;
                src[idx] = (temp[idx - X] + (temp[idx] << 1) + temp[idx + X] + 1) >> 2;
            }
        }
    }

    // Pass 3: Depth Z-axis Smoothing
    for (let y = 0; y < Y; y++) {
        const yOff = y * X;
        for (let x = 0; x < X; x++) {
            const idxBase = yOff + x;
            temp[idxBase] = (src[idxBase] * 3 + src[idxBase + XY]) >> 2;
            const backIdx = idxBase + (Z - 1) * XY;
            temp[backIdx] = (src[backIdx] * 3 + src[backIdx - XY]) >> 2;

            for (let z = 1; z < Z - 1; z++) {
                const idx = idxBase + z * XY;
                temp[idx] = (src[idx - XY] + (src[idx] << 1) + src[idx + XY] + 1) >> 2;
            }
        }
    }

    return temp;
}

/**
 * 🌟 Constructs Ultra-HD 3D Volume (384 x 96 x 384) with Hermite & Gaussian Beam Interpolation
 */
function processVolume(rawBytes, radarLat, radarLon, bounds, stationId = 'KDMX') {
    const sweeps = parseSweepsFromLevel2(rawBytes, stationId);
    if (sweeps.length === 0) {
        throw new Error(`No valid Level 2 sweeps found for ${stationId}`);
    }

    const voxels = new Uint8Array(GRID_X * GRID_Y * GRID_Z);

    const minLng = Math.min(bounds[0], bounds[2]);
    const maxLng = Math.max(bounds[0], bounds[2]);
    const minLat = Math.min(bounds[1], bounds[3]);
    const maxLat = Math.max(bounds[1], bounds[3]);

    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;
    const radarCosLat = Math.cos(radarLat * DEG_TO_RAD);

    for (let gz = 0; gz < GRID_Z; gz++) {
        const voxelLat = minLat + (gz / (GRID_Z - 1)) * latSpan;
        const dy = (voxelLat - radarLat) * DEG_TO_RAD * EARTH_RADIUS_METERS;

        for (let gx = 0; gx < GRID_X; gx++) {
            const voxelLng = minLng + (gx / (GRID_X - 1)) * lngSpan;
            const dx = (voxelLng - radarLon) * DEG_TO_RAD * EARTH_RADIUS_METERS * radarCosLat;

            const groundDist = Math.hypot(dx, dy);
            let azRad = Math.atan2(dx, dy);
            if (azRad < 0) azRad += Math.PI * 2;
            const azDeg = azRad * RAD_TO_DEG;

            for (let gy = 0; gy < GRID_Y; gy++) {
                const altMeters = (gy / (GRID_Y - 1)) * MAX_ALTITUDE_METERS;

                const s = groundDist;
                const h = altMeters;
                const r = Math.sqrt(s * s + h * h);
                const elAngleRad = Math.atan2(h - (s * s) / (2.0 * KE_EARTH_RADIUS), s);
                const elAngleDeg = elAngleRad * RAD_TO_DEG;

                let sweepBelow = null;
                let sweepAbove = null;

                for (let k = 0; k < sweeps.length; k++) {
                    if (sweeps[k].elAngle <= elAngleDeg) {
                        sweepBelow = sweeps[k];
                    }
                    if (sweeps[k].elAngle >= elAngleDeg && !sweepAbove) {
                        sweepAbove = sweeps[k];
                    }
                }

                let finalDbz = 0.0;

                if (sweepBelow && sweepAbove && sweepBelow !== sweepAbove) {
                    const dbz1 = sampleSweepBilinear(sweepBelow, r, azDeg);
                    const dbz2 = sampleSweepBilinear(sweepAbove, r, azDeg);
                    const span = Math.max(0.4, sweepAbove.elAngle - sweepBelow.elAngle);

                    if (dbz1 > 0.0 && dbz2 > 0.0) {
                        // Smooth Hermite S-curve blending between elevation angles
                        const t = Math.max(0.0, Math.min(1.0, (elAngleDeg - sweepBelow.elAngle) / span));
                        const smoothT = t * t * (3.0 - 2.0 * t);
                        finalDbz = dbz1 + smoothT * (dbz2 - dbz1);
                    } else if (dbz1 > 0.0) {
                        // Smooth Gaussian beam dispersion into clear air
                        const diff = elAngleDeg - sweepBelow.elAngle;
                        const normDiff = diff / span;
                        finalDbz = dbz1 * Math.exp(-1.6 * normDiff * normDiff);
                    } else if (dbz2 > 0.0) {
                        const diff = sweepAbove.elAngle - elAngleDeg;
                        const normDiff = diff / span;
                        finalDbz = dbz2 * Math.exp(-1.6 * normDiff * normDiff);
                    }
                } else if (sweepBelow) {
                    const dbz = sampleSweepBilinear(sweepBelow, r, azDeg);
                    if (dbz > 0.0) {
                        const diff = elAngleDeg - sweepBelow.elAngle;
                        if (diff < 3.5) {
                            finalDbz = dbz * Math.exp(-0.6 * diff * diff);
                        }
                    }
                } else if (sweepAbove) {
                    const dbz = sampleSweepBilinear(sweepAbove, r, azDeg);
                    if (dbz > 0.0) {
                        const diff = sweepAbove.elAngle - elAngleDeg;
                        if (diff < 2.5) {
                            finalDbz = dbz * Math.exp(-0.9 * diff * diff);
                        }
                    }
                }

                if (finalDbz >= 1.5) {
                    const mappedByte = Math.min(255, Math.max(1, Math.round((finalDbz + 32.0) * 2.0)));
                    const memoryIndex = gz * (GRID_X * GRID_Y) + gy * GRID_X + gx;
                    voxels[memoryIndex] = mappedByte;
                }
            }
        }
    }

    // 🌟 Run the 3D Separable Spatial Filter across the voxel volume (GR2Analyst-style smoothing)
    const smoothedVoxels = smoothVolume3D(voxels, GRID_X, GRID_Y, GRID_Z);

    const tiltsMeta = sweeps.map((s, idx) => ({ index: idx, elevation: s.elAngle }));
    return { voxels: smoothedVoxels, tilts: tiltsMeta };
}

self.onmessage = async (e) => {
    const { id, rawBuffer, radarLat, radarLon, bounds, station, cacheKey } = e.data;
    const startTime = performance.now();

    try {
        const decompressedBytes = decompressLevel2(rawBuffer);
        const { voxels, tilts } = processVolume(
            decompressedBytes,
            radarLat,
            radarLon,
            bounds,
            station || 'KDMX'
        );

        const elapsed = (performance.now() - startTime).toFixed(1);
        console.log(`⚡ [Level 2 Worker] Built Smoothed 3D Volume (${GRID_X}x${GRID_Y}x${GRID_Z}) in ${elapsed}ms`);

        self.postMessage({
            id,
            success: true,
            voxelBuffer: voxels,
            tilts,
            bounds,
            cacheKey
        }, [voxels.buffer]);

    } catch (err) {
        console.error("Worker processing failed:", err);
        self.postMessage({ id, success: false, error: err.message });
    }
};
