// js/core/level2Worker.js
import { unzlibSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import seekBzip from 'https://cdn.jsdelivr.net/npm/seek-bzip@1.0.6/+esm';

// Grid Dimensions (128 x 128 x 64 = 1,048,576 bytes = 1 MB)
const GRID_X = 128;
const GRID_Y = 128;
const GRID_Z = 64;
const MAX_ALTITUDE_METERS = 20000.0; // 20 km (~65.6 kft)

// 4/3 Effective Earth Radius for Standard Atmospheric Refraction
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

    // 1. Raw GZIP file
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        try {
            return unzlibSync(bytes);
        } catch (e) {}
    }

    // 2. Archive II Chunked Format (24-byte volume header followed by chunk records)
    let pos = 0;
    const isArchiveHeader = bytes.length > 24 &&
        bytes[0] === 0x41 && bytes[1] === 0x52 && bytes[2] === 0x32 && bytes[3] === 0x56; // "AR2V"

    if (isArchiveHeader) {
        pos = 24;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    while (pos + 4 < bytes.length) {
        let chunkSize = view.getInt32(pos, false);
        pos += 4;

        if (chunkSize === 0) continue;

        // If negative, chunk is uncompressed
        if (chunkSize < 0) {
            chunkSize = -chunkSize;
            if (pos + chunkSize > bytes.length) break;
            decompressedChunks.push(bytes.subarray(pos, pos + chunkSize));
            pos += chunkSize;
            continue;
        }

        if (pos + chunkSize > bytes.length) break;

        // BZIP2 Chunk
        if (bytes[pos] === 0x42 && bytes[pos + 1] === 0x5a && bytes[pos + 2] === 0x68) {
            try {
                const sub = bytes.subarray(pos, pos + chunkSize);
                const out = seekBzip.decode(sub);
                if (out && out.length > 0) {
                    decompressedChunks.push(new Uint8Array(out));
                }
            } catch (e) {}
        }
        pos += chunkSize;
    }

    if (decompressedChunks.length === 0) {
        // Fallback: try decoding as single standalone BZIP2
        try {
            const out = seekBzip.decode(bytes);
            return new Uint8Array(out);
        } catch (e) {
            throw new Error("Could not decompress Level 2 payload");
        }
    }

    // Merge all decompressed chunks
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
 * 🛰️ Parses Message 31 sweeps and voxelizes the selected storm column
 */
function processVolume(rawBytes, radarLat, radarLon, bounds, targetTiltIndex = 0) {
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const voxels = new Uint8Array(GRID_X * GRID_Y * GRID_Z);

    const [minLng, minLat, maxLng, maxLat] = bounds;
    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;

    const detectedTiltsMap = new Map();
    let selectedTiltRadialGrid = null;
    const TARGET_RADIALS = 720;
    let selectedTiltMaxBins = 0;

    let offset = 0;

    // Scan through records
    while (offset + 160 <= rawBytes.length) {
        // In Archive II, records are optionally padded to 2432 bytes or preceded by a 12-16 byte header
        let msgOffset = offset;
        let msgType = view.getUint8(msgOffset + 15);

        if (msgType !== 31 && offset + 2432 <= rawBytes.length) {
            msgOffset = offset + 12;
            msgType = view.getUint8(msgOffset + 3);
        }

        // We only process Message 31 (Generic Digital Radar Data)
        if (msgType === 31 && msgOffset + 100 <= rawBytes.length) {
            const azAngle = view.getFloat32(msgOffset + 12, false);
            const elIndex = view.getUint8(msgOffset + 22);
            const elAngle = view.getFloat32(msgOffset + 24, false);
            const dataBlockCount = view.getUint16(msgOffset + 28, false);

            if (!detectedTiltsMap.has(elIndex)) {
                detectedTiltsMap.set(elIndex, parseFloat(elAngle.toFixed(2)));
            }

            // Find the Reflectivity ("REF") block pointer
            let refOffset = -1;
            for (let b = 0; b < dataBlockCount; b++) {
                const ptr = view.getUint32(msgOffset + 30 + (b * 4), false);
                if (ptr > 0 && msgOffset + ptr + 4 <= rawBytes.length) {
                    const b0 = rawBytes[msgOffset + ptr];
                    const b1 = rawBytes[msgOffset + ptr + 1];
                    const b2 = rawBytes[msgOffset + ptr + 2];
                    const b3 = rawBytes[msgOffset + ptr + 3];

                    // Check for "REF" or "DREF"
                    if ((b0 === 82 && b1 === 69 && b2 === 70) || (b1 === 82 && b2 === 69 && b3 === 70)) {
                        refOffset = msgOffset + ptr;
                        break;
                    }
                }
            }

            if (refOffset > 0 && refOffset + 28 <= rawBytes.length) {
                const numGates = view.getUint16(refOffset + 8, false);
                const firstGateMeters = view.getUint16(refOffset + 10, false);
                const gateSpacingMeters = view.getUint16(refOffset + 12, false);

                // Check if this tilt was requested for 2D slicing
                const isSelected2DTilt = (elIndex === (targetTiltIndex + 1));
                if (isSelected2DTilt) {
                    if (!selectedTiltRadialGrid) {
                        selectedTiltMaxBins = numGates;
                        selectedTiltRadialGrid = new Uint8Array(TARGET_RADIALS * numGates);
                    }
                    const rayIdx = Math.min(TARGET_RADIALS - 1, Math.max(0, Math.round(azAngle * 2) % TARGET_RADIALS));
                    const targetRayOffset = rayIdx * numGates;
                    const gateBytes = rawBytes.subarray(refOffset + 28, refOffset + 28 + numGates);
                    selectedTiltRadialGrid.set(gateBytes, targetRayOffset);
                }

                // Mathematical beam propagation parameters
                const sinEl = Math.sin(elAngle * DEG_TO_RAD);
                const cosEl = Math.cos(elAngle * DEG_TO_RAD);
                const sinAz = Math.sin(azAngle * DEG_TO_RAD);
                const cosAz = Math.cos(azAngle * DEG_TO_RAD);
                const radarCosLat = Math.cos(radarLat * DEG_TO_RAD);

                const dataStart = refOffset + 28;
                const availableGates = Math.min(numGates, rawBytes.length - dataStart);

                for (let g = 0; g < availableGates; g++) {
                    const rawVal = rawBytes[dataStart + g];
                    // Skip clear-air noise & ground clutter below 12 dBZ
                    if (rawVal < 68) continue;

                    const slantRange = firstGateMeters + (g * gateSpacingMeters);

                    // 4/3 Earth Radius Atmospheric Refraction Model
                    const heightMeters = Math.sqrt(
                        slantRange * slantRange +
                        KE_EARTH_RADIUS * KE_EARTH_RADIUS +
                        2.0 * slantRange * KE_EARTH_RADIUS * sinEl
                    ) - KE_EARTH_RADIUS;

                    if (heightMeters < 0 || heightMeters > MAX_ALTITUDE_METERS) continue;

                    // Ground distance along Earth surface
                    const groundDist = KE_EARTH_RADIUS * Math.asin((slantRange * cosEl) / (KE_EARTH_RADIUS + heightMeters));

                    const dx = groundDist * sinAz;
                    const dy = groundDist * cosAz;

                    const gateLat = radarLat + (dy / EARTH_RADIUS_METERS) * RAD_TO_DEG;
                    const gateLng = radarLon + (dx / (EARTH_RADIUS_METERS * radarCosLat)) * RAD_TO_DEG;

                    // Fast Bounding Box Filter (Discards 95% of gates outside storm)
                    if (gateLng < minLng || gateLng > maxLng || gateLat < minLat || gateLat > maxLat) {
                        continue;
                    }

                    // Map Geographic & Altitude Coordinates to Voxel Grid Indices
                    const gx = Math.min(GRID_X - 1, Math.max(0, Math.floor(((gateLng - minLng) / lngSpan) * GRID_X)));
                    const gy = Math.min(GRID_Y - 1, Math.max(0, Math.floor(((gateLat - minLat) / latSpan) * GRID_Y)));
                    const gz = Math.min(GRID_Z - 1, Math.max(0, Math.floor((heightMeters / MAX_ALTITUDE_METERS) * GRID_Z)));

                    // Half-beam height thickness splat to bridge conical elevation gaps
                    const beamThickness = Math.max(1, Math.floor((slantRange * 0.0087 / MAX_ALTITUDE_METERS) * GRID_Z));

                    for (let dz = -beamThickness; dz <= beamThickness; dz++) {
                        const targetZ = gz + dz;
                        if (targetZ >= 0 && targetZ < GRID_Z) {
                            const vIdx = targetZ * (GRID_X * GRID_Y) + gy * GRID_X + gx;
                            if (rawVal > voxels[vIdx]) {
                                voxels[vIdx] = rawVal;
                            }
                        }
                    }
                }
            }
        }

        offset += (offset + 2432 <= rawBytes.length) ? 2432 : 100;
    }

    const sortedTilts = Array.from(detectedTiltsMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([index, el]) => ({ index: index - 1, elevation: el }));

    return {
        voxels,
        tilts: sortedTilts,
        tiltSweep: selectedTiltRadialGrid ? {
            numRadials: TARGET_RADIALS,
            numBins: selectedTiltMaxBins,
            data: selectedTiltRadialGrid
        } : null
    };
}

/**
 * 🌟 Web Worker Message Dispatcher
 */
self.onmessage = async (e) => {
    const { id, rawBuffer, radarLat, radarLon, bounds, targetTiltIndex } = e.data;
    const startTime = performance.now();

    try {
        const decompressedBytes = decompressLevel2(rawBuffer);
        const { voxels, tilts, tiltSweep } = processVolume(
            decompressedBytes,
            radarLat,
            radarLon,
            bounds,
            targetTiltIndex || 0
        );

        const elapsed = (performance.now() - startTime).toFixed(1);
        console.log(`⚡ [Level 2 Worker] Voxelized storm (${GRID_X}x${GRID_Y}x${GRID_Z}) in ${elapsed}ms`);

        // Transferable zero-copy memory transfer
        const transferList = [voxels.buffer];
        if (tiltSweep && tiltSweep.data) {
            transferList.push(tiltSweep.data.buffer);
        }

        self.postMessage({
            id,
            success: true,
            voxelBuffer: voxels,
            tilts,
            tiltSweep,
            bounds
        }, transferList);

    } catch (err) {
        console.error("Worker processing failed:", err);
        self.postMessage({
            id,
            success: false,
            error: err.message
        });
    }
};
