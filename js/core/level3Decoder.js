// js/core/level3Decoder.js

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

    // 1. Check GZIP (0x1F, 0x8B)
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const out = await tryDecompress(bytes, 'gzip');
        if (out) return out;
    }

    // 2. Check ZLIB from byte 0 (0x78)
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

    // Return raw uncompressed bytes if already unpacked
    return bytes;
}

/**
 * 🛰️ Unpacks a Level 3 binary buffer into a 720 x RangeBins matrix
 */
export async function decodeLevel3(rawBuffer, stationMeta = null) {
    const startTime = performance.now();
    const dataBytes = await decompressLevel3Payload(rawBuffer);
    const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);

    // 1. Locate Radial Packet Header (Packet 16 / 0x0010, Packet 28 / 0x001C, or Symbology divider)
    let packetPos = -1;

    // Scan for Symbology divider (-1 / 0xFFFF)
    for (let i = 0; i < Math.min(dataBytes.length - 20, 1024); i += 2) {
        if (view.getInt16(i, false) === -1) {
            const blockId = view.getInt16(i + 2, false);
            if (blockId === 1) { // Symbology Block
                packetPos = i + 16;
                break;
            }
        }
    }

    // Fallback: Scan directly for Packet 16 (0x0010) structure
    if (packetPos === -1) {
        for (let i = 0; i < Math.min(dataBytes.length - 20, 2048); i += 2) {
            const code = view.getUint16(i, false);
            if (code === 16 || code === 0x0010) {
                const numBins = view.getUint16(i + 4, false);
                const numRadials = view.getUint16(i + 12, false);
                if (numBins >= 100 && numBins <= 4000 && (numRadials === 720 || numRadials === 360)) {
                    packetPos = i;
                    break;
                }
            }
        }
    }

    if (packetPos === -1) {
        throw new Error(`Invalid Level 3 file: Radial packet not found (decompressed size: ${dataBytes.length} bytes)`);
    }

    // 2. Read Packet Header
    const firstBin = view.getUint16(packetPos + 2, false);
    const numBins = view.getUint16(packetPos + 4, false);
    const iCenter = view.getInt16(packetPos + 6, false);
    const jCenter = view.getInt16(packetPos + 8, false);
    const rangeScaleFactor = view.getUint16(packetPos + 10, false);
    const numRadialsInFile = view.getUint16(packetPos + 12, false);

    const gateSizeMeters = rangeScaleFactor > 0 ? rangeScaleFactor : 250;
    const maxRangeMeters = numBins * gateSizeMeters;

    // 3. Build 720 Azimuth Grid (0.5° rays)
    const TARGET_RADIALS = 720;
    const radarGrid = new Uint8Array(TARGET_RADIALS * numBins);
    const filledRays = new Uint8Array(TARGET_RADIALS);

    let pos = packetPos + 14;

    for (let r = 0; r < numRadialsInFile; r++) {
        if (pos + 6 > dataBytes.length) break;

        const numBytesInRadial = view.getUint16(pos, false);
        const startAngleTenths = view.getUint16(pos + 2, false);
        const angleDeltaTenths = view.getUint16(pos + 4, false);
        pos += 6;

        const azimuthDeg = startAngleTenths / 10.0;
        const rayIndex = Math.min(TARGET_RADIALS - 1, Math.max(0, Math.round(azimuthDeg * 2) % TARGET_RADIALS));

        const copyLength = Math.min(numBytesInRadial, numBins);
        const targetOffset = rayIndex * numBins;

        radarGrid.set(dataBytes.subarray(pos, pos + copyLength), targetOffset);
        filledRays[rayIndex] = 1;

        pos += numBytesInRadial;
    }

    // 4. Fill missing rays
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
    console.log(`⚡ [Decoder] Unpacked Level 3 (${stationMeta?.id || 'RADAR'}): ${numRadialsInFile} radials × ${numBins} gates in ${elapsed}ms`);

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
