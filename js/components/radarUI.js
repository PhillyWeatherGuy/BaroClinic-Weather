// js/components/radarUI.js
import { 
    radarState, 
    buildRadarTimeline, 
    loadRadarBitmap, 
    preloadAllRadarFrames, 
    purgeRadarMemory 
} from '../core/radarLoader.js';
import { createRadarShaderLayer } from '../shaders/radarShader.js';
import { 
    WXTOOLS_PALETTE_256, 
    RADARSCOPE_PRO_PALETTE_256, 
    NWS_CLASSIC_PALETTE_256 
} from '../config/radarPalettes.js';

let radarShaderLayer = null;
let radarPlayInterval = null;
let isRadarPlaying = false;
const RADAR_PLAYBACK_SPEED_MS = 160; // 160ms per frame = smooth 2-hour loop

/**
 * 🌟 1. Launch Radar Mode & Initialize Map Layers
 */
export async function initRadarMode(mapInstance) {
    if (!mapInstance) return;

    // 1. Build 2-hour live timeline (24 frames)
    const frames = buildRadarTimeline(24);
    const liveIndex = frames.length - 1;

    // 2. Create and attach WebGL Radar Shader Layer
    if (mapInstance.getLayer('radar-gpu-shader')) {
        mapInstance.removeLayer('radar-gpu-shader');
    }
    if (radarShaderLayer) {
        radarShaderLayer.clearTextures();
        radarShaderLayer = null;
    }

    radarShaderLayer = createRadarShaderLayer(mapInstance);

    // Place radar under boundary lines, county lines, and text labels
    let firstOverlayId = null;
    const layers = mapInstance.getStyle().layers || [];
    for (const layer of layers) {
        const id = layer.id.toLowerCase();
        const type = layer.type;
        if (type === 'symbol' || type === 'line' || id.includes('admin') || id.includes('boundary') || id.includes('border') || id.includes('road')) {
            firstOverlayId = layer.id;
            break;
        }
    }

    if (!mapInstance.getLayer('radar-gpu-shader')) {
        mapInstance.addLayer(radarShaderLayer, firstOverlayId);
    }

    // 3. Load and display LIVE scan immediately
    try {
        const liveBitmap = await loadRadarBitmap(liveIndex, radarState.loadGeneration);
        radarShaderLayer.preloadRadarTexture(liveIndex, liveBitmap);
        syncRadarTimelineUI();
        setRadarFrame(liveIndex);
    } catch (err) {
        console.warn("Could not load initial live radar frame:", err);
    }

    // 4. Preload remaining 23 historical frames in background
    preloadAllRadarFrames((idx, bitmap) => {
        if (radarShaderLayer) {
            radarShaderLayer.preloadRadarTexture(idx, bitmap);
        }
        updateRadarSliderTrack();
    });

    bindRadarControls();
}

/**
 * 🌟 2. Set Active Radar Frame & Update UI
 */
export async function setRadarFrame(frameIndex) {
    if (!radarState.frames || frameIndex < 0 || frameIndex >= radarState.frames.length) return;

    radarState.activeFrameIndex = frameIndex;
    const frameInfo = radarState.frames[frameIndex];

    // If bitmap not in GPU texture yet, load it on demand
    if (!radarShaderLayer?.frameTextures[frameIndex]) {
        try {
            const bitmap = await loadRadarBitmap(frameIndex, radarState.loadGeneration);
            if (radarShaderLayer) {
                radarShaderLayer.preloadRadarTexture(frameIndex, bitmap);
            }
        } catch (e) {
            return;
        }
    }

    if (radarShaderLayer) {
        radarShaderLayer.updateFrame(frameIndex);
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
 * 🌟 3. Timeline Playback Controller (Looping)
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
 * 🌟 4. Sync Slider and Control Buttons
 */
function syncRadarTimelineUI() {
    const slider = document.getElementById('timeline-slider');
    const stepsCount = radarState.frames.length;
    if (!slider || stepsCount === 0) return;

    slider.min = '0';
    slider.max = (stepsCount - 1).toString();
    slider.value = radarState.activeFrameIndex.toString();

    const runLabel = document.getElementById('current-run-label');
    if (runLabel) runLabel.textContent = 'Live Loop (2h)';

    updateRadarSliderTrack();
}

function updateRadarSliderTrack() {
    const slider = document.getElementById('timeline-slider');
    if (!slider || !radarState.frames || radarState.frames.length === 0) return;

    const total = radarState.frames.length - 1;
    const loadedCount = Object.keys(radarState.loadedBitmaps).length;
    const percent = total > 0 ? (loadedCount / total) * 100 : 0;

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
 * 🌟 5. Dynamic Colormap Palette Switcher
 */
export function setRadarPalette(presetName = 'wxtools') {
    if (!radarShaderLayer) return;

    if (presetName === 'nws') {
        radarShaderLayer.updatePalette(NWS_CLASSIC_PALETTE_256);
    } else if (presetName === 'radarscope') {
        radarShaderLayer.updatePalette(RADARSCOPE_PRO_PALETTE_256);
    } else {
        radarShaderLayer.updatePalette(WXTOOLS_PALETTE_256);
    }
}

/**
 * 🌟 6. Teardown Radar Mode
 */
export function destroyRadarMode(mapInstance) {
    pauseRadarPlayback();

    if (mapInstance && mapInstance.getLayer('radar-gpu-shader')) {
        try { mapInstance.removeLayer('radar-gpu-shader'); } catch (e) {}
    }

    purgeRadarMemory(radarShaderLayer);
    radarShaderLayer = null;
}
