// js/core/level2Worker.js
import { unzlibSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import seekBzip from 'https://cdn.jsdelivr.net/npm/seek-bzip@1.0.6/+esm';

const GRID_X = 128; // East - West (Longitude)
const GRID_Y = 64;  // Altitude / Height (0 to 20 km)
const GRID_Z = 128; // North - South (Latitude)
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

    const sweepsByElevation = new Map(); // elIndex -> sweepData
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

    // Sort sweeps strictly by elevation angle
    const sortedSweeps = Array.from(sweepsByElevation.values()).sort((a, b) => a.elAngle - b.elAngle);
    return sortedSweeps;
}

/**
 * 🌟 Samples reflectivity at (r, az) from a single elevation cut
 */
function sampleSweep(sweep, slantRangeMeters, azDeg) {
    if (!sweep) return 0.0;
    const rayIdx = Math.min(TARGET_RADIALS - 1, Math.max(0, Math.round(azDeg * 2) % TARGET_RADIALS));
    const radial = sweep.radials[rayIdx] || sweep.radials[(rayIdx + 1) % TARGET_RADIALS] || sweep.radials[(rayIdx - 1 + TARGET_RADIALS) % TARGET_RADIALS];
    if (!radial) return 0.0;

    const bin = Math.floor((slantRangeMeters - sweep.firstGateMeters) / sweep.gateSpacingMeters);
    if (bin < 0 || bin >= radial.length) return 0.0;

    const raw = radial[bin];
    if (raw <= 1) return 0.0; // 0 = below SNR, 1 = range folded

    const dbz = (raw - sweep.offsetVal) / sweep.scale;
    return dbz > 10.0 ? dbz : 0.0;
}

/**
 * 🌟 INVERSE VOXEL PULL WITH VERTICAL TILT INTERPOLATION (The GR2Analyst Method)
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

    let nonZeroVoxels = 0;

    // For every voxel (gx, gy, gz) in the 3D box, interpolate the atmosphere continuously
    for (let gz = 0; gz < GRID_Z; gz++) {
        // In Three.js: -Z is North, +Z is South
        const latT = (GRID_Z - 1 - gz) / (GRID_Z - 1);
        const voxelLat = minLat + latT * latSpan;
        const dy = (voxelLat - radarLat) * DEG_TO_RAD * EARTH_RADIUS_METERS;

        for (let gx = 0; gx < GRID_X; gx++) {
            // -X is West, +X is East
            const lngT = gx / (GRID_X - 1);
            const voxelLng = minLng + lngT * lngSpan;
            const dx = (voxelLng - radarLon) * DEG_TO_RAD * EARTH_RADIUS_METERS * radarCosLat;

            const groundDist = Math.hypot(dx, dy);
            let azRad = Math.atan2(dx, dy);
            if (azRad < 0) azRad += Math.PI * 2;
            const azDeg = azRad * RAD_TO_DEG;

            for (let gy = 0; gy < GRID_Y; gy++) {
                const altMeters = (gy / (GRID_Y - 1)) * MAX_ALTITUDE_METERS;

                // 4/3 Earth Radius Beam Inversion: solve for slant range r and elevation angle phi
                const s = groundDist;
                const h = altMeters;
                const r = Math.sqrt(s * s + h * h);
                const elAngleRad = Math.atan2(h - (s * s) / (2.0 * KE_EARTH_RADIUS), s);
                const elAngleDeg = elAngleRad * RAD_TO_DEG;

                // Find the sweeps immediately below and above this voxel's elevation angle
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
                    const dbz1 = sampleSweep(sweepBelow, r, azDeg);
                    const dbz2 = sampleSweep(sweepAbove, r, azDeg);

                    const span = sweepAbove.elAngle - sweepBelow.elAngle;
                    const t = Math.max(0.0, Math.min(1.0, (elAngleDeg - sweepBelow.elAngle) / span));

                    if (dbz1 > 0 && dbz2 > 0) {
                        finalDbz = dbz1 + t * (dbz2 - dbz1);
                    } else if (dbz1 > 0) {
                        finalDbz = dbz1 * (1.0 - t); // Smooth fade-out into cloud boundary
                    } else if (dbz2 > 0) {
                        finalDbz = dbz2 * t;
                    }
                } else if (sweepBelow) {
                    const dbz = sampleSweep(sweepBelow, r, azDeg);
                    const diff = elAngleDeg - sweepBelow.elAngle;
                    if (diff < 1.5) {
                        finalDbz = dbz * Math.max(0.0, 1.0 - diff / 1.5);
                    }
                } else if (sweepAbove) {
                    const dbz = sampleSweep(sweepAbove, r, azDeg);
                    const diff = sweepAbove.elAngle - elAngleDeg;
                    if (diff < 1.0) {
                        finalDbz = dbz * Math.max(0.0, 1.0 - diff / 1.0);
                    }
                }

                if (finalDbz >= 12.0) {
                    // Map to 0..255 byte
                    const mappedByte = Math.min(255, Math.max(1, Math.round((finalDbz + 32.0) * 2.0)));
                    const idx = gz * (GRID_X * GRID_Y) + gy * GRID_X + gx;
                    voxels[idx] = mappedByte;
                    nonZeroVoxels++;
                }
            }
        }
    }

    console.log(`📡 [Level 2 Worker] Seamlessly interpolated ${nonZeroVoxels} continuous cloud voxels across ${sweeps.length} elevation tilts.`);

    const tiltsMeta = sweeps.map((s, idx) => ({ index: idx, elevation: s.elAngle }));

    return {
        voxels,
        tilts: tiltsMeta,
        tiltSweep: null
    };
}

/**
 * 🌟 Web Worker Message Dispatcher
 */
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
