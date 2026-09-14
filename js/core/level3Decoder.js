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
 * 🛰️ Parses NEXRAD Level 3 Message Header & Product Description Block (PDB)
 * Extracts scan date, radar coords, and dynamic float32 Scale/Offset factors.
 */
function parseLevel3Header(data) {
    if (!data) return null;
    try {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const searchLen = Math.min(bytes.byteLength, 1024);

        for (let i = 0; i <= searchLen - 68; i++) {
            const msgCode = view.getUint16(i, false);

            // Valid NEXRAD Level 3 product codes (e.g., 94, 138, 153, 170, 172)
            if (msgCode > 0 && msgCode < 300) {
                const julianDays = view.getUint16(i + 2, false);
                const secondsSinceMidnight = view.getUint32(i + 4, false);
                const divider = view.getInt16(i + 18, false);
                const pdbCode = view.getInt16(i + 30, false);

                // Strict validation: Julian days, 24h seconds, PDB divider (-1), matching product codes
                if (
                    julianDays >= 10000 && julianDays < 40000 &&
                    secondsSinceMidnight <= 86400 &&
                    divider === -1 &&
                    pdbCode === msgCode
                ) {
                    const unixMs = (julianDays - 1) * 86400000 + (secondsSinceMidnight * 1000);
                    const scanDate = new Date(unixMs);
                    const lat = view.getInt32(i + 20, false) / 1000.0;
                    const lon = view.getInt32(i + 24, false) / 1000.0;
                    const heightFeet = view.getInt16(i + 28, false);

                    let scale = null;
                    let offset = null;

                    // Dual-Pol products (DAA: 170, DTA: 172, DU3: 173, DOD: 174, DSD: 175, DPR: 176, ZDR: 159, CC: 161, KDP: 163)
                    // Halfwords 31-32 (bytes 60..63) = Scale (Float32)
                    // Halfwords 33-34 (bytes 64..67) = Offset (Float32)
                    if ([159, 161, 163, 170, 172, 173, 174, 175, 176].includes(msgCode)) {
                        scale = view.getFloat32(i + 60, false);
                        offset = view.getFloat32(i + 64, false);
                    } else if (msgCode === 138) {
                        // DSP: Legacy Digital Storm Total
                        const hw31 = view.getInt16(i + 60, false);
                        const hw32 = view.getInt16(i + 62, false);
                        offset = hw31 / 100.0;
                        scale = hw32 > 0 ? (100.0 / hw32) : null;
                    }

                    return {
                        msgCode,
                        scanDate,
                        lat,
                        lon,
                        heightFeet,
                        scale: Number.isFinite(scale) ? scale : null,
                        offset: Number.isFinite(offset) ? offset : null
                    };
                }
            }
        }
    } catch (e) {
        console.warn("Could not parse Level 3 message header", e);
    }
    return null;
}

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
 * 🛰️ Universal Level 3 Radial Decoder
 */
export async function decodeLevel3(rawBuffer, stationMeta = null) {
    const startTime = performance.now();

    const dataBytes = decompressLevel3Payload(rawBuffer);
    const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);

    // 🌟 Extract Real Header, Timestamp, Coords, and Dynamic Scaling Factors
    const headerInfo = parseLevel3Header(rawBuffer) || parseLevel3Header(dataBytes);
    const scanDate = headerInfo?.scanDate || new Date();

    // Identify product type for selective filtering
    const prod = (stationMeta?.product || 'N0B').toUpperCase();
    const isReflectivity = prod === 'N0B' || prod === 'N0Q' || prod === 'REF';

    // 1. Locate Radial Data Packet Header
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

    // 🌟 CORRECT NEXRAD RANGE CALCULATION PER PRODUCT
    let maxRangeMeters = 230000.0;
    if (numBins >= 1400) {
        maxRangeMeters = 460000.0; // 1840 bins * 250m = 460km (N0B Super-Res Refl)
    } else if (numBins >= 1000) {
        maxRangeMeters = 300000.0; // 1200 bins * 250m = 300km (N0U / N0G Super-Res Velocity)
    } else {
        maxRangeMeters = 230000.0; // 230km (DAA / DTA / Legacy Products)
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
                const byteVal = isReflectivity 
                    ? (LEVEL_16_TO_BYTE[level] || 0)
                    : (level === 0 ? 0 : Math.round((level / 15) * 255));

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
                if (isReflectivity) {
                    // Filter out clear-air ground clutter below 15 dBZ (byte 75 in 8-bit space)
                    radarGrid[targetOffset + k] = val < 75 ? 0 : val;
                } else {
                    // Velocity & Accumulation: keep all valid bytes (0 = no signal, 1 = RF / Flag)
                    radarGrid[targetOffset + k] = val;
                }
            }
            pos += numUnits;
        }

        filledRays[rayIndex] = 1;

        // Duplicate 360 radials (1.0° beams) into adjacent 0.5° slots for smooth circle
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
    console.log(`⚡ [Decoder] Unpacked Level 3 (${stationMeta?.id || 'RADAR'} [${prod} - 0x${packetCode.toString(16).toUpperCase()}]): ${numRadialsInFile} radials × ${numBins} gates (Scale: ${headerInfo?.scale}, Offset: ${headerInfo?.offset}) in ${elapsed}ms`);

    return {
        stationId: stationMeta?.id || "RADAR",
        product: prod,
        lat: stationMeta?.lat || headerInfo?.lat || 0.0,
        lon: stationMeta?.lon || headerInfo?.lon || 0.0,
        numRadials: TARGET_RADIALS,
        numBins: numBins,
        maxRangeMeters: maxRangeMeters,
        scanDate: scanDate,
        scale: headerInfo?.scale ?? null,
        offset: headerInfo?.offset ?? null,
        data: radarGrid
    };
}

/**
 * 🌟 Samples raw byte from single-site radial memory at any geographic (lng, lat)
 */
export function sampleRadarSweep(lng, lat, sweep) {
    if (!sweep || !sweep.data || !sweep.lat || !sweep.lon) return null;

    const EARTH_RADIUS = 6371000.0;
    const dLngRad = (lng - sweep.lon) * (Math.PI / 180.0);
    const dLatRad = (lat - sweep.lat) * (Math.PI / 180.0);
    const avgLatRad = ((lat + sweep.lat) * 0.5) * (Math.PI / 180.0);

    const dx = dLngRad * EARTH_RADIUS * Math.cos(avgLatRad);
    const dy = dLatRad * EARTH_RADIUS;
    const r = Math.hypot(dx, dy);

    if (r > sweep.maxRangeMeters || r < 1000.0) return null;

    let azimuthRad = Math.atan2(dx, dy);
    if (azimuthRad < 0.0) azimuthRad += Math.PI * 2;

    const normAzimuth = azimuthRad / (Math.PI * 2);
    const rayIndex = Math.floor(normAzimuth * sweep.numRadials) % sweep.numRadials;
    const normRange = r / sweep.maxRangeMeters;
    const binIndex = Math.floor(normRange * sweep.numBins);

    if (binIndex < 0 || binIndex >= sweep.numBins) return null;

    return sweep.data[rayIndex * sweep.numBins + binIndex];
}

/**
 * 🌟 Converts raw 8-bit radar gate byte to human-readable physical meteorological quantity.
 * Supports passing either:
 *   formatRadarValue(rawByte, sweep)
 *   formatRadarValue(rawByte, productCode, scale, offset)
 */
export function formatRadarValue(rawByte, productOrSweep, optScale = null, optOffset = null) {
    if (rawByte === undefined || rawByte === null || rawByte === 0) return null;

    let productCode = productOrSweep;
    let scale = optScale;
    let offset = optOffset;

    if (typeof productOrSweep === 'object' && productOrSweep !== null) {
        productCode = productOrSweep.product;
        scale = productOrSweep.scale;
        offset = productOrSweep.offset;
    }

    const p = (productCode || 'N0B').toUpperCase();

    // 1. Super-Res Velocity (N0U / N0G)
    if (p === 'N0U' || p === 'N0G' || p === 'VEL' || p.includes('VEL')) {
        if (rawByte === 1) return 'RF'; // Range Folded
        const mph = Math.round((rawByte - 129) * 1.11847);
        return (mph > 0 ? `+${mph}` : `${mph}`) + ' MPH';
    }

    // 2. Correlation Coefficient (N0C / CC / RHO)
    if (p === 'N0C' || p === 'CC' || p === 'RHO') {
        if (rawByte <= 1) return null;
        if (scale !== null && scale > 0) {
            const cc = (rawByte - (offset ?? 0)) / scale;
            return cc.toFixed(3) + ' ρHV';
        }
        const cc = ((rawByte - 2) / 253.0) * 1.05;
        return cc.toFixed(2) + ' ρHV';
    }

    // 3. Precipitation Accumulations (DAA, DTA, DU3/DUA, DSP)
    const isPrecip = ['DAA', 'DTA', 'DSP', 'DU3', 'DUA', 'OHA', 'STA', 'TOTAL', '1HR', '3HR'].includes(p);
    if (isPrecip) {
        // Must have legitimate scaling factor from the PDB
        if (scale === null || scale === undefined || scale <= 0) {
            console.warn(`[formatRadarValue] Missing genuine PDB scale factor for ${p}. Value cannot be verified.`);
            return null;
        }

        // NOAA ROC Equation: F = (N - OFFSET) / SCALE [F is in units of 0.01 inches]
        const hundredthsOfInches = (rawByte - (offset ?? 0)) / scale;
        const inches = hundredthsOfInches * 0.01;

        if (inches <= 0) return null;
        return `${inches.toFixed(2)} in`;
    }

    // 4. Default: Base Reflectivity (dBZ)
    const dbz = Math.round((rawByte - 2) * 0.5 - 32.0);
    return `${dbz} dBZ`;
}
