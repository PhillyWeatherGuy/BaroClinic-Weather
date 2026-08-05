import { stateManager } from './core/stateManager.js';
import { fetchManifest, loadChunkBitmap } from './core/dataLoader.js';
import { createScalarShaderLayer } from './shaders/scalarShader.js';
// 🌟 NEW: Import the dismiss function from your new component
import { dismissSplashScreen } from './components/homeScreen.js'; 

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

map.on('load', async () => {
    try {
        await fetchManifest();
        initLayer();

        const bitmap0 = await loadChunkBitmap(0);
        customShaderLayer.preloadChunkTexture(0, bitmap0);

        const slider = document.getElementById('timeline-slider');
        slider.max = stateManager.globalSteps.length - 1;
        
        slider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            const frameInfo = stateManager.globalSteps[val];
            document.getElementById('time-label').textContent = `Forecast: F${String(frameInfo.step).padStart(3, '0')}`;
            
            if (renderDebounceId) cancelAnimationFrame(renderDebounceId);
            renderDebounceId = requestAnimationFrame(() => renderFrame(val));
        });

        await renderFrame(0);
        document.getElementById('status-toast').style.display = 'none';

        // 🌟 NEW: The map is fully painted and ready! Fade out the splash screen.
        dismissSplashScreen();

        if (stateManager.manifest.chunks.length > 1) {
            loadChunkBitmap(1).then((bitmap1) => {
                customShaderLayer.preloadChunkTexture(1, bitmap1);
            });
        }
    } catch (err) {
        document.getElementById('status-toast').textContent = '❌ ' + err.message;
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