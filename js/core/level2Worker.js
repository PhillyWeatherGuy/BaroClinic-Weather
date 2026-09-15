// js/core/level2Worker.js
import { unzlibSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import seekBzip from 'https://cdn.jsdelivr.net/npm/seek-bzip@1.0.6/+esm';

const GRID_X = 128; // East - West
const GRID_Y = 64;  // Altitude (0 to 20 km)
const GRID_Z = 128; // North - South
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
 * 🛰️ Parses Message 31 sweeps into structured polar elevation cuts
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
                            radials: new Array(TARGET_RADIALS)
                        });
                    }

                    const sweep = sweepsByElevation.get(elIndex);
                    const rayIdx = Math.min(TARGET_RADIALS - 1, Math.max(0, Math.round(azAngle * 2) % TARGET_RADIALS));
                    const gateBytes = rawBytes.subarray(refOffset + 28, refOffset + 28 + numGates);
                    sweep.radials[rayIdx] = new Uint8Array(gateBytes);

                    i += 100;
                }
            }
        }
    }

    return Array.from(sweepsByElevation.values()).sort((a, b) => a.elAngle - b.elAngle);
}

/**
 * 🌟 Smooth Bilinear Sampling within a single polar sweep
 */
function sampleSweepBilinear(sweep, slantRangeMeters, azDeg) {
    if (!sweep) return 0.0;

    // Fractional ray
    const normRay = ((azDeg % 360.0) + 360.0) % 360.0 * 2.0;
    const r0 = Math.floor(normRay) % TARGET_RADIALS;
    const r1 = (r0 + 1) % TARGET_RADIALS;
    const rayT = normRay - Math.floor(normRay);

    const rad0 = sweep.radials[r0];
    const rad1 = sweep.radials[r1] || rad0;
    if (!rad0) return 0.0;

    // Fractional gate bin
    const normBin = (slantRangeMeters - sweep.firstGateMeters) / sweep.gateSpacingMeters;
    if (normBin < 0 || normBin >= sweep.numGates - 1) return 0.0;

    const b0 = Math.floor(normBin);
    const b1 = b0 + 1;
    const binT = normBin - b0;

    const v00 = rad0[b0] > 1 ? (rad0[b0] - sweep.offsetVal) / sweep.scale : 0.0;
    const v01 = rad0[b1] > 1 ? (rad0[b1] - sweep.offsetVal) / sweep.scale : 0.0;
    const v10 = (rad1 && rad1[b0] > 1) ? (rad1[b0] - sweep.offsetVal) / sweep.scale : v00;
    const v11 = (rad1 && rad1[b1] > 1) ? (rad1[b1] - sweep.offsetVal) / sweep.scale : v01;

    // Bilinear interpolation
    const top = v00 * (1.0 - binT) + v01 * binT;
    const bottom = v10 * (1.0 - binT) + v11 * binT;
    const dbz = top * (1.0 - rayT) + bottom * rayT;

    return dbz > 10.0 ? dbz : 0.0;
}

/**
 * 🌟 3D Separable Gaussian Blur (The "Puffy Cloud" Filter)
 * Smooths raw discretized radar cells into natural, billowy fluid domes
 */
function applyGaussian3DFilter(voxels) {
    const temp = new Float32Array(GRID_X * GRID_Y * GRID_Z);
    const out = new Uint8Array(GRID_X * GRID_Y * GRID_Z);

    // Pass 1: Horizontal X-Blur
    for (let z = 0; z < GRID_Z; z++) {
        for (let y = 0; y < GRID_Y; y++) {
            const rowOffset = z * (GRID_X * GRID_Y) + y * GRID_X;
            for (let x = 0; x < GRID_X; x++) {
                const x0 = Math.max(0, x - 1);
                const x1 = Math.min(GRID_X - 1, x + 1);
                temp[rowOffset + x] = 
                    voxels[rowOffset + x0] * 0.25 + 
                    voxels[rowOffset + x] * 0.50 + 
                    voxels[rowOffset + x1] * 0.25;
            }
        }
    }

    // Pass 2: Vertical Y-Blur
    for (let z = 0; z < GRID_Z; z++) {
        for (let x = 0; x < GRID_X; x++) {
            for (let y = 0; y < GRID_Y; y++) {
                const y0 = Math.max(0, y - 1);
                const y1 = Math.min(GRID_Y - 1, y + 1);
                const idx0 = z * (GRID_X * GRID_Y) + y0 * GRID_X + x;
                const idx  = z * (GRID_X * GRID_Y) + y * GRID_X + x;
                const idx1 = z * (GRID_X * GRID_Y) + y1 * GRID_X + x;

                const val = temp[idx0] * 0.25 + temp[idx] * 0.50 + temp[idx1] * 0.25;
                out[idx] = Math.min(255, Math.round(val));
            }
        }
    }

    // Pass 3: Depth Z-Blur
    for (let y = 0; y < GRID_Y; y++) {
        for (let x = 0; x < GRID_X; x++) {
            for (let z = 0; z < GRID_Z; z++) {
                const z0 = Math.max(0, z - 1);
                const z1 = Math.min(GRID_Z - 1, z + 1);
                const idx0 = z0 * (GRID_X * GRID_Y) + y * GRID_X + x;
                const idx  = z  * (GRID_X * GRID_Y) + y * GRID_X + x;
                const idx1 = z1 * (GRID_X * GRID_Y) + y * GRID_X + x;

                const val = out[idx0] * 0.25 + out[idx] * 0.50 + out[idx1] * 0.25;
                voxels[idx] = Math.min(255, Math.round(val));
            }
        }
    }
}

/**
 * 🛰️ Inverse Voxel Pull with Continuous Polar Interpolation
 */
function processVolume(rawBytes, radarLat, radarLon, bounds, targetTiltIndex = 0, stationId = 'KDMX') {
    const sweeps = parseSweepsFromLevel2(rawBytes, stationId);
    const voxels = new Uint8Array(GRID_X * GRID_Y * GRID_Z);

    if (sweeps.length === 0) {
        throw new Error(`No valid Level 2 radar sweeps found for ${stationId}`);
    }

    const minLng = Math.min(bounds[0], bounds[2]);
    const maxLng = Math.max(bounds[0], bounds[2]);
    const minLat = Math.min(bounds[1], bounds[3]);
    const maxLat = Math.max(bounds[1], bounds[3]);

    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;
    const radarCosLat = Math.cos(radarLat * DEG_TO_RAD);

    for (let gz = 0; gz < GRID_Z; gz++) {
        const latT = (GRID_Z - 1 - gz) / (GRID_Z - 1);
        const voxelLat = minLat + latT * latSpan;
        const dy = (voxelLat - radarLat) * DEG_TO_RAD * EARTH_RADIUS_METERS;

        for (let gx = 0; gx < GRID_X; gx++) {
            const lngT = gx / (GRID_X - 1);
            const voxelLng = minLng + lngT * lngSpan;
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

                    const span = sweepAbove.elAngle - sweepBelow.elAngle;
                    const t = Math.max(0.0, Math.min(1.0, (elAngleDeg - sweepBelow.elAngle) / span));

                    if (dbz1 > 0 && dbz2 > 0) {
                        finalDbz = dbz1 + t * (dbz2 - dbz1);
                    } else if (dbz1 > 0) {
                        finalDbz = dbz1 * (1.0 - t * 0.8);
                    } else if (dbz2 > 0) {
                        finalDbz = dbz2 * (t * 0.8);
                    }
                } else if (sweepBelow) {
                    const dbz = sampleSweepBilinear(sweepBelow, r, azDeg);
                    const diff = elAngleDeg - sweepBelow.elAngle;
                    if (diff < 2.0) {
                        finalDbz = dbz * Math.max(0.0, 1.0 - diff / 2.0);
                    }
                } else if (sweepAbove) {
                    const dbz = sampleSweepBilinear(sweepAbove, r, azDeg);
                    const diff = sweepAbove.elAngle - elAngleDeg;
                    if (diff < 1.2) {
                        finalDbz = dbz * Math.max(0.0, 1.0 - diff / 1.2);
                    }
                }

                if (finalDbz >= 10.0) {
                    const mappedByte = Math.min(255, Math.max(1, Math.round((finalDbz + 32.0) * 2.0)));
                    const idx = gz * (GRID_X * GRID_Y) + gy * GRID_X + gx;
                    voxels[idx] = mappedByte;
                }
            }
        }
    }

    // 🌟 Run the 3D Gaussian filter to sculpt the cloud billows
    applyGaussian3DFilter(voxels);

    const tiltsMeta = sweeps.map((s, idx) => ({ index: idx, elevation: s.elAngle }));
    return { voxels, tilts: tiltsMeta, tiltSweep: null };
}

self.onmessage = async (e) => {
    const { id, rawBuffer, radarLat, radarLon, bounds, targetTiltIndex, station } = e.data;
    const startTime = performance.now();

    try {
        const decompressedBytes = decompressLevel2(rawBuffer);
        const { voxels, tilts, tiltSweep } = processVolume(
            decompressedBytes,
            radarLat,
            radarLon,
            bounds,
            targetTiltIndex || 0,
            station || 'KDMX'
        );

        const elapsed = (performance.now() - startTime).toFixed(1);
        console.log(`⚡ [Level 2 Worker] Generated smooth storm volume in ${elapsed}ms`);

        self.postMessage({
            id,
            success: true,
            voxelBuffer: voxels,
            tilts,
            tiltSweep,
            bounds
        }, [voxels.buffer]);

    } catch (err) {
        console.error("Worker processing failed:", err);
        self.postMessage({ id, success: false, error: err.message });
    }
};
