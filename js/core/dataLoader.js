import { stateManager } from './stateManager.js';

export async function fetchManifest(run = null) {
    let fileName = 'manifest.json';
    
    // If a specific historical run is selected from dropdown:
    if (run && run.year && run.month && run.day && run.cycle) {
        const dateStr = `${run.year}${run.month}${run.day}`;
        const cycleStr = run.cycle.toLowerCase(); // e.g. "12z"
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

    const bitmap = await createImageBitmap(await imgResp.blob());
    stateManager.loadedChunkBitmaps[chunkIndex] = bitmap;
    return bitmap;
}

/**
 * 🌟 MEMORY CLEANUP: Closes CPU/RAM image bitmaps immediately to prevent memory leaks
 */
export function purgeLoadedBitmaps() {
    for (const key in stateManager.loadedChunkBitmaps) {
        const bitmap = stateManager.loadedChunkBitmaps[key];
        if (bitmap && typeof bitmap.close === 'function') {
            bitmap.close();
        }
    }
    stateManager.loadedChunkBitmaps = {};
}