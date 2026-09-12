// js/core/radarLoader.js

export const radarState = {
    frames: [],          // [{ index, tag, label, date, tileUrl }]
    activeFrameIndex: 0,
    isPlaying: false,
    mode: 'live',        // 'live' | 'archive'
    archiveDate: null
};

const MINUTE_OFFSETS = [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];

/**
 * 🌟 1. Build the Radar Timeline (Supports Live OR Historical Archive)
 */
export function buildRadarTimeline(startUtcDate = null) {
    const frames = [];

    if (!startUtcDate) {
        // --- REAL-TIME LIVE 1-HOUR LOOP ---
        radarState.mode = 'live';
        radarState.archiveDate = null;
        const now = new Date();

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
    } else {
        // --- HISTORICAL ARCHIVE 1-HOUR LOOP (12 frames, 5-min intervals) ---
        radarState.mode = 'archive';
        radarState.archiveDate = new Date(startUtcDate.getTime());

        for (let i = 0; i < 12; i++) {
            const frameDate = new Date(startUtcDate.getTime() + i * 5 * 60 * 1000);

            const yyyy = frameDate.getUTCFullYear();
            const mm = String(frameDate.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(frameDate.getUTCDate()).padStart(2, '0');
            const hh = String(frameDate.getUTCHours()).padStart(2, '0');
            const mi = String(Math.floor(frameDate.getUTCMinutes() / 5) * 5).padStart(2, '0');

            const timestampStr = `${yyyy}${mm}${dd}${hh}${mi}`;
            const label = `+${i * 5}m`;

            // Official IEM Archived National Mosaic tile endpoint
            const tileUrl = `https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0Q-${timestampStr}/{z}/{x}/{y}.png`;

            frames.push({
                index: i,
                minsAgo: null,
                tag: timestampStr,
                label: label,
                date: frameDate,
                tileUrl: tileUrl
            });
        }

        radarState.frames = frames;
        radarState.activeFrameIndex = 0; // Default to start of archive hour
    }

    return frames;
}

/**
 * 🌟 2. Purge Radar State
 */
export function purgeRadarMemory() {
    radarState.frames = [];
    radarState.activeFrameIndex = 0;
    radarState.isPlaying = false;
    radarState.mode = 'live';
    radarState.archiveDate = null;
}
