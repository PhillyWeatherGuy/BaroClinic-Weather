// js/core/level3Decoder.js
import { unzlibSync, inflateSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';

/**
 * 🌟 16-Level Reflectivity RLE Byte Map (0..15 -> 0..255 for radarPalettes.js)
 */
const LEVEL_16_TO_BYTE = new Uint8Array([
    0,   // Level 0: Below threshold / Clear air (transparent)
    40,  // Level 1: ~5 dBZ
    60,  // Level 2: ~10 dBZ
    80,  // Level 3: ~15 dBZ
    100, // Level 4: ~20 dBZ
    120, // Level 5: ~25 dBZ
    140, // Level 6: ~30 dBZ
    160, // Level 7: ~35 dBZ
    175, // Level 8: ~40 dBZ
    190, // Level 9: ~45 dBZ
    205, // Level 10: ~50 dBZ
    220, // Level 11: ~55 dBZ
    235, // Level 12: ~60 dBZ
    245, // Level 13: ~65 dBZ
    252, // Level 14: ~70 dBZ
    255  // Level 15: ~75+ dBZ
]);

/**
 * 🛰️ Decompresses Level 3 payload by scanning every possible byte offset
 */
function decompressLevel3Payload(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);

    // 1. Direct GZIP (0x1F, 0x8B)
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        try {
            const out = unzlibSync(bytes);
            if (out && out.length > 500) return out;
        } catch (e) {}
    }

    // 2. Scan every byte from offset 0 to 512 for ZLIB Header (0x78)
    for (let offset = 0; offset <= Math.min(bytes.length - 2, 512); offset++) {
        if (bytes[offset] === 0x78) {
            try {
                const sub = bytes.subarray(offset);
                const out = unzlibSync(sub);
                if (out && out.length > 500) {
                    return out;
                }
            } catch (e) {}
        }
    }

    // 3. Scan every byte from offset 0 to 512 for Raw Deflate stream without 0x78 header
    for (let offset = 0; offset <= Math.min(bytes.length - 2, 512); offset++) {
        try {
            const sub = bytes.subarray(offset);
            const out = inflateSync(sub);
            if (out && out.length > 500) {
                return out;
            }
        } catch (e) {}
    }

    // If already uncompressed, return raw bytes
    return bytes;
}

/**
 * 🛰️ Universal Level 3 Radial Decoder (Supports Packet 16, 28, and 0xAF1F RLE)
 */
export async function decodeLevel3(rawBuffer, stationMeta = null) {
    const startTime = performance.now();
    const dataBytes = decompressLevel3Payload(rawBuffer);
    const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);

    // 1. Scan for the Radial Data Packet Header across all byte boundaries
    let packetPos = -1;
    let packetCode = 0;

    for (let offset = 0; offset <= dataBytes.length - 16; offset += 2) {
        const code = view.getUint16(offset, false);
        if (code === 0xAF1F || code === 0x0010 || code === 16 || code === 0x001C || code === 28) {
            const numBins = view.getUint16(offset + 4, false);
            const numRadials = view.getUint16(offset + 12, false);

            // Validate standard NEXRAD gate count (20..4000) & radial count (50..800)
            if (numBins >= 20 && numBins <= 4000 && numRadials >= 50 && numRadials <= 800) {
                packetPos = offset;
                packetCode = code;
                break;
            }
        }
    }

    if (packetPos === -1) {
        throw new Error(`Invalid Level 3 file: Symbology packet not found (decompressed: ${dataBytes.length} bytes)`);
    }

    // 2. Read Packet Header
    const firstBin = view.getUint16(packetPos + 2, false);
    const numBins = view.getUint16(packetPos + 4, false);
    const iCenter = view.getInt16(packetPos + 6, false);
    const jCenter = view.getInt16(packetPos + 8, false);
    const rangeScaleFactor = view.getUint16(packetPos + 10, false);
    const numRadialsInFile = view.getUint16(packetPos + 12, false);

    const gateSizeMeters = rangeScaleFactor > 0 ? rangeScaleFactor : (packetCode === 0xAF1F ? 1000 : 250);
    const maxRangeMeters = numBins * gateSizeMeters;

    const TARGET_RADIALS = 720;
    const radarGrid = new Uint8Array(TARGET_RADIALS * numBins);
    const filledRays = new Uint8Array(TARGET_RADIALS);

    let pos = packetPos + 14;

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
            const rleBytesCount = (numUnits * 2) - 6; // numUnits is halfwords in radial
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
            radarGrid.set(dataBytes.subarray(pos, pos + copyLength), targetOffset);
            pos += numUnits;
        }

        filledRays[rayIndex] = 1;

        // If data was 360 radials (1.0° beams), duplicate to next 0.5° slot for smooth 720-ray circle
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
    console.log(`⚡ [Decoder] Unpacked Level 3 (${stationMeta?.id || 'RADAR'} [0x${packetCode.toString(16).toUpperCase()}]): ${numRadialsInFile} radials × ${numBins} gates in ${elapsed}ms`);

    return {
        stationId: stationMeta?.id || "RADAR",
        lat: stationMeta?.lat || 0.0,
        lon: stationMeta?.lon || 0.0,
        numRadials: TARGET_RADIALS,
        numBins: numBins,
        gateSizeMeters: gateSizeMeters,
        maxRangeMeters: maxRangeMeters,
        data: radarGrid
    };
}
