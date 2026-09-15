// js/core/level2Worker.js
import { unzlibSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import seekBzip from 'https://cdn.jsdelivr.net/npm/seek-bzip@1.0.6/+esm';

// Exact 3D Volume Dimensions (128 x 64 x 128 = 1 MB)
const GRID_X = 128; // Longitude (West -> East)
const GRID_Y = 64;  // Altitude (0 -> 20 km)
const GRID_Z = 128; // Latitude (South -> North)
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
 * 🛰️ Parses Message 31 sweeps from Level 2 buffer
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

    // Fill missing radial gaps with adjacent beam data
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

    return Array.from(sweepsByElevation.values()).sort((a, b) => a.elAngle - b.elAngle);
}

/**
 * 🌟 Smooth Bilinear Sampling within a single polar sweep
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

    return dbz > 8.0 ? dbz : 0.0;
}

/**
 * 🌟 Constructs the Continuous 3D Volume Density Field with Correct Memory Striding
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

    // Continuous 3D spatial interpolation across all voxels
    for (let gz = 0; gz < GRID_Z; gz++) {
        // gz = 0 is South, gz = 127 is North
        const voxelLat = minLat + (gz / (GRID_Z - 1)) * latSpan;
        const dy = (voxelLat - radarLat) * DEG_TO_RAD * EARTH_RADIUS_METERS;

        for (let gx = 0; gx < GRID_X; gx++) {
            // gx = 0 is West, gx = 127 is East
            const voxelLng = minLng + (gx / (GRID_X - 1)) * lngSpan;
            const dx = (voxelLng - radarLon) * DEG_TO_RAD * EARTH_RADIUS_METERS * radarCosLat;

            const groundDist = Math.hypot(dx, dy);
            let azRad = Math.atan2(dx, dy);
            if (azRad < 0) azRad += Math.PI * 2;
            const azDeg = azRad * RAD_TO_DEG;

            for (let gy = 0; gy < GRID_Y; gy++) {
                // gy = 0 is Ground, gy = 63 is 20 km altitude
                const altMeters = (gy / (GRID_Y - 1)) * MAX_ALTITUDE_METERS;

                const s = groundDist;
                const h = altMeters;
                const r = Math.sqrt(s * s + h * h);
                const elAngleRad = Math.atan2(h - (s * s) / (2.0 * KE_EARTH_RADIUS), s);
                const elAngleDeg = elAngleRad * RAD_TO_DEG;

                // Find elevation sweeps immediately below and above this point
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
                        finalDbz = dbz1 * (1.0 - t * 0.7);
                    } else if (dbz2 > 0) {
                        finalDbz = dbz2 * (t * 0.7);
                    }
                } else if (sweepBelow) {
                    const dbz = sampleSweepBilinear(sweepBelow, r, azDeg);
                    const diff = elAngleDeg - sweepBelow.elAngle;
                    if (diff < 2.5) {
                        finalDbz = dbz * Math.max(0.0, 1.0 - diff / 2.5);
                    }
                } else if (sweepAbove) {
                    const dbz = sampleSweepBilinear(sweepAbove, r, azDeg);
                    const diff = sweepAbove.elAngle - elAngleDeg;
                    if (diff < 1.5) {
                        finalDbz = dbz * Math.max(0.0, 1.0 - diff / 1.5);
                    }
                }

                if (finalDbz >= 10.0) {
                    const mappedByte = Math.min(255, Math.max(1, Math.round((finalDbz + 32.0) * 2.0)));
                    // 🌟 Exact WebGL 3D Texture Memory Stride: z * (width * height) + y * width + x
                    const memoryIndex = gz * (GRID_X * GRID_Y) + gy * GRID_X + gx;
                    voxels[memoryIndex] = mappedByte;
                }
            }
        }
    }

    const tiltsMeta = sweeps.map((s, idx) => ({ index: idx, elevation: s.elAngle }));

    return {
        voxels,
        tilts: tiltsMeta
    };
}

/**
 * 🌟 Web Worker Message Dispatcher
 */
self.onmessage = async (e) => {
    const { id, rawBuffer, radarLat, radarLon, bounds, station } = e.data;
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
        console.log(`⚡ [Level 2 Worker] Built 3D volume in ${elapsed}ms`);

        self.postMessage({
            id,
            success: true,
            voxelBuffer: voxels,
            tilts,
            bounds
        }, [voxels.buffer]);

    } catch (err) {
        console.error("Worker processing failed:", err);
        self.postMessage({ id, success: false, error: err.message });
    }
};
