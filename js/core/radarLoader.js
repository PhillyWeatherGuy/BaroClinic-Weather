// js/core/radarLoader.js

export const radarState = {
    frames: [],          // [{ index, tag, label, date, tileUrl }]
    activeFrameIndex: 0,
    isPlaying: false
};

// 5-minute steps from 120 minutes ago down to 0 (25 frames)
const MINUTE_OFFSETS = Array.from({ length: 25 }, (_, i) => 120 - (i * 5));

/**
 * Helper to convert a Date object into IEM's required UTC timestamp (YYYYMMDDHHmm)
 * floored to the nearest 5-minute scan interval.
 */
function getIemUtcTimestamp(date) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const min = String(Math.floor(date.getUTCMinutes() / 5) * 5).padStart(2, '0');

    return `${yyyy}${mm}${dd}${hh}${min}`;
}

/**
 * 🌟 1. Build the Live IEM NEXRAD 25-Frame Loop (120 Minutes)
 */
export function buildRadarTimeline() {
    const now = new Date();
    const frames = [];

    MINUTE_OFFSETS.forEach((minsAgo, idx) => {
        const frameDate = new Date(now.getTime() - minsAgo * 60 * 1000);
        let tag;

        if (minsAgo === 0) {
            tag = '900913'; // Current live layer shortcut
        } else if (minsAgo <= 50) {
            // IEM relative cache shortcuts work up to -m50m
            tag = `900913-m${String(minsAgo).padStart(2, '0')}m`;
        } else {
            // Frames > 50 minutes ago require explicit UTC timestamps (YYYYMMDDHHmm)
            tag = `900913-${getIemUtcTimestamp(frameDate)}`;
        }

        const label = minsAgo === 0 ? 'LIVE' : `-${minsAgo}m`;
        const tileUrl = `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-${tag}/{z}/{x}/{y}.png`;

        frames.push({
            index: idx,
            minsAgo: minsAgo,
            tag: tag,
            label: label,
            date: frameDate,
            tileUrl: tileUrl
        });
    });

    radarState.frames = frames;
    radarState.activeFrameIndex = frames.length - 1; // Default to LIVE frame
    return frames;
}

/**
 * 🌟 2. Purge Radar State
 */
export function purgeRadarMemory() {
    radarState.frames = [];
    radarState.activeFrameIndex = 0;
    radarState.isPlaying = false;
}
