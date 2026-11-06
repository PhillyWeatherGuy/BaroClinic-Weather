// js/core/dataLoader.js
import { stateManager } from './stateManager.js';
import { clearThreeGlobeTextures } from '../layers/threeGlobe.js';
import { clearPolarTextures } from '../layers/polarMap.js';
import { clearVectorContours } from '../layers/vectorContours.js';

export async function fetchManifest(run = null, model = null, param = null) {
    const activeModel = (model || stateManager.activeModel || 'ecmwf').toLowerCase();
    const activeParam = (param || stateManager.activeParam || '2t').toLowerCase();

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
    const latestUrl = `${stateManager.BASE_URL}${activeModel}_${manifestParam}_manifest.json`;

    // 🌟 For ERA5 storms, always use clean storm-slug URLs without operational date suffixes
    if (stateManager.currentDate && stateManager.currentCycle && !activeModel.startsWith('era5')) {
        const dateStr = stateManager.currentDate;
        const cycleStr = stateManager.currentCycle;
        
        if (activeParam === 'pva') {
            urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_z500_${dateStr}_${cycleStr}_manifest.json`);
        } else {
            urlsToTry.push(`${stateManager.BASE_URL}${activeModel}_${manifestParam}_${dateStr}_${cycleStr}_manifest.json`);
        }
    }
    if (!run || activeModel.startsWith('era5')) {
        urlsToTry.unshift(latestUrl);
    } else {
        urlsToTry.push(latestUrl);
    }

    let fetchedData = null;

    for (const url of urlsToTry) {
        try {
            // 🌟 Turn off caching for aifs_ens manifests
            const fetchOptions = {
                signal: stateManager.activeFetchController?.signal,
                cache: activeModel === 'aifs_ens' ? 'no-store' : 'default'
            };
            const resp = await fetch(url + `?t=${Date.now()}`, fetchOptions);
            if (resp.ok) {
                fetchedData = await resp.json();
                console.log(`✅ Loaded manifest from: ${url}`);
                break;
            }
        } catch (err) {
            if (err.name === 'AbortError') return; // Exit gracefully if aborted
        }
    }

    if (!fetchedData) {
        throw new Error(`HTTP Manifest not found for ${activeModel} (${activeParam})`);
    }

    stateManager.manifest = fetchedData;
    
    if (stateManager.manifest.date) stateManager.currentDate = stateManager.manifest.date;
    if (stateManager.manifest.run) stateManager.currentCycle = stateManager.manifest.run.toLowerCase();
    if (stateManager.manifest.model) stateManager.activeModel = stateManager.manifest.model;
    
    // 🌟 Preserve the frontend-specific _rrfs parameter ID
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
    
    // 🌟 Approach 1: On phones, if a run has >70 hourly frames, step in 3-hour intervals
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
                continue; // Skip intermediate hours on mobile to keep timeline slider light
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
 * 🌟 Dynamic Frame to ImageBitmap Converter (Supports 1x Native, 2x Upscale, and Dual Rate/Ptype Packing)
 */
async function frameToBitmap(frameBytes, width, height, shouldUpscale = false, ptypeBytes = null) {
    const targetW = shouldUpscale ? width * 2 : width;
    const targetH = shouldUpscale ? height * 2 : height;
    const totalPixels = width * height;

    const rgbaBuffer = new ArrayBuffer(totalPixels * 4);
    const rgba32 = new Uint32Array(rgbaBuffer);

    if (ptypeBytes) {
        // Fast 32-bit Little-Endian packing: R = Rate, G = Ptype, B = 0, A = 255
        for (let i = 0; i < totalPixels; i++) {
            const r = frameBytes[i];
            const g = ptypeBytes[i];
            rgba32[i] = 0xFF000000 | (g << 8) | r;
        }
    } else {
        // Fast 32-bit Little-Endian pixel packing for standard scalar parameters: A(255) | B(v) | G(v) | R(v)
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

    // 🌟 Instant Cache Return (Zero latency if already in memory)
    if (stateManager.loadedChunkBitmaps[chunkIndex]) {
        return stateManager.loadedChunkBitmaps[chunkIndex];
    }

    // 🌟 DEDUPLICATE CONCURRENT FETCHES (Prevents double downloading)
    if (!stateManager.activeChunkPromises) stateManager.activeChunkPromises = {};
    if (stateManager.activeChunkPromises[chunkIndex]) {
        return stateManager.activeChunkPromises[chunkIndex];
    }

    const loadPromise = (async () => {
        const chunk = stateManager.manifest?.chunks?.[chunkIndex];
        if (!chunk) throw new Error(`Chunk index ${chunkIndex} missing from manifest`);

        const rawChunkUrl = chunk.file.startsWith('http') ? chunk.file : stateManager.BASE_URL + chunk.file;
        
        // 🌟 TURN OFF CACHING FOR AIFS-ENS CHUNKS
        const isEnsemble = stateManager.activeModel === 'aifs_ens';
        const chunkUrl = rawChunkUrl + (isEnsemble ? `?t=${Date.now()}` : '');
        
        const imgResp = await fetch(chunkUrl, { 
            signal: stateManager.activeFetchController?.signal,
            cache: isEnsemble ? 'no-store' : 'default'
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

        // 🌟 Determine if intermediate hours are skipped on mobile
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
                    const ptypeUrl = `${stateManager.BASE_URL}${chunk.ptype_file}` + (isEnsemble ? `?t=${Date.now()}` : '');
                    const ptypeResp = await fetch(ptypeUrl, { 
                        signal: stateManager.activeFetchController?.signal,
                        cache: isEnsemble ? 'no-store' : 'default'
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
            
            // Native Grid Path: Keeps zero-copy typed arrays for HRRR/RRFS whether scalar or ptype
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

            // 🌟 NEW PATH: ENSEMBLE CHUNKED (10 members bundled together)
            if (stateManager.manifest.type === 'ensemble_chunked') {
                const numMembers = stateManager.manifest.members || 10;
                const memberSizeBytes = chunk.member_size_bytes || (numFrames * frameSize);
                
                const outFrames = []; // Array of arrays: [ [m1_bmp, m2_bmp...m10_bmp], [m1_bmp...m10_bmp] ]

                for (let f = 0; f < numFrames; f++) {
                    const stepVal = (chunk.forecast_steps || [])[f];
                    if (mobileStepInterval > 1 && stepVal !== undefined && (stepVal % mobileStepInterval !== 0)) {
                        outFrames.push(null);
                        continue;
                    }

                    const memberBitmaps = [];
                    for (let m = 0; m < numMembers; m++) {
                        // Offset formula: (Member Index * Total Size of Member Block) + (Frame Index * Size of One Frame)
                        const srcStart = (m * memberSizeBytes) + (f * frameSize);
                        const frameBytes = rawData.subarray(srcStart, srcStart + frameSize);
                        
                        // 🌟 Extract P-Type data for this specific member
                        let ptypeSlice = null;
                        if (ptypeBytes) {
                            ptypeSlice = ptypeBytes.subarray(srcStart, srcStart + frameSize);
                        }
                        
                        // Create the bitmap for this specific member and frame
                        const bitmap = await frameToBitmap(frameBytes, frameW, frameH, shouldUpscale, ptypeSlice);
                        memberBitmaps.push(bitmap);
                    }
                    outFrames.push(memberBitmaps);
                }

                if (currentGen !== null && currentGen !== stateManager.loadGeneration) {
                    outFrames.forEach(mArr => { if(mArr) mArr.forEach(b => { if (b && typeof b.close === 'function') b.close(); }); });
                    throw new Error("Load cancelled");
                }

                const volumeObj = {
                    frames: outFrames,
                    width: shouldUpscale ? frameW * 2 : frameW,
                    height: shouldUpscale ? frameH * 2 : frameH,
                    isVolume: true,
                    isEnsemble: true
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

    // 🌟 ABORT ONGOING DOWNLOADS
    if (stateManager.activeFetchController) {
        try { stateManager.activeFetchController.abort(); } catch(e){}
    }
    stateManager.activeFetchController = new AbortController();
    
    // 🌟 CLEAR PROMISE LOCKS
    stateManager.activeChunkPromises = {};

    clearThreeGlobeTextures();
    clearPolarTextures();
    clearVectorContours();

    for (const key in stateManager.loadedChunkBitmaps) {
        const item = stateManager.loadedChunkBitmaps[key];
        
        if (item && item.frames) {
            item.frames.forEach(frameOrArray => {
                // 🌟 Handle Ensemble Arrays
                if (Array.isArray(frameOrArray)) {
                    frameOrArray.forEach(bmp => {
                        if (bmp && typeof bmp.close === 'function') bmp.close();
                    });
                } 
                // 🌟 Handle Standard Single ImageBitmaps
                else if (frameOrArray && typeof frameOrArray.close === 'function') {
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
