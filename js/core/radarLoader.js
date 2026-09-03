// js/core/radarLoader.js

export const radarState = {
    frames: [],
    activeFrameIndex: 0,
    isPlaying: false
};

// 5-minute steps back to 120 minutes ago (25 frames)
const MINUTE_OFFSETS = Array.from({ length: 25 }, (_, i) => 120 - (i * 5));

/**
 * 🌟 Build IEM WMS Radar Loop (Supports 120+ minutes)
 */
export function buildRadarTimeline() {
    const now = new Date();
    const frames = [];

    MINUTE_OFFSETS.forEach((minsAgo, idx) => {
        // Floor to 5-minute intervals
        const frameTime = new Date(now.getTime() - minsAgo * 60 * 1000);
        frameTime.setUTCMinutes(Math.floor(frameTime.getUTCMinutes() / 5) * 5, 0, 0);

        const isoTime = frameTime.toISOString().substring(0, 19) + 'Z'; // e.g., "2026-09-02T21:05:00Z"
        const label = minsAgo === 0 ? 'LIVE' : `-${minsAgo}m`;

        // IEM WMS endpoint using TIME parameter
        const tileUrl = `https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=TRUE&LAYERS=nexrad-n0q-t&TIME=${isoTime}&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}`;

        frames.push({
            index: idx,
            minsAgo: minsAgo,
            label: label,
            date: frameTime,
            tileUrl: tileUrl
        });
    });

    radarState.frames = frames;
    radarState.activeFrameIndex = frames.length - 1;
    return frames;
}
