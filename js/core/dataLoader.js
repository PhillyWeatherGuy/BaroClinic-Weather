// js/core/dataLoader.js
import { stateManager } from './stateManager.js';
import { clearThreeGlobeTextures } from '../layers/threeGlobe.js';
import { clearPolarTextures } from '../layers/polarMap.js';
import { clearVectorContours } from '../layers/vectorContours.js';

const MAX_CACHED_CHUNKS = 4;

export async function fetchManifest(run = null, model = null, param = null) {
    const activeModel = (model || stateManager.activeModel || 'ecmwf').toLowerCase();
    const activeParam = (param || stateManager.activeParam || '2t').toLowerCase();

    if (run && run.year && run.month && run.day && run.cycle) {
        stateManager.currentDate = `${run.year}${run.month}${run.day}`;
        stateManager.currentCycle = run.cycle.toLowerCase();
    }

    const urlsToTry = [];

    if (stateManager.currentDate && stateManager.currentCycle) {
        const dateStr = stateManager.currentDate;
        const cycleStr = stateManager.currentCycle;
        urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${activeParam}_${dateStr}_${cycleStr}_manifest.json`);
    }
    urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${activeParam}_manifest.json`);

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
        const steps = chunk.forecast_steps || [];
        for (let fIdx = 0; fIdx < steps.length; fIdx++) {
            stateManager.globalSteps.push({
                step: steps[fIdx],
                chunkIndex: cIdx,
                frameIndex: fIdx,
                col: 0,
                row: 0
            });
        }
    }
    return stateManager.manifest;
}

/**
 * 🌟 Dynamic Frame to ImageBitmap Converter (Supports 1x Native and 2x Upscale)
 */
async function frameToBitmap(frameBytes, width, height, shouldUpscale = false) {
    const targetW = shouldUpscale ? width * 2 : width;
    const targetH = shouldUpscale ? height * 2 : height;
    const totalPixels = width * height;

    const rgbaBuffer = new ArrayBuffer(totalPixels * 4);
    const rgba32 = new Uint32Array(rgbaBuffer);

    // Fast 32-bit Little-Endian pixel packing: A(255) | B(v) | G(v) | R(v)
    for (let i = 0; i < totalPixels; i++) {
        const v = frameBytes[i];
        rgba32[i] = 0xFF000000 | (v << 16) | (v << 8) | v;
    }

    const imgData = new ImageData(new Uint8ClampedArray(rgbaBuffer), width, height);

    const bitmapOptions = shouldUpscale ? {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'high'
    } : undefined;

    try {
        return await (bitmapOptions ? createImageBitmap(imgData, bitmapOptions) : createImageBitmap(imgData));
    } catch (e) {
        const off = document.createElement('canvas');
        off.width = width;
        off.height = height;
        const offCtx = off.getContext('2d');
        offCtx.putImageData(imgData, 0, 0);

        if (!shouldUpscale) return off;

        const up = document.createElement('canvas');
        up.width = targetW;
        up.height = targetH;
        const upCtx = up.getContext('2d');
        upCtx.imageSmoothingEnabled = true;
        upCtx.imageSmoothingQuality = 'high';
        upCtx.drawImage(off, 0, 0, targetW, targetH);
        
        off.width = 0;
        off.height = 0;
        return up;
    }
}

/**
 * Evict oldest chunks to keep memory usage strictly bounded
 */
function evictOldChunks(currentChunkIndex) {
    const activeKeys = Object.keys(stateManager.loadedChunkBitmaps);
    if (activeKeys.length > MAX_CACHED_CHUNKS) {
        // Sort by furthest distance from active chunk
        const sortedByDistance = activeKeys
            .map(Number)
            .sort((a, b) => Math.abs(b - currentChunkIndex) - Math.abs(a - currentChunkIndex));

        const toRemove = sortedByDistance.slice(0, activeKeys.length - MAX_CACHED_CHUNKS);
        for (const oldKey of toRemove) {
            const oldChunk = stateManager.loadedChunkBitmaps[oldKey];
            if (oldChunk && oldChunk.frames) {
                oldChunk.frames.forEach(b => { if (b && typeof b.close === 'function') b.close(); });
            }
            delete stateManager.loadedChunkBitmaps[oldKey];
            delete stateManager.chunkPixelData[oldKey];
        }
    }
}

export async function loadChunkBitmap(chunkIndex, currentGen = null) {
    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        throw new Error("Load cancelled");
    }

    const chunk = stateManager.manifest.chunks[chunkIndex];
    if (!chunk) throw new Error(`Chunk index ${chunkIndex} missing from manifest`);

    const rawChunkUrl = chunk.file.startsWith('http') ? chunk.file : stateManager.BASE_URL + chunk.file;
    const chunkUrl = rawChunkUrl + (rawChunkUrl.includes('?') ? '&' : '?') + `t=${Date.now()}`;
    const imgResp = await fetch(chunkUrl);
    if (!imgResp.ok) throw new Error(`Failed to load chunk asset: ${imgResp.status}`);

    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        throw new Error("Load cancelled");
    }

    const frameW = stateManager.manifest.frame_width || 1440;
    const frameH = stateManager.manifest.frame_height || 721;
    const frameSize = frameW * frameH;
    const numFrames = (chunk.forecast_steps || []).length || chunk.frame_count || 1;

    // 🌟 Dynamically check if models.json specifies upscale_2x for this parameter
    const shouldUpscale = Boolean(stateManager.paramConfig?.upscale_2x || stateManager.manifest?.upscale_2x);

    // 🌟 PATH A: Compressed Binary Time Volume (.bin)
    if (chunk.file.endsWith('.bin')) {
        let rawData = stateManager.chunkPixelData[chunkIndex];

        if (!rawData) {
            const arrayBuffer = await imgResp.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
                try {
                    const stream = new Response(arrayBuffer).body.pipeThrough(new DecompressionStream('gzip'));
                    const decompressedBlob = await new Response(stream).blob();
                    const decompressedBuffer = await decompressedBlob.arrayBuffer();
                    rawData = new Uint8Array(decompressedBuffer);
                } catch (e) {
                    rawData = bytes;
                }
            } else {
                rawData = bytes;
            }

            if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
                throw new Error("Load cancelled");
            }

            stateManager.chunkPixelData[chunkIndex] = rawData;
        }

        // Sliding window eviction
        evictOldChunks(chunkIndex);

        const outFrames = [];
        for (let f = 0; f < numFrames; f++) {
            const srcStart = f * frameSize;
            const frameBytes = rawData.subarray(srcStart, srcStart + frameSize);
            const bitmap = await frameToBitmap(frameBytes, frameW, frameH, shouldUpscale);
            outFrames.push(bitmap);
        }

        if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
            outFrames.forEach(b => { if (b && typeof b.close === 'function') b.close(); });
            throw new Error("Load cancelled");
        }

        const volumeObj = {
            frames: outFrames,
            width: shouldUpscale ? frameW * 2 : frameW,
            height: shouldUpscale ? frameH * 2 : frameH,
            isVolume: true
        };

        stateManager.loadedChunkBitmaps[chunkIndex] = volumeObj;
        return volumeObj;
    }

    // 🌟 PATH B: Image fallback (.png / .webp)
    const blob = await imgResp.blob();
    const fullBitmap = await createImageBitmap(blob);

    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        fullBitmap.close();
        throw new Error("Load cancelled");
    }

    const outFrames = [];
    for (let f = 0; f < numFrames; f++) {
        const frameBitmap = await createImageBitmap(
            fullBitmap, 
            f * frameW, 0, frameW, frameH,
            shouldUpscale ? { resizeWidth: frameW * 2, resizeHeight: frameH * 2, resizeQuality: 'high' } : undefined
        );
        outFrames.push(frameBitmap);
    }

    fullBitmap.close();

    evictOldChunks(chunkIndex);

    const volumeObj = {
        frames: outFrames,
        width: shouldUpscale ? frameW * 2 : frameW,
        height: shouldUpscale ? frameH * 2 : frameH,
        isVolume: true
    };

    stateManager.loadedChunkBitmaps[chunkIndex] = volumeObj;
    return volumeObj;
}

export function purgeAllAppMemory(shaderLayerRef = null) {
    stateManager.loadGeneration++;

    clearThreeGlobeTextures();
    clearPolarTextures();
    clearVectorContours();

    for (const key in stateManager.loadedChunkBitmaps) {
        const item = stateManager.loadedChunkBitmaps[key];
        if (item && item.frames) {
            item.frames.forEach(frame => {
                if (frame && typeof frame.close === 'function') {
                    frame.close();
                }
            });
        } else if (item && typeof item.close === 'function') {
            item.close();
        }
    }
    stateManager.loadedChunkBitmaps = {};
    stateManager.chunkPixelData = {};

    if (shaderLayerRef && typeof shaderLayerRef.clearTextures === 'function') {
        shaderLayerRef.clearTextures();
    }

    stateManager.manifest = null;
    stateManager.globalSteps = [];
    stateManager.currentStepIndex = 0;
    stateManager.activeFrameState = null;
    stateManager.initTime = null;

    window.lastActiveFrameState = null;
    window.lastManifest = null;
}
