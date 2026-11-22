// js/components/basemapEditor.js
import { stateManager } from '../core/stateManager.js';
import { getContextualLabelDefaults } from '../layers/cityOverlay.js';

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

const FONT_OPTIONS = [
    { label: 'Roboto (Default)', value: "'Roboto', -apple-system, sans-serif" },
    { label: 'Inter', value: "'Inter', -apple-system, sans-serif" },
    { label: 'Montserrat', value: "'Montserrat', sans-serif" },
    { label: 'Poppins', value: "'Poppins', sans-serif" },
    { label: 'Oswald (Condensed)', value: "'Oswald', 'Arial Narrow', sans-serif" },
    { label: 'Bebas Neue (Broadcast)', value: "'Bebas Neue', Impact, sans-serif" },
    { label: 'System Sans', value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
    { label: 'Arial', value: "Arial, Helvetica, sans-serif" },
    { label: 'Trebuchet MS', value: "'Trebuchet MS', 'Lucida Sans Unicode', sans-serif" },
    { label: 'Impact', value: "Impact, 'Arial Narrow', sans-serif" },
    { label: 'JetBrains Mono', value: "'JetBrains Mono', Consolas, monospace" },
    { label: 'Monospace', value: "SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
    { label: 'Merriweather (Serif)', value: "'Merriweather', Georgia, serif" },
    { label: 'Georgia (Serif)', value: "Georgia, 'Times New Roman', serif" }
];

let presetCallback = null;
let editorChangeCallback = null;
let bordersExpanded = false;
let labelsExpanded = false;

function createDefaultBordersState() {
    return {
        all: { visible: true, thickness: 1, color: null },
        oceanLand: { visible: true, thickness: 1, color: null, minZoom: null },
        national: { visible: true, thickness: 1, color: null, minZoom: null },
        state: { visible: true, thickness: 1, color: null, minZoom: null },
        county: { visible: true, thickness: 1, color: null, minZoom: null },
        roads: { visible: true, thickness: 1, color: null, minZoom: null }
    };
}

function createDefaultLabelsState() {
    return {
        showCities: null,
        showCallouts: null,
        density: null,
        cityColor: null,
        calloutColor: null,
        cityFont: null,
        calloutFont: null,
        cityFontSize: null,
        calloutFontSize: null
    };
}

function createDefaultBasemapOverrides() {
    return {
        landColor: null,
        waterColor: null,
        borders: createDefaultBordersState(),
        labels: createDefaultLabelsState()
    };
}

function ensureOverridesState() {
    if (!stateManager.basemapOverrides) {
        stateManager.basemapOverrides = createDefaultBasemapOverrides();
    }
    if (!stateManager.basemapOverrides.borders) {
        stateManager.basemapOverrides.borders = createDefaultBordersState();
    }
    if (!stateManager.basemapOverrides.labels) {
        stateManager.basemapOverrides.labels = createDefaultLabelsState();
    }

    BORDER_CATEGORIES.forEach(({ id }) => {
        if (!stateManager.basemapOverrides.borders[id]) {
            stateManager.basemapOverrides.borders[id] = id === 'all'
                ? { visible: true, thickness: 1, color: null }
                : { visible: true, thickness: 1, color: null, minZoom: null };
        }
        if (id !== 'all' && stateManager.basemapOverrides.borders[id].minZoom === undefined) {
            stateManager.basemapOverrides.borders[id].minZoom = null;
        }
    });

    if (stateManager.basemapOverrides.labels.cityFontSize === undefined) {
        stateManager.basemapOverrides.labels.cityFontSize = null;
    }
    if (stateManager.basemapOverrides.labels.calloutFontSize === undefined) {
        stateManager.basemapOverrides.labels.calloutFontSize = null;
    }

    return stateManager.basemapOverrides;
}

function getPreviewUrl(preset, theme) {
    return theme === 'light' ? preset.previewLight : preset.previewDark;
}

function hasAnyCustomizations() {
    if ((stateManager.activeBasemapPreset || 'default') !== 'default') return true;
    const overrides = ensureOverridesState();
    if (overrides.landColor || overrides.waterColor) return true;

    const hasBorderCustomizations = BORDER_CATEGORIES.some(({ id }) => {
        const b = overrides.borders[id];
        const hasZoom = id !== 'all' && b.minZoom !== null && b.minZoom !== undefined;
        return !b.visible || Math.abs((b.thickness ?? 1) - 1) > 0.01 || Boolean(b.color) || hasZoom;
    });
    if (hasBorderCustomizations) return true;

    const lbl = overrides.labels;
    if (lbl) {
        if (lbl.showCities !== null && lbl.showCities !== undefined) return true;
        if (lbl.showCallouts !== null && lbl.showCallouts !== undefined) return true;
        if (lbl.density !== null && lbl.density !== undefined) return true;
        if (Number.isFinite(lbl.cityFontSize) || Number.isFinite(lbl.calloutFontSize)) return true;
        if (lbl.cityColor || lbl.calloutColor || lbl.cityFont || lbl.calloutFont) return true;
    }

    return false;
}

export function setBasemapPresetCallback(callback) {
    presetCallback = callback;
}

export function setBasemapEditorChangeCallback(callback) {
    editorChangeCallback = callback;
}

export function updateBasemapZoomReadout(zoom) {
    const el = document.getElementById('basemap-zoom-readout');
    if (el && Number.isFinite(zoom)) {
        el.textContent = `Zoom: ${zoom.toFixed(2)}`;
    }
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

    syncBasemapColorInputs();
}

export function syncBasemapColorInputs(baseColors = { land: '#ededed', water: '#f5fdff', borders: {}, borderMinZooms: {} }) {
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
    const baseMinZooms = baseColors.borderMinZooms || {};
    const allColorOverride = borders.all.color;

    BORDER_CATEGORIES.forEach(({ id }) => {
        const b = borders[id];
        const visibleEl = document.getElementById(`border-visible-${id}`);
        const thickEl = document.getElementById(`border-thickness-${id}`);
        const thickValEl = document.getElementById(`border-thickness-val-${id}`);
        const zoomEl = document.getElementById(`border-minzoom-${id}`);
        const zoomValEl = document.getElementById(`border-minzoom-val-${id}`);
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

        if (id !== 'all') {
            const baseMinZoom = Number.isFinite(baseMinZooms[id]) ? baseMinZooms[id] : 0;
            const activeMinZoom = (b.minZoom !== null && b.minZoom !== undefined) ? b.minZoom : baseMinZoom;
            if (zoomEl) zoomEl.value = String(activeMinZoom);
            if (zoomValEl) zoomValEl.textContent = `${activeMinZoom.toFixed(1)}`;
        }

        const displayColor = id === 'all'
            ? (b.color || baseBorders.all || '#000000')
            : (b.color || allColorOverride || baseBorders[id] || '#000000');
        if (colorEl) colorEl.value = displayColor;

        if (resetEl) {
            const isModified = id === 'all'
                ? BORDER_CATEGORIES.some(({ id: checkId }) => {
                    const item = borders[checkId];
                    const itemHasZoom = checkId !== 'all' && item.minZoom !== null && item.minZoom !== undefined;
                    return !item.visible || Math.abs((item.thickness ?? 1) - 1) > 0.01 || Boolean(item.color) || itemHasZoom;
                })
                : (!b.visible || Math.abs(thickness - 1) > 0.01 || Boolean(b.color) || (b.minZoom !== null && b.minZoom !== undefined));
            resetEl.disabled = !isModified;
        }
    });

    // 🌟 Sync Labels controls with contextual defaults
    const lbl = overrides.labels;
    const labelDefaults = getContextualLabelDefaults();

    const showCitiesEl = document.getElementById('labels-show-cities');
    const showCalloutsEl = document.getElementById('labels-show-callouts');
    const densityEl = document.getElementById('labels-density-slider');
    const densityValEl = document.getElementById('labels-density-val');
    const cityColorEl = document.getElementById('labels-city-color');
    const calloutColorEl = document.getElementById('labels-callout-color');
    const cityFontEl = document.getElementById('labels-city-font');
    const calloutFontEl = document.getElementById('labels-callout-font');
    const citySizeEl = document.getElementById('labels-city-size');
    const calloutSizeEl = document.getElementById('labels-callout-size');
    const resetLabelsBtn = document.getElementById('btn-reset-labels');

    const activeShowCities = (lbl.showCities !== null && lbl.showCities !== undefined) ? lbl.showCities : labelDefaults.showCities;
    const activeShowCallouts = (lbl.showCallouts !== null && lbl.showCallouts !== undefined) ? lbl.showCallouts : labelDefaults.showCallouts;
    const activeDensity = (lbl.density !== null && lbl.density !== undefined) ? lbl.density : labelDefaults.density;
    const activeCityColor = lbl.cityColor || labelDefaults.cityColor;
    const activeCalloutColor = lbl.calloutColor || labelDefaults.calloutColor;
    const activeCityFont = lbl.cityFont || labelDefaults.cityFont;
    const activeCalloutFont = lbl.calloutFont || labelDefaults.calloutFont;
    const activeCitySize = Number.isFinite(lbl.cityFontSize) ? lbl.cityFontSize : labelDefaults.cityFontSize;
    const activeCalloutSize = Number.isFinite(lbl.calloutFontSize) ? lbl.calloutFontSize : labelDefaults.calloutFontSize;

    if (showCitiesEl) showCitiesEl.checked = activeShowCities;
    if (showCalloutsEl) showCalloutsEl.checked = activeShowCallouts;

    if (densityEl) densityEl.value = String(activeDensity);
    if (densityValEl) densityValEl.textContent = `${activeDensity.toFixed(1)}x`;

    if (cityColorEl) cityColorEl.value = activeCityColor;
    if (calloutColorEl) calloutColorEl.value = activeCalloutColor;

    if (cityFontEl) cityFontEl.value = activeCityFont;
    if (calloutFontEl) calloutFontEl.value = activeCalloutFont;

    if (citySizeEl && document.activeElement !== citySizeEl) {
        citySizeEl.value = String(activeCitySize);
    }
    if (calloutSizeEl && document.activeElement !== calloutSizeEl) {
        calloutSizeEl.value = String(activeCalloutSize);
    }

    if (resetLabelsBtn) {
        const isModified = (lbl.showCities !== null && lbl.showCities !== undefined) ||
            (lbl.showCallouts !== null && lbl.showCallouts !== undefined) ||
            (lbl.density !== null && lbl.density !== undefined) ||
            Number.isFinite(lbl.cityFontSize) ||
            Number.isFinite(lbl.calloutFontSize) ||
            Boolean(lbl.cityColor) ||
            Boolean(lbl.calloutColor) ||
            Boolean(lbl.cityFont) ||
            Boolean(lbl.calloutFont);
        resetLabelsBtn.disabled = !isModified;
    }

    const resetAllBtn = document.getElementById('btn-reset-all-basemap');
    if (resetAllBtn) {
        resetAllBtn.disabled = !hasAnyCustomizations();
    }
}

function renderEditorSections(bodyEl) {
    const currentTheme = stateManager.currentTheme || 'dark';
    const activePreset = stateManager.activeBasemapPreset || 'default';
    const labelDefaults = getContextualLabelDefaults();

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

            <!-- Borders Dropdown -->
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
                            ${id !== 'all' ? `
                                <div class="basemap-border-slider-row">
                                    <span class="basemap-slider-label">Min Zoom</span>
                                    <input
                                        id="border-minzoom-${id}"
                                        class="basemap-range-slider"
                                        type="range"
                                        min="0"
                                        max="18"
                                        step="0.1"
                                        value="0"
                                        aria-label="${label} minimum zoom"
                                    />
                                    <span id="border-minzoom-val-${id}" class="basemap-slider-value">0.0</span>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Labels Dropdown -->
            <div class="basemap-dropdown-block">
                <button
                    id="btn-labels-dropdown"
                    class="basemap-dropdown-toggle ${labelsExpanded ? 'open' : ''}"
                    type="button"
                    aria-expanded="${String(labelsExpanded)}"
                >
                    <span>Labels & Callouts</span>
                    <span class="basemap-dropdown-arrow">${labelsExpanded ? '▾' : '▸'}</span>
                </button>
                <div id="labels-dropdown-body" class="basemap-dropdown-body" style="display: ${labelsExpanded ? 'flex' : 'none'};">
                    <div class="basemap-label-switches-row">
                        <label class="basemap-checkbox-label">
                            <input id="labels-show-cities" class="basemap-checkbox" type="checkbox" ${labelDefaults.showCities ? 'checked' : ''} />
                            <span>City Names</span>
                        </label>
                        <label class="basemap-checkbox-label">
                            <input id="labels-show-callouts" class="basemap-checkbox" type="checkbox" ${labelDefaults.showCallouts ? 'checked' : ''} />
                            <span>Weather Callouts</span>
                        </label>
                    </div>

                    <div class="basemap-border-row">
                        <div class="basemap-border-slider-row">
                            <span class="basemap-slider-label">Density</span>
                            <input
                                id="labels-density-slider"
                                class="basemap-range-slider"
                                type="range"
                                min="0.5"
                                max="2.5"
                                step="0.1"
                                value="1"
                                aria-label="Label density"
                            />
                            <span id="labels-density-val" class="basemap-slider-value">1.0x</span>
                        </div>
                    </div>

                    <div class="basemap-border-row">
                        <div class="basemap-border-top">
                            <span class="basemap-control-label">City Names</span>
                            <input id="labels-city-color" class="basemap-color-input" type="color" value="${labelDefaults.cityColor}" aria-label="City name color" />
                        </div>
                        <div class="basemap-font-select-row">
                            <span class="basemap-slider-label">Font</span>
                            <select id="labels-city-font" class="basemap-font-select" aria-label="City name font">
                                ${FONT_OPTIONS.map((f) => `<option value="${f.value}">${f.label}</option>`).join('')}
                            </select>
                            <div class="basemap-font-size-wrap">
                                <input
                                    id="labels-city-size"
                                    class="basemap-font-size-input"
                                    type="number"
                                    min="8"
                                    max="36"
                                    step="1"
                                    value="${labelDefaults.cityFontSize}"
                                    aria-label="City name font size"
                                />
                                <span class="basemap-font-size-unit">px</span>
                            </div>
                        </div>
                    </div>

                    <div class="basemap-border-row">
                        <div class="basemap-border-top">
                            <span class="basemap-control-label">Weather Callouts</span>
                            <input id="labels-callout-color" class="basemap-color-input" type="color" value="${labelDefaults.calloutColor}" aria-label="Weather callout color" />
                        </div>
                        <div class="basemap-font-select-row">
                            <span class="basemap-slider-label">Font</span>
                            <select id="labels-callout-font" class="basemap-font-select" aria-label="Weather callout font">
                                ${FONT_OPTIONS.map((f) => `<option value="${f.value}">${f.label}</option>`).join('')}
                            </select>
                            <div class="basemap-font-size-wrap">
                                <input
                                    id="labels-callout-size"
                                    class="basemap-font-size-input"
                                    type="number"
                                    min="8"
                                    max="36"
                                    step="1"
                                    value="${labelDefaults.calloutFontSize}"
                                    aria-label="Weather callout font size"
                                />
                                <span class="basemap-font-size-unit">px</span>
                            </div>
                        </div>
                    </div>

                    <div class="basemap-row-right-align">
                        <button id="btn-reset-labels" class="basemap-reset-btn" type="button" disabled>Reset Labels</button>
                    </div>
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

    // Labels dropdown toggle
    const labelsToggle = document.getElementById('btn-labels-dropdown');
    const labelsBody = document.getElementById('labels-dropdown-body');
    if (labelsToggle && labelsBody) {
        labelsToggle.addEventListener('click', () => {
            labelsExpanded = !labelsExpanded;
            labelsToggle.classList.toggle('open', labelsExpanded);
            labelsToggle.setAttribute('aria-expanded', String(labelsExpanded));
            labelsBody.style.display = labelsExpanded ? 'flex' : 'none';
            const arrow = labelsToggle.querySelector('.basemap-dropdown-arrow');
            if (arrow) arrow.textContent = labelsExpanded ? '▾' : '▸';
        });
    }

    // Borders row controls
    BORDER_CATEGORIES.forEach(({ id }) => {
        const visibleEl = document.getElementById(`border-visible-${id}`);
        const thickEl = document.getElementById(`border-thickness-${id}`);
        const zoomEl = document.getElementById(`border-minzoom-${id}`);
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

        if (zoomEl) {
            zoomEl.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                ensureOverridesState().borders[id].minZoom = Number.isFinite(val) ? val : null;
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
                    borders[id] = { visible: true, thickness: 1, color: null, minZoom: null };
                    borders.all.visible = SUB_BORDER_IDS.every((subId) => borders[subId].visible);
                }
                if (typeof editorChangeCallback === 'function') editorChangeCallback();
            });
        }
    });

    // Labels row controls
    const showCitiesEl = document.getElementById('labels-show-cities');
    const showCalloutsEl = document.getElementById('labels-show-callouts');
    const densityEl = document.getElementById('labels-density-slider');
    const cityColorEl = document.getElementById('labels-city-color');
    const calloutColorEl = document.getElementById('labels-callout-color');
    const cityFontEl = document.getElementById('labels-city-font');
    const calloutFontEl = document.getElementById('labels-callout-font');
    const citySizeEl = document.getElementById('labels-city-size');
    const calloutSizeEl = document.getElementById('labels-callout-size');
    const resetLabelsBtn = document.getElementById('btn-reset-labels');

    if (showCitiesEl) {
        showCitiesEl.addEventListener('change', (e) => {
            ensureOverridesState().labels.showCities = e.target.checked;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (showCalloutsEl) {
        showCalloutsEl.addEventListener('change', (e) => {
            ensureOverridesState().labels.showCallouts = e.target.checked;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (densityEl) {
        densityEl.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            ensureOverridesState().labels.density = Number.isFinite(val) ? val : 1.0;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (cityColorEl) {
        cityColorEl.addEventListener('input', (e) => {
            ensureOverridesState().labels.cityColor = e.target.value;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (calloutColorEl) {
        calloutColorEl.addEventListener('input', (e) => {
            ensureOverridesState().labels.calloutColor = e.target.value;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (cityFontEl) {
        cityFontEl.addEventListener('change', (e) => {
            ensureOverridesState().labels.cityFont = e.target.value;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (calloutFontEl) {
        calloutFontEl.addEventListener('change', (e) => {
            ensureOverridesState().labels.calloutFont = e.target.value;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (citySizeEl) {
        citySizeEl.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (!Number.isFinite(val) || val < 8 || val > 36) return;
            ensureOverridesState().labels.cityFontSize = Math.round(val);
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
        citySizeEl.addEventListener('change', (e) => {
            const raw = parseFloat(e.target.value);
            const clamped = Number.isFinite(raw) ? Math.min(36, Math.max(8, Math.round(raw))) : getContextualLabelDefaults().cityFontSize;
            e.target.value = String(clamped);
            ensureOverridesState().labels.cityFontSize = clamped;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (calloutSizeEl) {
        calloutSizeEl.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (!Number.isFinite(val) || val < 8 || val > 36) return;
            ensureOverridesState().labels.calloutFontSize = Math.round(val);
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
        calloutSizeEl.addEventListener('change', (e) => {
            const raw = parseFloat(e.target.value);
            const clamped = Number.isFinite(raw) ? Math.min(36, Math.max(8, Math.round(raw))) : getContextualLabelDefaults().calloutFontSize;
            e.target.value = String(clamped);
            ensureOverridesState().labels.calloutFontSize = clamped;
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

    if (resetLabelsBtn) {
        resetLabelsBtn.addEventListener('click', () => {
            ensureOverridesState().labels = createDefaultLabelsState();
            if (typeof editorChangeCallback === 'function') editorChangeCallback();
        });
    }

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

    const header = panel.querySelector('.basemap-editor-header');
    if (header && !document.getElementById('basemap-zoom-readout')) {
        const actions = document.createElement('div');
        actions.className = 'basemap-header-actions';
        const zoomEl = document.createElement('span');
        zoomEl.id = 'basemap-zoom-readout';
        zoomEl.className = 'basemap-zoom-readout';
        zoomEl.textContent = 'Zoom: --';
        actions.appendChild(zoomEl);
        if (closeBtn) {
            actions.appendChild(closeBtn);
        }
        header.appendChild(actions);
    }

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
