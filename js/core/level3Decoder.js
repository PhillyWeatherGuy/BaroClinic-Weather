// js/core/level3Decoder.js
import { unzlibSync, inflateSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';

/**
 * 🌟 NWS 16-Level Reflectivity Threshold Map (dBZ -> 0..255 Palette Index)
 */
const LEVEL_16_TO_BYTE = new Uint8Array([
    0,   // Level 0: < 5 dBZ (Transparent)
    0,   // Level 1: 5 dBZ (Transparent / Clear-air filter)
    0,   // Level 2: 10 dBZ (Transparent / Clear-air filter)
    85,  // Level 3: 15 dBZ (Light Blue / Drizzle)
    105, // Level 4: 20 dBZ (Light Green)
    125, // Level 5: 25 dBZ (Moderate Green)
    140, // Level 6: 30 dBZ (Dark Green)
    155, // Level 7: 35 dBZ (Yellow)
    170, // Level 8: 40 dBZ (Dark Yellow / Light Orange)
    185, // Level 9: 45 dBZ (Orange)
    200, // Level 10: 50 dBZ (Red)
    215, // Level 11: 55 dBZ (Dark Red)
    230, // Level 12: 60 dBZ (Pink)
    242, // Level 13: 65 dBZ (Purple)
    250, // Level 14: 70 dBZ (Dark Purple)
    255  // Level 15: 75+ dBZ (White / Hail)
]);

/**
 * 🛰️ Decompresses Level 3 payload using fflate and browser Zlib/Deflate
 */
function decompressLevel3Payload(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let bestOut = bytes;
    let maxLen = 0;

    // 1. Scan every byte for ZLIB Header (0x78)
    for (let offset = 0; offset <= Math.min(bytes.length - 2, 600); offset++) {
        if (bytes[offset] === 0x78) {
            try {
                const sub = bytes.subarray(offset);
                const out = unzlibSync(sub);
                if (out && out.length > maxLen) {
                    bestOut = out;
                    maxLen = out.length;
                }
            } catch (e) {}
        }
    }

    if (maxLen > 1000) return bestOut;

    // 2. Scan for GZIP / Raw Deflate
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        try {
            const out = unzlibSync(bytes);
            if (out && out.length > maxLen) {
                bestOut = out;
                maxLen = out.length;
            }
        } catch (e) {}
    }

    for (let offset = 0; offset <= Math.min(bytes.length - 2, 600); offset++) {
        try {
            const sub = bytes.subarray(offset);
            const out = inflateSync(sub);
            if (out && out.length > maxLen) {
                bestOut = out;
                maxLen = out.length;
            }
        } catch (e) {}
    }

    return bestOut;
}

/**
 * 🌟 Helper: Extracts exact radar scan Date from the Product Description Block (PDB)
 */
function extractRadarTimestamp(rawBytes, view) {
    try {
        for (let off = 30; off <= Math.min(rawBytes.length - 54, 250); off += 2) {
            const julianDays = view.getUint32(off, false);
            const secPastMid = view.getUint32(off + 4, false);

            if (julianDays >= 18000 && julianDays <= 25000 && secPastMid >= 0 && secPastMid <= 86400) {
                const msTime = (julianDays * 86400000) + (secPastMid * 1000);
                const scanDate = new Date(msTime);
                if (!isNaN(scanDate.getTime())) {
                    return scanDate;
                }
            }
        }
    } catch (e) {}
    return new Date();
}

/**
 * 🛰️ Universal Level 3 Radial Decoder
 */
export async function decodeLevel3(rawBuffer, stationMeta = null) {
    const startTime = performance.now();
    const rawBytes = new Uint8Array(rawBuffer);
    const rawView = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);

    const scanTimestamp = extractRadarTimestamp(rawBytes, rawView);

    const dataBytes = decompressLevel3Payload(rawBuffer);
    const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);

    let packetPos = -1;
    let packetCode = 0;

    if (dataBytes.length >= 30) {
        const codeAt16 = view.getUint16(16, false);
        if (codeAt16 === 0xAF1F || codeAt16 === 0x0010 || codeAt16 === 16 || codeAt16 === 0x001C || codeAt16 === 28) {
            packetPos = 16;
            packetCode = codeAt16;
        }
    }

    if (packetPos === -1) {
        for (let offset = 0; offset <= dataBytes.length - 16; offset++) {
            const code = view.getUint16(offset, false);
            if (code === 0xAF1F || code === 0x0010 || code === 16 || code === 0x001C || code === 28) {
                const numBins = view.getUint16(offset + 4, false);
                const numRadials = view.getUint16(offset + 12, false);

                if (numBins >= 20 && numBins <= 4000 && numRadials >= 50 && numRadials <= 800) {
                    packetPos = offset;
                    packetCode = code;
                    break;
                }
            }
        }
    }

    if (packetPos === -1) {
        throw new Error(`Invalid Level 3 file: Radial packet not found (size: ${dataBytes.length} bytes)`);
    }

    const firstBin = view.getUint16(packetPos + 2, false);
    let numBins = view.getUint16(packetPos + 4, false);
    const iCenter = view.getInt16(packetPos + 6, false);
    const jCenter = view.getInt16(packetPos + 8, false);
    const rangeScaleFactor = view.getUint16(packetPos + 10, false);
    const numRadialsInFile = view.getUint16(packetPos + 12, false);

    let pos = packetPos + 14;

    if (pos + 6 <= dataBytes.length) {
        const firstRadialBytes = view.getUint16(pos, false);
        if ((packetCode === 16 || packetCode === 0x0010) && firstRadialBytes > 0 && firstRadialBytes !== numBins && firstRadialBytes <= 4000) {
            numBins = firstRadialBytes;
        }
    }

    let maxRangeMeters = 230000.0;
    if (numBins >= 1000) {
        maxRangeMeters = 460000.0;
    } else if (numBins <= 230) {
        maxRangeMeters = 230000.0;
    } else if (numBins === 460) {
        maxRangeMeters = 230000.0;
    } else {
        maxRangeMeters = 230000.0;
    }

    const TARGET_RADIALS = 720;
    const radarGrid = new Uint8Array(TARGET_RADIALS * numBins);
    const filledRays = new Uint8Array(TARGET_RADIALS);

    for (let r = 0; r < numRadialsInFile; r++) {
        if (pos + 6 > dataBytes.length) break;

        const numUnits = view.getUint16(pos, false);
        const startAngleTenths = view.getUint16(pos + 2, false);
        const angleDeltaTenths = view.getUint16(pos + 4, false);
        pos += 6;

        const azimuthDeg = startAngleTenths / 10.0;
        const rayIndex = Math.min(TARGET_RADIALS - 1, Math.max(0, Math.round(azimuthDeg * 2) % TARGET_RADIALS));
        const targetOffset = rayIndex * numBins;

        if (packetCode === 0xAF1F) {
            let binIdx = 0;
            const rleBytesCount = (numUnits * 2) - 6;
            for (let b = 0; b < rleBytesCount && pos < dataBytes.length; b++) {
                const rleByte = dataBytes[pos++];
                const run = (rleByte >> 4) & 0x0F;
                const level = rleByte & 0x0F;
                const byteVal = LEVEL_16_TO_BYTE[level] || 0;

                for (let k = 0; k < run && binIdx < numBins; k++) {
                    radarGrid[targetOffset + binIdx++] = byteVal;
                }
            }
        } else {
            const copyLength = Math.min(numUnits, numBins);
            const rawSlice = dataBytes.subarray(pos, pos + copyLength);
            for (let k = 0; k < copyLength; k++) {
                const val = rawSlice[k];
                radarGrid[targetOffset + k] = val < 75 ? 0 : val;
            }
            pos += numUnits;
        }

        filledRays[rayIndex] = 1;

        if (numRadialsInFile <= 360) {
            const nextSlot = (rayIndex + 1) % TARGET_RADIALS;
            radarGrid.set(radarGrid.subarray(targetOffset, targetOffset + numBins), nextSlot * numBins);
            filledRays[nextSlot] = 1;
        }
    }

    for (let i = 0; i < TARGET_RADIALS; i++) {
        if (!filledRays[i]) {
            const prev = (i - 1 + TARGET_RADIALS) % TARGET_RADIALS;
            if (filledRays[prev]) {
                radarGrid.set(radarGrid.subarray(prev * numBins, (prev + 1) * numBins), i * numBins);
                filledRays[i] = 1;
            }
        }
    }

    const elapsed = (performance.now() - startTime).toFixed(1);
    console.log(`⚡ [Decoder] Unpacked Level 3 (${stationMeta?.id || 'RADAR'} [0x${packetCode.toString(16).toUpperCase()}]): ${numRadialsInFile} radials × ${numBins} gates in ${elapsed}ms | Time: ${scanTimestamp.toUTCString()}`);

    return {
        stationId: stationMeta?.id || "RADAR",
        lat: stationMeta?.lat || 0.0,
        lon: stationMeta?.lon || 0.0,
        numRadials: TARGET_RADIALS,
        numBins: numBins,
        maxRangeMeters: maxRangeMeters,
        data: radarGrid,
        timestamp: scanTimestamp
    };
}
