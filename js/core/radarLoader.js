// js/core/radarLoader.js

/**
 * 🛰️ IEM Real-Time Radar State & Frame Store
 */
export const radarState = {
    frames: [],          // Array of 24 frames: [{ index, url, date, label }]
    loadedImages: {},    // In-memory cache of loaded Image elements
    activeFrameIndex: 23,
    // 🌟 Full CONUS Bounding Box: [West, South, East, North]
    bounds: [-126.0, 24.0, -66.0, 50.0],
    loadGeneration: 0,
    isPreloading: false
};

const TOTAL_RADAR_FRAMES = 24; // 24 frames @ 5-minute intervals = Past 2 Hours of Radar

/**
 * 🌟 1. Build the Live IEM 2-Hour Timeline
 */
export function buildRadarTimeline(numFrames = TOTAL_RADAR_FRAMES) {
    const now = new Date();
    const frames = [];

    // Align to latest 5-minute block
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

        // IEM Raw 8-bit Composite N0Q Endpoint
        const url = `https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_${offsetIndex}.png`;

        frames.push({
            index: i,
            offsetIndex: offsetIndex,
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
 * 🌟 2. Load Single IEM Frame via CORS-Safe Image Loader
 */
export function loadRadarImage(frameIndex, currentGen = null) {
    return new Promise((resolve, reject) => {
        if (currentGen !== null && currentGen !== radarState.loadGeneration) {
            return reject(new Error("Radar load cancelled"));
        }

        // Return instant cache if already loaded
        if (radarState.loadedImages[frameIndex]) {
            return resolve(radarState.loadedImages[frameIndex]);
        }

        const frameInfo = radarState.frames[frameIndex];
        if (!frameInfo) return reject(new Error(`Frame ${frameIndex} not found`));

        const img = new Image();
        img.crossOrigin = "anonymous";

        img.onload = () => {
            if (currentGen !== null && currentGen !== radarState.loadGeneration) {
                return reject(new Error("Radar load cancelled"));
            }
            radarState.loadedImages[frameIndex] = img;
            resolve(img);
        };

        img.onerror = (err) => {
            reject(new Error(`Failed to load IEM radar asset: ${frameInfo.url}`));
        };

        // Cache-buster to guarantee real-time scans
        img.src = `${frameInfo.url}?t=${Date.now()}`;
    });
}

/**
 * 🌟 3. Preload all 24 Radar Frames for Smooth Looping
 */
export async function preloadAllRadarFrames(onFrameLoaded = null) {
    const thisGen = radarState.loadGeneration;
    radarState.isPreloading = true;

    for (let i = radarState.frames.length - 1; i >= 0; i--) {
        if (thisGen !== radarState.loadGeneration) break;

        if (!radarState.loadedImages[i]) {
            try {
                const img = await loadRadarImage(i, thisGen);
                if (thisGen === radarState.loadGeneration && typeof onFrameLoaded === 'function') {
                    onFrameLoaded(i, img);
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

    // Clear Image cache
    radarState.loadedImages = {};

    if (shaderRef && typeof shaderRef.clearTextures === 'function') {
        shaderRef.clearTextures();
    }

    radarState.frames = [];
    radarState.activeFrameIndex = 0;
}
