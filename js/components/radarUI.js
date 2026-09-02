// js/components/radarUI.js
import { 
    radarState, 
    fetchLiveRadarTimeline, 
    getRadarTileUrl, 
    purgeRadarMemory 
} from '../core/radarLoader.js';

let radarPlayInterval = null;
let isRadarPlaying = false;
let currentMap = null;
const RADAR_PLAYBACK_SPEED_MS = 500; // 500ms per frame for a smooth loop

/**
 * 🌟 1. Launch Live Radar on MapLibre
 */
export async function initRadarMode(mapInstance) {
    if (!mapInstance) return;
    currentMap = mapInstance;

    // 1. Fetch live radar frames from open API
    const frames = await fetchLiveRadarTimeline();
    const liveIndex = radarState.activeFrameIndex;

    // 2. Remove any old radar layers
    cleanupRadarLayers();

    // 3. Find first border/label layer to place radar underneath
    const firstOverlayId = getFirstOverlayId();

    // 4. Add all radar frame tile sources to MapLibre for instant 0ms switching
    frames.forEach((frame) => {
        const sourceId = `radar-src-${frame.index}`;
        const layerId = `radar-lyr-${frame.index}`;

        if (!mapInstance.getSource(sourceId)) {
            mapInstance.addSource(sourceId, {
                type: 'raster',
                tiles: [getRadarTileUrl(frame.index, 4)],
                tileSize: 512
            });

            mapInstance.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: {
                    'raster-opacity': (frame.index === liveIndex) ? 0.85 : 0,
                    'raster-fade-duration': 150
                }
            }, firstOverlayId);
        }
    });

    syncRadarTimelineUI();
    setRadarFrame(liveIndex);
    bindRadarControls();
}

/**
 * 🌟 2. Set Active Radar Frame (Instant 0ms Layer Opacity Toggle)
 */
export function setRadarFrame(frameIndex) {
    if (!currentMap || !radarState.frames || frameIndex < 0 || frameIndex >= radarState.frames.length) return;

    radarState.activeFrameIndex = frameIndex;
    const frameInfo = radarState.frames[frameIndex];

    // Show active frame layer, hide all other frames
    radarState.frames.forEach((f) => {
        const layerId = `radar-lyr-${f.index}`;
        if (currentMap.getLayer(layerId)) {
            currentMap.setPaintProperty(
                layerId, 
                'raster-opacity', 
                (f.index === frameIndex) ? 0.85 : 0
            );
        }
    });

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
            nextIdx = 0; // Loop back to oldest frame
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
 * 🌟 4. UI Bindings
 */
function syncRadarTimelineUI() {
    const slider = document.getElementById('timeline-slider');
    const stepsCount = radarState.frames.length;
    if (!slider || stepsCount === 0) return;

    slider.min = '0';
    slider.max = (stepsCount - 1).toString();
    slider.value = radarState.activeFrameIndex.toString();

    const runLabel = document.getElementById('current-run-label');
    if (runLabel) runLabel.textContent = 'Live Radar Loop';

    updateRadarSliderTrack();
}

function updateRadarSliderTrack() {
    const slider = document.getElementById('timeline-slider');
    if (!slider || !radarState.frames || radarState.frames.length === 0) return;

    const total = radarState.frames.length - 1;
    const percent = total > 0 ? (radarState.activeFrameIndex / total) * 100 : 0;

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

function getFirstOverlayId() {
    if (!currentMap) return null;
    let firstOverlayId = null;
    const layers = currentMap.getStyle().layers || [];
    for (const layer of layers) {
        const id = layer.id.toLowerCase();
        const type = layer.type;
        if (type === 'symbol' || (type === 'line' && id !== 'waterway') || id.includes('admin') || id.includes('boundary') || id.includes('border') || id.includes('road')) {
            firstOverlayId = layer.id;
            break;
        }
    }
    return firstOverlayId;
}

function cleanupRadarLayers() {
    if (!currentMap) return;
    const layers = currentMap.getStyle()?.layers || [];
    layers.forEach(l => {
        if (l.id.startsWith('radar-lyr-')) {
            try { currentMap.removeLayer(l.id); } catch(e) {}
        }
    });
    for (let i = 0; i < 40; i++) {
        const sourceId = `radar-src-${i}`;
        if (currentMap.getSource(sourceId)) {
            try { currentMap.removeSource(sourceId); } catch(e) {}
        }
    }
}

/**
 * 🌟 5. Teardown
 */
export function destroyRadarMode(mapInstance) {
    pauseRadarPlayback();
    cleanupRadarLayers();
    purgeRadarMemory();
    currentMap = null;
}
