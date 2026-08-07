import { stateManager } from '../core/stateManager.js';

let onStepChangeCallback = null;

/**
 * Initializes listeners for the timeline slider, top navigation, and UI overlays.
 * @param {Function} stepCallback - Callback function executed when step changes (passed to app.js to trigger GPU redraws)
 */
export function initViewerUI(stepCallback) {
    onStepChangeCallback = stepCallback;

    const slider = document.getElementById('timeline-slider');
    const navButtons = document.querySelectorAll('#top-nav .nav-tabs button');

    // 1. Timeline Slider scrubbing listener
    if (slider) {
        slider.addEventListener('input', (e) => {
            const targetIndex = parseInt(e.target.value, 10);
            setStepIndex(targetIndex);
        });
    }

    // 2. Navigation tab selection listener
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
 * Synchronizes the slider min, max, and current value after the manifest is fetched.
 */
export function syncTimelineWithManifest() {
    const slider = document.getElementById('timeline-slider');
    const stepsCount = stateManager.globalSteps.length;

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

    // Update global state
    stateManager.currentStepIndex = index;

    // Sync slider position if triggered externally
    const slider = document.getElementById('timeline-slider');
    if (slider) slider.value = index.toString();

    // Update text label (e.g. Forecast: F006)
    updateTimeLabel(index);

    // Notify app.js to update WebGL textures / shader uniforms
    if (typeof onStepChangeCallback === 'function') {
        onStepChangeCallback(index, stateManager.globalSteps[index]);
    }
}

/**
 * Formats and updates the #time-label text.
 */
function updateTimeLabel(index) {
    const label = document.getElementById('time-label');
    const stepData = stateManager.globalSteps[index];

    if (!label || !stepData) return;

    const rawStep = stepData.step;
    let formattedStep = rawStep;

    // Format numbers or raw strings to 'F000' format
    if (typeof rawStep === 'number') {
        formattedStep = `F${String(rawStep).padStart(3, '0')}`;
    } else if (typeof rawStep === 'string' && !rawStep.startsWith('F')) {
        formattedStep = `F${rawStep.padStart(3, '0')}`;
    }

    label.textContent = `Forecast: ${formattedStep}`;
}

/**
 * Toast banner helpers for engine/data loading status.
 */
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