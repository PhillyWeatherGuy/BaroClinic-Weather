// js/core/level3Decoder.js

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
 * 🛰️ Decompress a Level 3 binary buffer with stream error isolation
 */
async function decompressLevel3Payload(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);

    const tryDecompress = async (subArray, format) => {
        try {
            const ds = new DecompressionStream(format);
            const writer = ds.writable.getWriter();
            writer.write(subArray);
            writer.close();
            const res = new Response(ds.readable);
            const buf = await res.arrayBuffer();
            return new Uint8Array(buf);
        } catch (e) {
            return null;
        }
    };

    // 1. Direct GZIP (0x1F, 0x8B)
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const out = await tryDecompress(bytes, 'gzip');
        if (out) return out;
    }

    // 2. Direct ZLIB (0x78)
    if (bytes[0] === 0x78) {
        const out = await tryDecompress(bytes, 'deflate');
        if (out) return out;
    }

    // 3. Scan for ZLIB magic header (0x78 0x9C, 0x78 0xDA, 0x78 0x01, 0x78 0x5E)
    for (let offset = 0; offset <= Math.min(bytes.length - 2, 400); offset++) {
        if (bytes[offset] === 0x78 && [0x01, 0x20, 0x5e, 0x9c, 0xda, 0xbb].includes(bytes[offset + 1])) {
            const sub = bytes.subarray(offset);
            const out = await tryDecompress(sub, 'deflate');
            if (out && out.length > 50) return out;
        }
    }

    return bytes;
}

/**
 * 🛰️ Unpacks a Level 3 binary buffer (Packet 16 or Packet AF1F RLE) into a 720 x RangeBins matrix
 */
export async function decodeLevel3(rawBuffer, stationMeta = null) {
    const startTime = performance.now();
    const dataBytes = await decompressLevel3Payload(rawBuffer);
    const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);

    // 1. Locate Radial Packet Header (Packet 16 / 0x0010 or Packet AF1F / 0xAF1F)
    let packetPos = -1;
    let packetCode = 0;

    // A: Scan via Symbology divider (-1 / 0xFFFF)
    for (let i = 0; i < Math.min(dataBytes.length - 20, 1024); i += 2) {
        if (view.getInt16(i, false) === -1) {
            const blockId = view.getInt16(i + 2, false);
            if (blockId === 1) { // Symbology Block
                packetPos = i + 16;
                packetCode = view.getUint16(packetPos, false);
                break;
            }
        }
    }

    // B: Fallback scan directly for Packet Code signatures
    if (packetPos === -1 || (packetCode !== 0xAF1F && packetCode !== 0x0010 && packetCode !== 16 && packetCode !== 0x001C && packetCode !== 28)) {
        for (let i = 0; i < Math.min(dataBytes.length - 20, 2048); i += 2) {
            const code = view.getUint16(i, false);
            if (code === 0xAF1F || code === 0x0010 || code === 16 || code === 0x001C || code === 28) {
                const numBins = view.getUint16(i + 4, false);
                const numRadials = view.getUint16(i + 12, false);
                if (numBins >= 50 && numBins <= 4000 && numRadials >= 100 && numRadials <= 800) {
                    packetPos = i;
                    packetCode = code;
                    break;
                }
            }
        }
    }

    if (packetPos === -1) {
        throw new Error(`Invalid Level 3 file: Radial packet not found (decompressed: ${dataBytes.length} bytes)`);
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

    // 3. Unpack Radials (Handles both 4-Bit RLE Packet AF1F & 8-Bit Raw Packet 16)
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

        // If data was 360 radials (1.0° beams), duplicate to next 0.5° slot
        if (numRadialsInFile <= 360) {
            const nextSlot = (rayIndex + 1) % TARGET_RADIALS;
            radarGrid.set(radarGrid.subarray(targetOffset, targetOffset + numBins), nextSlot * numBins);
            filledRays[nextSlot] = 1;
        }
    }

    // 4. Fill Any Missing Rays by Interpolating Neighbors (Prevents black slits)
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
