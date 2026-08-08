import { stateManager } from './stateManager.js';

export async function fetchManifest(run = null) {
    let fileName = 'manifest.json';
    
    if (run && run.year && run.month && run.day && run.cycle) {
        const dateStr = `${run.year}${run.month}${run.day}`;
        const cycleStr = run.cycle.toLowerCase();
        fileName = `ecmwf_${dateStr}_${cycleStr}_manifest.json`;
    }

    const resp = await fetch(stateManager.BASE_URL + fileName);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} - Run manifest ${fileName} not found`);
    stateManager.manifest = await resp.json();
    
    stateManager.initTime = stateManager.manifest.init_time 
                         || stateManager.manifest.run_time 
                         || stateManager.manifest.base_time 
                         || stateManager.manifest.model_run
                         || stateManager.manifest.time;
    
    stateManager.globalSteps = [];
    const chunks = stateManager.manifest.chunks || [];
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const chunk = chunks[cIdx];
        for (let fIdx = 0; fIdx < chunk.forecast_steps.length; fIdx++) {
            stateManager.globalSteps.push({
                step: chunk.forecast_steps[fIdx],
                chunkIndex: cIdx,
                col: fIdx % chunk.columns,
                row: Math.floor(fIdx / chunk.columns)
            });
        }
    }
    return stateManager.manifest;
}

export async function loadChunkBitmap(chunkIndex) {
    const chunk = stateManager.manifest.chunks[chunkIndex];
    if (!chunk) throw new Error(`Chunk index ${chunkIndex} missing from manifest`);

    const chunkUrl = chunk.file.startsWith('http') ? chunk.file : stateManager.BASE_URL + chunk.file;
    const imgResp = await fetch(chunkUrl);
    if (!imgResp.ok) throw new Error(`Failed to load chunk image: ${imgResp.status}`);

    const blob = await imgResp.blob();
    const bitmap = await createImageBitmap(blob);
    stateManager.loadedChunkBitmaps[chunkIndex] = bitmap;

    // Extract raw pixel Uint8Array ONCE when chunk loads
    const offCanvas = document.createElement('canvas');
    offCanvas.width = bitmap.width;
    offCanvas.height = bitmap.height;
    const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
    offCtx.drawImage(bitmap, 0, 0);
    stateManager.chunkPixelData[chunkIndex] = offCtx.getImageData(0, 0, bitmap.width, bitmap.height).data;

    return bitmap;
}

/**
 * 🌟 UNIFIED APP MEMORY PURGER: Wipes 100% of RAM, VRAM, and Global Caches
 */
export function purgeAllAppMemory(shaderLayerRef = null) {
    // 1. Close CPU ImageBitmap handles
    for (const key in stateManager.loadedChunkBitmaps) {
        const bitmap = stateManager.loadedChunkBitmaps[key];
        if (bitmap && typeof bitmap.close === 'function') {
            bitmap.close();
        }
    }
    stateManager.loadedChunkBitmaps = {};

    // 2. Clear raw city temperature pixel memory arrays
    stateManager.chunkPixelData = {};

    // 3. Delete WebGL textures from GPU VRAM
    if (shaderLayerRef && typeof shaderLayerRef.clearTextures === 'function') {
        shaderLayerRef.clearTextures();
    }

    // 4. Clear global state references
    stateManager.manifest = null;
    stateManager.globalSteps = [];
    stateManager.currentStepIndex = 0;
    stateManager.activeFrameState = null;
    stateManager.initTime = null;

    // 5. Clear overlay window caches
    window.lastActiveFrameState = null;
    window.lastManifest = null;
}