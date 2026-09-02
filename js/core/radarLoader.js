// js/core/radarLoader.js

/**
 * 🛰️ IEM Real-Time Radar State & Frame Store
 */
export const radarState = {
    frames: [],          // Array of 24 frames: [{ index, offsetIndex, date, label, url }]
    loadedBitmaps: {},   // In-memory cache of decoded ImageBitmaps
    activeFrameIndex: 23,
    bounds: [-126.0, 24.0, -66.0, 50.0], // Full CONUS Bounding Box
    loadGeneration: 0,
    isPreloading: false
};

const TOTAL_RADAR_FRAMES = 24; // 24 frames @ 5-minute intervals = Past 2 Hours

/**
 * 🌟 1. Build the Live IEM 2-Hour Timeline
 */
export function buildRadarTimeline(numFrames = TOTAL_RADAR_FRAMES) {
    const now = new Date();
    const frames = [];

    // Align to latest 5-minute interval
    const currentMins = now.getUTCMinutes();
    const roundedMins = Math.floor(currentMins / 5) * 5;
    const baseDate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        roundedMins,
        0
    ));

    for (let i = 0; i < numFrames; i++) {
        // Frame 0 is oldest (-115m), Frame 23 is LIVE (0m)
        const offsetIndex = numFrames - 1 - i;
        const frameDate = new Date(baseDate.getTime() - offsetIndex * 5 * 60 * 1000);

        const timeStr = frameDate.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
        });

        const label = (offsetIndex === 0) ? 'LIVE' : (offsetIndex <= 1 ? `-${offsetIndex * 5}m` : timeStr);

        // IEM Raw 8-bit Composite N0Q
        const rawUrl = `https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_${offsetIndex}.png`;

        frames.push({
            index: i,
            offsetIndex: offsetIndex,
            date: frameDate,
            label: label,
            url: rawUrl
        });
    }

    radarState.frames = frames;
    radarState.activeFrameIndex = frames.length - 1; // Default to LIVE
    return frames;
}

/**
 * 🌟 2. Load Single IEM Frame via CORS-Relay
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
    if (!frameInfo) throw new Error(`Frame ${frameIndex} not found`);

    // CORS-enabled proxy URLs
    const targetUrl = `${frameInfo.url}?t=${Date.now()}`;
    const proxyUrls = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
    ];

    let blob = null;

    // Try CORS relays
    for (const pUrl of proxyUrls) {
        try {
            const resp = await fetch(pUrl);
            if (resp.ok) {
                blob = await resp.blob();
                break;
            }
        } catch (e) {}
    }

    if (!blob) {
        throw new Error(`Failed to load IEM radar frame ${frameIndex}`);
    }

    if (currentGen !== null && currentGen !== radarState.loadGeneration) {
        throw new Error("Radar load cancelled");
    }

    const bitmap = await createImageBitmap(blob);

    if (currentGen !== null && currentGen !== radarState.loadGeneration) {
        bitmap.close();
        throw new Error("Radar load cancelled");
    }

    radarState.loadedBitmaps[frameIndex] = bitmap;
    return bitmap;
}

/**
 * 🌟 3. Preload all 24 Radar Frames for Smooth Looping
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
 * 🌟 4. Purge Radar State on Exit
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
