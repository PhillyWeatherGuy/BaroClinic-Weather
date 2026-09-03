// js/core/radarLoader.js

export const radarState = {
    frames: [],          // [{ index, tag, label, date, tileUrl }]
    activeFrameIndex: 0,
    isPlaying: false
};

const MINUTE_OFFSETS = [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];

/**
 * 🌟 1. Build the Live IEM NEXRAD 12-Frame Loop
 */
export function buildRadarTimeline() {
    const now = new Date();
    const frames = [];

    MINUTE_OFFSETS.forEach((minsAgo, idx) => {
        const frameDate = new Date(now.getTime() - minsAgo * 60 * 1000);
        const tag = minsAgo === 0 ? '900913' : `900913-m${String(minsAgo).padStart(2, '0')}m`;
        const label = minsAgo === 0 ? 'LIVE' : `-${minsAgo}m`;

        // Official IEM High-Speed Tile Service
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
