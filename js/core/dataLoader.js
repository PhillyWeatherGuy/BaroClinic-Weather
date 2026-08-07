import { stateManager } from './stateManager.js';

export async function fetchManifest() {
    const resp = await fetch(stateManager.BASE_URL + 'manifest.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    stateManager.manifest = await resp.json();
    
    // 🌟 ADDED THIS: Look for common time properties in your JSON and save to state
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
    const imgResp = await fetch(stateManager.BASE_URL + chunk.file);
    const bitmap = await createImageBitmap(await imgResp.blob());
    stateManager.loadedChunkBitmaps[chunkIndex] = bitmap;
    return bitmap;
}