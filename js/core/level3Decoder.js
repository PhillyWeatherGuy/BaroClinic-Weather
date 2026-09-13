// js/core/level3Decoder.js
import { unzlibSync, inflateSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import seekBzip from 'https://cdn.jsdelivr.net/npm/seek-bzip@1.0.6/+esm';

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
 * 🛰️ Helper to Extract Exact Scan Date from NEXRAD Message Header
 */
function extractScanDate(buffer) {
    try {
        const view = new DataView(buffer);
        const searchLen = Math.min(buffer.byteLength, 512);
        
        for (let i = 0; i < searchLen - 8; i++) {
            const msgCode = view.getUint16(i, false);
            if (msgCode > 0 && msgCode < 200) {
                const julianDays = view.getUint16(i + 2, false);
                const secondsSinceMidnight = view.getUint32(i + 4, false);
                
                if (julianDays > 19000 && julianDays < 35000 && secondsSinceMidnight < 86400) {
                    const unixMs = (julianDays - 1) * 86400000 + (secondsSinceMidnight * 1000);
                    return new Date(unixMs);
                }
            }
        }
    } catch (e) {}
    return null;
}

/**
 * 🛰️ Decompresses Level 3 payload (BZIP2, ZLIB, GZIP, Raw)
 */
function decompressLevel3Payload(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let bestOut = bytes;
    let maxLen = 0;

    // 1. Scan for BZIP2 Header ('B', 'Z', 'h')
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
 * 🛰️ Universal Level 3 Radial Decoder (Supports Packet 16, 28, and AF1F)
 */
export async function decodeLevel3(rawBuffer, stationMeta = null) {
    const startTime = performance.now();
    
    let scanDate = extractScanDate(rawBuffer);
    const dataBytes = decompressLevel3Payload(rawBuffer);
    const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);

    if (!scanDate) {
        scanDate = extractScanDate(dataBytes.buffer) || new Date(); 
    }

    // 1. Locate Radial Data Packet Header (Supports Packet 16, 28, AF1F)
    let packetPos = -1;
    let packetCode = 0;

    for (let offset = 0; offset <= dataBytes.length - 16; offset++) {
        const code = view.getUint16(offset, false);
        // Packet 16 (0x0010), Packet 28 (0x001C), Packet AF1F (0xAF1F)
        if (code === 0xAF1F || code === 0x0010 || code === 16 || code === 0x001C || code === 28) {
            // For Packet 28, check component layout
            if (code === 0x001C || code === 28) {
                const numComp = view.getUint16(offset + 8, false);
                const binsTest = view.getUint16(offset + 14, false);
                const radsTest = view.getUint16(offset + 22, false);
                if (numComp > 0 && binsTest >= 20 && binsTest <= 4000 && radsTest >= 50 && radsTest <= 800) {
                    packetPos = offset;
                    packetCode = code;
                    break;
                }
            } else {
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

    // 2. Read Packet Header (Differentiating Packet 28 vs 16/AF1F)
    let numBins = 0;
    let rangeScaleFactor = 0;
    let numRadialsInFile = 0;
    let pos = 0;

    if (packetCode === 0x001C || packetCode === 28) {
        // === Packet 28 Header Layout ===
        const numComponents = view.getUint16(packetPos + 8, false);
        pos = packetPos + 10;
        // Read first component header
        const compType = view.getUint16(pos, false);
        const compLen = view.getUint32(pos + 2, false);
        numBins = view.getUint16(pos + 6, false);
        const firstBin = view.getUint16(pos + 8, false);
        const iCenter = view.getInt16(pos + 10, false);
        const jCenter = view.getInt16(pos + 12, false);
        rangeScaleFactor = view.getUint16(pos + 14, false);
        numRadialsInFile = view.getUint16(pos + 16, false);
        pos += 18; // Start of radials in Packet 28
    } else {
        // === Packet 16 & AF1F Header Layout ===
        const firstBin = view.getUint16(packetPos + 2, false);
        numBins = view.getUint16(packetPos + 4, false);
        const iCenter = view.getInt16(packetPos + 6, false);
        const jCenter = view.getInt16(packetPos + 8, false);
        rangeScaleFactor = view.getUint16(packetPos + 10, false);
        numRadialsInFile = view.getUint16(packetPos + 12, false);
        pos = packetPos + 14;
    }

    let maxRangeMeters = 230000.0;
    if (numBins >= 1000) {
        maxRangeMeters = 460000.0;
    } else if (numBins === 460 || numBins <= 230) {
        maxRangeMeters = 230000.0;
    } else {
        maxRangeMeters = 230000.0;
    }

    const TARGET_RADIALS = 720;
    const radarGrid = new Uint8Array(TARGET_RADIALS * numBins);
    const filledRays = new Uint8Array(TARGET_RADIALS);

    // 3. Unpack Radials
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
            // === 8-Bit Digital Raw Radial Array (Packet 16 & Packet 28) ===
            const copyLength = Math.min(numUnits, numBins);
            const rawSlice = dataBytes.subarray(pos, pos + copyLength);
            for (let k = 0; k < copyLength; k++) {
                const val = rawSlice[k];
                radarGrid[targetOffset + k] = val < 75 ? 0 : val; // Clutter filter
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

    // 4. Fill Missing Rays
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
    console.log(`⚡ [Decoder] Unpacked Level 3 (${stationMeta?.id || 'RADAR'} [0x${packetCode.toString(16).toUpperCase()}]): ${numRadialsInFile} radials × ${numBins} gates in ${elapsed}ms`);

    return {
        stationId: stationMeta?.id || "RADAR",
        lat: stationMeta?.lat || 0.0,
        lon: stationMeta?.lon || 0.0,
        numRadials: TARGET_RADIALS,
        numBins: numBins,
        maxRangeMeters: maxRangeMeters,
        scanDate: scanDate,
        data: radarGrid
    };
}
