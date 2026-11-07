// js/core/dataLoader.js
import { stateManager } from './stateManager.js';
import { clearThreeGlobeTextures } from '../layers/threeGlobe.js';
import { clearPolarTextures } from '../layers/polarMap.js';
import { clearVectorContours } from '../layers/vectorContours.js';

export async function fetchManifest(run = null, model = null, param = null) {
    const rawModel = (model || stateManager.activeModel || 'ecmwf').toLowerCase();
    const activeParam = (param || stateManager.activeParam || '2t').toLowerCase();

    // 🌟 Resolve base model and member range tag for ensemble variants
    let activeModel = rawModel;
    let memberTag = null;

    const memberMatch = rawModel.match(/aifs_ens_(\d+)_(\d+)/);
    if (memberMatch) {
        activeModel = 'aifs_ens';
        const start = String(memberMatch[1]).padStart(2, '0');
        const end = String(memberMatch[2]).padStart(2, '0');
        memberTag = `m${start}-m${end}`;
    } else if (rawModel === 'aifs_ens') {
        memberTag = 'm01-m10';
    }

    // 🌟 Keep base URL pointing to the Cloudflare Worker proxy for all models
    if (!stateManager.DEFAULT_BASE_URL) {
        stateManager.DEFAULT_BASE_URL = stateManager.BASE_URL;
    } else {
        stateManager.BASE_URL = stateManager.DEFAULT_BASE_URL;
    }

    if (run && run.year && run.month && run.day && run.cycle) {
        stateManager.currentDate = `${run.year}${run.month}${run.day}`;
        stateManager.currentCycle = run.cycle.toLowerCase();
    }

    // 🌟 Map frontend parameter IDs to the actual backend manifest filenames
    let manifestParam = activeParam;
    if (activeParam === 'pva') {
        manifestParam = 'z500';
    } else if (activeParam === 'asnow_rrfs') {
        manifestParam = 'asnow';
    } else if (activeParam.endsWith('_rrfs')) {
        manifestParam = activeParam.replace('_rrfs', '');
    }

    const urlsToTry = [];

    // 1. URLs with Run Date and Cycle (Operational runs)
    if (stateManager.currentDate && stateManager.currentCycle && !activeModel.startsWith('era5')) {
        const dateStr = stateManager.currentDate;
        const cycleStr = stateManager.currentCycle;
        const pName = (activeParam === 'pva') ? 'z500' : manifestParam;

        if (memberTag) {
            urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${pName}_${dateStr}_${cycleStr}_${memberTag}_manifest.json`);
            urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${pName}_${dateStr}_${cycleStr}_${memberTag}.json`);
        } else {
            urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${pName}_${dateStr}_${cycleStr}_manifest.json`);
        }
    }

    // 2. Latest Run URLs (Fallback / default load)
    if (memberTag) {
        if (memberTag === 'm01-m10') {
            urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${manifestParam}_manifest.json`);
        }
        urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${manifestParam}_${memberTag}_manifest.json`);
        urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${manifestParam}_manifest_${memberTag}.json`);
        urlsToTry.push(`${stateManager.BASE_URL}${rawModel}_${manifestParam}_manifest.json`);
    } else {
        urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${manifestParam}_manifest.json`);
    }

    let fetchedData = null;

    for (const url of urlsToTry) {
        try {
            const fetchOptions = {
                signal: stateManager.activeFetchController?.signal,
                cache: 'default'
            };
            const resp = await fetch(url, fetchOptions);
            if (resp.ok) {
                fetchedData = await resp.json();
                console.log(`✅ Loaded manifest from: ${url}`);
                break;
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
        }
    }

    if (!fetchedData) {
        throw new Error(`HTTP Manifest not found for ${rawModel} (${activeParam})`);
    }

    stateManager.manifest = fetchedData;
    
    if (stateManager.manifest.date) stateManager.currentDate = stateManager.manifest.date;
    if (stateManager.manifest.run) stateManager.currentCycle = stateManager.manifest.run.toLowerCase();
    
    // 🌟 Preserve the specific variant (e.g. aifs_ens_11_20) so the active button highlight doesn't reset
    stateManager.activeModel = rawModel;
    
    if (stateManager.manifest.parameter) {
        if (!stateManager.activeParam.endsWith('_rrfs')) {
            stateManager.activeParam = stateManager.manifest.parameter;
        }
    }

    stateManager.initTime = stateManager.manifest.init_time 
                         || stateManager.manifest.run_time 
                         || stateManager.manifest.base_time 
                         || stateManager.manifest.model_run
                         || stateManager.manifest.time;
    
    // 🌟 Update the 10 card badges in the UI (Member 01..10 or Member 11..20, etc.)
    updateEnsembleGridLabels(stateManager.manifest);

    // 🌟 Step reduction for mobile devices
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const totalFramesCount = stateManager.manifest.total_frames || 0;
    const mobileStepInterval = (isMobile && totalFramesCount > 70) ? 3 : 1;

    stateManager.globalSteps = [];
    const chunks = stateManager.manifest.chunks || [];
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const chunk = chunks[cIdx];
        const steps = chunk.forecast_steps || [];
        for (let fIdx = 0; fIdx < steps.length; fIdx++) {
            const stepVal = steps[fIdx];
            if (mobileStepInterval > 1 && (stepVal % mobileStepInterval !== 0)) {
                continue;
            }
            stateManager.globalSteps.push({
                step: stepVal,
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
 * 🌟 Dynamically updates the corner labels on the 10 map cards
 */
function updateEnsembleGridLabels(manifest) {
    const cards = document.querySelectorAll('#ensemble-grid .map-card');
    if (!cards || cards.length === 0) return;

    const memberIds = manifest?.member_ids;
    cards.forEach((card, idx) => {
        if (memberIds && memberIds[idx]) {
            const cleanNum = memberIds[idx].replace(/^m0?/, '');
            card.setAttribute('data-member', `Member ${cleanNum.padStart(2, '0')}`);
        } else {
            card.setAttribute('data-member', `Member ${String(idx + 1).padStart(2, '0')}`);
        }
    });
}

/**
 * 🌟 Dynamic Frame to ImageBitmap Converter (Supports 1x Native, 2x Upscale, and Dual Rate/Ptype Packing)
 */
async function frameToBitmap(frameBytes, width, height, shouldUpscale = false, ptypeBytes = null) {
    const targetW = shouldUpscale ? width * 2 : width;
    const targetH = shouldUpscale ? height * 2 : height;
    const totalPixels = width * height;

    const rgbaBuffer = new ArrayBuffer(totalPixels * 4);
    const rgba32 = new Uint32Array(rgbaBuffer);

    if (ptypeBytes) {
        for (let i = 0; i < totalPixels; i++) {
            const r = frameBytes[i];
            const g = ptypeBytes[i];
            rgba32[i] = 0xFF000000 | (g << 8) | r;
        }
    } else {
        for (let i = 0; i < totalPixels; i++) {
            const v = frameBytes[i];
            rgba32[i] = 0xFF000000 | (v << 16) | (v << 8) | v;
        }
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

export async function loadChunkBitmap(chunkIndex, currentGen = null) {
    if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
        throw new Error("Load cancelled");
    }

    if (stateManager.loadedChunkBitmaps[chunkIndex]) {
        return stateManager.loadedChunkBitmaps[chunkIndex];
    }

    if (!stateManager.activeChunkPromises) stateManager.activeChunkPromises = {};
    if (stateManager.activeChunkPromises[chunkIndex]) {
        return stateManager.activeChunkPromises[chunkIndex];
    }

    const loadPromise = (async () => {
        const chunk = stateManager.manifest?.chunks?.[chunkIndex];
        if (!chunk) throw new Error(`Chunk index ${chunkIndex} missing from manifest`);

        const chunkUrl = chunk.file.startsWith('http') ? chunk.file : stateManager.BASE_URL + chunk.file;
        
        const imgResp = await fetch(chunkUrl, { 
            signal: stateManager.activeFetchController?.signal,
            cache: 'default'
        });
        if (!imgResp.ok) throw new Error(`Failed to load chunk asset: ${imgResp.status}`);

        if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
            throw new Error("Load cancelled");
        }

        const frameW = stateManager.manifest.frame_width || 1440;
        const frameH = stateManager.manifest.frame_height || 721;
        const frameSize = frameW * frameH;
        const numFrames = (chunk.forecast_steps || []).length || chunk.frame_count || 1;

        const shouldUpscale = Boolean(stateManager.paramConfig?.upscale_2x || stateManager.manifest?.upscale_2x);

        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
        const totalFramesCount = stateManager.manifest?.total_frames || 0;
        const mobileStepInterval = (isMobile && totalFramesCount > 70) ? 3 : 1;

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

            let ptypeBytes = null;
            if (chunk.ptype_file) {
                try {
                    const ptypeUrl = `${stateManager.BASE_URL}${chunk.ptype_file}`;
                    const ptypeResp = await fetch(ptypeUrl, { 
                        signal: stateManager.activeFetchController?.signal,
                        cache: 'default'
                    });
                    if (ptypeResp.ok) {
                        const ptypeBuffer = await ptypeResp.arrayBuffer();
                        let rawPtype = new Uint8Array(ptypeBuffer);
                        if (rawPtype[0] === 0x1f && rawPtype[1] === 0x8b) {
                            const stream = new Response(ptypeBuffer).body.pipeThrough(new DecompressionStream('gzip'));
                            ptypeBytes = new Uint8Array(await new Response(stream).arrayBuffer());
                        } else {
                            ptypeBytes = rawPtype;
                        }
                    }
                } catch (e) {
                    if (e.name !== 'AbortError') console.warn("Could not load ptype_file:", e);
                }

                if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
                    throw new Error("Load cancelled");
                }
            }
            
            // Native Grid Path: HRRR/RRFS
            if (stateManager.manifest.grid) {
                const frames = [];
                const ptypeFrames = ptypeBytes ? [] : null;
                for (let f = 0; f < numFrames; f++) {
                    const srcStart = f * frameSize;
                    frames.push(rawData.subarray(srcStart, srcStart + frameSize));
                    if (ptypeBytes) {
                        ptypeFrames.push(ptypeBytes.subarray(srcStart, srcStart + frameSize));
                    }
                }
                const volumeObj = { 
                    frames, 
                    ptypeFrames, 
                    width: frameW, 
                    height: frameH, 
                    isVolume: true, 
                    isRaw: true,
                    hasPtype: Boolean(ptypeBytes)
                };
                stateManager.loadedChunkBitmaps[chunkIndex] = volumeObj;
                return volumeObj;
            }

            // 🌟 OPTIMIZED PATH: ENSEMBLE CHUNKED (10 members)
            if (stateManager.manifest.type === 'ensemble_chunked') {
                const numMembers = stateManager.manifest.members || 10;
                const memberSizeBytes = chunk.member_size_bytes || (numFrames * frameSize);
                
                const outFrames = [];

                for (let f = 0; f < numFrames; f++) {
                    const stepVal = (chunk.forecast_steps || [])[f];
                    if (mobileStepInterval > 1 && stepVal !== undefined && (stepVal % mobileStepInterval !== 0)) {
                        outFrames.push(null);
                        continue;
                    }

                    const memberFrames = [];
                    for (let m = 0; m < numMembers; m++) {
                        const srcStart = (m * memberSizeBytes) + (f * frameSize);
                        const frameBytes = rawData.subarray(srcStart, srcStart + frameSize);
                        const ptypeSlice = ptypeBytes ? ptypeBytes.subarray(srcStart, srcStart + frameSize) : null;
                        
                        memberFrames.push({
                            data: frameBytes,
                            ptype: ptypeSlice
                        });
                    }
                    outFrames.push(memberFrames);
                }

                if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
                    throw new Error("Load cancelled");
                }

                const volumeObj = {
                    frames: outFrames,
                    width: frameW,
                    height: frameH,
                    isVolume: true,
                    isEnsemble: true,
                    isRaw: true,
                    hasPtype: Boolean(ptypeBytes)
                };

                stateManager.loadedChunkBitmaps[chunkIndex] = volumeObj;
                return volumeObj;
            }

            // Standard Single-Member Volume Path
            const outFrames = [];
            for (let f = 0; f < numFrames; f++) {
                const stepVal = (chunk.forecast_steps || [])[f];
                if (mobileStepInterval > 1 && stepVal !== undefined && (stepVal % mobileStepInterval !== 0)) {
                    outFrames.push(null);
                    continue;
                }

                const srcStart = f * frameSize;
                const frameBytes = rawData.subarray(srcStart, srcStart + frameSize);
                const ptypeSlice = ptypeBytes ? ptypeBytes.subarray(srcStart, srcStart + frameSize) : null;
                const bitmap = await frameToBitmap(frameBytes, frameW, frameH, shouldUpscale, ptypeSlice);
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

        const volumeObj = {
            frames: outFrames,
            width: shouldUpscale ? frameW * 2 : frameW,
            height: shouldUpscale ? frameH * 2 : frameH,
            isVolume: true
        };

        stateManager.loadedChunkBitmaps[chunkIndex] = volumeObj;
        return volumeObj;
    })();

    stateManager.activeChunkPromises[chunkIndex] = loadPromise;

    try {
        return await loadPromise;
    } finally {
        delete stateManager.activeChunkPromises[chunkIndex];
    }
}

export function purgeAllAppMemory(shaderLayerRef = null) {
    stateManager.loadGeneration++;

    if (stateManager.activeFetchController) {
        try { stateManager.activeFetchController.abort(); } catch(e){}
    }
    stateManager.activeFetchController = new AbortController();
    stateManager.activeChunkPromises = {};

    clearThreeGlobeTextures();
    clearPolarTextures();
    clearVectorContours();

    for (const key in stateManager.loadedChunkBitmaps) {
        const item = stateManager.loadedChunkBitmaps[key];
        
        if (item && item.frames) {
            item.frames.forEach(frameOrArray => {
                if (Array.isArray(frameOrArray)) {
                    frameOrArray.forEach(bmp => {
                        if (bmp && typeof bmp.close === 'function') bmp.close();
                    });
                } else if (frameOrArray && typeof frameOrArray.close === 'function') {
                    frameOrArray.close();
                }
            });

            if (item.ptypeFrames) {
                item.ptypeFrames.forEach(frame => {
                    if (frame && typeof frame.close === 'function') frame.close();
                });
            }
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
