// js/core/dataLoader.js
import { stateManager } from './stateManager.js';
import { clearThreeGlobeTextures } from '../layers/threeGlobe.js'; // 🌟 3D VRAM Disposer
import { clearVectorContours } from '../layers/vectorContours.js'; // 🌟 Vector Contour Disposer
import { decompress } from 'https://cdn.jsdelivr.net/npm/fzstd/+esm'; // 🌟 Zstd browser decompressor

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

    const chunkUrl = (chunk.file.startsWith('http') ? chunk.file : stateManager.BASE_URL + chunk.file) + `?t=${Date.now()}`;
    const resp = await fetch(chunkUrl);
    if (!resp.ok) throw new Error(`Failed to load chunk binary: ${resp.status}`);

    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        throw new Error("Load cancelled");
    }

    const compressedBytes = new Uint8Array(await resp.arrayBuffer());

    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        throw new Error("Load cancelled");
    }

    // 🌟 Decompress Zstandard buffer using fzstd
    const decompressedBytes = decompress(compressedBytes);
    const buffer = decompressedBytes.buffer;

    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        throw new Error("Load cancelled");
    }

    // 🌟 Parse 16-bit uint16 array for high precision (0 - 4095)
    const u16 = new Uint16Array(buffer);
    
    // 🌟 Derive 8-bit version for smooth GPU texture rendering
    const u8 = new Uint8Array(u16.length);
    for (let i = 0; i < u16.length; i++) {
        u8[i] = u16[i] >> 4;
    }

    // Save full 16-bit array for precise click inspections
    stateManager.chunkPixelData[chunkIndex] = u16;

    const bufferObj = {
        data: u8,
        width: chunk.sheet_width,
        height: chunk.sheet_height
    };

    stateManager.loadedChunkBitmaps[chunkIndex] = bufferObj;
    return bufferObj;
}

/**
 * 🌟 UNIFIED APP MEMORY PURGER: Wipes 2D & 3D GPU VRAM + CPU RAM + Vector Contours
 */
export function purgeAllAppMemory(shaderLayerRef = null) {
    stateManager.loadGeneration++;

    // 🌟 Disposes 3D Globe GPU VRAM textures & vector contour features
    clearThreeGlobeTextures();
    clearVectorContours();

    // 1. Clear CPU chunk buffers
    stateManager.loadedChunkBitmaps = {};

    // 2. Clear raw pixel memory
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