// js/core/radarLoader.js

/**
 * 🛰️ Nationwide Radar State & Memory Store
 */
export const radarState = {
    frames: [],          // Array of 24 frame objects: [{ index, url, time, label }]
    loadedBitmaps: {},   // In-memory cache of decoded ImageBitmaps: { [index]: ImageBitmap }
    activeFrameIndex: 0,
    // 🌟 Full CONUS Bounding Box: [West, South, East, North]
    bounds: [-126.0, 24.0, -66.0, 50.0],
    loadGeneration: 0,
    isPreloading: false
};

const TOTAL_RADAR_FRAMES = 24;

/**
 * 🌟 1. Build the Live Real-Time Radar Timeline
 */
export function buildRadarTimeline(numFrames = TOTAL_RADAR_FRAMES) {
    const now = new Date();
    const frames = [];

    for (let i = 0; i < numFrames; i++) {
        const frameOffsetIndex = numFrames - 1 - i;
        const frameDate = new Date(now.getTime() - frameOffsetIndex * 5 * 60 * 1000);

        const timeStr = frameDate.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
        });

        const label = (frameOffsetIndex === 0) ? 'LIVE' : timeStr;
        const url = `https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_${frameOffsetIndex}.png`;

        frames.push({
            index: i,
            offsetIndex: frameOffsetIndex,
            date: frameDate,
            label: label,
            url: url
        });
    }

    radarState.frames = frames;
    radarState.activeFrameIndex = frames.length - 1;
    return frames;
}

/**
 * 🌟 2. Fast Raw dBZ Decoder
 * Converts IEM N0Q composite colors back into true 0..255 physical dBZ scalar values
 */
async function decodeIemRadarToScalar(blob) {
    const imgBitmap = await createImageBitmap(blob);
    const w = imgBitmap.width;
    const h = imgBitmap.height;

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgBitmap, 0, 0);
    imgBitmap.close();

    const imgData = ctx.getImageData(0, 0, w, h);
    const rgba = imgData.data;
    const totalPixels = w * h;

    const scalarBuffer = new ArrayBuffer(totalPixels * 4);
    const scalar32 = new Uint32Array(scalarBuffer);

    for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        const a = rgba[idx + 3];

        if (a < 10) {
            scalar32[i] = 0x00000000; // Transparent
            continue;
        }

        const r = rgba[idx];
        const g = rgba[idx + 1];
        const b = rgba[idx + 2];

        // Approximate physical dBZ scalar from NWS/IEM RGB palette (-30 dBZ to +75 dBZ -> byte 0 to 255)
        let dbzByte = 0;

        if (r > 200 && g > 200 && b > 200) {
            dbzByte = 240; // White (75+ dBZ)
        } else if (r > 150 && b > 150 && g < 100) {
            dbzByte = 210 + Math.round((r / 255) * 25); // Purple / Magenta (60-70 dBZ)
        } else if (r > 180 && g < 80 && b < 80) {
            dbzByte = 175 + Math.round((r / 255) * 30); // Red (50-60 dBZ)
        } else if (r > 200 && g > 100 && b < 50) {
            dbzByte = 145 + Math.round((r / 255) * 25); // Orange (40-50 dBZ)
        } else if (r > 200 && g > 200 && b < 50) {
            dbzByte = 125 + Math.round((g / 255) * 15); // Yellow (35-40 dBZ)
        } else if (g > 100 && r < 100 && b < 100) {
            dbzByte = 75 + Math.round((g / 255) * 45);  // Green (20-35 dBZ)
        } else if (b > 100 && r < 120) {
            dbzByte = 35 + Math.round((b / 255) * 35);  // Blue / Teal / Cyan (5-20 dBZ)
        } else {
            dbzByte = Math.max(r, Math.max(g, b));
        }

        scalar32[i] = 0xFF000000 | (dbzByte << 16) | (dbzByte << 8) | dbzByte;
    }

    const processedData = new ImageData(new Uint8ClampedArray(scalarBuffer), w, h);
    return await createImageBitmap(processedData);
}

/**
 * 🌟 3. Load & Decode Radar Frame
 */
export async function loadRadarBitmap(frameIndex, currentGen = null) {
    if (currentGen !== null && currentGen !== radarState.loadGeneration) {
        throw new Error("Radar load cancelled");
    }

    if (radarState.loadedBitmaps[frameIndex]) {
        return radarState.loadedBitmaps[frameIndex];
    }

    const frameInfo = radarState.frames[frameIndex];
    if (!frameInfo) throw new Error(`Radar frame index ${frameIndex} not found`);

    const cacheBusterUrl = `${frameInfo.url}?t=${Date.now()}`;
    const resp = await fetch(cacheBusterUrl);
    if (!resp.ok) throw new Error(`Failed to load radar frame ${frameIndex}: HTTP ${resp.status}`);

    if (currentGen !== null && currentGen !== radarState.loadGeneration) {
        throw new Error("Radar load cancelled");
    }

    const blob = await resp.blob();
    const scalarBitmap = await decodeIemRadarToScalar(blob);

    if (currentGen !== null && currentGen !== radarState.loadGeneration) {
        scalarBitmap.close();
        throw new Error("Radar load cancelled");
    }

    radarState.loadedBitmaps[frameIndex] = scalarBitmap;
    return scalarBitmap;
}

/**
 * 🌟 4. Background Preloader (Past 2 Hours @ 60 FPS)
 */
export async function preloadAllRadarFrames(onFrameLoaded = null) {
    const thisGen = radarState.loadGeneration;
    radarState.isPreloading = true;

    for (let i = radarState.frames.length - 1; i >= 0; i--) {
        if (thisGen !== radarState.loadGeneration) break;

        if (!radarState.loadedBitmaps[i]) {
            try {
                const bitmap = await loadRadarBitmap(i, thisGen);
                if (thisGen === radarState.loadGeneration && typeof onFrameLoaded === 'function') {
                    onFrameLoaded(i, bitmap);
                }
                await new Promise(r => setTimeout(r, 40));
            } catch (err) {
                if (err.message !== "Radar load cancelled") {
                    console.warn(`Skipped radar frame ${i}:`, err);
                }
            }
        }
    }

    radarState.isPreloading = false;
}

/**
 * 🌟 5. Memory Purge
 */
export function purgeRadarMemory(shaderRef = null) {
    radarState.loadGeneration++;
    radarState.isPreloading = false;

    for (const key in radarState.loadedBitmaps) {
        const bmp = radarState.loadedBitmaps[key];
        if (bmp && typeof bmp.close === 'function') {
            bmp.close();
        }
    }
    radarState.loadedBitmaps = {};

    if (shaderRef && typeof shaderRef.clearTextures === 'function') {
        shaderRef.clearTextures();
    }

    radarState.frames = [];
    radarState.activeFrameIndex = 0;
}
