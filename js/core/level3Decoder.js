// js/core/level3Decoder.js
import { unzlibSync, inflateSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import seekBzip from 'https://cdn.jsdelivr.net/npm/seek-bzip@1.0.6/+esm';

/**
 * 🌟 NWS 16-Level Reflectivity Threshold Map (dBZ -> 0..255 Palette Index)
 * Levels 0..2 (< 15 dBZ) are set to 0 (transparent) to filter out clear-air ground clutter!
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
 * 🛰️ Decompresses Level 3 payload (Supports BZIP2, ZLIB, GZIP, and Raw NIDS)
 */
function decompressLevel3Payload(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let bestOut = bytes;
    let maxLen = 0;

    // 1. Scan for BZIP2 Header: 'B', 'Z', 'h' (0x42, 0x5A, 0x68)
    for (let offset = 0; offset <= Math.min(bytes.length - 4, 600); offset++) {
        if (bytes[offset] === 0x42 && bytes[offset + 1] === 0x5A && bytes[offset + 2] === 0x68) {
            try {
                const sub = bytes.subarray(offset);
                const out = seekBzip.decode(sub);
                if (out && out.length > maxLen) {
                    bestOut = new Uint8Array(out);
                    maxLen = out.length;
                }
            } catch (e) {}
        }
    }

    if (maxLen > 1000) return bestOut;

    // 2. Scan for ZLIB Header (0x78)
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

    // 3. Scan for GZIP / Raw Deflate
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
        // Search for the 102-byte PDB or scan for Julian Date / Time fields in the first 300 bytes
        // In NEXRAD Level 3 PDB:
        // Halfwords 23-24 (bytes 46-49 from PDB start) = Volume Scan Date (Julian days since Jan 1, 1970)
        // Halfwords 25-26 (bytes 50-53 from PDB start) = Volume Scan Time (Seconds past midnight UTC)
        for (let off = 30; off <= Math.min(rawBytes.length - 54, 250); off += 2) {
            const julianDays = view.getUint32(off, false);
            const secPastMid = view.getUint32(off + 4, false);

            // Sanity check: Julian days for 2020-2035 range roughly from 18262 to 23831
            // Seconds past midnight ranges from 0 to 86400
            if (julianDays >= 18000 && julianDays <= 25000 && secPastMid >= 0 && secPastMid <= 86400) {
                // Convert Unix epoch day offset (Julian days since 1970-01-01)
                const msTime = (julianDays * 86400000) + (secPastMid * 1000);
                const scanDate = new Date(msTime);
                if (!isNaN(scanDate.getTime())) {
                    return scanDate;
                }
            }
        }
    } catch (e) {}
    return new Date(); // Fallback to current time if unparsable
}

/**
 * 🛰️ Universal Level 3 Radial Decoder
 */
export async function decodeLevel3(rawBuffer, stationMeta = null) {
    const startTime = performance.now();
    const rawBytes = new Uint8Array(rawBuffer);
    const rawView = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);

    // 🌟 Extract exact scan time from raw file headers before decompression
    const scanTimestamp = extractRadarTimestamp(rawBytes, rawView);

    const dataBytes = decompressLevel3Payload(rawBuffer);
    const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);

    // 1. Locate Radial Data Packet Header
    let packetPos = -1;
    let packetCode = 0;

    // Check standard offset 16 first
    if (dataBytes.length >= 30) {
        const codeAt16 = view.getUint16(16, false);
        if (codeAt16 === 0xAF1F || codeAt16 === 0x0010 || codeAt16 === 16 || codeAt16 === 0x001C || codeAt16 === 28) {
            packetPos = 16;
            packetCode = codeAt16;
        }
    }

    // Fallback: Scan every byte offset for packet code
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

    // 2. Read Packet Header
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
        maxRangeMeters = 460000.0; // 1840 bins * 250m = 460km
    } else if (numBins <= 230) {
        maxRangeMeters = 230000.0; // 230 bins * 1000m = 230km
    } else if (numBins === 460) {
        maxRangeMeters = 230000.0; // 460 bins * 500m = 230km
    } else {
        maxRangeMeters = 230000.0;
    }

    const TARGET_RADIALS = 720;
    const radarGrid = new Uint8Array(TARGET_RADIALS * numBins);
    const filledRays = new Uint8Array(TARGET_RADIALS);

    // 3. Unpack Radials (Handles both 4-Bit RLE Packet AF1F & 8-Bit Raw Packet 16/28)
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
            // === 4-Bit Run-Length Encoded Nibbles ===
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
            // === 8-Bit Digital Raw Radial Array ===
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

    // 4. Fill Missing Rays by Interpolating Adjacent Neighbors
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
        timestamp: scanTimestamp // 🌟 Exact scan observation time!
    };
}
