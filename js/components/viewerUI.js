import { stateManager } from '../core/stateManager.js';
import { fetchManifest, loadChunkBitmap, purgeAllAppMemory } from '../core/dataLoader.js';
import { preloadRemainingChunks } from '../app.js';

let onStepChangeCallback = null;
let isPlaying = false;
let playInterval = null;
const PLAYBACK_SPEED_MS = 400;
let shaderLayerRef = null;

export function setShaderLayerReference(layer) {
    shaderLayerRef = layer;
}

export function initViewerUI(stepCallback) {
    onStepChangeCallback = stepCallback;

    const slider = document.getElementById('timeline-slider');
    const playBtn = document.getElementById('btn-play');
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    const navButtons = document.querySelectorAll('#top-nav .nav-tabs button');

    initModelRunDropdown();

    if (slider) {
        slider.addEventListener('input', (e) => {
            if (isPlaying) pausePlayback();
            const targetIndex = parseInt(e.target.value, 10);
            setStepIndex(targetIndex);
        });
    }

    if (playBtn) playBtn.addEventListener('click', togglePlayback);

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (isPlaying) pausePlayback();
            stepRelative(-1);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (isPlaying) pausePlayback();
            stepRelative(1);
        });
    }

    navButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
            navButtons.forEach((b) => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            const targetMode = e.currentTarget.getAttribute('data-target');
            console.log(`[UI] Active view switched to: ${targetMode}`);

            if (targetMode !== 'modelViewer') {
                if (isPlaying) pausePlayback();
                showToast(`Switching view...`);
                purgeAllAppMemory(shaderLayerRef);
            }
        });
    });
}

export function syncModelRunDropdown() {
    initModelRunDropdown();
}

function initModelRunDropdown() {
    const toggleBtn = document.getElementById('model-run-toggle');
    const menu = document.getElementById('model-run-menu');
    const labelSpan = document.getElementById('current-run-label');

    if (!toggleBtn || !menu) return;

    let anchorDate = null;
    if (stateManager.initTime) {
        let baseStr = stateManager.initTime;
        if (!baseStr.endsWith('Z') && !baseStr.includes('+') && !baseStr.includes('-')) {
            baseStr = baseStr.replace(' ', 'T') + 'Z';
        }
        anchorDate = new Date(baseStr);
    }

    if (!anchorDate || isNaN(anchorDate.getTime())) {
        const now = new Date();
        const currentHour = now.getUTCHours();
        const latestRunHour = Math.floor(currentHour / 6) * 6;
        anchorDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), latestRunHour, 0));
    }

    const runs = [];
    let currentDate = new Date(anchorDate.getTime());

    for (let i = 0; i < 28; i++) {
        const runHour = String(currentDate.getUTCHours()).padStart(2, '0') + 'Z';
        const options = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
        const dateStr = currentDate.toLocaleDateString('en-US', options);
        
        const runId = `${runHour} ${dateStr}`;
        runs.push({ 
            id: runId, 
            year: currentDate.getUTCFullYear(),
            month: String(currentDate.getUTCMonth() + 1).padStart(2, '0'),
            day: String(currentDate.getUTCDate()).padStart(2, '0'),
            cycle: runHour,
            rawDate: new Date(currentDate.getTime())
        });

        currentDate.setUTCHours(currentDate.getUTCHours() - 6);
    }

    if (runs.length > 0 && labelSpan) {
        labelSpan.textContent = runs[0].id;
    }

    menu.innerHTML = '';
    runs.forEach((run, index) => {
        const item = document.createElement('button');
        item.className = `run-dropdown-item ${index === 0 ? 'active' : ''}`;
        item.setAttribute('data-run', run.id);
        item.innerHTML = `<span>Run Time: ${run.id}</span><span class="check-icon">✓</span>`;

        item.addEventListener('click', async () => {
            document.querySelectorAll('.run-dropdown-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            if (labelSpan) labelSpan.textContent = run.id;
            menu.style.display = 'none';

            if (isPlaying) pausePlayback();

            showToast(`Unloading previous run data...`);
            
            purgeAllAppMemory(shaderLayerRef);
            const thisGen = stateManager.loadGeneration;

            showToast(`Loading model run ${run.id}...`);
            try {
                stateManager.activeModelRun = run.id;
                
                await fetchManifest(run); 

                const bitmap0 = await loadChunkBitmap(0, thisGen);
                if (shaderLayerRef && thisGen === stateManager.loadGeneration) {
                    shaderLayerRef.preloadChunkTexture(0, bitmap0);
                }
                
                if (thisGen !== stateManager.loadGeneration) return;

                syncTimelineWithManifest();
                setStepIndex(0);

                if (typeof onStepChangeCallback === 'function') {
                    onStepChangeCallback(0, stateManager.globalSteps[0]);
                }

                hideToast();

                // 🌟 Preload ALL remaining chunks in background for the new run!
                preloadRemainingChunks(thisGen);

            } catch (err) {
                if (err.message !== "Load cancelled") {
                    console.error(err);
                    showToast(`❌ Failed to load run ${run.id}`);
                }
            }
        });

        menu.appendChild(item);
    });

    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        const isVisible = menu.style.display === 'block';
        menu.style.display = isVisible ? 'none' : 'block';
    };

    document.onclick = () => {
        menu.style.display = 'none';
    };
}

export function togglePlayback() {
    if (isPlaying) pausePlayback();
    else startPlayback();
}

export function startPlayback() {
    if (!stateManager.globalSteps || stateManager.globalSteps.length <= 1) return;
    
    isPlaying = true;
    updatePlayPauseUI();

    playInterval = setInterval(() => {
        let nextIndex = stateManager.currentStepIndex + 1;
        if (nextIndex >= stateManager.globalSteps.length) nextIndex = 0;
        setStepIndex(nextIndex);
    }, PLAYBACK_SPEED_MS);
}

export function pausePlayback() {
    isPlaying = false;
    if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
    }
    updatePlayPauseUI();
}

function stepRelative(delta) {
    if (!stateManager.globalSteps) return;
    const maxIndex = stateManager.globalSteps.length - 1;
    let targetIndex = stateManager.currentStepIndex + delta;

    if (targetIndex < 0) targetIndex = maxIndex;
    if (targetIndex > maxIndex) targetIndex = 0;

    setStepIndex(targetIndex);
}

function updatePlayPauseUI() {
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    
    if (playIcon && pauseIcon) {
        playIcon.style.display = isPlaying ? 'none' : 'block';
        pauseIcon.style.display = isPlaying ? 'block' : 'none';
    }
}

export function syncTimelineWithManifest() {
    const slider = document.getElementById('timeline-slider');
    const stepsCount = stateManager.globalSteps ? stateManager.globalSteps.length : 0;

    if (!slider || stepsCount === 0) return;

    slider.min = '0';
    slider.max = (stepsCount - 1).toString();
    slider.value = stateManager.currentStepIndex.toString();

    updateTimeLabel(stateManager.currentStepIndex);
}

export function setStepIndex(index) {
    if (!stateManager.globalSteps || index < 0 || index >= stateManager.globalSteps.length) return;

    stateManager.currentStepIndex = index;

    const slider = document.getElementById('timeline-slider');
    if (slider) slider.value = index.toString();

    updateTimeLabel(index);

    if (typeof onStepChangeCallback === 'function') {
        onStepChangeCallback(index, stateManager.globalSteps[index]);
    }
}

function updateTimeLabel(index) {
    const label = document.getElementById('time-label');
    const stepData = stateManager.globalSteps ? stateManager.globalSteps[index] : null;

    if (!stepData) return;

    const rawStep = stepData.step;
    let formattedStep = rawStep;

    if (typeof rawStep === 'number') {
        formattedStep = `F${String(rawStep).padStart(3, '0')}`;
    } else if (typeof rawStep === 'string' && !rawStep.startsWith('F')) {
        formattedStep = `F${rawStep.padStart(3, '0')}`;
    }

    if (label) label.textContent = `${formattedStep}`;
    updateForecastClock(stepData);
}

function updateForecastClock(stepData) {
    const appClock = document.getElementById('app-clock');

    if (!appClock) return;

    let stepHours = 0;
    const rawStep = stepData?.step ?? stepData?.forecast_hour ?? 0;
    
    if (typeof rawStep === 'number') {
        stepHours = rawStep;
    } else if (typeof rawStep === 'string') {
        stepHours = parseInt(rawStep.replace(/\D/g, ''), 10) || 0;
    }

    let baseTimeString = stateManager.initTime || stateManager.runTime;
    let validDate = null;

    if (baseTimeString) {
        if (!baseTimeString.endsWith('Z') && !baseTimeString.includes('+') && !baseTimeString.includes('-')) {
            baseTimeString = baseTimeString.replace(' ', 'T') + 'Z';
        }
        
        const baseTime = new Date(baseTimeString);
        validDate = new Date(baseTime.getTime() + (stepHours * 3600 * 1000));
    }

    if (!validDate || isNaN(validDate.getTime())) {
        appClock.textContent = "--:--";
        return;
    }

    const timeString = validDate.toLocaleTimeString([], { 
        weekday: 'short',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric', 
        minute: '2-digit', 
        timeZoneName: 'short' 
    });

    appClock.textContent = timeString;
}

export function showToast(message) {
    const toast = document.getElementById('status-toast');
    if (toast) {
        toast.textContent = message;
        toast.style.display = 'block';
    }
}

export function hideToast() {
    const toast = document.getElementById('status-toast');
    if (toast) {
        toast.style.display = 'none';
    }
}