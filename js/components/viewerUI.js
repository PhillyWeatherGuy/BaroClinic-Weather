// js/components/viewerUI.js
import { stateManager } from '../core/stateManager.js';
import { fetchManifest, loadChunkBitmap, purgeAllAppMemory } from '../core/dataLoader.js';
import { preloadRemainingChunks, updateBasemapStyle, initLayer } from '../app.js';
import { showThreeGlobe, hideThreeGlobe, updateThreeGlobePalette } from '../layers/threeGlobe.js';

let onStepChangeCallback = null;
let onThemeChangeCallback = null;
let isPlaying = false;
let playInterval = null;
const PLAYBACK_SPEED_MS = 200;
let shaderLayerRef = null;
let isGlobe = false;

export function setShaderLayerReference(layer) {
    shaderLayerRef = layer;
}

/**
 * 🌟 2D Map <-> 3D Three.js Globe Engine Switcher with Glowing Icon
 */
export function initGlobeToggle(map) {
    const globeBtn = document.getElementById('btn-globe');
    if (!globeBtn) return;

    globeBtn.onclick = (e) => {
        e.stopPropagation();
        isGlobe = !isGlobe;

        if (isGlobe) {
            // 🌟 Activate 3D Three.js Globe Engine & Turn ON Glow
            showThreeGlobe();
            globeBtn.classList.add('active');
            console.log("🌐 3D Three.js Globe Engine Activated");
        } else {
            // 🌟 Return to 2D MapLibre Engine & Turn OFF Glow
            hideThreeGlobe();
            globeBtn.classList.remove('active');
            console.log("🗺️ 2D MapLibre Map Engine Activated");
        }
    };
}

/**
 * 🌟 DARK / LIGHT MODE THEME TOGGLE
 */
export function initThemeToggle() {
    const themeBtn = document.getElementById('btn-theme-toggle');
    if (!themeBtn) return;

    // Sync initial state (defaults to light mode)
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

export function getMaxLoadedStepIndex() {
    if (!stateManager.globalSteps || stateManager.globalSteps.length === 0) return 0;
    let maxIdx = 0;
    for (let i = 0; i < stateManager.globalSteps.length; i++) {
        const chunkIdx = stateManager.globalSteps[i].chunkIndex;
        if (stateManager.loadedChunkBitmaps[chunkIdx]) {
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

/**
 * 🌟 MODEL CATEGORY SUB-BAR & DYNAMIC MODEL SELECTOR
 */
export function initModelCategoryBar() {
    const modelBtn = document.getElementById('btn-model-menu');
    const categoryBar = document.getElementById('model-category-bar');
    const scrollContainer = categoryBar ? categoryBar.querySelector('.category-scroll-container') : null;
    const modelListContainer = document.getElementById('model-list-container');
    const catPills = categoryBar ? categoryBar.querySelectorAll('.model-cat-pill') : [];

    if (!modelBtn || !categoryBar) return;

    let modelsData = null;

    // Fetch config/models.json
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

    // Function to render models matching active category
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

            btn.addEventListener('click', () => {
                document.querySelectorAll('#model-list-container .model-select-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const labelSpan = modelBtn.querySelector('span');
                if (labelSpan) labelSpan.textContent = model.name;

                stateManager.activeModel = model.id;
                console.log(`[UI] Active model selected: ${model.id}`);
            });

            modelListContainer.appendChild(btn);
        });
    }

    // 1. Toggle Sub-Bar on Model Button Click
    modelBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Close parameter category bar if open
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

    // 2. Category Pill Selection Listener
    catPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            catPills.forEach(p => p.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            const category = e.currentTarget.getAttribute('data-category');
            renderCategoryModels(category);
        });
    });

    // 3. 🌟 Mouse Drag-to-Scroll Logic for Desktop Users
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

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!categoryBar.contains(e.target) && !modelBtn.contains(e.target)) {
            categoryBar.style.display = 'none';
            modelBtn.classList.remove('active', 'open');
        }
    });
}

/**
 * 🌟 PARAMETER CATEGORY SUB-BAR & DYNAMIC PARAMETER SELECTOR
 */
export function initParameterCategoryBar() {
    const paramBtn = document.getElementById('btn-param-menu');
    const paramBar = document.getElementById('param-category-bar');
    const scrollContainer = paramBar ? paramBar.querySelector('.category-scroll-container') : null;
    const paramListContainer = document.getElementById('param-list-container');
    const catPills = paramBar ? paramBar.querySelectorAll('.param-cat-pill') : [];

    if (!paramBtn || !paramBar) return;

    let modelsData = null;

    // Fetch config/models.json
    fetch('./config/models.json')
        .then(resp => resp.ok ? resp.json() : null)
        .then(data => {
            if (data) {
                modelsData = data;
                const labelSpan = paramBtn.querySelector('span');
                if (labelSpan && modelsData.parameters?.[stateManager.activeParam]) {
                    labelSpan.textContent = modelsData.parameters[stateManager.activeParam].name;
                }
                // 🌟 Defaults to Thermodynamics category (where 2m Temperature lives)
                renderCategoryParameters('Thermodynamics');
            }
        })
        .catch(err => console.warn("Could not load config/models.json:", err));

    // Function to render parameters matching active category
    function renderCategoryParameters(categoryName) {
        if (!paramListContainer) return;
        paramListContainer.innerHTML = '';

        if (!modelsData || !modelsData.parameters) return;

        const targetCatLower = categoryName.toLowerCase();

        const matchingParams = Object.values(modelsData.parameters).filter(p => {
            if (!p.category) return false;
            const pCatLower = p.category.toLowerCase();
            if (pCatLower === targetCatLower) return true;
            // Matches "Surface" or "Precipitation" for the "Surface and Precipitation" pill
            if (targetCatLower.includes('surface') && targetCatLower.includes('precipitation')) {
                return pCatLower.includes('surface') || pCatLower.includes('precipitation');
            }
            return false;
        });

        if (matchingParams.length === 0) {
            paramListContainer.innerHTML = `<span class="no-models-msg">No ${categoryName} parameters available</span>`;
            return;
        }

        matchingParams.forEach((param, idx) => {
            const btn = document.createElement('button');
            btn.className = `model-select-btn ${stateManager.activeParam === param.id ? 'active' : ''}`;
            btn.setAttribute('data-param-id', param.id);
            btn.textContent = param.name;

            // 🌟 PARAMETER SWITCH EVENT LISTENER
            btn.addEventListener('click', async () => {
                document.querySelectorAll('#param-list-container .model-select-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const labelSpan = paramBtn.querySelector('span');
                if (labelSpan) labelSpan.textContent = param.name;

                if (stateManager.activeParam === param.id) return;

                if (isPlaying) pausePlayback();

                showToast(`Loading ${param.name}...`);
                
                stateManager.activeParam = param.id;
                stateManager.activeShader = param.shader || 'scalar';

                // 🌟 1. Dynamic Basemap Style Switcher (Supports Light and Dark Mode URLs)
                const targetStyle = (stateManager.currentTheme === 'dark' && param.map_style_dark)
                    ? param.map_style_dark
                    : (param.map_style_light || param.map_style);

                if (targetStyle && typeof updateBasemapStyle === 'function') {
                    updateBasemapStyle(targetStyle);
                }

                // 🌟 2. Unload previous memory & destroy old layer
                purgeAllAppMemory(shaderLayerRef);
                const thisGen = stateManager.loadGeneration;

                // 🌟 3. Mount matching shader layer based on models.json config!
                if (typeof initLayer === 'function') {
                    initLayer(param.shader || 'scalar');
                }

                // 🌟 4. Swap GPU Palettes for the NEW Shader Layer & 3D Globe
                if (shaderLayerRef && typeof shaderLayerRef.updatePalette === 'function') {
                    shaderLayerRef.updatePalette(param.palette || param.id);
                }
                try {
                    updateThreeGlobePalette(param.palette || param.id);
                } catch (e) {}

                try {
                    // 🌟 5. Fetch Parameter Manifest
                    await fetchManifest(null, stateManager.activeModel, stateManager.activeParam);

                    // 🌟 6. Load Chunk 0 and Render Frame 0
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

                    // 🌟 7. Background Preload
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

    // 1. Toggle Sub-Bar on Parameter Button Click
    paramBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Close model category bar if open
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

    // 2. Category Pill Selection Listener
    catPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            catPills.forEach(p => p.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            const category = e.currentTarget.getAttribute('data-category');
            renderCategoryParameters(category);
        });
    });

    // 3. Mouse Drag-to-Scroll Logic for Desktop
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

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!paramBar.contains(e.target) && !paramBtn.contains(e.target)) {
            paramBar.style.display = 'none';
            paramBtn.classList.remove('active', 'open');
        }
    });
}

export function initViewerUI(stepCallback, themeCallback = null) {
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

    if (slider) {
        slider.addEventListener('input', (e) => {
            if (isPlaying) pausePlayback();

            const maxLoadedIdx = getMaxLoadedStepIndex();
            let targetIndex = parseInt(e.target.value, 10);

            if (targetIndex > maxLoadedIdx) {
                targetIndex = maxLoadedIdx;
                slider.value = maxLoadedIdx.toString();
            }

            setStepIndex(targetIndex);
            updateSliderTrackAndBounds();
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
