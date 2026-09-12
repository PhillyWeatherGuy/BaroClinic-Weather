// js/core/level3Decoder.js

/**
 * 🛰️ Decompress a raw Level 3 file buffer using the browser's native DecompressionStream.
 * Handles:
 *  - Full-file zlib/deflate
 *  - Gzip wrapped
 *  - 30-byte WMO header followed by compressed stream
 */
async function decompressLevel3Payload(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);

    // 1. Direct GZIP stream (0x1F, 0x8B)
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        try {
            const ds = new DecompressionStream('gzip');
            const stream = new Response(new Blob([bytes])).body.pipeThrough(ds);
            return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (e) {
            console.warn("[Decoder] Gzip decompression failed:", e);
        }
    }

    // 2. Direct ZLIB stream (0x78)
    if (bytes[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(bytes[1])) {
        try {
            const ds = new DecompressionStream('deflate');
            const stream = new Response(new Blob([bytes])).body.pipeThrough(ds);
            return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (e) {
            console.warn("[Decoder] Direct zlib decompression failed:", e);
        }
    }

    // 3. Scan for compressed payload offset (often begins after ~30 byte WMO header or 120 byte PDB)
    for (let offset = 20; offset <= 200; offset++) {
        if (bytes[offset] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(bytes[offset + 1])) {
            try {
                const sub = bytes.subarray(offset);
                const ds = new DecompressionStream('deflate');
                const stream = new Response(new Blob([sub])).body.pipeThrough(ds);
                return new Uint8Array(await new Response(stream).arrayBuffer());
            } catch (e) {
                // Keep scanning
            }
        }
    }

    // Return uncompressed raw bytes if already unpacked
    return bytes;
}

/**
 * 🛰️ Unpacks a Level 3 binary buffer into a 720 x RangeBins matrix
 * @param {ArrayBuffer} rawBuffer - The binary file from NOAA / S3 / TGFTP
 * @param {Object} stationMeta - Optional station info { lat, lon, id } from radarStations.js
 */
export async function decodeLevel3(rawBuffer, stationMeta = null) {
    const startTime = performance.now();
    const dataBytes = await decompressLevel3Payload(rawBuffer);
    const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);

    // 1. Find the Symbology Block Divider (-1 / 0xFFFF)
    let symbologyOffset = -1;
    for (let i = 0; i < Math.min(dataBytes.length - 14, 512); i += 2) {
        if (view.getInt16(i, false) === -1) {
            const blockId = view.getInt16(i + 2, false);
            if (blockId === 1) { // Symbology Block ID is always 1
                symbologyOffset = i;
                break;
            }
        }
    }

    if (symbologyOffset === -1) {
        throw new Error("Invalid Level 3 file: Symbology block header not found");
    }

    // 2. Symbology Block Header
    // Offset + 0: Divider (-1)
    // Offset + 2: Block ID (1)
    // Offset + 4: Block length (uint32)
    // Offset + 8: Num layers (uint16)
    // Offset + 10: Layer divider (-1)
    // Offset + 12: Layer length (uint32)
    let packetPos = symbologyOffset + 16;
    const packetCode = view.getUint16(packetPos, false);

    // Packet 16 (0x0010): Digital Radial Data Array Packet (N0B, N0Q)
    if (packetCode !== 16 && packetCode !== 0x0010) {
        throw new Error(`Unsupported Level 3 packet code: ${packetCode} (expected Packet 16)`);
    }

    // 3. Read Packet 16 Header
    const firstBin = view.getUint16(packetPos + 2, false);
    const numBins = view.getUint16(packetPos + 4, false);
    const iCenter = view.getInt16(packetPos + 6, false);
    const jCenter = view.getInt16(packetPos + 8, false);
    const rangeScaleFactor = view.getUint16(packetPos + 10, false); // in 0.001 km (250 = 250m)
    const numRadialsInFile = view.getUint16(packetPos + 12, false);  // typically 720 (0.5°) or 360 (1.0°)

    const gateSizeMeters = rangeScaleFactor > 0 ? rangeScaleFactor : 250;
    const maxRangeMeters = numBins * gateSizeMeters;

    // 4. Allocate 720 Azimuth Rays Grid (0.0° to 359.5° in 0.5° increments)
    const TARGET_RADIALS = 720;
    const radarGrid = new Uint8Array(TARGET_RADIALS * numBins);
    const filledRays = new Uint8Array(TARGET_RADIALS); // Ray tracking for gap filling

    let pos = packetPos + 14;

    for (let r = 0; r < numRadialsInFile; r++) {
        if (pos + 6 > dataBytes.length) break;

        const numBytesInRadial = view.getUint16(pos, false);
        const startAngleTenths = view.getUint16(pos + 2, false); // in 0.1 deg (e.g. 3501 -> 350.1°)
        const angleDeltaTenths = view.getUint16(pos + 4, false); // in 0.1 deg (e.g. 5 -> 0.5°)
        pos += 6;

        const azimuthDeg = startAngleTenths / 10.0;
        // Map azimuth (0..360) into 0..719 ray index
        const rayIndex = Math.min(TARGET_RADIALS - 1, Math.max(0, Math.round(azimuthDeg * 2) % TARGET_RADIALS));

        const copyLength = Math.min(numBytesInRadial, numBins);
        const targetOffset = rayIndex * numBins;

        radarGrid.set(dataBytes.subarray(pos, pos + copyLength), targetOffset);
        filledRays[rayIndex] = 1;

        pos += numBytesInRadial;
    }

    // 5. Fill Any Missing Rays by Copying Adjacent Rays (Prevents black seams)
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
    console.log(`⚡ [Decoder] Unpacked Level 3: ${numRadialsInFile} radials × ${numBins} gates in ${elapsed}ms`);

    return {
        stationId: stationMeta?.id || "RADAR",
        lat: stationMeta?.lat || 0.0,
        lon: stationMeta?.lon || 0.0,
        numRadials: TARGET_RADIALS,
        numBins: numBins,
        gateSizeMeters: gateSizeMeters,
        maxRangeMeters: maxRangeMeters,
        data: radarGrid // 1D array of 720 * numBins bytes
    };
}
