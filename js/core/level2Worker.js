// js/core/level2Worker.js
import { unzlibSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import seekBzip from 'https://cdn.jsdelivr.net/npm/seek-bzip@1.0.6/+esm';

const GRID_SIZE = 128; // 128 x 128 resolution per tilt slice
const TARGET_RADIALS = 720; // 0.5° Azimuth resolution

const EARTH_RADIUS_METERS = 6371000.0;
const KE_EARTH_RADIUS = (4.0 / 3.0) * EARTH_RADIUS_METERS;
const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;

/**
 * 🛰️ Decompresses Level 2 Archive II Chunks (BZIP2 / GZIP)
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

    // Fill missing radial gaps by copying from adjacent slots
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
 * 🌟 Samples raw reflectivity at (r, az) from a single 2D polar sweep
 */
function sampleSweepFast(sweep, slantRangeMeters, azDeg) {
    if (!sweep) return 0;
    const rayIdx = Math.min(TARGET_RADIALS - 1, Math.max(0, Math.round(azDeg * 2) % TARGET_RADIALS));
    const radial = sweep.radials[rayIdx];
    if (!radial) return 0;

    const bin = Math.floor((slantRangeMeters - sweep.firstGateMeters) / sweep.gateSpacingMeters);
    if (bin < 0 || bin >= radial.length) return 0;

    const raw = radial[bin];
    if (raw <= 1) return 0; // Skip SNR/RF

    const dbz = (raw - sweep.offsetVal) / sweep.scale;
    if (dbz < 10.0) return 0;

    // Convert dBZ to standard 0..255 byte
    return Math.min(255, Math.max(1, Math.round((dbz + 32.0) * 2.0)));
}

/**
 * 🌟 Rasterizes each elevation tilt into a stacked 2D slice for the bounding box
 */
function buildStackedTiltSlices(rawBytes, radarLat, radarLon, bounds, stationId = 'KDMX') {
    const sweeps = parseSweepsFromLevel2(rawBytes, stationId);
    if (sweeps.length === 0) {
        throw new Error(`No valid Level 2 sweeps found for ${stationId}`);
    }

    const minLng = Math.min(bounds[0], bounds[2]);
    const maxLng = Math.max(bounds[0], bounds[2]);
    const minLat = Math.min(bounds[1], bounds[3]);
    const maxLat = Math.max(bounds[1], bounds[3]);

    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;
    const radarCosLat = Math.cos(radarLat * DEG_TO_RAD);

    // Calculate center slant range to determine each tilt's physical altitude over the storm
    const cLng = (minLng + maxLng) * 0.5;
    const cLat = (minLat + maxLat) * 0.5;
    const dxC = (cLng - radarLon) * DEG_TO_RAD * EARTH_RADIUS_METERS * radarCosLat;
    const dyC = (cLat - radarLat) * DEG_TO_RAD * EARTH_RADIUS_METERS;
    const centerDist = Math.hypot(dxC, dyC);

    const slices = [];
    const transferList = [];

    for (let sIdx = 0; sIdx < sweeps.length; sIdx++) {
        const sweep = sweeps[sIdx];
        const sinEl = Math.sin(sweep.elAngle * DEG_TO_RAD);
        const cosEl = Math.cos(sweep.elAngle * DEG_TO_RAD);

        // 4/3 Earth Radius Beam Altitude at storm center
        const altMeters = Math.sqrt(
            centerDist * centerDist +
            KE_EARTH_RADIUS * KE_EARTH_RADIUS +
            2.0 * centerDist * KE_EARTH_RADIUS * sinEl
        ) - KE_EARTH_RADIUS;

        // Skip sweeps that shoot completely above the troposphere (> 22 km)
        if (altMeters > 22000.0) continue;

        const sliceBuffer = new Uint8Array(GRID_SIZE * GRID_SIZE);
        let hasData = false;

        // Rasterize 128x128 grid matching the exact 2D geographic bounding box
        for (let py = 0; py < GRID_SIZE; py++) {
            // py = 0 is North (top of map), py = 127 is South (bottom)
            const lat = maxLat - (py / (GRID_SIZE - 1)) * latSpan;
            const dy = (lat - radarLat) * DEG_TO_RAD * EARTH_RADIUS_METERS;

            for (let px = 0; px < GRID_SIZE; px++) {
                // px = 0 is West (left), px = 127 is East (right)
                const lng = minLng + (px / (GRID_SIZE - 1)) * lngSpan;
                const dx = (lng - radarLon) * DEG_TO_RAD * EARTH_RADIUS_METERS * radarCosLat;

                const groundDist = Math.hypot(dx, dy);
                let azRad = Math.atan2(dx, dy);
                if (azRad < 0) azRad += Math.PI * 2;
                const azDeg = azRad * RAD_TO_DEG;

                // Slant range to this ground coordinate along this tilt's beam
                const slantRange = groundDist / cosEl;

                const byteVal = sampleSweepFast(sweep, slantRange, azDeg);
                if (byteVal > 0) {
                    sliceBuffer[py * GRID_SIZE + px] = byteVal;
                    hasData = true;
                }
            }
        }

        // Only include sweeps that actually intersect the storm
        if (hasData || sIdx === 0) {
            slices.push({
                elIndex: sIdx,
                elAngle: sweep.elAngle,
                altitudeMeters: Math.max(0, altMeters),
                data: sliceBuffer
            });
            transferList.push(sliceBuffer.buffer);
        }
    }

    console.log(`📡 [Level 2 Worker] Built ${slices.length} crisp stacked elevation slices for ${stationId}.`);

    const tiltsMeta = sweeps.map((s, idx) => ({ index: idx, elevation: s.elAngle }));

    return {
        slices,
        tilts: tiltsMeta,
        transferList
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
        const { slices, tilts, transferList } = buildStackedTiltSlices(
            decompressedBytes,
            radarLat,
            radarLon,
            bounds,
            station || 'KDMX'
        );

        const elapsed = (performance.now() - startTime).toFixed(1);
        console.log(`⚡ [Level 2 Worker] Stacked ${slices.length} tilts in ${elapsed}ms`);

        self.postMessage({
            id,
            success: true,
            slices,
            tilts,
            bounds
        }, transferList);

    } catch (err) {
        console.error("Worker processing failed:", err);
        self.postMessage({ id, success: false, error: err.message });
    }
};
