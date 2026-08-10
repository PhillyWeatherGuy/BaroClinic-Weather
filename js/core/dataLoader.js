// js/core/dataLoader.js
import { stateManager } from './stateManager.js';
import { clearThreeGlobeTextures } from '../layers/threeGlobe.js'; // 🌟 3D VRAM Disposer
import { clearVectorContours } from '../layers/vectorContours.js'; // 🌟 Vector Contour Disposer

export async function fetchManifest(run = null) {
    let fileName = 'manifest.json';
    
    if (run && run.year && run.month && run.day && run.cycle) {
        const modelStr = run.model ? run.model.toLowerCase() : 'ecmwf';
        const dateStr = `${run.year}${run.month}${run.day}`;
        const cycleStr = run.cycle.toLowerCase();
        fileName = `${modelStr}_${dateStr}_${cycleStr}_manifest.json`;
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

export async function loadChunkBitmap(chunkIndex, currentGen = null) {
    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        throw new Error("Load cancelled");
    }

    const chunk = stateManager.manifest.chunks[chunkIndex];
    if (!chunk) throw new Error(`Chunk index ${chunkIndex} missing from manifest`);

    const chunkUrl = chunk.file.startsWith('http') ? chunk.file : stateManager.BASE_URL + chunk.file;
    const imgResp = await fetch(chunkUrl);
    if (!imgResp.ok) throw new Error(`Failed to load chunk image: ${imgResp.status}`);

    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        throw new Error("Load cancelled");
    }

    const blob = await imgResp.blob();
    const bitmap = await createImageBitmap(blob);

    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        bitmap.close();
        throw new Error("Load cancelled");
    }

    stateManager.loadedChunkBitmaps[chunkIndex] = bitmap;

    let offCanvas = document.createElement('canvas');
    offCanvas.width = bitmap.width;
    offCanvas.height = bitmap.height;
    let offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
    offCtx.drawImage(bitmap, 0, 0);

    const rgba = offCtx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const singleChannel = new Uint8Array(bitmap.width * bitmap.height);

    for (let i = 0; i < singleChannel.length; i++) {
        singleChannel[i] = rgba[i * 4];
    }

    stateManager.chunkPixelData[chunkIndex] = singleChannel;

    offCanvas.width = 0;
    offCanvas.height = 0;
    offCanvas = null;
    offCtx = null;

    return bitmap;
}

/**
 * 🌟 UNIFIED APP MEMORY PURGER: Wipes 2D & 3D GPU VRAM + CPU RAM + Vector Contours
 */
export function purgeAllAppMemory(shaderLayerRef = null) {
    stateManager.loadGeneration++;

    // 🌟 Disposes 3D Globe GPU VRAM textures & vector contour features
    clearThreeGlobeTextures();
    clearVectorContours();

    // 1. Close CPU ImageBitmap handles
    for (const key in stateManager.loadedChunkBitmaps) {
        const bitmap = stateManager.loadedChunkBitmaps[key];
        if (bitmap && typeof bitmap.close === 'function') {
            bitmap.close();
        }
    }
    stateManager.loadedChunkBitmaps = {};

    // 2. Clear raw city temperature pixel memory
    stateManager.chunkPixelData = {};

    // 3. Delete 2D WebGL textures from GPU VRAM
    if (shaderLayerRef && typeof shaderLayerRef.clearTextures === 'function') {
        shaderLayerRef.clearTextures();
    }

    // 4. Clear state references
    stateManager.manifest = null;
    stateManager.globalSteps = [];
    stateManager.currentStepIndex = 0;
    stateManager.activeFrameState = null;
    stateManager.initTime = null;

    // 5. Clear overlay window caches
    window.lastActiveFrameState = null;
    window.lastManifest = null;
}