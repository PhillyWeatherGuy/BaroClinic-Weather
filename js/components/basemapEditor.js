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

const BORDER_CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'oceanLand', label: 'Ocean / Land' },
    { id: 'national', label: 'National' },
    { id: 'state', label: 'State / Province' },
    { id: 'county', label: 'County' },
    { id: 'roads', label: 'Roads' }
];

const SUB_BORDER_IDS = ['oceanLand', 'national', 'state', 'county', 'roads'];

let presetCallback = null;
let editorChangeCallback = null;
let bordersExpanded = false;

function createDefaultBordersState() {
    return {
        all: { visible: true, thickness: 1, color: null },
        oceanLand: { visible: true, thickness: 1, color: null },
        national: { visible: true, thickness: 1, color: null },
        state: { visible: true, thickness: 1, color: null },
        county: { visible: true, thickness: 1, color: null },
        roads: { visible: true, thickness: 1, color: null }
    };
}

function createDefaultBasemapOverrides() {
    return {
        landColor: null,
        waterColor: null,
        borders: createDefaultBordersState()
    };
}

function ensureOverridesState() {
    if (!stateManager.basemapOverrides) {
        stateManager.basemapOverrides = createDefaultBasemapOverrides();
    }
    if (!stateManager.basemapOverrides.borders) {
        stateManager.basemapOverrides.borders = createDefaultBordersState();
    }
    BORDER_CATEGORIES.forEach(({ id }) => {
        if (!stateManager.basemapOverrides.borders[id]) {
            stateManager.basemapOverrides.borders[id] = { visible: true, thickness: 1, color: null };
        }
    });
    return stateManager.basemapOverrides;
}

function getPreviewUrl(preset, theme) {
    return theme === 'light' ? preset.previewLight : preset.previewDark;
}

function hasAnyCustomizations() {
    if ((stateManager.activeBasemapPreset || 'default') !== 'default') return true;
    const overrides = ensureOverridesState();
    if (overrides.landColor || overrides.waterColor) return true;

    return BORDER_CATEGORIES.some(({ id }) => {
        const b = overrides.borders[id];
        return !b.visible || Math.abs((b.thickness ?? 1) - 1) > 0.01 || Boolean(b.color);
    });
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

export function syncBasemapColorInputs(baseColors = { land: '#ededed', water: '#f5fdff', borders: {} }) {
    const isSatellite = stateManager.activeBasemapPreset === 'satellite';
    const overrides = ensureOverridesState();

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

    // Sync Borders rows
    const borders = overrides.borders;
    const baseBorders = baseColors.borders || {};
    const allColorOverride = borders.all.color;

    BORDER_CATEGORIES.forEach(({ id }) => {
        const b = borders[id];
        const visibleEl = document.getElementById(`border-visible-${id}`);
        const thickEl = document.getElementById(`border-thickness-${id}`);
        const thickValEl = document.getElementById(`border-thickness-val-${id}`);
        const colorEl = document.getElementById(`border-color-${id}`);
        const resetEl = document.getElementById(`btn-reset-border-${id}`);

        if (visibleEl) {
            visibleEl.checked = b.visible;
            if (id === 'all') {
                const subVisibles = SUB_BORDER_IDS.map((subId) => borders[subId].visible);
                const allTrue = subVisibles.every(Boolean);
                const anyTrue = subVisibles.some(Boolean);
                visibleEl.indeterminate = anyTrue && !allTrue;
            }
        }

        const thickness = b.thickness ?? 1;
        if (thickEl) thickEl.value = String(thickness);
        if (thickValEl) thickValEl.textContent = `${thickness.toFixed(1)}x`;

        const displayColor = id === 'all'
            ? (b.color || baseBorders.all || '#000000')
            : (b.color || allColorOverride || baseBorders[id] || '#000000');
        if (colorEl) colorEl.value = displayColor;

        if (resetEl) {
            const isModified = id === 'all'
                ? BORDER_CATEGORIES.some(({ id: checkId }) => {
                    const item = borders[checkId];
                    return !item.visible || Math.abs((item.thickness ?? 1) - 1) > 0.01 || Boolean(item.color);
                })
                : (!b.visible || Math.abs(thickness - 1) > 0.01 || Boolean(b.color));
            resetEl.disabled = !isModified;
        }
    });

    const resetAllBtn = document.getElementById('btn-reset-all-basemap');
    if (resetAllBtn) {
        resetAllBtn.disabled = !hasAnyCustomizations();
    }
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

            <div class="basemap-dropdown-block">
                <button
                    id="btn-borders-dropdown"
                    class="basemap-dropdown-toggle ${bordersExpanded ? 'open' : ''}"
                    type="button"
                    aria-expanded="${String(bordersExpanded)}"
                >
                    <span>Borders</span>
                    <span class="basemap-dropdown-arrow">${bordersExpanded ? '▾' : '▸'}</span>
                </button>
                <div id="borders-dropdown-body" class="basemap-dropdown-body" style="display: ${bordersExpanded ? 'flex' : 'none'};">
                    ${BORDER_CATEGORIES.map(({ id, label }) => `
                        <div class="basemap-border-row ${id === 'all' ? 'is-all-row' : ''}" data-border-id="${id}">
                            <div class="basemap-border-top">
                                <label class="basemap-checkbox-label">
                                    <input id="border-visible-${id}" class="basemap-checkbox" type="checkbox" checked />
                                    <span>${label}</span>
                                </label>
                                <div class="basemap-color-group">
                                    <input id="border-color-${id}" class="basemap-color-input" type="color" value="#000000" aria-label="${label} color" />
                                    <button id="btn-reset-border-${id}" class="basemap-reset-btn" type="button" disabled>Reset</button>
                                </div>
                            </div>
                            <div class="basemap-border-slider-row">
                                <span class="basemap-slider-label">${id === 'all' ? 'Multiplier' : 'Thickness'}</span>
                                <input
                                    id="border-thickness-${id}"
                                    class="basemap-range-slider"
                                    type="range"
                                    min="0.2"
                                    max="4"
                                    step="0.1"
                                    value="1"
                                    aria-label="${label} thickness"
                                />
                                <span id="border-thickness-val-${id}" class="basemap-slider-value">1.0x</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </section>

        <div class="basemap-editor-footer">
            <button id="btn-reset-all-basemap" class="basemap-reset-all-btn" type="button" disabled>
                Reset Everything to Default
            </button>
        </div>
    `;

    // Preset cards
    bodyEl.querySelectorAll('.basemap-preset-card').forEach((card) => {
        card.addEventListener('click', () => {
            const presetId = card.dataset.presetId;
            if (stateManager.activeBasemapPreset === presetId) return;

            stateManager.activeBasemapPreset = presetId;
            stateManager.basemapOverrides = createDefaultBasemapOverrides();

            bodyEl.querySelectorAll('.basemap-preset-card').forEach((c) => {
                c.classList.toggle('active', c.dataset.presetId === presetId);
            });

            if (typeof presetCallback === 'function') {
                presetCallback(presetId);
            }
        });
    });

    // Land & Water
    const landInput = document.getElementById('basemap-land-color');
    const waterInput = document.getElementById('basemap-water-color');
    const resetLandBtn = document.getElementById('btn-reset-land-color');
    const resetWaterBtn = document.getElementById('btn-reset-water-color');

    if (landInput) {
        landInput.addEventListener('input', (e) => {
            if (stateManager.activeBasemapPreset === 'satellite') return;
            ensureOverridesState().landColor = e.target.value;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (waterInput) {
        waterInput.addEventListener('input', (e) => {
            if (stateManager.activeBasemapPreset === 'satellite') return;
            ensureOverridesState().waterColor = e.target.value;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (resetLandBtn) {
        resetLandBtn.addEventListener('click', () => {
            ensureOverridesState().landColor = null;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (resetWaterBtn) {
        resetWaterBtn.addEventListener('click', () => {
            ensureOverridesState().waterColor = null;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    // Borders dropdown toggle
    const bordersToggle = document.getElementById('btn-borders-dropdown');
    const bordersBody = document.getElementById('borders-dropdown-body');
    if (bordersToggle && bordersBody) {
        bordersToggle.addEventListener('click', () => {
            bordersExpanded = !bordersExpanded;
            bordersToggle.classList.toggle('open', bordersExpanded);
            bordersToggle.setAttribute('aria-expanded', String(bordersExpanded));
            bordersBody.style.display = bordersExpanded ? 'flex' : 'none';
            const arrow = bordersToggle.querySelector('.basemap-dropdown-arrow');
            if (arrow) arrow.textContent = bordersExpanded ? '▾' : '▸';
        });
    }

    // Borders row controls
    BORDER_CATEGORIES.forEach(({ id }) => {
        const visibleEl = document.getElementById(`border-visible-${id}`);
        const thickEl = document.getElementById(`border-thickness-${id}`);
        const colorEl = document.getElementById(`border-color-${id}`);
        const resetEl = document.getElementById(`btn-reset-border-${id}`);

        if (visibleEl) {
            visibleEl.addEventListener('change', (e) => {
                const borders = ensureOverridesState().borders;
                const checked = e.target.checked;
                borders[id].visible = checked;

                if (id === 'all') {
                    SUB_BORDER_IDS.forEach((subId) => {
                        borders[subId].visible = checked;
                    });
                } else {
                    borders.all.visible = SUB_BORDER_IDS.every((subId) => borders[subId].visible);
                }

                if (typeof editorChangeCallback === 'function') editorChangeCallback();
            });
        }

        if (thickEl) {
            thickEl.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                ensureOverridesState().borders[id].thickness = Number.isFinite(val) ? val : 1;
                if (typeof editorChangeCallback === 'function') editorChangeCallback();
            });
        }

        if (colorEl) {
            colorEl.addEventListener('input', (e) => {
                const borders = ensureOverridesState().borders;
                borders[id].color = e.target.value;
                if (id === 'all') {
                    SUB_BORDER_IDS.forEach((subId) => {
                        borders[subId].color = null;
                    });
                }
                if (typeof editorChangeCallback === 'function') editorChangeCallback();
            });
        }

        if (resetEl) {
            resetEl.addEventListener('click', () => {
                const borders = ensureOverridesState().borders;
                if (id === 'all') {
                    ensureOverridesState().borders = createDefaultBordersState();
                } else {
                    borders[id] = { visible: true, thickness: 1, color: null };
                    borders.all.visible = SUB_BORDER_IDS.every((subId) => borders[subId].visible);
                }
                if (typeof editorChangeCallback === 'function') editorChangeCallback();
            });
        }
    });

    // Bottom Reset Everything button
    const resetAllBtn = document.getElementById('btn-reset-all-basemap');
    if (resetAllBtn) {
        resetAllBtn.addEventListener('click', () => {
            const wasDefaultPreset = (stateManager.activeBasemapPreset || 'default') === 'default';
            stateManager.activeBasemapPreset = 'default';
            stateManager.basemapOverrides = createDefaultBasemapOverrides();

            bodyEl.querySelectorAll('.basemap-preset-card').forEach((c) => {
                c.classList.toggle('active', c.dataset.presetId === 'default');
            });

            if (!wasDefaultPreset && typeof presetCallback === 'function') {
                presetCallback('default');
            } else if (typeof editorChangeCallback === 'function') {
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
    ensureOverridesState();

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
