// js/core/radarLoader.js

export const radarState = {
    frames: [],          // [{ index, tag, label, date, tileUrl }]
    activeFrameIndex: 0,
    isPlaying: false,
    mode: 'live',        // 'live' | 'archive'
    archiveDate: null,
    durationHours: 1     // 1, 2, 3, 6, 12, 24
};

const MINUTE_OFFSETS_1H = [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];

/**
 * 🌟 1. Build the Radar Timeline (Supports Live Loop OR 1h–24h Archive Loops)
 */
export function buildRadarTimeline(startUtcDate = null, durationHours = 1) {
    const frames = [];
    radarState.durationHours = durationHours;

    if (!startUtcDate) {
        // --- REAL-TIME LIVE 1-HOUR LOOP ---
        radarState.mode = 'live';
        radarState.archiveDate = null;
        
        // 🌟 Snap to the latest exact 5-minute radar volume scan bucket (accounting for ~4 min processing delay)
        const rawNow = new Date();
        const delayedNow = new Date(rawNow.getTime() - 4 * 60 * 1000);
        const snappedMinutes = Math.floor(delayedNow.getUTCMinutes() / 5) * 5;
        
        const snappedNow = new Date(Date.UTC(
            delayedNow.getUTCFullYear(),
            delayedNow.getUTCMonth(),
            delayedNow.getUTCDate(),
            delayedNow.getUTCHours(),
            snappedMinutes,
            0
        ));

        MINUTE_OFFSETS_1H.forEach((minsAgo, idx) => {
            const frameDate = new Date(snappedNow.getTime() - minsAgo * 60 * 1000);
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
        // --- HISTORICAL ARCHIVE LOOP (1 to 24 Hours) ---
        radarState.mode = 'archive';
        radarState.archiveDate = new Date(startUtcDate.getTime());

        // Determine frame count & time step based on duration
        let totalFrames = 12;
        let stepMinutes = 5;

        if (durationHours === 2) {
            totalFrames = 24;
            stepMinutes = 5;
        } else if (durationHours === 3) {
            totalFrames = 36;
            stepMinutes = 5;
        } else if (durationHours === 6) {
            totalFrames = 36;
            stepMinutes = 10;
        } else if (durationHours === 12) {
            totalFrames = 48;
            stepMinutes = 15;
        } else if (durationHours === 24) {
            totalFrames = 48;
            stepMinutes = 30;
        }

        for (let i = 0; i < totalFrames; i++) {
            const frameDate = new Date(startUtcDate.getTime() + i * stepMinutes * 60 * 1000);

            const yyyy = frameDate.getUTCFullYear();
            const mm = String(frameDate.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(frameDate.getUTCDate()).padStart(2, '0');
            const hh = String(frameDate.getUTCHours()).padStart(2, '0');
            const mi = String(Math.floor(frameDate.getUTCMinutes() / 5) * 5).padStart(2, '0');

            const timestampStr = `${yyyy}${mm}${dd}${hh}${mi}`;
            
            const totalMins = i * stepMinutes;
            const h = Math.floor(totalMins / 60);
            const m = totalMins % 60;
            const label = h > 0 ? `+${h}h${m > 0 ? ` ${m}m` : ''}` : `+${m}m`;

            const tileUrl = `https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0Q-${timestampStr}/{z}/{x}/{y}.png`;

            frames.push({
                index: i,
                minsAgo: null,
                tag: timestampStr,
                label: i === 0 ? 'START' : label,
                date: frameDate,
                tileUrl: tileUrl
            });
        }

        radarState.frames = frames;
        radarState.activeFrameIndex = 0; // Default to start of archive window
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
    radarState.durationHours = 1;
}
