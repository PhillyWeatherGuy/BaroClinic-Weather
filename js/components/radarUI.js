// js/components/radarUI.js
import { radarState, buildRadarTimeline, purgeRadarMemory } from '../core/radarLoader.js';

let radarMapInstance = null;
let radarPlayInterval = null;
let isRadarPlaying = false;
let currentVisibleIndex = -1;
const RADAR_PLAYBACK_SPEED_MS = 220; // Smooth Doppler Loop speed

/**
 * 🌟 1. Launch Real-Time IEM Radar on Map (With Style Guard)
 */
export async function initRadarMode(mapInstance) {
    if (!mapInstance) return;

    // 🛑 CRUCIAL: If basemap style is still loading, wait so we don't place radar on top of basemap!
    if (!mapInstance.isStyleLoaded()) {
        mapInstance.once('load', () => initRadarMode(mapInstance));
        return;
    }

    radarMapInstance = mapInstance;

    // 1. Build 12-frame real-time timeline
    const frames = buildRadarTimeline();
    const liveIndex = frames.length - 1;
    currentVisibleIndex = liveIndex;

    // 2. Find layer to place radar under (boundaries, county lines, text labels)
    let firstOverlayId = null;
    const style = mapInstance.getStyle();
    const layers = style?.layers || [];
    for (const layer of layers) {
        const id = layer.id.toLowerCase();
        const type = layer.type;
        if (type === 'symbol' || (type === 'line' && id !== 'water_outline' && id !== 'waterway') || id.includes('admin') || id.includes('boundary') || id.includes('border') || id.includes('road')) {
            firstOverlayId = layer.id;
            break;
        }
    }

    // 3. Add IEM tile sources and layers (Locked UNDER basemap overlay)
    frames.forEach((frame) => {
        const sourceId = `iem-radar-src-${frame.index}`;
        const layerId = `iem-radar-layer-${frame.index}`;

        if (!mapInstance.getSource(sourceId)) {
            mapInstance.addSource(sourceId, {
                type: 'raster',
                tiles: [frame.tileUrl],
                tileSize: 256
            });
        }

        if (!mapInstance.getLayer(layerId)) {
            mapInstance.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                layout: {
                    'visibility': 'visible'
                },
                paint: {
                    'raster-opacity': (frame.index === liveIndex) ? 1.0 : 0.0,
                    'raster-fade-duration': 0,
                    'raster-opacity-transition': { duration: 0, delay: 0 },
                    'raster-resampling': 'linear'
                }
            }, firstOverlayId); // 👈 Always inserted UNDER firstOverlayId
        }
    });

    syncRadarTimelineUI();
    setRadarFrame(liveIndex);
    bindRadarControls();
}

/**
 * 🌟 2. Instant Zero-Blink GPU Frame Swapping
 */
export function setRadarFrame(frameIndex) {
    if (!radarState.frames || frameIndex < 0 || frameIndex >= radarState.frames.length) return;

    const prevIndex = currentVisibleIndex;
    currentVisibleIndex = frameIndex;
    radarState.activeFrameIndex = frameIndex;
    const frameInfo = radarState.frames[frameIndex];

    if (radarMapInstance) {
        const newLayerId = `iem-radar-layer-${frameIndex}`;

        // 1. Turn ON new frame
        if (radarMapInstance.getLayer(newLayerId)) {
            radarMapInstance.setPaintProperty(newLayerId, 'raster-opacity', 1.0);
        }

        // 2. Turn OFF previous frame (instant swap)
        if (prevIndex >= 0 && prevIndex !== frameIndex) {
            const prevLayerId = `iem-radar-layer-${prevIndex}`;
            if (radarMapInstance.getLayer(prevLayerId)) {
                radarMapInstance.setPaintProperty(prevLayerId, 'raster-opacity', 0.0);
            }
        }
    }

    // Update Slider Value
    const slider = document.getElementById('timeline-slider');
    if (slider) slider.value = frameIndex.toString();

    // Update Time Label & App Clock
    const timeLabel = document.getElementById('time-label');
    if (timeLabel && frameInfo) {
        timeLabel.textContent = frameInfo.label;
    }

    const appClock = document.getElementById('app-clock');
    if (appClock && frameInfo?.date) {
        appClock.textContent = frameInfo.date.toLocaleTimeString([], {
            weekday: 'short',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short'
        });
    }

    updateRadarSliderTrack();
}

/**
 * 🌟 3. Playback Controller
 */
export function toggleRadarPlayback() {
    if (isRadarPlaying) pauseRadarPlayback();
    else startRadarPlayback();
}

export function startRadarPlayback() {
    if (!radarState.frames || radarState.frames.length <= 1) return;

    isRadarPlaying = true;
    updateRadarPlayPauseUI();

    if (radarPlayInterval) clearInterval(radarPlayInterval);

    radarPlayInterval = setInterval(() => {
        let nextIdx = radarState.activeFrameIndex + 1;
        if (nextIdx >= radarState.frames.length) {
            nextIdx = 0; // Loop back to oldest
        }
        setRadarFrame(nextIdx);
    }, RADAR_PLAYBACK_SPEED_MS);
}

export function pauseRadarPlayback() {
    isRadarPlaying = false;
    if (radarPlayInterval) {
        clearInterval(radarPlayInterval);
        radarPlayInterval = null;
    }
    updateRadarPlayPauseUI();
}

function updateRadarPlayPauseUI() {
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    if (playIcon && pauseIcon) {
        playIcon.style.display = isRadarPlaying ? 'none' : 'block';
        pauseIcon.style.display = isRadarPlaying ? 'block' : 'none';
    }
}

/**
 * 🌟 4. UI Slider Binding
 */
function syncRadarTimelineUI() {
    const slider = document.getElementById('timeline-slider');
    const stepsCount = radarState.frames.length;
    if (!slider || stepsCount === 0) return;

    slider.min = '0';
    slider.max = (stepsCount - 1).toString();
    slider.value = radarState.activeFrameIndex.toString();

    const runLabel = document.getElementById('current-run-label');
    if (runLabel) runLabel.textContent = 'Live Loop (1h)';

    updateRadarSliderTrack();
}

function updateRadarSliderTrack() {
    const slider = document.getElementById('timeline-slider');
    if (!slider || !radarState.frames || radarState.frames.length === 0) return;

    const total = radarState.frames.length - 1;
    const current = radarState.activeFrameIndex;
    const percent = total > 0 ? (current / total) * 100 : 0;

    slider.style.background = `linear-gradient(to right, 
        rgba(56, 189, 248, 0.6) 0%, 
        rgba(56, 189, 248, 0.6) ${percent}%, 
        rgba(255, 255, 255, 0.15) ${percent}%, 
        rgba(255, 255, 255, 0.15) 100%)`;
}

function bindRadarControls() {
    const slider = document.getElementById('timeline-slider');
    const playBtn = document.getElementById('btn-play');
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');

    if (slider) {
        slider.oninput = (e) => {
            if (isRadarPlaying) pauseRadarPlayback();
            setRadarFrame(parseInt(e.target.value, 10));
        };
    }

    if (playBtn) playBtn.onclick = toggleRadarPlayback;

    if (prevBtn) {
        prevBtn.onclick = () => {
            if (isRadarPlaying) pauseRadarPlayback();
            let prevIdx = radarState.activeFrameIndex - 1;
            if (prevIdx < 0) prevIdx = radarState.frames.length - 1;
            setRadarFrame(prevIdx);
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            if (isRadarPlaying) pauseRadarPlayback();
            let nextIdx = radarState.activeFrameIndex + 1;
            if (nextIdx >= radarState.frames.length) nextIdx = 0;
            setRadarFrame(nextIdx);
        };
    }
}

/**
 * 🌟 5. Teardown Radar Mode
 */
export function destroyRadarMode(mapInstance) {
    pauseRadarPlayback();
    currentVisibleIndex = -1;

    if (mapInstance && radarState.frames) {
        radarState.frames.forEach((frame) => {
            const layerId = `iem-radar-layer-${frame.index}`;
            const sourceId = `iem-radar-src-${frame.index}`;
            try {
                if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
                if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId);
            } catch (e) {}
        });
    }

    purgeRadarMemory();
    radarMapInstance = null;
}
