import { stateManager } from './core/stateManager.js';
import { fetchManifest, loadChunkBitmap } from './core/dataLoader.js';
import { createScalarShaderLayer } from './shaders/scalarShader.js';
import { initHubTransition } from './components/homeScreen.js'; 
import { 
    initViewerUI, 
    syncTimelineWithManifest, 
    showToast, 
    hideToast 
} from './components/viewerUI.js';

let customShaderLayer = null;
let renderDebounceId = null;

const popup = new maplibregl.Popup({ closeButton: false });

const map = new maplibregl.Map({
    container: 'map',
    style: 'https://api.maptiler.com/maps/019fc9f8-1ca6-7efe-b666-aba0ef35bce8/style.json?key=f9fTA5Ce0HKefPDICSVG',
    center: [-74.4, 39.3], 
    zoom: 7
});

function initLayer() {
    customShaderLayer = createScalarShaderLayer(map);
    
    let firstOverlayId = null;
    const layers = map.getStyle().layers || [];
    for (const layer of layers) {
        if (layer.type === 'line' || layer.type === 'symbol') {
            firstOverlayId = layer.id;
            break;
        }
    }
    map.addLayer(customShaderLayer, firstOverlayId);
}

async function renderFrame(globalIdx) {
    if (!stateManager.manifest || stateManager.globalSteps.length === 0) return;
    
    const frameInfo = stateManager.globalSteps[globalIdx];
    const chunkInfo = stateManager.manifest.chunks[frameInfo.chunkIndex];
    if (!stateManager.loadedChunkBitmaps[frameInfo.chunkIndex]) return;

    stateManager.activeFrameState = {
        chunkIndex: frameInfo.chunkIndex,
        col: frameInfo.col,
        row: frameInfo.row,
        chunkImg: stateManager.loadedChunkBitmaps[frameInfo.chunkIndex],
        uvOffset: [frameInfo.col / chunkInfo.columns, frameInfo.row / chunkInfo.rows],
        uvScale: [1.0 / chunkInfo.columns, 1.0 / chunkInfo.rows]
    };
    
    if (customShaderLayer) {
        customShaderLayer.updateFrame(stateManager.activeFrameState);
    }
}

// Initialize UI listeners & register GPU redraw callback
initViewerUI((stepIndex) => {
    if (renderDebounceId) cancelAnimationFrame(renderDebounceId);
    renderDebounceId = requestAnimationFrame(() => renderFrame(stepIndex));
});

// 🌟 Generate Past 7 Days of Model Runs (18Z, 12Z, 06Z, 00Z)
function initModelRunDropdown() {
    const toggleBtn = document.getElementById('model-run-toggle');
    const menu = document.getElementById('model-run-menu');
    const labelSpan = document.getElementById('current-run-label');

    const hours = [18, 12, 6, 0];
    const runs = [];
    
    // Generate past 7 days starting from current UTC time backwards
    const now = new Date();
    // Round down to latest available 6-hour cycle window
    const currentHour = now.getUTCHours();
    const latestRunHour = Math.floor(currentHour / 6) * 6;
    
    let currentDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), latestRunHour, 0));

    // 7 days * 4 cycles/day = 28 runs total
    for (let i = 0; i < 28; i++) {
        const runHour = String(currentDate.getUTCHours()).padStart(2, '0') + 'Z';
        
        // Format date e.g., "Fri Aug 07"
        const options = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
        const dateStr = currentDate.toLocaleDateString('en-US', options);
        
        const runId = `${runHour} ${dateStr}`;
        runs.push({ id: runId, dateObj: new Date(currentDate) });

        // Step back 6 hours
        currentDate.setUTCHours(currentDate.getUTCHours() - 6);
    }

    // Populate menu DOM
    menu.innerHTML = '';
    runs.forEach((run, index) => {
        const item = document.createElement('button');
        item.className = `run-dropdown-item ${index === 0 ? 'active' : ''}`;
        item.setAttribute('data-run', run.id);
        item.innerHTML = `<span>${run.id}</span><span class="check-icon">✓</span>`;
        
        item.addEventListener('click', async () => {
            document.querySelectorAll('.run-dropdown-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            labelSpan.textContent = run.id;
            menu.style.display = 'none';

            showToast(`Loading ${run.id}...`);
            try {
                stateManager.activeModelRun = run.id;
                // Hook up your manifest fetch with the selected run parameter here if applicable
                // await fetchManifest(run.id);
                hideToast();
            } catch (err) {
                showToast('❌ Failed to load run');
            }
        });

        menu.appendChild(item);
    });

    // Toggle menu visibility
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = menu.style.display === 'block';
        menu.style.display = isVisible ? 'none' : 'block';
    });

    // Close menu when clicking outside
    document.addEventListener('click', () => {
        menu.style.display = 'none';
    });
}

map.on('load', async () => {
    try {
        initModelRunDropdown();
        await fetchManifest();
        initLayer();

        const bitmap0 = await loadChunkBitmap(0);
        customShaderLayer.preloadChunkTexture(0, bitmap0);

        // Sync slider min/max/value & label with manifest step length
        syncTimelineWithManifest();

        // Render initial frame (F000)
        await renderFrame(0);
        hideToast();

        // Initialize the home hub screen sequence once the map is painted
        initHubTransition();

        // Preload next chunk if present
        if (stateManager.manifest.chunks.length > 1) {
            loadChunkBitmap(1).then((bitmap1) => {
                customShaderLayer.preloadChunkTexture(1, bitmap1);
            });
        }
    } catch (err) {
        showToast('❌ ' + err.message);
    }
});

// Canvas for pixel inspection
const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = 1;
sampleCanvas.height = 1;
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

map.on('click', (e) => {
    if (!stateManager.manifest || !stateManager.activeFrameState || !stateManager.activeFrameState.chunkImg) return;

    let lng = ((e.lngLat.lng % 360) + 360) % 360;
    if (lng > 180) lng -= 360;

    const normX = (lng + 180) / 360;
    const latRad = e.lngLat.lat * Math.PI / 180;
    const mercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const normY = 0.5 - (mercY / (2 * Math.PI));

    if (normY < 0 || normY > 1) return;

    const frameW = stateManager.manifest.frame_width;
    const frameH = stateManager.manifest.frame_height;

    sampleCtx.clearRect(0, 0, 1, 1);
    sampleCtx.drawImage(
        stateManager.activeFrameState.chunkImg,
        stateManager.activeFrameState.col * frameW + Math.floor(normX * frameW), 
        stateManager.activeFrameState.row * frameH + Math.floor(normY * frameH), 1, 1,
        0, 0, 1, 1
    );

    const rawGrayValue = sampleCtx.getImageData(0, 0, 1, 1).data[0];
    const minK = stateManager.manifest.temp_min_k || 210.0;
    const maxK = stateManager.manifest.temp_max_k || 330.0;
    const tempK = minK + (rawGrayValue / 255.0) * (maxK - minK);
    const tempC = tempK - 273.15;

    popup.setLngLat(e.lngLat)
         .setHTML(`<div class="temp-f">${((tempC * 9/5) + 32).toFixed(1)}°F</div><div class="temp-c">${tempC.toFixed(1)}°C</div>`)
         .addTo(map);
});