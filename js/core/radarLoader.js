// js/core/radarLoader.js

export const radarState = {
    host: 'https://tilecache.rainviewer.com',
    frames: [],          // [{ time, path, label, date }]
    activeFrameIndex: 0,
    activeSourceId: null,
    loadGeneration: 0
};

/**
 * 🌟 1. Fetch Real-Time Radar Timestamps from RainViewer API
 */
export async function fetchLiveRadarTimeline() {
    const resp = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!resp.ok) throw new Error(`RainViewer API error: ${resp.status}`);

    const data = await resp.json();
    radarState.host = data.host || 'https://tilecache.rainviewer.com';

    const pastFrames = data.radar?.past || [];
    const nowcastFrames = data.radar?.nowcast || [];
    const allFrames = [...pastFrames, ...nowcastFrames];

    if (allFrames.length === 0) {
        throw new Error("No live radar frames available");
    }

    radarState.frames = allFrames.map((f, idx) => {
        const frameDate = new Date(f.time * 1000);
        const timeStr = frameDate.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
        });

        const isLive = (idx === pastFrames.length - 1);
        const isFuture = (idx >= pastFrames.length);

        let label = timeStr;
        if (isLive) label = 'LIVE';
        else if (isFuture) label = `+${(idx - pastFrames.length + 1) * 10}m`;

        return {
            index: idx,
            time: f.time,
            path: f.path,
            date: frameDate,
            label: label,
            isLive: isLive
        };
    });

    // Default to the LIVE frame
    radarState.activeFrameIndex = Math.max(0, pastFrames.length - 1);
    return radarState.frames;
}

/**
 * 🌟 2. Get Tile URL for a Specific Radar Frame
 */
export function getRadarTileUrl(frameIndex, colorScheme = 4) {
    const frame = radarState.frames[frameIndex];
    if (!frame) return null;

    // High-def 512px smoothed tiles with snow/rain separation
    return `${radarState.host}${frame.path}/512/{z}/{x}/{y}/${colorScheme}/1_1.png`;
}

/**
 * 🌟 3. Clean Memory Purge on Exit
 */
export function purgeRadarMemory() {
    radarState.loadGeneration++;
    radarState.frames = [];
    radarState.activeFrameIndex = 0;
    radarState.activeSourceId = null;
}
