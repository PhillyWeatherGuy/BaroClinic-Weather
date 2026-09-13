// js/components/radarUI.js
import { radarState, buildRadarTimeline, purgeRadarMemory } from '../core/radarLoader.js';
import { setBasemapLabelsVisibility } from '../layers/cityOverlay.js';
import { getRadarStationsGeoJson } from '../config/radarStations.js';
import { decodeLevel3 } from '../core/level3Decoder.js';
import { createSingleSiteRadarLayer } from '../shaders/singleSiteRadarShader.js';
import { stateManager } from '../core/stateManager.js';
import { getRadarPalette } from '../config/radarPalettes.js';

let radarMapInstance = null;
let radarPlayInterval = null;
let isRadarPlaying = false;
let currentVisibleIndex = -1;
const RADAR_PLAYBACK_SPEED_MS = 220; // Smooth Doppler Loop speed

// 🌟 Radar Mode State ('composite' | 'local')
let activeRadarViewType = 'composite';

// 🌟 Single-Site Level 3 State
let singleSiteRadarLayer = null;
let activeStationId = null;
let activeStationLat = 0;
let activeStationLon = 0;
let singleSiteFrames = []; // Dynamically sized (12 to 48 frames)

// 🌟 Live Auto-Refresh (keeps the "LIVE" slot current without a full reload/flash)
let localRadarAutoRefreshInterval = null;
const LOCAL_RADAR_REFRESH_MS = 120000; // 2 minutes

// 🌟 Archive Calendar State
let archivePopoverEl = null;
let calendarViewDate = new Date();
let selectedDayForArchive = null;
let selectedDurationHours = 1; // 1, 2, 3, 6, 12, 24
let calendarViewMode = 'days'; // 'days' | 'months'

// 🌟 Top Radar Dropdown Elements & Station Popup
let radarModeMenuEl = null;
let radarParamMenuEl = null;
let stationHoverPopup = null;

const RADAR_PRODUCTS = [
    { id: 'N0B', name: 'Base Reflectivity (dBZ)' },
    { id: 'N0U', name: 'Base Velocity (MPH)' },
    { id: 'DAA', name: '1-Hour Precip (in)' },
    { id: 'N3P', name: '3-Hour Precip (in)' },
    { id: 'DTA', name: 'Storm Total Precip (in)' }
];

function ensureArchiveStyles() {
    if (document.getElementById('radar-archive-styles')) return;
    const style = document.createElement('style');
    style.id = 'radar-archive-styles';
    style.textContent = `
        .radar-archive-popover {
            position: absolute;
            bottom: calc(100% + 12px);
            left: 0;
            width: 290px;
            background: rgba(11, 15, 25, 0.96);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 14px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8);
            padding: 10px;
            z-index: 120;
            font-family: 'Rajdhani', sans-serif;
            color: #f8fafc;
            box-sizing: border-box;
        }
        .archive-live-btn {
            width: 100%;
            background: rgba(56, 189, 248, 0.18);
            border: 1px solid rgba(56, 189, 248, 0.5);
            color: #38bdf8;
            font-family: 'Rajdhani', sans-serif;
            font-weight: 700;
            font-size: 12px;
            letter-spacing: 0.5px;
            padding: 6px;
            border-radius: 8px;
            cursor: pointer;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s ease;
        }
        .archive-live-btn:hover {
            background: rgba(56, 189, 248, 0.35);
        }
        .duration-selector-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
            margin-bottom: 8px;
            background: rgba(255, 255, 255, 0.05);
            padding: 4px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .duration-label {
            font-size: 11px;
            font-weight: 700;
            color: #94a3b8;
            padding-left: 4px;
            text-transform: uppercase;
        }
        .duration-pills-group {
            display: flex;
            gap: 2px;
        }
        .duration-pill-btn {
            background: transparent;
            border: 1px solid transparent;
            color: #94a3b8;
            font-family: 'Rajdhani', sans-serif;
            font-weight: 700;
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .duration-pill-btn:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }
        .duration-pill-btn.active {
            background: rgba(56, 189, 248, 0.25);
            color: #38bdf8;
            border-color: rgba(56, 189, 248, 0.5);
            box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
        }
        .cal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
            padding: 0 4px;
        }
        .cal-title {
            font-weight: 700;
            font-size: 14px;
            color: #e2e8f0;
        }
        .cal-title-btn {
            background: transparent;
            border: 1px solid transparent;
            color: #e2e8f0;
            font-family: 'Rajdhani', sans-serif;
            font-weight: 700;
            font-size: 14px;
            cursor: pointer;
            padding: 2px 8px;
            border-radius: 6px;
            transition: all 0.15s ease;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .cal-title-btn:hover {
            color: #38bdf8;
            background: rgba(56, 189, 248, 0.15);
            border-color: rgba(56, 189, 248, 0.4);
        }
        .cal-nav-btn {
            background: transparent;
            border: none;
            color: #94a3b8;
            font-size: 16px;
            cursor: pointer;
            padding: 2px 8px;
            border-radius: 4px;
        }
        .cal-nav-btn:hover:not(:disabled) {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }
        .cal-nav-btn:disabled {
            opacity: 0.2;
            cursor: not-allowed;
        }
        .cal-weekdays {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            text-align: center;
            font-size: 11px;
            font-weight: 700;
            color: #64748b;
            margin-bottom: 4px;
        }
        .cal-days-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
        }
        .cal-day-btn {
            background: transparent;
            border: none;
            color: #cbd5e1;
            font-family: 'Rajdhani', sans-serif;
            font-size: 12px;
            font-weight: 600;
            aspect-ratio: 1;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s ease;
        }
        .cal-day-btn:hover:not(:disabled) {
            background: rgba(56, 189, 248, 0.2);
            color: #38bdf8;
        }
        .cal-day-btn.selected {
            background: #38bdf8 !important;
            color: #0b0f19 !important;
            font-weight: 700;
        }
        .cal-day-btn:disabled {
            opacity: 0.2;
            cursor: not-allowed;
        }
        .months-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            margin-top: 6px;
        }
        .month-chip-btn {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #cbd5e1;
            font-family: 'Rajdhani', sans-serif;
            font-weight: 700;
            font-size: 13px;
            padding: 8px 0;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .month-chip-btn:hover:not(:disabled) {
            background: rgba(56, 189, 248, 0.25);
            color: #38bdf8;
            border-color: rgba(56, 189, 248, 0.5);
        }
        .month-chip-btn.selected {
            background: #38bdf8 !important;
            color: #0b0f19 !important;
            font-weight: 700;
        }
        .month-chip-btn:disabled {
            opacity: 0.2;
            cursor: not-allowed;
        }
        .hours-view-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        .hours-back-btn {
            background: transparent;
            border: none;
            color: #38bdf8;
            font-family: 'Rajdhani', sans-serif;
            font-weight: 700;
            font-size: 12px;
            cursor: pointer;
            padding: 2px 4px;
        }
        .hours-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 4px;
            max-height: 180px;
            overflow-y: auto;
        }
        .hour-chip-btn {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #cbd5e1;
            font-family: 'Rajdhani', sans-serif;
            font-size: 12px;
            font-weight: 700;
            padding: 6px 0;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .hour-chip-btn:hover {
            background: rgba(56, 189, 248, 0.25);
            color: #38bdf8;
            border-color: rgba(56, 189, 248, 0.5);
        }

        /* 🌟 Top Bar Radar Dropdowns Styling */
        .radar-top-dropdown {
            position: absolute;
            top: 48px;
            width: 190px;
            background: rgba(11, 15, 25, 0.96);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 12px;
            padding: 6px;
            z-index: 100;
            display: flex;
            flex-direction: column;
            gap: 2px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8);
            font-family: 'Rajdhani', sans-serif;
        }
        .radar-top-item {
            background: transparent;
            border: none;
            color: #cbd5e1;
            font-family: 'Rajdhani', sans-serif;
            font-weight: 700;
            font-size: 13px;
            text-align: left;
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: all 0.15s ease;
        }
        .radar-top-item:hover {
            background: rgba(56, 189, 248, 0.2);
            color: #38bdf8;
        }
        .radar-top-item.active {
            background: rgba(56, 189, 248, 0.25);
            color: #38bdf8;
        }
        .station-hover-tooltip {
            font-family: 'Rajdhani', sans-serif;
            padding: 4px 6px;
            text-align: center;
        }
    `;
    document.head.appendChild(style);
}

/**
 * 🌟 1. Launch Real-Time IEM Radar on Map
 */
export async function initRadarMode(mapInstance) {
    if (!mapInstance) return;
    radarMapInstance = mapInstance;

    if (typeof mapInstance.setMaxTileCacheSize === 'function') {
        mapInstance.setMaxTileCacheSize(1200);
    }

    await switchRadarTimeline(null);

    bindRadarControls();
    setBasemapLabelsVisibility(mapInstance, true);
    initArchivePopover();
    initRadarModeDropdown();
    initRadarParamDropdown();
    setupStationLayers(mapInstance);
}

/**
 * 🌟 2. Seamless Timeline Switcher (Live Loop vs Historical 1h–24h Archive)
 */
export async function switchRadarTimeline(startUtcDate = null, durationHours = 1) {
    if (!radarMapInstance) return;
    pauseRadarPlayback();

    // 1. Clean up old composite raster layers & sources
    if (radarState.frames) {
        radarState.frames.forEach((frame) => {
            const layerId = `iem-radar-layer-${frame.index}`;
            const sourceId = `iem-radar-src-${frame.index}`;
            try {
                if (radarMapInstance.getLayer(layerId)) radarMapInstance.removeLayer(layerId);
                if (radarMapInstance.getSource(sourceId)) radarMapInstance.removeSource(sourceId);
            } catch (e) {}
        });
    }

    // 2. Build timeline frames based on chosen duration
    const frames = buildRadarTimeline(startUtcDate, durationHours);
    const defaultIndex = (radarState.mode === 'live') ? frames.length - 1 : 0;
    currentVisibleIndex = defaultIndex;

    // 3. Find layer to place radar under
    let firstOverlayId = null;
    const layers = radarMapInstance.getStyle().layers || [];
    for (const layer of layers) {
        const id = layer.id.toLowerCase();
        if (
            id.includes('boundary_county') ||
            id.includes('boundary_state') ||
            id.includes('admin') ||
            id.startsWith('boundary_') ||
            id.startsWith('place_')
        ) {
            firstOverlayId = layer.id;
            break;
        }
    }

    const addRadarLayer = (frame, isInitial) => {
        const sourceId = `iem-radar-src-${frame.index}`;
        const layerId = `iem-radar-layer-${frame.index}`;

        if (!radarMapInstance.getSource(sourceId)) {
            radarMapInstance.addSource(sourceId, {
                type: 'raster',
                tiles: [frame.tileUrl],
                tileSize: 256
            });
        }

        if (!radarMapInstance.getLayer(layerId)) {
            radarMapInstance.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                layout: { 
                    'visibility': activeRadarViewType === 'composite' ? 'visible' : 'none' 
                },
                paint: {
                    'raster-opacity': (activeRadarViewType === 'composite' && isInitial) ? 1.0 : 0.0,
                    'raster-fade-duration': 0,
                    'raster-opacity-transition': { duration: 0, delay: 0 },
                    'raster-resampling': 'linear'
                }
            }, firstOverlayId);
        }
    };

    if (frames.length > 0) {
        addRadarLayer(frames[defaultIndex], true);
    }

    // If a local radar station is active, reload its loop for the new date and duration
    if (activeRadarViewType === 'local' && activeStationId) {
        await loadSingleSiteRadar(activeStationId, activeStationLat, activeStationLon);
        return;
    }

    syncRadarTimelineUI();
    setRadarFrame(defaultIndex);

    // Stagger remaining composite frames in background
    let delay = 25;
    for (let i = 0; i < frames.length; i++) {
        if (i === defaultIndex) continue;
        const frame = frames[i];
        setTimeout(() => {
            if (radarMapInstance && radarState.frames.length > 0) {
                addRadarLayer(frame, false);
            }
        }, delay);
        delay += 25;
    }
}

/**
 * 🌟 3. Instant Zero-Blink GPU Frame Swapping
 */
export function setRadarFrame(frameIndex) {
    const totalFrames = radarState.frames?.length || 12;
    if (frameIndex < 0 || frameIndex >= totalFrames) return;

    const prevIndex = currentVisibleIndex;
    currentVisibleIndex = frameIndex;
    radarState.activeFrameIndex = frameIndex;

    if (radarMapInstance) {
        if (activeRadarViewType === 'composite') {
            // === COMPOSITE MODE ===
            const newLayerId = `iem-radar-layer-${frameIndex}`;
            if (radarMapInstance.getLayer(newLayerId)) {
                radarMapInstance.setPaintProperty(newLayerId, 'raster-opacity', 1.0);
            }

            if (prevIndex >= 0 && prevIndex !== frameIndex) {
                const prevLayerId = `iem-radar-layer-${prevIndex}`;
                if (radarMapInstance.getLayer(prevLayerId)) {
                    radarMapInstance.setPaintProperty(prevLayerId, 'raster-opacity', 0.0);
                }
            }
        } else if (activeRadarViewType === 'local' && singleSiteRadarLayer) {
            // === LOCAL SINGLE-SITE RADAR MODE ===
            if (radarState.frames) {
                radarState.frames.forEach((f) => {
                    const lId = `iem-radar-layer-${f.index}`;
                    if (radarMapInstance.getLayer(lId)) {
                        radarMapInstance.setPaintProperty(lId, 'raster-opacity', 0.0);
                    }
                });
            }

            const frameObj = singleSiteFrames[frameIndex];
            if (frameObj && frameObj.sweepData) {
                singleSiteRadarLayer.setSweepData(frameObj.sweepData);
            }
        }
    }

    const slider = document.getElementById('timeline-slider');
    if (slider) slider.value = frameIndex.toString();

    // 🌟 Dynamically get exact scanDate for Local Mode or fallback to Composite snapped date
    let frameDate = null;
    let frameLabel = '';

    if (activeRadarViewType === 'local') {
        const frameObj = singleSiteFrames[frameIndex];
        if (frameObj) {
            frameDate = frameObj.sweepData?.scanDate;
            frameLabel = frameObj.label;
        }
    } else {
        const frameInfo = radarState.frames?.[frameIndex];
        if (frameInfo) {
            frameDate = frameInfo.date;
            frameLabel = frameInfo.label;
        }
    }

    const timeLabel = document.getElementById('time-label');
    if (timeLabel) {
        timeLabel.textContent = frameLabel || (frameIndex === totalFrames - 1 ? 'LIVE' : `F${frameIndex}`);
    }

    const appClock = document.getElementById('app-clock');
    if (appClock) {
        if (frameDate) {
            appClock.textContent = frameDate.toLocaleTimeString([], {
                weekday: 'short',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short'
            });
        } else {
            appClock.textContent = '--:--';
        }
    }

    updateRadarSliderTrack();
}

/**
 * 🌟 4. Playback Controller
 */
export function toggleRadarPlayback() {
    if (isRadarPlaying) pauseRadarPlayback();
    else startRadarPlayback();
}

export function startRadarPlayback() {
    const totalFrames = radarState.frames?.length || 12;
    if (totalFrames <= 1) return;

    isRadarPlaying = true;
    updateRadarPlayPauseUI();

    if (radarPlayInterval) clearInterval(radarPlayInterval);

    radarPlayInterval = setInterval(() => {
        let nextIdx = radarState.activeFrameIndex + 1;
        if (nextIdx >= totalFrames) {
            nextIdx = 0;
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
 * 🌟 5. UI Slider & Dropdown Binding
 */
function syncRadarTimelineUI() {
    const slider = document.getElementById('timeline-slider');
    const totalFrames = radarState.frames?.length || 12;
    if (!slider || totalFrames === 0) return;

    slider.min = '0';
    slider.max = (totalFrames - 1).toString();
    slider.value = radarState.activeFrameIndex.toString();

    const runLabel = document.getElementById('current-run-label');
    if (runLabel) {
        const dur = radarState.durationHours || 1;
        if (activeRadarViewType === 'local' && activeStationId) {
            runLabel.textContent = `${activeStationId} (${dur}h Loop)`;
        } else if (radarState.mode === 'live' || !radarState.archiveDate) {
            runLabel.textContent = `Live Loop (${dur}h)`;
        } else {
            const d = radarState.archiveDate;
            const monthStr = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
            const day = d.getUTCDate();
            const hh = String(d.getUTCHours()).padStart(2, '0');
            runLabel.textContent = `${monthStr} ${day}, ${hh}Z (${dur}h)`;
        }
    }

    updateRadarSliderTrack();
}

function updateRadarSliderTrack() {
    const slider = document.getElementById('timeline-slider');
    const totalFrames = radarState.frames?.length || 12;
    if (!slider || totalFrames === 0) return;

    const total = totalFrames - 1;
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
            const totalFrames = radarState.frames?.length || 12;
            let prevIdx = radarState.activeFrameIndex - 1;
            if (prevIdx < 0) prevIdx = totalFrames - 1;
            setRadarFrame(prevIdx);
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            if (isRadarPlaying) pauseRadarPlayback();
            const totalFrames = radarState.frames?.length || 12;
            let nextIdx = radarState.activeFrameIndex + 1;
            if (nextIdx >= totalFrames) nextIdx = 0;
            setRadarFrame(nextIdx);
        };
    }
}

/**
 * 🌟 6. Calendar + 24-Hour Archive Popover with Duration Selector
 */
function initArchivePopover() {
    ensureArchiveStyles();

    const toggleBtn = document.getElementById('model-run-toggle');
    const container = document.querySelector('.model-run-dropdown-container');
    if (!toggleBtn || !container) return;

    if (!archivePopoverEl) {
        archivePopoverEl = document.createElement('div');
        archivePopoverEl.id = 'radar-archive-popover';
        archivePopoverEl.className = 'radar-archive-popover';
        archivePopoverEl.style.display = 'none';
        container.appendChild(archivePopoverEl);

        archivePopoverEl.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        document.addEventListener('click', (e) => {
            if (archivePopoverEl && !archivePopoverEl.contains(e.target) && !toggleBtn.contains(e.target)) {
                archivePopoverEl.style.display = 'none';
            }
        });
    }

    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        const isVisible = archivePopoverEl.style.display === 'block';
        archivePopoverEl.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            selectedDayForArchive = null;
            calendarViewMode = 'days';
            calendarViewDate = radarState.archiveDate ? new Date(radarState.archiveDate) : new Date();
            renderArchivePopover();
        }
    };
}

function renderArchivePopover() {
    if (!archivePopoverEl) return;
    archivePopoverEl.innerHTML = '';
    const now = new Date();

    // 1. Return to Live Loop Button
    const liveBtn = document.createElement('button');
    liveBtn.className = 'archive-live-btn';
    liveBtn.innerHTML = `<span>Live Radar</span>`;
    liveBtn.onclick = async (e) => {
        e.stopPropagation();
        archivePopoverEl.style.display = 'none';
        await switchRadarTimeline(null, 1);
    };
    archivePopoverEl.appendChild(liveBtn);

    // VIEW A: 24-Hour Selector (When day is clicked)
    if (selectedDayForArchive) {
        const hoursHeader = document.createElement('div');
        hoursHeader.className = 'hours-view-header';

        const monthStr = selectedDayForArchive.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
        const dayNum = selectedDayForArchive.getUTCDate();

        hoursHeader.innerHTML = `
            <button class="hours-back-btn" id="btn-back-to-days">&larr; Change Day</button>
            <span class="cal-title">${monthStr} ${dayNum} (UTC)</span>
        `;
        archivePopoverEl.appendChild(hoursHeader);

        hoursHeader.querySelector('#btn-back-to-days').onclick = (e) => {
            e.stopPropagation();
            selectedDayForArchive = null;
            calendarViewMode = 'days';
            renderArchivePopover();
        };

        // 🌟 Duration Selector Row [ 1h | 2h | 3h | 6h | 12h | 24h ]
        const durRow = document.createElement('div');
        durRow.className = 'duration-selector-row';
        durRow.innerHTML = `
            <span class="duration-label">Loop:</span>
            <div class="duration-pills-group">
                ${[1, 2, 3, 6, 12, 24].map(dh => `
                    <button class="duration-pill-btn ${selectedDurationHours === dh ? 'active' : ''}" data-hours="${dh}">${dh}h</button>
                `).join('')}
            </div>
        `;
        durRow.querySelectorAll('.duration-pill-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                selectedDurationHours = parseInt(btn.getAttribute('data-hours'), 10);
                durRow.querySelectorAll('.duration-pill-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            };
        });
        archivePopoverEl.appendChild(durRow);

        const grid = document.createElement('div');
        grid.className = 'hours-grid';

        for (let h = 0; h < 24; h++) {
            const hBtn = document.createElement('button');
            hBtn.className = 'hour-chip-btn';
            const hhStr = String(h).padStart(2, '0') + 'Z';
            hBtn.textContent = hhStr;

            const candidateDate = new Date(Date.UTC(
                selectedDayForArchive.getUTCFullYear(),
                selectedDayForArchive.getUTCMonth(),
                selectedDayForArchive.getUTCDate(),
                h, 0, 0
            ));

            if (candidateDate > now) {
                hBtn.disabled = true;
                hBtn.style.opacity = '0.2';
                hBtn.style.cursor = 'not-allowed';
            } else {
                hBtn.onclick = async (e) => {
                    e.stopPropagation();
                    archivePopoverEl.style.display = 'none';
                    await switchRadarTimeline(candidateDate, selectedDurationHours);
                };
            }

            grid.appendChild(hBtn);
        }
        archivePopoverEl.appendChild(grid);
        return;
    }

    // VIEW B: Month & Year Selector (When month title is clicked)
    if (calendarViewMode === 'months') {
        const currentYear = calendarViewDate.getUTCFullYear();

        const calHeader = document.createElement('div');
        calHeader.className = 'cal-header';
        calHeader.innerHTML = `
            <button class="cal-nav-btn" id="btn-year-prev">&lsaquo;</button>
            <span class="cal-title">${currentYear}</span>
            <button class="cal-nav-btn" id="btn-year-next" ${currentYear >= now.getUTCFullYear() ? 'disabled' : ''}>&rsaquo;</button>
        `;
        archivePopoverEl.appendChild(calHeader);

        calHeader.querySelector('#btn-year-prev').onclick = (e) => {
            e.stopPropagation();
            calendarViewDate.setUTCFullYear(currentYear - 1);
            renderArchivePopover();
        };

        const nextYearBtn = calHeader.querySelector('#btn-year-next');
        if (nextYearBtn && currentYear < now.getUTCFullYear()) {
            nextYearBtn.onclick = (e) => {
                e.stopPropagation();
                calendarViewDate.setUTCFullYear(currentYear + 1);
                renderArchivePopover();
            };
        }

        const monthsGrid = document.createElement('div');
        monthsGrid.className = 'months-grid';

        const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        monthShortNames.forEach((name, mIdx) => {
            const mBtn = document.createElement('button');
            mBtn.className = `month-chip-btn ${mIdx === calendarViewDate.getUTCMonth() ? 'selected' : ''}`;
            mBtn.textContent = name;

            const testDate = new Date(Date.UTC(currentYear, mIdx, 1));
            if (testDate.getUTCFullYear() === now.getUTCFullYear() && mIdx > now.getUTCMonth()) {
                mBtn.disabled = true;
            } else {
                mBtn.onclick = (e) => {
                    e.stopPropagation();
                    calendarViewDate.setUTCMonth(mIdx);
                    calendarViewMode = 'days';
                    renderArchivePopover();
                };
            }
            monthsGrid.appendChild(mBtn);
        });

        archivePopoverEl.appendChild(monthsGrid);
        return;
    }

    // VIEW C: Days Calendar (Default)
    const year = calendarViewDate.getUTCFullYear();
    const month = calendarViewDate.getUTCMonth();

    const calHeader = document.createElement('div');
    calHeader.className = 'cal-header';

    const monthName = calendarViewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    calHeader.innerHTML = `
        <button class="cal-nav-btn" id="btn-cal-prev">&lsaquo;</button>
        <button class="cal-title-btn" id="btn-month-select" title="Click to change Month or Year">${monthName} &#9662;</button>
        <button class="cal-nav-btn" id="btn-cal-next">&rsaquo;</button>
    `;
    archivePopoverEl.appendChild(calHeader);

    calHeader.querySelector('#btn-month-select').onclick = (e) => {
        e.stopPropagation();
        calendarViewMode = 'months';
        renderArchivePopover();
    };

    calHeader.querySelector('#btn-cal-prev').onclick = (e) => {
        e.stopPropagation();
        calendarViewDate.setUTCMonth(calendarViewDate.getUTCMonth() - 1);
        renderArchivePopover();
    };

    calHeader.querySelector('#btn-cal-next').onclick = (e) => {
        e.stopPropagation();
        const nextMonth = new Date(calendarViewDate.getTime());
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        if (nextMonth <= now) {
            calendarViewDate = nextMonth;
            renderArchivePopover();
        }
    };

    const weekdays = document.createElement('div');
    weekdays.className = 'cal-weekdays';
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => {
        const span = document.createElement('span');
        span.textContent = d;
        weekdays.appendChild(span);
    });
    archivePopoverEl.appendChild(weekdays);

    const daysGrid = document.createElement('div');
    daysGrid.className = 'cal-days-grid';

    const firstDayIndex = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const totalDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    for (let i = 0; i < firstDayIndex; i++) {
        const emptyCell = document.createElement('div');
        daysGrid.appendChild(emptyCell);
    }

    for (let d = 1; d <= totalDays; d++) {
        const dBtn = document.createElement('button');
        dBtn.className = 'cal-day-btn';
        dBtn.textContent = d;

        const dayUtc = new Date(Date.UTC(year, month, d));

        if (dayUtc > now) {
            dBtn.disabled = true;
        } else {
            dBtn.onclick = (e) => {
                e.stopPropagation();
                selectedDayForArchive = dayUtc;
                renderArchivePopover();
            };
        }

        daysGrid.appendChild(dBtn);
    }
    archivePopoverEl.appendChild(daysGrid);
}

/**
 * 🌟 7. Top Radar Mode Dropdown ("NEXRAD Composite" vs "Local Radar")
 */
function initRadarModeDropdown() {
    ensureArchiveStyles();

    const modelBtn = document.getElementById('btn-model-menu');
    const navRight = document.querySelector('.nav-right');
    if (!modelBtn || !navRight) return;

    if (!radarModeMenuEl) {
        radarModeMenuEl = document.createElement('div');
        radarModeMenuEl.id = 'radar-mode-menu';
        radarModeMenuEl.className = 'radar-top-dropdown';
        radarModeMenuEl.style.display = 'none';
        radarModeMenuEl.style.right = '175px';

        radarModeMenuEl.innerHTML = `
            <button class="radar-top-item ${activeRadarViewType === 'composite' ? 'active' : ''}" data-type="composite">
                <span>NEXRAD Composite</span>
            </button>
            <button class="radar-top-item ${activeRadarViewType === 'local' ? 'active' : ''}" data-type="local">
                <span>Local Radar</span>
            </button>
        `;

        navRight.appendChild(radarModeMenuEl);

        radarModeMenuEl.querySelectorAll('.radar-top-item').forEach((item) => {
            item.onclick = (e) => {
                e.stopPropagation();
                const selectedType = item.getAttribute('data-type');
                setRadarViewType(selectedType);
                radarModeMenuEl.style.display = 'none';
                modelBtn.classList.remove('active', 'open');
            };
        });

        document.addEventListener('click', (e) => {
            if (radarModeMenuEl && !radarModeMenuEl.contains(e.target) && !modelBtn.contains(e.target)) {
                radarModeMenuEl.style.display = 'none';
                modelBtn.classList.remove('active', 'open');
            }
        });
    }

    modelBtn.onclick = (e) => {
        e.stopPropagation();
        if (radarParamMenuEl) radarParamMenuEl.style.display = 'none';
        const isVisible = radarModeMenuEl.style.display === 'flex';
        radarModeMenuEl.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible) {
            modelBtn.classList.add('active', 'open');
        } else {
            modelBtn.classList.remove('active', 'open');
        }
    };
}

/**
 * 🌟 7b. Top Radar Parameter Dropdown (Reflectivity, Velocity, Accumulations)
 */
function initRadarParamDropdown() {
    ensureArchiveStyles();

    const paramBtn = document.getElementById('btn-param-menu');
    const navRight = document.querySelector('.nav-right');
    if (!paramBtn || !navRight) return;

    if (!radarParamMenuEl) {
        radarParamMenuEl = document.createElement('div');
        radarParamMenuEl.id = 'radar-param-menu';
        radarParamMenuEl.className = 'radar-top-dropdown';
        radarParamMenuEl.style.display = 'none';
        radarParamMenuEl.style.right = '12px';
        radarParamMenuEl.style.width = '210px';

        const currentProd = stateManager.activeRadarProduct || 'N0B';
        radarParamMenuEl.innerHTML = RADAR_PRODUCTS.map(p => `
            <button class="radar-top-item ${currentProd === p.id ? 'active' : ''}" data-product="${p.id}">
                <span>${p.name}</span>
            </button>
        `).join('');

        navRight.appendChild(radarParamMenuEl);

        radarParamMenuEl.querySelectorAll('.radar-top-item').forEach((item) => {
            item.onclick = async (e) => {
                e.stopPropagation();
                const selectedProd = item.getAttribute('data-product');
                radarParamMenuEl.style.display = 'none';
                paramBtn.classList.remove('active', 'open');

                if (stateManager.activeRadarProduct === selectedProd) return;

                stateManager.activeRadarProduct = selectedProd;
                const prodInfo = RADAR_PRODUCTS.find(p => p.id === selectedProd);
                if (prodInfo) {
                    paramBtn.querySelector('span').textContent = prodInfo.name;
                }

                radarParamMenuEl.querySelectorAll('.radar-top-item').forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-product') === selectedProd);
                });

                // Velocity and Accumulation are single-site products: switch to Local view if currently on composite
                if (selectedProd !== 'N0B' && activeRadarViewType === 'composite') {
                    setRadarViewType('local');
                }

                if (activeRadarViewType === 'local' && activeStationId) {
                    await loadSingleSiteRadar(activeStationId, activeStationLat, activeStationLon);
                }
            };
        });

        document.addEventListener('click', (e) => {
            if (radarParamMenuEl && !radarParamMenuEl.contains(e.target) && !paramBtn.contains(e.target)) {
                radarParamMenuEl.style.display = 'none';
                paramBtn.classList.remove('active', 'open');
            }
        });
    }

    paramBtn.onclick = (e) => {
        e.stopPropagation();
        if (radarModeMenuEl) radarModeMenuEl.style.display = 'none';
        const isVisible = radarParamMenuEl.style.display === 'flex';
        radarParamMenuEl.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible) {
            paramBtn.classList.add('active', 'open');
        } else {
            paramBtn.classList.remove('active', 'open');
        }
    };
}

export function setRadarViewType(type) {
    activeRadarViewType = type;
    const modelBtn = document.getElementById('btn-model-menu');

    if (radarModeMenuEl) {
        radarModeMenuEl.querySelectorAll('.radar-top-item').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-type') === type);
        });
    }

    if (type === 'composite') {
        if (modelBtn) modelBtn.querySelector('span').textContent = 'NEXRAD Composite';
        setStationLayersVisibility(false);
        if (singleSiteRadarLayer) {
            singleSiteRadarLayer.isVisible = false;
            radarMapInstance.triggerRepaint();
        }
        activeStationId = null;
        stopLocalRadarAutoRefresh();

        // Restore composite layers visibility
        if (radarState.frames) {
            radarState.frames.forEach((frame) => {
                const layerId = `iem-radar-layer-${frame.index}`;
                if (radarMapInstance && radarMapInstance.getLayer(layerId)) {
                    radarMapInstance.setLayoutProperty(layerId, 'visibility', 'visible');
                }
            });
        }

        setRadarFrame(radarState.activeFrameIndex);
    } else {
        if (modelBtn) modelBtn.querySelector('span').textContent = activeStationId ? `Local Radar (${activeStationId})` : 'Local Radar';
        setStationLayersVisibility(true);

        // Hide all composite layers
        if (radarState.frames) {
            radarState.frames.forEach((frame) => {
                const layerId = `iem-radar-layer-${frame.index}`;
                if (radarMapInstance && radarMapInstance.getLayer(layerId)) {
                    radarMapInstance.setLayoutProperty(layerId, 'visibility', 'none');
                }
            });
        }

        if (singleSiteRadarLayer && activeStationId) {
            singleSiteRadarLayer.isVisible = true;
            radarMapInstance.triggerRepaint();
        }

        if (activeStationId) {
            startLocalRadarAutoRefresh();
        }
    }
}

/**
 * 🌟 8. Fetch Real-Time or Archive Level 3 Sweep via Your Cloudflare Worker S3 Engine
 */
async function fetchLevel3Frame(stationId, frameIndex = 11, totalFrames = 12, archiveDate = null, durationHours = 1, product = null) {
    const prod = product || stateManager.activeRadarProduct || 'N0B';
    const siteCode = stationId.startsWith('K') && stationId.length === 4 ? stationId.slice(1) : stationId;
    let workerUrl = `https://baroclinic-data-proxy.andrew-n-orsini.workers.dev/radar?station=${siteCode}&product=${prod}&frame=${frameIndex}&totalFrames=${totalFrames}&duration=${durationHours}`;

    if (archiveDate) {
        const yyyy = archiveDate.getUTCFullYear();
        const mm = String(archiveDate.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(archiveDate.getUTCDate()).padStart(2, '0');
        const hh = archiveDate.getUTCHours();
        workerUrl += `&date=${yyyy}${mm}${dd}&hour=${hh}`;
    } else {
        // 🌟 CACHE-BUST: Live requests must never be served from Safari's (or any browser's)
        // local HTTP cache, since the URL would otherwise be byte-identical every single time
        // and the browser can silently keep re-serving an old response forever. Archive
        // requests are intentionally left alone since those scans are immutable and safe to cache.
        workerUrl += `&_t=${Date.now()}`;
    }

    const resp = await fetch(workerUrl, { cache: 'no-store' });
    if (!resp.ok) {
        throw new Error(`Worker returned HTTP ${resp.status} for ${stationId} (${prod}) frame ${frameIndex}`);
    }
    return await resp.arrayBuffer();
}

/**
 * 🌟 Load & Animate Single-Site Dynamic Time Loop from S3 (1h to 24h)
 */
async function loadSingleSiteRadar(stationId, lat, lon) {
    if (!radarMapInstance) return;

    try {
        pauseRadarPlayback();

        // 🚨 Immediately wipe the old station's radar off the screen!
        if (singleSiteRadarLayer) {
            singleSiteRadarLayer.isVisible = false;
            radarMapInstance.triggerRepaint();
        }

        activeStationId = stationId;
        activeStationLat = lat;
        activeStationLon = lon;

        const currentProd = stateManager.activeRadarProduct || 'N0B';
        const totalFrames = radarState.frames?.length || 12;
        singleSiteFrames = new Array(totalFrames);

        // 1. Completely hide all composite layers
        if (radarState.frames) {
            radarState.frames.forEach((frame) => {
                const layerId = `iem-radar-layer-${frame.index}`;
                if (radarMapInstance.getLayer(layerId)) {
                    radarMapInstance.setLayoutProperty(layerId, 'visibility', 'none');
                }
            });
        }

        const dur = radarState.durationHours || 1;
        const runLabel = document.getElementById('current-run-label');
        if (runLabel) runLabel.textContent = `Loading ${stationId}...`;

        // 2. Load and render default frame immediately (newest for live, or frame 0 for archive)
        const defaultIndex = (radarState.mode === 'live') ? (totalFrames - 1) : 0;
        const rawBuffer = await fetchLevel3Frame(stationId, defaultIndex, totalFrames, radarState.archiveDate, dur, currentProd);
        const sweep = await decodeLevel3(rawBuffer, { id: stationId, lat, lon, product: currentProd });

        singleSiteFrames[defaultIndex] = {
            index: defaultIndex,
            sweepData: sweep,
            label: radarState.frames?.[defaultIndex]?.label || (defaultIndex === totalFrames - 1 ? 'LIVE' : 'START')
        };

        // 3. Attach GPU single-site layer
        if (!singleSiteRadarLayer) {
            singleSiteRadarLayer = createSingleSiteRadarLayer(radarMapInstance);
            const beforeId = radarMapInstance.getLayer('radar-stations-circle-layer') ? 'radar-stations-circle-layer' : undefined;
            radarMapInstance.addLayer(singleSiteRadarLayer, beforeId);
        }

        singleSiteRadarLayer.updatePalette(getRadarPalette(currentProd));
        singleSiteRadarLayer.setSweepData(sweep);

        if (runLabel) runLabel.textContent = `${stationId} (${dur}h Loop)`;
        syncRadarTimelineUI();
        setRadarFrame(defaultIndex);

        // 4. Preload remaining historical frames in background from S3
        for (let i = 0; i < totalFrames; i++) {
            if (i === defaultIndex) continue;
            fetchLevel3Frame(stationId, i, totalFrames, radarState.archiveDate, dur, currentProd)
                .then(buf => decodeLevel3(buf, { id: stationId, lat, lon, product: currentProd }))
                .then(decodedSweep => {
                    singleSiteFrames[i] = {
                        index: i,
                        sweepData: decodedSweep,
                        label: radarState.frames?.[i]?.label || `F${i}`
                    };
                })
                .catch(() => {});
        }

        // 5. Kick off (or restart) the auto-refresh loop for this newly-selected live station
        if (radarState.mode === 'live') {
            startLocalRadarAutoRefresh();
        } else {
            stopLocalRadarAutoRefresh();
        }

    } catch (err) {
        console.error(`[RadarUI] Error loading single site ${stationId}:`, err);
        const runLabel = document.getElementById('current-run-label');
        if (runLabel) runLabel.textContent = `Error (${stationId})`;
    }
}

/**
 * 🌟 8b. LIVE AUTO-REFRESH LOOP
 */
function startLocalRadarAutoRefresh() {
    stopLocalRadarAutoRefresh();

    localRadarAutoRefreshInterval = setInterval(async () => {
        if (activeRadarViewType !== 'local') return;
        if (!activeStationId) return;
        if (radarState.mode !== 'live') return;

        const totalFrames = radarState.frames?.length || 12;
        const liveIndex = totalFrames - 1;
        const dur = radarState.durationHours || 1;
        const currentProd = stateManager.activeRadarProduct || 'N0B';

        try {
            const rawBuffer = await fetchLevel3Frame(activeStationId, liveIndex, totalFrames, null, dur, currentProd);
            const sweep = await decodeLevel3(rawBuffer, {
                id: activeStationId,
                lat: activeStationLat,
                lon: activeStationLon,
                product: currentProd
            });

            // Guard against a station switch happening mid-fetch
            if (activeRadarViewType !== 'local' || !activeStationId) return;

            singleSiteFrames[liveIndex] = {
                index: liveIndex,
                sweepData: sweep,
                label: 'LIVE'
            };

            // Only push the refreshed sweep to the screen if the user is actually on the LIVE frame
            if (currentVisibleIndex === liveIndex && singleSiteRadarLayer) {
                singleSiteRadarLayer.setSweepData(sweep);
                const appClock = document.getElementById('app-clock');
                if (appClock && sweep.scanDate) {
                    appClock.textContent = sweep.scanDate.toLocaleTimeString([], {
                        weekday: 'short',
                        month: 'numeric',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZoneName: 'short'
                    });
                }
            }
        } catch (err) {
            console.warn(`[RadarUI] Auto-refresh failed for ${activeStationId}:`, err);
        }
    }, LOCAL_RADAR_REFRESH_MS);
}

function stopLocalRadarAutoRefresh() {
    if (localRadarAutoRefreshInterval) {
        clearInterval(localRadarAutoRefreshInterval);
        localRadarAutoRefreshInterval = null;
    }
}

/**
 * 🌟 9. NWS-Style Blue Circles for WSR-88D Stations
 */
function setupStationLayers(mapInstance) {
    if (!mapInstance) return;

    if (!stationHoverPopup) {
        stationHoverPopup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false
        });
    }

    const sourceId = 'radar-stations-src';
    const circleLayerId = 'radar-stations-circle-layer';
    const labelLayerId = 'radar-stations-symbol-layer';

    if (!mapInstance.getSource(sourceId)) {
        mapInstance.addSource(sourceId, {
            type: 'geojson',
            data: getRadarStationsGeoJson()
        });
    }

    if (!mapInstance.getLayer(circleLayerId)) {
        mapInstance.addLayer({
            id: circleLayerId,
            type: 'circle',
            source: sourceId,
            layout: {
                'visibility': activeRadarViewType === 'local' ? 'visible' : 'none'
            },
            paint: {
                'circle-color': '#2563eb',
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    3, 4,
                    6, 7,
                    10, 10
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.8,
                'circle-opacity': 0.95
            }
        });
    }

    if (!mapInstance.getLayer(labelLayerId)) {
        mapInstance.addLayer({
            id: labelLayerId,
            type: 'symbol',
            source: sourceId,
            minzoom: 6,
            layout: {
                'visibility': activeRadarViewType === 'local' ? 'visible' : 'none',
                'text-field': ['get', 'id'],
                'text-font': ['Noto Sans Bold'],
                'text-size': 11,
                'text-offset': [0, 1.3],
                'text-anchor': 'top',
                'text-optional': true
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#0b0f19',
                'text-halo-width': 2.0
            }
        });
    }

    // Hover Tooltip
    mapInstance.on('mouseenter', circleLayerId, (e) => {
        if (activeRadarViewType !== 'local') return;
        mapInstance.getCanvas().style.cursor = 'pointer';

        const f = e.features && e.features[0];
        if (!f) return;

        const coords = f.geometry.coordinates.slice();
        const { id, name, state } = f.properties;

        stationHoverPopup.setLngLat(coords)
            .setHTML(`<div class="station-hover-tooltip"><strong>${id}</strong><br>${name}, ${state}</div>`)
            .addTo(mapInstance);
    });

    mapInstance.on('mouseleave', circleLayerId, () => {
        mapInstance.getCanvas().style.cursor = '';
        stationHoverPopup.remove();
    });

    // Click to select, fly to station, and load single-site radar
    mapInstance.on('click', circleLayerId, async (e) => {
        if (activeRadarViewType !== 'local') return;

        const f = e.features && e.features[0];
        if (!f) return;

        const [lon, lat] = f.geometry.coordinates;
        const { id, name } = f.properties;

        mapInstance.flyTo({
            center: [lon, lat],
            zoom: 8.5,
            duration: 1200
        });

        const modelBtn = document.getElementById('btn-model-menu');
        if (modelBtn) {
            modelBtn.querySelector('span').textContent = `Local Radar (${id})`;
        }

        // 🌟 Trigger direct single-site radar download and render
        await loadSingleSiteRadar(id, lat, lon);
    });
}

function setStationLayersVisibility(isVisible) {
    if (!radarMapInstance) return;
    const visibilityVal = isVisible ? 'visible' : 'none';

    if (radarMapInstance.getLayer('radar-stations-circle-layer')) {
        radarMapInstance.setLayoutProperty('radar-stations-circle-layer', 'visibility', visibilityVal);
    }
    if (radarMapInstance.getLayer('radar-stations-symbol-layer')) {
        radarMapInstance.setLayoutProperty('radar-stations-symbol-layer', 'visibility', visibilityVal);
    }
    if (!isVisible && stationHoverPopup) {
        stationHoverPopup.remove();
    }
}

/**
 * 🌟 10. Teardown Radar Mode
 */
export function destroyRadarMode(mapInstance) {
    pauseRadarPlayback();
    stopLocalRadarAutoRefresh();
    currentVisibleIndex = -1;

    if (archivePopoverEl) {
        archivePopoverEl.style.display = 'none';
    }

    if (radarModeMenuEl) {
        radarModeMenuEl.style.display = 'none';
    }

    if (radarParamMenuEl) {
        radarParamMenuEl.style.display = 'none';
    }

    if (stationHoverPopup) {
        stationHoverPopup.remove();
    }

    if (singleSiteRadarLayer) {
        try {
            if (mapInstance && mapInstance.getLayer(singleSiteRadarLayer.id)) {
                mapInstance.removeLayer(singleSiteRadarLayer.id);
            }
        } catch (e) {}
        singleSiteRadarLayer = null;
    }
    activeStationId = null;
    singleSiteFrames = [];

    if (mapInstance) {
        if (radarState.frames) {
            radarState.frames.forEach((frame) => {
                const layerId = `iem-radar-layer-${frame.index}`;
                const sourceId = `iem-radar-src-${frame.index}`;
                try {
                    if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
                    if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId);
                } catch (e) {}
            });
        }

        try {
            if (mapInstance.getLayer('radar-stations-symbol-layer')) mapInstance.removeLayer('radar-stations-symbol-layer');
            if (mapInstance.getLayer('radar-stations-circle-layer')) mapInstance.removeLayer('radar-stations-circle-layer');
            if (mapInstance.getSource('radar-stations-src')) mapInstance.removeSource('radar-stations-src');
        } catch (e) {}
    }

    purgeRadarMemory();
    radarMapInstance = null;
}
