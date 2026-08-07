import { stateManager } from '../core/stateManager.js';

let onStepChangeCallback = null;
let isPlaying = false;
let playInterval = null;
const PLAYBACK_SPEED_MS = 400; // Time per frame in milliseconds

/**
 * Initializes listeners for the timeline slider, play/pause controls, top navigation, and UI overlays.
 * @param {Function} stepCallback - Callback function executed when step changes
 */
export function initViewerUI(stepCallback) {
    onStepChangeCallback = stepCallback;

    const slider = document.getElementById('timeline-slider');
    const playBtn = document.getElementById('btn-play');
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    const navButtons = document.querySelectorAll('#top-nav .nav-tabs button');

    // 1. Timeline Slider scrubbing listener
    if (slider) {
        slider.addEventListener('input', (e) => {
            if (isPlaying) pausePlayback();
            const targetIndex = parseInt(e.target.value, 10);
            setStepIndex(targetIndex);
        });
    }

    // 2. Play / Pause button toggle
    if (playBtn) {
        playBtn.addEventListener('click', togglePlayback);
    }

    // 3. Step Forward / Backward buttons
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

    // 4. Navigation tab selection listener
    navButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
            navButtons.forEach((b) => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            const targetMode = e.currentTarget.getAttribute('data-target');
            console.log(`[UI] Active view switched to: ${targetMode}`);
        });
    });
}

/**
 * Toggles the forecast animation loop.
 */
export function togglePlayback() {
    if (isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}

export function startPlayback() {
    if (!stateManager.globalSteps || stateManager.globalSteps.length <= 1) return;
    
    isPlaying = true;
    updatePlayPauseUI();

    playInterval = setInterval(() => {
        let nextIndex = stateManager.currentStepIndex + 1;
        
        // Loop back to start if we hit the end
        if (nextIndex >= stateManager.globalSteps.length) {
            nextIndex = 0;
        }
        
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

/**
 * Steps forward (+1) or backward (-1) relative to current index.
 */
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

/**
 * Synchronizes the slider min, max, and current value after the manifest is fetched.
 */
export function syncTimelineWithManifest() {
    const slider = document.getElementById('timeline-slider');
    const stepsCount = stateManager.globalSteps ? stateManager.globalSteps.length : 0;

    if (!slider || stepsCount === 0) return;

    slider.min = '0';
    slider.max = (stepsCount - 1).toString();
    slider.value = stateManager.currentStepIndex.toString();

    updateTimeLabel(stateManager.currentStepIndex);
}

/**
 * Sets the current step index, updates UI display, and fires the frame update callback.
 * @param {number} index - Global step array index
 */
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

/**
 * Formats and updates the #time-label text and forecast valid local clock display.
 */
function updateTimeLabel(index) {
    const label = document.getElementById('time-label');
    const stepData = stateManager.globalSteps ? stateManager.globalSteps[index] : null;

    if (!stepData) return;

    // 1. Update Forecast Hour Label (e.g. "Forecast: F012" or compact "F012")
    const rawStep = stepData.step;
    let formattedStep = rawStep;

    if (typeof rawStep === 'number') {
        formattedStep = `F${String(rawStep).padStart(3, '0')}`;
    } else if (typeof rawStep === 'string' && !rawStep.startsWith('F')) {
        formattedStep = `F${rawStep.padStart(3, '0')}`;
    }

    if (label) label.textContent = `${formattedStep}`;

    // 2. Update Dynamic Forecast Local Time Clock
    updateForecastClock(stepData);
}

/**
 * Calculates the forecast frame's valid local time from a UTC base time.
 */
function updateForecastClock(stepData) {
    const appClock = document.getElementById('app-clock');

    if (!appClock) return;

    // 1. Get the forecast hour offset (e.g., "F012" -> 12)
    let stepHours = 0;
    const rawStep = stepData?.step ?? stepData?.forecast_hour ?? 0;
    
    if (typeof rawStep === 'number') {
        stepHours = rawStep;
    } else if (typeof rawStep === 'string') {
        // Strip out the 'F' so we just have the number
        stepHours = parseInt(rawStep.replace(/\D/g, ''), 10) || 0;
    }

    // 2. Get the model's initialization time
    let baseTimeString = stateManager.initTime || stateManager.runTime;
    let validDate = null;

    if (baseTimeString) {
        // Force the string to be parsed as UTC if it doesn't specify a timezone
        if (!baseTimeString.endsWith('Z') && !baseTimeString.includes('+') && !baseTimeString.includes('-')) {
            baseTimeString = baseTimeString.replace(' ', 'T') + 'Z';
        }
        
        const baseTime = new Date(baseTimeString);
        
        // Add the forecast hour offset in milliseconds (1 hour = 3,600,000 ms)
        validDate = new Date(baseTime.getTime() + (stepHours * 3600 * 1000));
    }

    // 3. Fallback if the manifest hasn't loaded the init time yet
    if (!validDate || isNaN(validDate.getTime())) {
        appClock.textContent = "--:--";
        return;
    }

    // 4. Format the calculated UTC date into the viewer's local timezone
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