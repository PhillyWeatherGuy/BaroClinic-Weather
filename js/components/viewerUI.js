// js/components/viewerUI.js
import { stateManager } from '../core/stateManager.js';
import { fetchManifest, loadChunkBitmap, purgeAllAppMemory } from '../core/dataLoader.js';
import { preloadRemainingChunks, updateBasemapStyle, initLayer } from '../app.js';
import { showThreeGlobe, hideThreeGlobe, updateThreeGlobePalette } from '../layers/threeGlobe.js';
import { updatePolarPalette } from '../layers/polarMap.js';

// 🛰️ Radar Imports (Fixed Path)
import { radarState } from '../core/radarLoader.js';
import { 
    setRadarFrame, 
    toggleRadarPlayback, 
    pauseRadarPlayback 
} from './radarUI.js';

let onStepChangeCallback = null;
let onThemeChangeCallback = null;
let onViewChangeCallback = null;
let onZoomKeyCallback = null;
let isPlaying = false;
let playInterval = null;
const PLAYBACK_SPEED_MS = 200;
let shaderLayerRef = null;
let highestPreloadedChunk = 0;

let cursorX = window.innerWidth / 2;
let cursorY = window.innerHeight / 2;
window.addEventListener('mousemove', (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
}, { passive: true });

export function setShaderLayerReference(layer) {
    shaderLayerRef = layer;
}

function initKeyboardControls(zoomCallback = null) {
    onZoomKeyCallback = zoomCallback;

    let keyHoldTimeout = null;
    let keyHoldInterval = null;
    let activeKey = null;

    const FAST_SCRUB_INTERVAL_MS = 40;
    const HOLD_DELAY_MS = 250;

    function handleStep(delta) {
        if (stateManager.activeMode === 'radar') {
            pauseRadarPlayback();
            if (!radarState.frames || radarState.frames.length === 0) return;
            let nextIdx = radarState.activeFrameIndex + delta;
            if (nextIdx < 0) nextIdx = radarState.frames.length - 1;
            if (nextIdx >= radarState.frames.length) nextIdx = 0;
            setRadarFrame(nextIdx);
            return;
        }

        if (isPlaying) pausePlayback();
        stepRelative(delta);
    }

    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
        if (e.target.tagName === 'TEXTAREA') return;

        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
        }

        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            if (activeKey === e.key) return;

            if (keyHoldTimeout) clearTimeout(keyHoldTimeout);
            if (keyHoldInterval) clearInterval(keyHoldInterval);

            activeKey = e.key;
            const delta = (e.key === 'ArrowRight') ? 1 : -1;

            handleStep(delta);

            keyHoldTimeout = setTimeout(() => {
                keyHoldInterval = setInterval(() => {
                    handleStep(delta);
                }, FAST_SCRUB_INTERVAL_MS);
            }, HOLD_DELAY_MS);
        } else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
            e.preventDefault();
            if (typeof onZoomKeyCallback === 'function') {
                onZoomKeyCallback(1, cursorX, cursorY);
            }
        } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
            e.preventDefault();
            if (typeof onZoomKeyCallback === 'function') {
                onZoomKeyCallback(-1, cursorX, cursorY);
            }
        } else if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            if (stateManager.activeMode === 'radar') {
                toggleRadarPlayback();
            } else {
                togglePlayback();
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            if (activeKey === e.key) {
                activeKey = null;
                if (keyHoldTimeout) clearTimeout(keyHoldTimeout);
                if (keyHoldInterval) clearInterval(keyHoldInterval);
                keyHoldTimeout = null;
                keyHoldInterval = null;
            }
        }
    });

    window.addEventListener('blur', () => {
        activeKey = null;
        if (keyHoldTimeout) clearTimeout(keyHoldTimeout);
        if (keyHoldInterval) clearInterval(keyHoldInterval);
        keyHoldTimeout = null;
        keyHoldInterval = null;
    });
}

export function initViewSelector(viewCallback = null) {
    onViewChangeCallback = viewCallback;

    const toggleBtn = document.getElementById('btn-view-toggle');
    const menu = document.getElementById('view-dropdown-menu');
    const optionBtns = document.querySelectorAll('.view-option-btn');

    if (!menu) return;

    const currentView = stateManager.activeView || '2d';
    optionBtns.forEach(btn => {
        if (btn.getAttribute('data-view') === currentView) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    if (toggleBtn) {
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            const isVisible = menu.style.display === 'flex' || menu.style.display === 'block';
            menu.style.display = isVisible ? 'none' : 'flex';
        };
    }

    optionBtns.forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const targetView = btn.getAttribute('data-view');
            if (!targetView) return;

            // 🌟 Guard: Radar is strictly 2D. Prevent desktop pill clicks from breaking radar mode
            if (stateManager.activeMode === 'radar' && targetView !== '2d') {
                showToast('3D & Polar projections are disabled in Radar mode');
                setTimeout(() => hideToast(), 1800);
                return;
            }

            optionBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            stateManager.activeView = targetView;

            if (window.innerWidth < 1024) {
                menu.style.display = 'none';
            }

            console.log(`🌐 [UI] View changed to: ${targetView}`);

            if (typeof onViewChangeCallback === 'function') {
                onViewChangeCallback(targetView);
            }
        };
    });

    document.addEventListener('click', (e) => {
        if (window.innerWidth < 1024 && menu && toggleBtn) {
            if (!menu.contains(e.target) && !toggleBtn.contains(e.target)) {
                menu.style.display = 'none';
            }
        }
    });
}

export function initThemeToggle() {
    const themeBtn = document.getElementById('btn-theme-toggle');
    if (!themeBtn) return;

    if (stateManager.currentTheme === 'light') {
        themeBtn.classList.add('light-mode');
    } else {
        themeBtn.classList.remove('light-mode');
    }

    themeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newTheme = stateManager.currentTheme === 'light' ? 'dark' : 'light';
        stateManager.currentTheme = newTheme;

        if (newTheme === 'light') {
            themeBtn.classList.add('light-mode');
        } else {
            themeBtn.classList.remove('light-mode');
        }

        console.log(`[UI] Theme switched to: ${newTheme}`);

        if (typeof onThemeChangeCallback === 'function') {
            onThemeChangeCallback(newTheme);
        }
    });
}

/**
 * 🌟 MEMORY-AWARE STEP INDEX CHECKER (For Model Viewer)
 */
export function getMaxLoadedStepIndex() {
    if (!stateManager.globalSteps || stateManager.globalSteps.length === 0) {
        highestPreloadedChunk = 0;
        return 0;
    }

    for (const key of Object.keys(stateManager.loadedChunkBitmaps)) {
        const num = Number(key);
        if (!isNaN(num) && num > highestPreloadedChunk) {
            highestPreloadedChunk = num;
        }
    }
    for (const key of Object.keys(stateManager.chunkPixelData)) {
        const num = Number(key);
        if (!isNaN(num) && num > highestPreloadedChunk) {
            highestPreloadedChunk = num;
        }
    }

    let maxIdx = 0;
    for (let i = 0; i < stateManager.globalSteps.length; i++) {
        if (stateManager.globalSteps[i].chunkIndex <= highestPreloadedChunk) {
            maxIdx = i;
        } else {
            break;
        }
    }
    return maxIdx;
}

export function updateSliderTrackAndBounds() {
    const slider = document.getElementById('timeline-slider');
    if (!slider || !stateManager.globalSteps || stateManager.globalSteps.length === 0) return;

    const totalSteps = stateManager.globalSteps.length - 1;
    if (totalSteps <= 0) return;

    const maxLoadedIdx = getMaxLoadedStepIndex();
    const loadedPercent = (maxLoadedIdx / totalSteps) * 100;

    slider.style.background = `linear-gradient(to right, 
        rgba(255, 255, 255, 0.15) 0%, 
        rgba(255, 255, 255, 0.15) ${loadedPercent}%, 
        rgba(239, 68, 68, 0.6) ${loadedPercent}%, 
        rgba(239, 68, 68, 0.6) 100%)`;
}

export function initModelCategoryBar() {
    const modelBtn = document.getElementById('btn-model-menu');
    const categoryBar = document.getElementById('model-category-bar');
    const scrollContainer = categoryBar ? categoryBar.querySelector('.category-scroll-container') : null;
    const modelListContainer = document.getElementById('model-list-container');
    const catPills = categoryBar ? categoryBar.querySelectorAll('.model-cat-pill') : [];

    if (!modelBtn || !categoryBar) return;

    let modelsData = null;

    fetch('./config/models.json')
        .then(resp => resp.ok ? resp.json() : null)
        .then(data => {
            if (data) {
                modelsData = data;
                const labelSpan = modelBtn.querySelector('span');
                if (labelSpan && modelsData.models?.[stateManager.activeModel]) {
                    labelSpan.textContent = modelsData.models[stateManager.activeModel].name;
                }
                renderCategoryModels('Global');
            }
        })
        .catch(err => console.warn("Could not load config/models.json:", err));

    function renderCategoryModels(categoryName) {
        if (!modelListContainer) return;
        modelListContainer.innerHTML = '';

        if (!modelsData || !modelsData.models) return;

        const matchingModels = Object.values(modelsData.models).filter(
            m => m.category && m.category.toLowerCase() === categoryName.toLowerCase()
        );

        if (matchingModels.length === 0) {
            modelListContainer.innerHTML = `<span class="no-models-msg">No ${categoryName} models available</span>`;
            return;
        }

        matchingModels.forEach((model, idx) => {
            const btn = document.createElement('button');
            btn.className = `model-select-btn ${idx === 0 ? 'active' : ''}`;
            btn.setAttribute('data-model-id', model.id);
            btn.textContent = model.name;

            btn.addEventListener('click', async () => {
                document.querySelectorAll('#model-list-container .model-select-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const labelSpan = modelBtn.querySelector('span');
                if (labelSpan) labelSpan.textContent = model.name;

                if (stateManager.activeModel === model.id) return;

                if (isPlaying) pausePlayback();

                showToast(`Loading model ${model.name}...`);
                stateManager.activeModel = model.id;
                
                purgeAllAppMemory(shaderLayerRef);
                highestPreloadedChunk = 0;
                const thisGen = stateManager.loadGeneration;

                try {
                    await fetchManifest(null, stateManager.activeModel, stateManager.activeParam);

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
                    preloadRemainingChunks(thisGen);
                } catch (err) {
                    if (err.message !== "Load cancelled") {
                        console.error(err);
                        showToast(`❌ Failed to load model ${model.name}`);
                    }
                }
            });

            modelListContainer.appendChild(btn);
        });
    }

    modelBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Guard: In radar mode, clicking this button shouldn't open model categories
        if (stateManager.activeMode === 'radar') {
            return;
        }

        const paramBar = document.getElementById('param-category-bar');
        const paramBtn = document.getElementById('btn-param-menu');
        if (paramBar) paramBar.style.display = 'none';
        if (paramBtn) paramBtn.classList.remove('active', 'open');

        const isOpen = categoryBar.style.display === 'block';

        if (isOpen) {
            categoryBar.style.display = 'none';
            modelBtn.classList.remove('active', 'open');
        } else {
            categoryBar.style.display = 'block';
            modelBtn.classList.add('active', 'open');
        }
    });

    catPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            catPills.forEach(p => p.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            const category = e.currentTarget.getAttribute('data-category');
            renderCategoryModels(category);
        });
    });

    if (scrollContainer) {
        let isDown = false;
        let startX;
        let scrollLeft;

        scrollContainer.addEventListener('mousedown', (e) => {
            isDown = true;
            startX = e.pageX - scrollContainer.offsetLeft;
            scrollLeft = scrollContainer.scrollLeft;
        });

        scrollContainer.addEventListener('mouseleave', () => { isDown = false; });
        scrollContainer.addEventListener('mouseup', () => { isDown = false; });

        scrollContainer.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - scrollContainer.offsetLeft;
            const walk = (x - startX) * 1.8;
            scrollContainer.scrollLeft = scrollLeft - walk;
        });
    }

    document.addEventListener('click', (e) => {
        if (!categoryBar.contains(e.target) && !modelBtn.contains(e.target)) {
            categoryBar.style.display = 'none';
            modelBtn.classList.remove('active', 'open');
        }
    });
}

export function initParameterCategoryBar() {
    const paramBtn = document.getElementById('btn-param-menu');
    const paramBar = document.getElementById('param-category-bar');
    const scrollContainer = paramBar ? paramBar.querySelector('.category-scroll-container') : null;
    const paramListContainer = document.getElementById('param-list-container');
    const catPills = paramBar ? paramBar.querySelectorAll('.param-cat-pill') : [];

    if (!paramBtn || !paramBar) return;

    let modelsData = null;

    fetch('./config/models.json')
        .then(resp => resp.ok ? resp.json() : null)
        .then(data => {
            if (data) {
                modelsData = data;
                const activeCfg = modelsData.parameters?.[stateManager.activeParam];
                stateManager.paramConfig = activeCfg;

                const labelSpan = paramBtn.querySelector('span');
                if (labelSpan && activeCfg) {
                    labelSpan.textContent = activeCfg.name;
                }
                renderCategoryParameters('Thermodynamics');
            }
        })
        .catch(err => console.warn("Could not load config/models.json:", err));

    function renderCategoryParameters(categoryName) {
        if (!paramListContainer) return;
        paramListContainer.innerHTML = '';

        if (!modelsData || !modelsData.parameters) return;

        const targetCatLower = categoryName.toLowerCase();

        const matchingParams = Object.values(modelsData.parameters).filter(p => {
            if (!p.category) return false;
            const pCatLower = p.category.toLowerCase();
            if (pCatLower === targetCatLower) return true;
            if (targetCatLower.includes('surface') && targetCatLower.includes('precipitation')) {
                return pCatLower.includes('surface') || pCatLower.includes('precipitation');
            }
            return false;
        });

        if (matchingParams.length === 0) {
            paramListContainer.innerHTML = `<span class="no-models-msg">No ${categoryName} parameters available</span>`;
            return;
        }

        matchingParams.forEach((param) => {
            const btn = document.createElement('button');
            btn.className = `model-select-btn ${stateManager.activeParam === param.id ? 'active' : ''}`;
            btn.setAttribute('data-param-id', param.id);
            btn.textContent = param.name;

            btn.addEventListener('click', async () => {
                document.querySelectorAll('#param-list-container .model-select-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const labelSpan = paramBtn.querySelector('span');
                if (labelSpan) labelSpan.textContent = param.name;

                if (stateManager.activeParam === param.id) return;

                if (isPlaying) pausePlayback();

                showToast(`Loading ${param.name}...`);
                
                stateManager.paramConfig = param;
                stateManager.activeParam = param.id;
                stateManager.activeShader = param.shader || 'scalar';

                const targetStyle = (stateManager.currentTheme === 'dark' && param.map_style_dark)
                    ? param.map_style_dark
                    : (param.map_style_light || param.map_style);

                if (targetStyle && typeof updateBasemapStyle === 'function') {
                    updateBasemapStyle(targetStyle);
                }

                purgeAllAppMemory(shaderLayerRef);
                highestPreloadedChunk = 0;
                const thisGen = stateManager.loadGeneration;

                if (typeof initLayer === 'function') {
                    initLayer(param.shader || 'scalar');
                }

                if (shaderLayerRef && typeof shaderLayerRef.updatePalette === 'function') {
                    shaderLayerRef.updatePalette(param.palette || param.id);
                }
                try { updateThreeGlobePalette(param.palette || param.id); } catch (e) {}
                try { updatePolarPalette(param.palette || param.id); } catch (e) {}

                try {
                    await fetchManifest(null, stateManager.activeModel, stateManager.activeParam);

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
                    preloadRemainingChunks(thisGen);

                } catch (err) {
                    if (err.message !== "Load cancelled") {
                        console.error(err);
                        showToast(`❌ Failed to load parameter ${param.name}`);
                    }
                }
            });

            paramListContainer.appendChild(btn);
        });
    }

    paramBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Guard: In radar mode, clicking this button shouldn't open parameter categories
        if (stateManager.activeMode === 'radar') {
            return;
        }

        const modelBar = document.getElementById('model-category-bar');
        const modelBtn = document.getElementById('btn-model-menu');
        if (modelBar) modelBar.style.display = 'none';
        if (modelBtn) modelBtn.classList.remove('active', 'open');

        const isOpen = paramBar.style.display === 'block';

        if (isOpen) {
            paramBar.style.display = 'none';
            paramBtn.classList.remove('active', 'open');
        } else {
            paramBar.style.display = 'block';
            paramBtn.classList.add('active', 'open');
        }
    });

    catPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            catPills.forEach(p => p.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            const category = e.currentTarget.getAttribute('data-category');
            renderCategoryParameters(category);
        });
    });

    if (scrollContainer) {
        let isDown = false;
        let startX;
        let scrollLeft;

        scrollContainer.addEventListener('mousedown', (e) => {
            isDown = true;
            startX = e.pageX - scrollContainer.offsetLeft;
            scrollLeft = scrollContainer.scrollLeft;
        });

        scrollContainer.addEventListener('mouseleave', () => { isDown = false; });
        scrollContainer.addEventListener('mouseup', () => { isDown = false; });

        scrollContainer.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - scrollContainer.offsetLeft;
            const walk = (x - startX) * 1.8;
            scrollContainer.scrollLeft = scrollLeft - walk;
        });
    }

    document.addEventListener('click', (e) => {
        if (!paramBar.contains(e.target) && !paramBtn.contains(e.target)) {
            paramBar.style.display = 'none';
            paramBtn.classList.remove('active', 'open');
        }
    });
}

export function initViewerUI(stepCallback, themeCallback = null, viewCallback = null, zoomCallback = null) {
    onStepChangeCallback = stepCallback;
    onThemeChangeCallback = themeCallback;

    const slider = document.getElementById('timeline-slider');
    const playBtn = document.getElementById('btn-play');
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    const navButtons = document.querySelectorAll('#top-nav .nav-tabs button');

    initModelRunDropdown();
    initModelCategoryBar();
    initParameterCategoryBar();
    initThemeToggle();
    initViewSelector(viewCallback);
    initKeyboardControls(zoomCallback);

    // 🌟 Unified Slider Input (Auto-routes between Model Viewer and Radar)
    if (slider) {
        slider.addEventListener('input', (e) => {
            const targetVal = parseInt(e.target.value, 10);

            if (stateManager.activeMode === 'radar') {
                pauseRadarPlayback();
                setRadarFrame(targetVal);
                return;
            }

            // Model Viewer mode:
            if (isPlaying) pausePlayback();

            const maxLoadedIdx = getMaxLoadedStepIndex();
            let targetIndex = targetVal;

            if (targetIndex > maxLoadedIdx) {
                targetIndex = maxLoadedIdx;
                slider.value = maxLoadedIdx.toString();
            }

            setStepIndex(targetIndex);
            updateSliderTrackAndBounds();
        });
    }

    // 🌟 Unified Play/Pause Button
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (stateManager.activeMode === 'radar') {
                toggleRadarPlayback();
            } else {
                togglePlayback();
            }
        });
    }

    // 🌟 Unified Previous Frame Button
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (stateManager.activeMode === 'radar') {
                pauseRadarPlayback();
                if (!radarState.frames || radarState.frames.length === 0) return;
                let prevIdx = radarState.activeFrameIndex - 1;
                if (prevIdx < 0) prevIdx = radarState.frames.length - 1;
                setRadarFrame(prevIdx);
            } else {
                if (isPlaying) pausePlayback();
                stepRelative(-1);
            }
        });
    }

    // 🌟 Unified Next Frame Button
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (stateManager.activeMode === 'radar') {
                pauseRadarPlayback();
                if (!radarState.frames || radarState.frames.length === 0) return;
                let nextIdx = radarState.activeFrameIndex + 1;
                if (nextIdx >= radarState.frames.length) nextIdx = 0;
                setRadarFrame(nextIdx);
            } else {
                if (isPlaying) pausePlayback();
                stepRelative(1);
            }
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
                highestPreloadedChunk = 0;
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
            highestPreloadedChunk = 0;
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

        // Guard: Radar does not have forecast run times; do not open menu
        if (stateManager.activeMode === 'radar') {
            return;
        }

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
        const maxLoadedIdx = getMaxLoadedStepIndex();
        let nextIndex = stateManager.currentStepIndex + 1;

        if (nextIndex > maxLoadedIdx) {
            if (maxLoadedIdx === stateManager.globalSteps.length - 1) {
                nextIndex = 0;
            } else {
                nextIndex = maxLoadedIdx;
            }
        }

        setStepIndex(nextIndex);
        updateSliderTrackAndBounds();
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
    const maxLoadedIdx = getMaxLoadedStepIndex();
    let targetIndex = stateManager.currentStepIndex + delta;

    if (targetIndex < 0) targetIndex = maxLoadedIdx;
    if (targetIndex > maxLoadedIdx) targetIndex = 0;

    setStepIndex(targetIndex);
    updateSliderTrackAndBounds();
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
    updateSliderTrackAndBounds();
}

export function setStepIndex(index) {
    if (!stateManager.globalSteps || index < 0 || index >= stateManager.globalSteps.length) return;

    stateManager.currentStepIndex = index;

    const slider = document.getElementById('timeline-slider');
    if (slider) slider.value = index.toString();

    updateTimeLabel(index);
    updateSliderTrackAndBounds();

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
