// js/components/basemapEditor.js
import { stateManager } from '../core/stateManager.js';

const BASEMAP_PRESETS = [
    {
        id: 'default',
        name: 'Default',
        previewLight: './assets/preset-default-light.png.JPEG',
        previewDark: './assets/preset-default-dark.png.JPEG'
    },
    {
        id: 'satellite',
        name: 'Satellite',
        previewLight: './assets/preset-satellite.png.JPEG',
        previewDark: './assets/preset-satellite.png.JPEG'
    },
    {
        id: 'street',
        name: 'Street Map',
        previewLight: './assets/preset-street.png.JPEG',
        previewDark: './assets/preset-street.png.JPEG'
    }
];

let presetCallback = null;
let editorChangeCallback = null;

function getPreviewUrl(preset, theme) {
    return theme === 'light' ? preset.previewLight : preset.previewDark;
}

export function setBasemapPresetCallback(callback) {
    presetCallback = callback;
}

export function setBasemapEditorChangeCallback(callback) {
    editorChangeCallback = callback;
}

export function syncBasemapEditorTheme(theme = stateManager.currentTheme || 'dark') {
    const bodyEl = document.getElementById('basemap-editor-body');
    if (!bodyEl) return;

    BASEMAP_PRESETS.forEach((preset) => {
        const img = bodyEl.querySelector(`.basemap-preset-card[data-preset-id="${preset.id}"] .basemap-preset-img`);
        if (img) {
            img.src = getPreviewUrl(preset, theme);
        }
    });
}

export function syncBasemapColorInputs(baseColors = { land: '#ededed', water: '#f5fdff' }) {
    const isSatellite = stateManager.activeBasemapPreset === 'satellite';
    const overrides = stateManager.basemapOverrides || {};

    const landColor = overrides.landColor || baseColors.land || '#ededed';
    const waterColor = overrides.waterColor || baseColors.water || '#f5fdff';

    const controls = document.getElementById('basemap-land-water-controls');
    const note = document.getElementById('basemap-satellite-note');
    const landInput = document.getElementById('basemap-land-color');
    const landHex = document.getElementById('basemap-land-hex');
    const resetLandBtn = document.getElementById('btn-reset-land-color');
    const waterInput = document.getElementById('basemap-water-color');
    const waterHex = document.getElementById('basemap-water-hex');
    const resetWaterBtn = document.getElementById('btn-reset-water-color');

    if (controls) controls.classList.toggle('is-disabled', isSatellite);
    if (note) note.style.display = isSatellite ? 'block' : 'none';

    if (landInput) {
        landInput.value = landColor;
        landInput.disabled = isSatellite;
    }
    if (landHex) landHex.textContent = isSatellite ? 'N/A' : landColor.toUpperCase();
    if (resetLandBtn) resetLandBtn.disabled = isSatellite || !overrides.landColor;

    if (waterInput) {
        waterInput.value = waterColor;
        waterInput.disabled = isSatellite;
    }
    if (waterHex) waterHex.textContent = isSatellite ? 'N/A' : waterColor.toUpperCase();
    if (resetWaterBtn) resetWaterBtn.disabled = isSatellite || !overrides.waterColor;
}

function renderEditorSections(bodyEl) {
    const currentTheme = stateManager.currentTheme || 'dark';
    const activePreset = stateManager.activeBasemapPreset || 'default';

    bodyEl.innerHTML = `
        <section class="basemap-editor-section">
            <h3 class="basemap-section-header">Presets</h3>
            <div class="basemap-presets-grid">
                ${BASEMAP_PRESETS.map((preset) => `
                    <button
                        type="button"
                        class="basemap-preset-card ${activePreset === preset.id ? 'active' : ''}"
                        data-preset-id="${preset.id}"
                    >
                        <div class="basemap-preset-thumb">
                            <img
                                class="basemap-preset-img"
                                src="${getPreviewUrl(preset, currentTheme)}"
                                alt="${preset.name} basemap preview"
                                loading="lazy"
                            />
                        </div>
                        <span class="basemap-preset-name">${preset.name}</span>
                    </button>
                `).join('')}
            </div>
        </section>

        <section class="basemap-editor-section">
            <h3 class="basemap-section-header">Map Editor</h3>
            <div id="basemap-satellite-note" class="basemap-disabled-note" style="display: none;">
                Land and water colors are disabled on Satellite imagery.
            </div>
            <div id="basemap-land-water-controls" class="basemap-editor-controls">
                <div class="basemap-control-row">
                    <span class="basemap-control-label">Land</span>
                    <div class="basemap-color-group">
                        <input id="basemap-land-color" class="basemap-color-input" type="color" value="#ededed" aria-label="Land color" />
                        <span id="basemap-land-hex" class="basemap-color-hex">#EDEDED</span>
                        <button id="btn-reset-land-color" class="basemap-reset-btn" type="button" disabled>Reset</button>
                    </div>
                </div>
                <div class="basemap-control-row">
                    <span class="basemap-control-label">Water</span>
                    <div class="basemap-color-group">
                        <input id="basemap-water-color" class="basemap-color-input" type="color" value="#f5fdff" aria-label="Water color" />
                        <span id="basemap-water-hex" class="basemap-color-hex">#F5FDFF</span>
                        <button id="btn-reset-water-color" class="basemap-reset-btn" type="button" disabled>Reset</button>
                    </div>
                </div>
            </div>
        </section>
    `;

    bodyEl.querySelectorAll('.basemap-preset-card').forEach((card) => {
        card.addEventListener('click', () => {
            const presetId = card.dataset.presetId;
            if (stateManager.activeBasemapPreset === presetId) return;
            stateManager.activeBasemapPreset = presetId;
            stateManager.basemapOverrides = { landColor: null, waterColor: null };

            bodyEl.querySelectorAll('.basemap-preset-card').forEach((c) => {
                c.classList.toggle('active', c.dataset.presetId === presetId);
            });

            if (typeof presetCallback === 'function') {
                presetCallback(presetId);
            }
        });
    });

    const landInput = document.getElementById('basemap-land-color');
    const waterInput = document.getElementById('basemap-water-color');
    const resetLandBtn = document.getElementById('btn-reset-land-color');
    const resetWaterBtn = document.getElementById('btn-reset-water-color');

    if (landInput) {
        landInput.addEventListener('input', (e) => {
            if (stateManager.activeBasemapPreset === 'satellite') return;
            stateManager.basemapOverrides.landColor = e.target.value;
            if (typeof editorChangeCallback === 'function') {
                editorChangeCallback();
            }
        });
    }

    if (waterInput) {
        waterInput.addEventListener('input', (e) => {
            if (stateManager.activeBasemapPreset === 'satellite') return;
            stateManager.basemapOverrides.waterColor = e.target.value;
            if (typeof editorChangeCallback === 'function') {
                editorChangeCallback();
            }
        });
    }

    if (resetLandBtn) {
        resetLandBtn.addEventListener('click', () => {
            stateManager.basemapOverrides.landColor = null;
            if (typeof editorChangeCallback === 'function') {
                editorChangeCallback();
            }
        });
    }

    if (resetWaterBtn) {
        resetWaterBtn.addEventListener('click', () => {
            stateManager.basemapOverrides.waterColor = null;
            if (typeof editorChangeCallback === 'function') {
                editorChangeCallback();
            }
        });
    }
}

export function initBasemapEditor() {
    const toggleBtn = document.getElementById('btn-basemap-editor');
    const closeBtn = document.getElementById('btn-close-basemap-editor');
    const panel = document.getElementById('basemap-editor-panel');
    const bodyEl = document.getElementById('basemap-editor-body');

    if (!toggleBtn || !panel) return;

    if (!stateManager.activeBasemapPreset) {
        stateManager.activeBasemapPreset = 'default';
    }
    if (!stateManager.basemapOverrides) {
        stateManager.basemapOverrides = { landColor: null, waterColor: null };
    }

    if (bodyEl) {
        renderEditorSections(bodyEl);
        syncBasemapColorInputs();
    }

    const setOpen = (isOpen) => {
        panel.classList.toggle('open', isOpen);
        panel.setAttribute('aria-hidden', String(!isOpen));
        toggleBtn.classList.toggle('active', isOpen);
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
    };

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!panel.classList.contains('open'));
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(false);
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.classList.contains('open')) {
            setOpen(false);
        }
    });
}
