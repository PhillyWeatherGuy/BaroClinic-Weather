// js/core/dataLoader.js
import { stateManager } from './stateManager.js';
import { clearThreeGlobeTextures } from '../layers/threeGlobe.js';
import { clearPolarTextures } from '../layers/polarMap.js';
import { clearVectorContours } from '../layers/vectorContours.js';

export async function fetchManifest(run = null, model = null, param = null) {
    const activeModel = (model || stateManager.activeModel || 'ecmwf').toLowerCase();
    const activeParam = (param || stateManager.activeParam || '2t').toLowerCase();

    if (run && run.year && run.month && run.day && run.cycle) {
        stateManager.currentDate = `${run.year}${run.month}${run.day}`;
        stateManager.currentCycle = run.cycle.toLowerCase();
    }

    const urlsToTry = [];

    // 🌟 Strictly parameter-specific manifest resolution
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
 * 🌟 2x Hardware Bilinear Upscaler
 */
async function upscaleFrameToBitmap2x(frameBytes, width, height) {
    const targetW = width * 2;
    const targetH = height * 2;

    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < frameBytes.length; i++) {
        const v = frameBytes[i];
        const idx = i * 4;
        rgba[idx]     = v;
        rgba[idx + 1] = v;
        rgba[idx + 2] = v;
        rgba[idx + 3] = 255;
    }
    const imgData = new ImageData(rgba, width, height);

    try {
        return await createImageBitmap(imgData, {
            resizeWidth: targetW,
            resizeHeight: targetH,
            resizeQuality: 'high'
        });
    } catch (e) {
        const off = document.createElement('canvas');
        off.width = width;
        off.height = height;
        const offCtx = off.getContext('2d');
        offCtx.putImageData(imgData, 0, 0);

        const up = document.createElement('canvas');
        up.width = targetW;
        up.height = targetH;
        const upCtx = up.getContext('2d');
        upCtx.imageSmoothingEnabled = true;
        upCtx.imageSmoothingQuality = 'high';
        upCtx.drawImage(off, 0, 0, targetW, targetH);
        return up;
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

    // 🌟 PATH A: Compressed Binary Time Volume (.bin) - Pure Contiguous 3D Slicing
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

        const rawData = new Uint8Array(buffer);
        stateManager.chunkPixelData[chunkIndex] = rawData;

        const upscaledFrames = [];
        for (let f = 0; f < numFrames; f++) {
            const srcStart = f * frameSize;
            const frameBytes = rawData.subarray(srcStart, srcStart + frameSize);
            const bitmap2x = await upscaleFrameToBitmap2x(frameBytes, frameW, frameH);
            upscaledFrames.push(bitmap2x);
        }

        if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
            upscaledFrames.forEach(b => { if (b && b.close) b.close(); });
            throw new Error("Load cancelled");
        }

        const volumeObj = {
            frames: upscaledFrames,
            width: frameW * 2,
            height: frameH * 2,
            isVolume: true
        };

        stateManager.loadedChunkBitmaps[chunkIndex] = volumeObj;
        return volumeObj;
    }

    // 🌟 PATH B: Image (.png / .webp legacy fallback)
    const blob = await imgResp.blob();
    const fullBitmap = await createImageBitmap(blob);

    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        fullBitmap.close();
        throw new Error("Load cancelled");
    }

    const upscaledFrames = [];
    for (let f = 0; f < numFrames; f++) {
        const frameBitmap = await createImageBitmap(
            fullBitmap, 
            f * frameW, 0, frameW, frameH,
            {
                resizeWidth: frameW * 2,
                resizeHeight: frameH * 2,
                resizeQuality: 'high'
            }
        );
        upscaledFrames.push(frameBitmap);
    }

    fullBitmap.close();

    const volumeObj = {
        frames: upscaledFrames,
        width: frameW * 2,
        height: frameH * 2,
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
