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

const TOTAL_RADAR_FRAMES = 24; // 24 frames @ 5-min intervals = Past 2 Hours of Radar

/**
 * 🌟 1. Build the Live Real-Time Radar Timeline
 * Creates timestamps from 2 hours ago up to the current LIVE scan
 */
export function buildRadarTimeline(numFrames = TOTAL_RADAR_FRAMES) {
    const now = new Date();
    const frames = [];

    for (let i = 0; i < numFrames; i++) {
        // Frames from oldest (i = 0, e.g. -115 mins) to newest (i = 23, LIVE)
        const frameOffsetIndex = numFrames - 1 - i;
        const frameDate = new Date(now.getTime() - frameOffsetIndex * 5 * 60 * 1000);

        // Format time string (e.g. "2:45 PM")
        const timeStr = frameDate.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
        });

        const label = (frameOffsetIndex === 0) ? 'LIVE' : timeStr;

        // NOAA / IEM Composite URL (n0q_0 is live, n0q_1 is -5m, etc.)
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
    radarState.activeFrameIndex = frames.length - 1; // Default to LIVE frame
    return frames;
}

/**
 * 🌟 2. Load and Decode a Single Radar Frame Bitmap
 */
export async function loadRadarBitmap(frameIndex, currentGen = null) {
    if (currentGen !== null && currentGen !== radarState.loadGeneration) {
        throw new Error("Radar load cancelled");
    }

    // Return instant memory cache if already loaded
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
    const bitmap = await createImageBitmap(blob);

    if (currentGen !== null && currentGen !== radarState.loadGeneration) {
        bitmap.close();
        throw new Error("Radar load cancelled");
    }

    radarState.loadedBitmaps[frameIndex] = bitmap;
    return bitmap;
}

/**
 * 🌟 3. Preload all 24 Radar Frames in Background for 60 FPS Looping
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
                // Small 30ms yield to keep UI responsive
                await new Promise(r => setTimeout(r, 30));
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
 * 🌟 4. Completely Purge Radar Memory on View Exit
 */
export function purgeRadarMemory(shaderRef = null) {
    radarState.loadGeneration++;
    radarState.isPreloading = false;

    // Explicitly close all GPU ImageBitmaps to free RAM
    for (const key in radarState.loadedBitmaps) {
        const bmp = radarState.loadedBitmaps[key];
        if (bmp && typeof bmp.close === 'function') {
            bmp.close();
        }
    }
    radarState.loadedBitmaps = {};

    // Clear WebGL shader textures if reference provided
    if (shaderRef && typeof shaderRef.clearTextures === 'function') {
        shaderRef.clearTextures();
    }

    radarState.frames = [];
    radarState.activeFrameIndex = 0;
}
