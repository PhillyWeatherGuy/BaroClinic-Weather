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
 * 🛰️ Parses Message 31 sweeps using Table XVII-A ICAO Radar Identifier Anchor
 */
function processVolume(rawBytes, radarLat, radarLon, bounds, targetTiltIndex = 0, stationId = 'KDMX') {
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const voxels = new Uint8Array(GRID_X * GRID_Y * GRID_Z);

    const minLng = Math.min(bounds[0], bounds[2]);
    const maxLng = Math.max(bounds[0], bounds[2]);
    const minLat = Math.min(bounds[1], bounds[3]);
    const maxLat = Math.max(bounds[1], bounds[3]);

    const lngSpan = Math.max(maxLng - minLng, 0.001);
    const latSpan = Math.max(maxLat - minLat, 0.001);

    const detectedTiltsMap = new Map();
    let selectedTiltRadialGrid = null;
    const TARGET_RADIALS = 720;
    let selectedTiltMaxBins = 0;

    let gateCountProcessed = 0;

    // Station code 4-byte ASCII anchor (Table XVII-A bytes 0..3)
    const sCode = (stationId.length === 3 ? 'K' + stationId : stationId).toUpperCase();
    const c0 = sCode.charCodeAt(0);
    const c1 = sCode.charCodeAt(1);
    const c2 = sCode.charCodeAt(2);
    const c3 = sCode.charCodeAt(3);

    const limit = rawBytes.length - 120;

    for (let i = 0; i <= limit; i++) {
        // Fast 4-byte match on station ID
        if (
            rawBytes[i] === c0 &&
            rawBytes[i + 1] === c1 &&
            rawBytes[i + 2] === c2 &&
            rawBytes[i + 3] === c3
        ) {
            const hdrPos = i;

            const azAngle = view.getFloat32(hdrPos + 12, false);
            const elIndex = view.getUint8(hdrPos + 22);
            const elAngle = view.getFloat32(hdrPos + 24, false);
            const dataBlockCount = view.getUint16(hdrPos + 30, false);

            // Sanity check Table XVII-A fields
            if (
                azAngle >= 0.0 && azAngle <= 360.0 &&
                elIndex >= 1 && elIndex <= 35 &&
                elAngle >= -2.0 && elAngle <= 45.0 &&
                dataBlockCount >= 2 && dataBlockCount <= 16
            ) {
                if (!detectedTiltsMap.has(elIndex) && Number.isFinite(elAngle)) {
                    detectedTiltsMap.set(elIndex, parseFloat(elAngle.toFixed(2)));
                }

                // Locate Reflectivity ("DREF" or "REF") block pointer
                let refOffset = -1;
                for (let b = 0; b < dataBlockCount; b++) {
                    const ptrPos = hdrPos + 32 + (b * 4);
                    if (ptrPos + 4 > rawBytes.length) break;
                    const ptr = view.getUint32(ptrPos, false);

                    if (ptr > 0 && hdrPos + ptr + 4 <= rawBytes.length) {
                        const blkPos = hdrPos + ptr;
                        const b0 = rawBytes[blkPos];
                        const b1 = rawBytes[blkPos + 1];
                        const b2 = rawBytes[blkPos + 2];
                        const b3 = rawBytes[blkPos + 3];

                        if ((b0 === 68 && b1 === 82 && b2 === 69 && b3 === 70) || // "DREF"
                            (b0 === 82 && b1 === 69 && b2 === 70)) {              // "REF "
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

                    // 2D slice extraction
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

                    // 3D Voxel Coordinate Projection
                    const sinEl = Math.sin(elAngle * DEG_TO_RAD);
                    const cosEl = Math.cos(elAngle * DEG_TO_RAD);
                    const sinAz = Math.sin(azAngle * DEG_TO_RAD);
                    const cosAz = Math.cos(azAngle * DEG_TO_RAD);
                    const radarCosLat = Math.cos(radarLat * DEG_TO_RAD);

                    const dataStart = refOffset + 28;
                    const availableGates = Math.min(numGates, rawBytes.length - dataStart);

                    for (let g = 0; g < availableGates; g++) {
                        const rawVal = rawBytes[dataStart + g];
                        if (rawVal <= 1) continue; // 0 = below SNR, 1 = range folded

                        const dbz = (rawVal - offsetVal) / scale;
                        if (dbz < 10.0) continue; // Noise floor threshold

                        // Map to standard 0..255 byte scale
                        const mappedByte = Math.min(255, Math.max(1, Math.round((dbz + 32.0) * 2.0)));

                        const slantRange = firstGateMeters + (g * gateSpacingMeters);

                        // 4/3 Earth Radius Beam Refraction Model
                        const heightMeters = Math.sqrt(
                            slantRange * slantRange +
                            KE_EARTH_RADIUS * KE_EARTH_RADIUS +
                            2.0 * slantRange * KE_EARTH_RADIUS * sinEl
                        ) - KE_EARTH_RADIUS;

                        if (heightMeters < 0 || heightMeters > MAX_ALTITUDE_METERS) continue;

                        const groundDist = KE_EARTH_RADIUS * Math.asin((slantRange * cosEl) / (KE_EARTH_RADIUS + heightMeters));
                        const dx = groundDist * sinAz;
                        const dy = groundDist * cosAz;

                        const gateLat = radarLat + (dy / EARTH_RADIUS_METERS) * RAD_TO_DEG;
                        const gateLng = radarLon + (dx / (EARTH_RADIUS_METERS * radarCosLat)) * RAD_TO_DEG;

                        // Bounding Box Filter
                        if (gateLng < minLng || gateLng > maxLng || gateLat < minLat || gateLat > maxLat) {
                            continue;
                        }

                        const gx = Math.min(GRID_X - 1, Math.max(0, Math.floor(((gateLng - minLng) / lngSpan) * GRID_X)));
                        const gy = Math.min(GRID_Y - 1, Math.max(0, Math.floor(((gateLat - minLat) / latSpan) * GRID_Y)));
                        const gz = Math.min(GRID_Z - 1, Math.max(0, Math.floor((heightMeters / MAX_ALTITUDE_METERS) * GRID_Z)));

                        // Vertical beam thickness splat to bridge conical gaps
                        const beamThickness = Math.max(1, Math.floor((slantRange * 0.0087 / MAX_ALTITUDE_METERS) * GRID_Z));

                        for (let dz = -beamThickness; dz <= beamThickness; dz++) {
                            const targetZ = gz + dz;
                            if (targetZ >= 0 && targetZ < GRID_Z) {
                                const vIdx = targetZ * (GRID_X * GRID_Y) + gy * GRID_X + gx;
                                if (mappedByte > voxels[vIdx]) {
                                    voxels[vIdx] = mappedByte;
                                    gateCountProcessed++;
                                }
                            }
                        }
                    }

                    // Advance search index past this radial
                    i += 100;
                }
            }
        }
    }

    const sortedTilts = Array.from(detectedTiltsMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([index, el]) => ({ index: index - 1, elevation: el }));

    console.log(`📡 [Level 2 Worker] Integrated ${gateCountProcessed} storm gates for ${sCode}.`);

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
        console.log(`⚡ [Level 2 Worker] Voxelized storm (${GRID_X}x${GRID_Y}x${GRID_Z}) in ${elapsed}ms`);

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
