// js/core/dataLoader.js
import { stateManager } from './stateManager.js';
import { clearThreeGlobeTextures } from '../layers/threeGlobe.js'; // 🌟 3D VRAM Disposer
import { clearPolarTextures } from '../layers/polarMap.js'; // 🌟 2D Polar VRAM Disposer
import { clearVectorContours } from '../layers/vectorContours.js'; // 🌟 Vector Contour Disposer

export async function fetchManifest(run = null, model = null, param = null) {
    const activeModel = (model || stateManager.activeModel || 'ecmwf').toLowerCase();
    const activeParam = (param || stateManager.activeParam || '2t').toLowerCase();

    // 1. Store run date & cycle in stateManager so parameter switches remember them
    if (run && run.year && run.month && run.day && run.cycle) {
        stateManager.currentDate = `${run.year}${run.month}${run.day}`;
        stateManager.currentCycle = run.cycle.toLowerCase();
    }

    const urlsToTry = [];

    // 2. Build parameter-specific URL using active date & cycle
    if (stateManager.currentDate && stateManager.currentCycle) {
        const dateStr = stateManager.currentDate;
        const cycleStr = stateManager.currentCycle;
        urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${activeParam}_${dateStr}_${cycleStr}_manifest.json`);
        urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${dateStr}_${cycleStr}_manifest.json`);
    }

    // 3. Fallback URLs
    urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${activeParam}_manifest.json`);
    urlsToTry.push(`${stateManager.BASE_URL}manifest.json`);

    let fetchedData = null;

    for (const url of urlsToTry) {
        try {
            const resp = await fetch(url + `?t=${Date.now()}`);
            if (resp.ok) {
                fetchedData = await resp.json();
                console.log(`✅ Loaded manifest from: ${url}`);
                break;
            }
        } catch (err) {}
    }

    if (!fetchedData) {
        throw new Error(`HTTP Manifest not found for ${activeModel} (${activeParam})`);
    }

    stateManager.manifest = fetchedData;
    
    // Save date, cycle, model, param to stateManager
    if (stateManager.manifest.date) stateManager.currentDate = stateManager.manifest.date;
    if (stateManager.manifest.run) stateManager.currentCycle = stateManager.manifest.run.toLowerCase();
    if (stateManager.manifest.model) stateManager.activeModel = stateManager.manifest.model;
    if (stateManager.manifest.parameter) stateManager.activeParam = stateManager.manifest.parameter;

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
    if (!imgResp.ok) throw new Error(`Failed to load chunk asset: ${imgResp.status}`);

    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        throw new Error("Load cancelled");
    }

    // 🌟 PATH A: Raw/Gzipped Binary Buffer (.bin)
    if (chunk.file.endsWith('.bin')) {
        let buffer;
        try {
            const decompressedStream = imgResp.body.pipeThrough(new DecompressionStream('gzip'));
            const blob = await new Response(decompressedStream).blob();
            buffer = await blob.arrayBuffer();
        } catch (e) {
            buffer = await imgResp.arrayBuffer();
        }

        if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
            throw new Error("Load cancelled");
        }

        const singleChannel = new Uint8Array(buffer);
        stateManager.chunkPixelData[chunkIndex] = singleChannel;

        const bufferObj = {
            data: singleChannel,
            width: chunk.sheet_width,
            height: chunk.sheet_height,
            isBinary: true
        };

        stateManager.loadedChunkBitmaps[chunkIndex] = bufferObj;
        return bufferObj;
    }

    // 🌟 PATH B: Image (.png / .webp)
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
 * 🌟 UNIFIED APP MEMORY PURGER: Wipes 2D, 3D & Polar GPU VRAM + CPU RAM + Vector Contours
 */
export function purgeAllAppMemory(shaderLayerRef = null) {
    stateManager.loadGeneration++;

    // 🌟 Disposes 3D Globe & 2D Polar GPU VRAM textures & vector contour features
    clearThreeGlobeTextures();
    clearPolarTextures();
    clearVectorContours();

    // 1. Close CPU ImageBitmap handles
    for (const key in stateManager.loadedChunkBitmaps) {
        const item = stateManager.loadedChunkBitmaps[key];
        if (item && typeof item.close === 'function') {
            item.close();
        }
    }
    stateManager.loadedChunkBitmaps = {};

    // 2. Clear raw city temperature pixel memory
    stateManager.chunkPixelData = {};

    // 3. Delete 2D WebGL textures from GPU VRAM
    if (shaderLayerRef && typeof shaderLayerRef.clearTextures === 'function') {
        shaderLayerRef.clearTextures();
    }

    // 4. Clear state references (Note: currentDate & currentCycle are preserved so parameter switches remember the run!)
    stateManager.manifest = null;
    stateManager.globalSteps = [];
    stateManager.currentStepIndex = 0;
    stateManager.activeFrameState = null;
    stateManager.initTime = null;

    // 5. Clear overlay window caches
    window.lastActiveFrameState = null;
    window.lastManifest = null;
}
