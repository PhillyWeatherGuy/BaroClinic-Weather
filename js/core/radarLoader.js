// js/core/radarLoader.js

export const radarState = {
    frames: [],          // [{ index, tag, label, date, tileUrl, tiles }]
    activeFrameIndex: 0,
    isPlaying: false
};

const MINUTE_OFFSETS = [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];
// 🌟 Official IEM DNS aliases to bypass the browser's 6-connection limit per domain
const IEM_HOSTS = ['mesonet1', 'mesonet2', 'mesonet3', 'www'];

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

        // Distribute frames across IEM host aliases to prevent connection throttling on desktop
        const host = IEM_HOSTS[idx % IEM_HOSTS.length];
        const tileUrl = `https://${host}.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-${tag}/{z}/{x}/{y}.png`;
        const tiles = IEM_HOSTS.map(h => `https://${h}.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-${tag}/{z}/{x}/{y}.png`);

        frames.push({
            index: idx,
            minsAgo: minsAgo,
            tag: tag,
            label: label,
            date: frameDate,
            tileUrl: tileUrl,
            tiles: tiles
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
