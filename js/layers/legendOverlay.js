// js/layers/legendOverlay.js
import { stateManager } from '../core/stateManager.js';
import {
    getPaletteForParameter as getLightPalette,
    PRATE_PALETTE,
    SNOW_PALETTE,
    FRZR_PALETTE,
    SLEET_PALETTE,
    TEMP_STOPS_F
} from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { getRadarPalette, WXTOOLS_PALETTE_256 } from '../config/radarPalettes.js';

const DEFAULT_SECTION_ORDER = ['header', 'init', 'fhr', 'valid', 'colorbar'];

const SECTION_LABELS = {
    header: 'Header',
    init: 'Init Time',
    fhr: 'Forecast Hour',
    valid: 'Valid Time',
    colorbar: 'Color Key'
};

let legendRoot = null;
let editMode = false;
let selectedSectionId = null;
let freeLayoutActive = false; // switches to true as soon as an inner element is dragged or resized

let boxRect = null; // null = default docked position; otherwise { left, top, width, height }
let sectionState = createDefaultSectionState();

let editToggleCallback = null;
let selectionChangeCallback = null;

function createDefaultSectionState() {
    const out = {};
    DEFAULT_SECTION_ORDER.forEach((id) => {
        out[id] = {
            deleted: false,
            x: null,
            y: null,
            w: null,
            h: null
        };
    });
    return out;
}

export function setLegendCallbacks({ onEditToggle = null, onSelectionChange = null } = {}) {
    if (onEditToggle) editToggleCallback = onEditToggle;
    if (onSelectionChange) selectionChangeCallback = onSelectionChange;
}

export function isLegendEditMode() {
    return editMode;
}

export function getSelectedLegendSection() {
    if (!selectedSectionId) return null;
    return {
        id: selectedSectionId,
        label: SECTION_LABELS[selectedSectionId] || selectedSectionId,
        ...sectionState[selectedSectionId]
    };
}

export function getLegendSectionsSummary() {
    return DEFAULT_SECTION_ORDER.map((id) => ({
        id,
        label: SECTION_LABELS[id],
        deleted: Boolean(sectionState[id]?.deleted)
    }));
}

export function setLegendEditMode(active) {
    editMode = Boolean(active);
    if (!legendRoot) return;

    legendRoot.classList.toggle('is-editing', editMode);

    if (!editMode) {
        selectedSectionId = null;
        updateSelectionClasses();
    } else if (!selectedSectionId) {
        // Auto-select header on enter edit mode so the editor immediately shows active context
        const firstVisible = DEFAULT_SECTION_ORDER.find((id) => !sectionState[id].deleted);
        if (firstVisible) {
            selectedSectionId = firstVisible;
            updateSelectionClasses();
        }
    }

    if (typeof editToggleCallback === 'function') {
        editToggleCallback(editMode);
    }
    if (typeof selectionChangeCallback === 'function') {
        selectionChangeCallback(getSelectedLegendSection());
    }
}

export function selectLegendSection(sectionId) {
    if (sectionId && sectionState[sectionId]?.deleted) return;
    selectedSectionId = sectionId || null;
    updateSelectionClasses();
    if (typeof selectionChangeCallback === 'function') {
        selectionChangeCallback(getSelectedLegendSection());
    }
}

export function deleteSelectedLegendSection() {
    if (!selectedSectionId || !sectionState[selectedSectionId]) return;
    sectionState[selectedSectionId].deleted = true;
    const deletedEl = legendRoot?.querySelector(`.legend-section[data-section-id="${selectedSectionId}"]`);
    if (deletedEl) deletedEl.style.display = 'none';

    const nextVisible = DEFAULT_SECTION_ORDER.find((id) => !sectionState[id].deleted);
    selectedSectionId = nextVisible || null;
    updateSelectionClasses();

    if (typeof selectionChangeCallback === 'function') {
        selectionChangeCallback(getSelectedLegendSection());
    }
}

export function restoreLegendSection(sectionId) {
    if (!sectionState[sectionId]) return;
    sectionState[sectionId].deleted = false;
    const el = legendRoot?.querySelector(`.legend-section[data-section-id="${sectionId}"]`);
    if (el) {
        el.style.display = '';
    }
    selectedSectionId = sectionId;
    updateSelectionClasses();
    requestAnimationFrame(() => renderColorKeyCanvas());

    if (typeof selectionChangeCallback === 'function') {
        selectionChangeCallback(getSelectedLegendSection());
    }
}

export function resetLegendToDefault() {
    boxRect = null;
    freeLayoutActive = false;
    sectionState = createDefaultSectionState();

    if (legendRoot) {
        legendRoot.classList.remove('is-free-layout', 'is-custom-box');
        legendRoot.style.left = '';
        legendRoot.style.top = '';
        legendRoot.style.width = '';
        legendRoot.style.height = '';

        DEFAULT_SECTION_ORDER.forEach((id) => {
            const el = legendRoot.querySelector(`.legend-section[data-section-id="${id}"]`);
            if (!el) return;
            el.style.display = '';
            el.style.left = '';
            el.style.top = '';
            el.style.width = '';
            el.style.height = '';
        });
    }

    if (editMode) {
        selectedSectionId = 'header';
    } else {
        selectedSectionId = null;
    }
    updateSelectionClasses();
    requestAnimationFrame(() => renderColorKeyCanvas());

    if (typeof selectionChangeCallback === 'function') {
        selectionChangeCallback(getSelectedLegendSection());
    }
}

function updateSelectionClasses() {
    if (!legendRoot) return;
    legendRoot.querySelectorAll('.legend-section').forEach((el) => {
        el.classList.toggle('is-selected', editMode && el.dataset.sectionId === selectedSectionId);
    });
}

/* =========================================================================
   FREE-LAYOUT SNAPSHOT (Converts clean default flex positions -> movable px)
   ========================================================================= */

function activateFreeLayoutIfNeeded() {
    if (freeLayoutActive || !legendRoot) return;

    const rootRect = legendRoot.getBoundingClientRect();
    if (!boxRect) {
        boxRect = {
            left: rootRect.left,
            top: rootRect.top,
            width: rootRect.width,
            height: rootRect.height
        };
    }

    // Snapshot every visible child's exact current coordinates before switching to position: absolute
    const measurements = {};
    DEFAULT_SECTION_ORDER.forEach((id) => {
        const el = legendRoot.querySelector(`.legend-section[data-section-id="${id}"]`);
        if (!el || sectionState[id].deleted) return;
        const r = el.getBoundingClientRect();
        measurements[id] = {
            x: r.left - rootRect.left,
            y: r.top - rootRect.top,
            w: r.width,
            h: r.height
        };
    });

    freeLayoutActive = true;
    legendRoot.classList.add('is-free-layout', 'is-custom-box');
    legendRoot.style.left = `${Math.round(boxRect.left)}px`;
    legendRoot.style.top = `${Math.round(boxRect.top)}px`;
    legendRoot.style.width = `${Math.round(boxRect.width)}px`;
    legendRoot.style.height = `${Math.round(boxRect.height)}px`;

    DEFAULT_SECTION_ORDER.forEach((id) => {
        const el = legendRoot.querySelector(`.legend-section[data-section-id="${id}"]`);
        const m = measurements[id];
        if (!el || !m) return;
        sectionState[id].x = Math.round(m.x);
        sectionState[id].y = Math.round(m.y);
        sectionState[id].w = Math.round(m.w);
        sectionState[id].h = Math.round(m.h);

        el.style.left = `${sectionState[id].x}px`;
        el.style.top = `${sectionState[id].y}px`;
        el.style.width = `${sectionState[id].w}px`;
        el.style.height = `${sectionState[id].h}px`;
    });
}

function applyBoxRect() {
    if (!legendRoot || !boxRect) return;
    legendRoot.classList.add('is-custom-box');
    legendRoot.style.left = `${Math.round(boxRect.left)}px`;
    legendRoot.style.top = `${Math.round(boxRect.top)}px`;
    legendRoot.style.width = `${Math.round(boxRect.width)}px`;
    legendRoot.style.height = `${Math.round(boxRect.height)}px`;
    renderColorKeyCanvas();
}

/* =========================================================================
   COLOR KEY & UNIT RESOLUTION (Exact match to palettes.js / darkPalettes / radar)
   ========================================================================= */

function decodeScalingValue(byteVal, scaling, minDefault = 0, maxDefault = 255) {
    if (scaling && scaling.mode === 'piecewise' && Array.isArray(scaling.val_points) && Array.isArray(scaling.byte_points)) {
        const vp = scaling.val_points.map(Number);
        const bp = scaling.byte_points.map(Number);
        for (let i = 0; i < bp.length - 1; i++) {
            if (byteVal >= bp[i] && byteVal <= bp[i + 1]) {
                const span = bp[i + 1] - bp[i];
                const t = span > 0 ? (byteVal - bp[i]) / span : 0;
                return vp[i] + t * (vp[i + 1] - vp[i]);
            }
        }
        return vp[vp.length - 1];
    }

    const minV = Number(scaling?.min_val ?? minDefault);
    const maxV = Number(scaling?.max_val ?? maxDefault);
    return minV + (byteVal / 255.0) * (maxV - minV);
}

function byteForPhysicalValue(targetVal, scaling, minDefault = 0, maxDefault = 255) {
    if (scaling && scaling.mode === 'piecewise' && Array.isArray(scaling.val_points) && Array.isArray(scaling.byte_points)) {
        const vp = scaling.val_points.map(Number);
        const bp = scaling.byte_points.map(Number);
        if (targetVal <= vp[0]) return bp[0];
        if (targetVal >= vp[vp.length - 1]) return bp[bp.length - 1];
        for (let i = 0; i < vp.length - 1; i++) {
            if (targetVal >= vp[i] && targetVal <= vp[i + 1]) {
                const span = vp[i + 1] - vp[i];
                const t = span > 0 ? (targetVal - vp[i]) / span : 0;
                return bp[i] + t * (bp[i + 1] - bp[i]);
            }
        }
    }

    const minV = Number(scaling?.min_val ?? minDefault);
    const maxV = Number(scaling?.max_val ?? maxDefault);
    if (maxV === minV) return 0;
    return ((targetVal - minV) / (maxV - minV)) * 255.0;
}

function paletteEntryToCss(entry) {
    if (!entry) return 'rgba(0,0,0,0)';
    if (typeof entry === 'string') return entry === 'transparent' ? 'rgba(0,0,0,0)' : entry;
    return `rgba(${entry.r}, ${entry.g}, ${entry.b}, ${(entry.a ?? 255) / 255})`;
}

function getActiveColorKeySpec() {
    const isDark = (stateManager.currentTheme || 'dark') === 'dark';
    const isMetric = stateManager.currentUnits === 'metric';

    // 1. Radar Mode
    if (stateManager.activeMode === 'radar') {
        const prodSelect = document.getElementById('radar-product-select');
        const productCode = (prodSelect?.value || stateManager.activeRadarProduct || 'BR').toUpperCase();
        const pal256 = getRadarPalette(productCode) || WXTOOLS_PALETTE_256;

        if (productCode === 'N0U' || productCode === 'N0G' || productCode === 'VEL' || productCode.includes('VEL')) {
            const ticks = isMetric
                ? [-100, -70, -40, -15, 0, 15, 40, 70, 100].map(v => ({ pos: (v + 120) / 240, label: `${v}` }))
                : [-100, -75, -50, -25, 0, 25, 50, 75, 100].map(v => ({ pos: (v + 140) / 280, label: `${v}` }));
            return { type: 'gradient', palette: pal256.slice(2), ticks };
        }
        if (productCode === 'N0C' || productCode === 'CC' || productCode === 'RHO') {
            const ticks = [0.2, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0, 1.05].map(v => ({ pos: v / 1.05, label: v.toFixed(2) }));
            return { type: 'gradient', palette: pal256.slice(2), ticks };
        }
        if (productCode === 'DAA' || productCode === 'N1P' || productCode === 'OHA' || productCode === '1HR' || productCode === 'N3P' || productCode === 'DU3' || productCode === '3HR') {
            const maxIn = 10.0;
            const vals = [0.1, 0.5, 1, 2, 3, 4, 6, 8, 10];
            const ticks = vals.map(v => ({
                pos: v / maxIn,
                label: isMetric ? `${Math.round(v * 25.4)}` : `${v}`
            }));
            return { type: 'gradient', palette: pal256.slice(1), ticks };
        }
        if (productCode === 'DTA' || productCode === 'DSP' || productCode === 'NTP' || productCode === 'STA' || productCode === 'TOTAL') {
            const maxIn = 18.0;
            const vals = [0.1, 1, 2, 4, 6, 8, 12, 15, 18];
            const ticks = vals.map(v => ({
                pos: v / maxIn,
                label: isMetric ? `${Math.round(v * 25.4)}` : `${v}`
            }));
            return { type: 'gradient', palette: pal256.slice(1), ticks };
        }

        // Reflectivity (dBZ)
        const minDbz = -10;
        const maxDbz = 80;
        const dbzTicks = [5, 15, 25, 35, 45, 55, 65, 75].map(dbz => ({
            pos: (dbz - minDbz) / (maxDbz - minDbz),
            label: `${dbz}`
        }));
        const startByte = Math.round(((minDbz + 30) / 125) * 254) + 1;
        const endByte = Math.round(((maxDbz + 30) / 125) * 254) + 1;
        return { type: 'gradient', palette: pal256.slice(startByte, endByte + 1), ticks: dbzTicks };
    }

    // 2. Model Viewer Mode
    const paramConfig = stateManager.paramConfig || {};
    const manifest = stateManager.manifest || {};
    const paramId = (paramConfig.id || stateManager.activeParam || '2t').toLowerCase();
    const shaderType = (paramConfig.shader || stateManager.activeShader || '').toLowerCase();

    if (shaderType === 'preciptype' || paramId.includes('ptype')) {
        return {
            type: 'ptype',
            bands: [
                { label: 'Rain', palette: PRATE_PALETTE.slice(11, 220) },
                { label: 'Snow', palette: SNOW_PALETTE.slice(11, 220) },
                { label: 'Ice', palette: FRZR_PALETTE.slice(11, 220) },
                { label: 'Sleet', palette: SLEET_PALETTE.slice(11, 220) }
            ]
        };
    }

    const paletteFunc = isDark ? getDarkPalette : getLightPalette;
    const palette256 = paletteFunc(paramId, manifest);
    const scaling = manifest.scaling || paramConfig.scaling;
    const rawUnit = (manifest.unit || paramConfig.unit || '').trim();
    const normUnit = rawUnit.toLowerCase();

    // Temperature parameters
    const isTemp = rawUnit.includes('°') || normUnit === 'k' || normUnit === 'c' || normUnit === 'f' ||
        normUnit.includes('kelvin') || normUnit.includes('celsius') || normUnit.includes('fahrenheit') ||
        (paramId.startsWith('t') && !paramId.startsWith('tp')) || paramId === '2t' || paramId === 'd2m';

    if (isTemp) {
        const minK = Number(scaling?.min_val ?? manifest.min_val ?? manifest.temp_min_k ?? 216.4833);
        const maxK = Number(scaling?.max_val ?? manifest.max_val ?? manifest.temp_max_k ?? 327.5944);
        const toF = (v) => (v > 150 ? (v - 273.15) * 9 / 5 + 32 : (normUnit.includes('c') ? v * 9 / 5 + 32 : v));
        const minF = toF(minK);
        const maxF = toF(maxK);

        // Display crisp -40°F to 110°F (or -40°C to 45°C) span clamped to actual range
        const dispMinF = Math.max(minF, -50);
        const dispMaxF = Math.min(maxF, 115);
        const startByte = Math.max(0, Math.round(((dispMinF - minF) / (maxF - minF)) * 255));
        const endByte = Math.min(255, Math.round(((dispMaxF - minF) / (maxF - minF)) * 255));

        const tickValsF = [-40, -20, 0, 20, 32, 50, 70, 90, 110].filter(v => v >= dispMinF && v <= dispMaxF);
        const ticks = tickValsF.map(f => {
            const pos = (f - dispMinF) / (dispMaxF - dispMinF);
            const val = isMetric ? Math.round((f - 32) * 5 / 9) : Math.round(f);
            return { pos, label: `${val}` };
        });

        return {
            type: 'gradient',
            palette: palette256.slice(startByte, endByte + 1),
            ticks
        };
    }

    // Piecewise / non-linear fields (Precip, Snow, CAPE, PWAT, PVA, Wind, Anomalies)
    let tickValues = [];
    if (paramId === 'prate') {
        tickValues = [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 4.0];
    } else if (paramId === 'asnow_1h' || paramId === 'asnow_3h' || paramId === 'asnow1hr3') {
        tickValues = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8];
    } else if (paramId.startsWith('asnow') || paramId.includes('snow') || paramId === 'sf') {
        tickValues = [0.5, 2, 4, 6, 10, 15, 20, 30, 48];
    } else if (paramId.startsWith('tp') || paramId.includes('precip')) {
        tickValues = [0.05, 0.25, 0.5, 1, 2, 4, 8, 12, 20];
    } else if (paramId === 'pwat' || paramId === 'tcwv') {
        tickValues = [0.25, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0];
    } else if (paramId === 'pva' || paramId.includes('vort') || paramId === 'vo') {
        tickValues = [2, 5, 10, 15, 20, 30, 45, 60];
    } else if (paramId === 'cape') {
        tickValues = [250, 500, 1000, 2000, 3000, 4500, 6000, 8000];
    } else if (paramId.includes('anom')) {
        tickValues = [-360, -240, -120, 0, 120, 240, 360];
    } else if (paramId.startsWith('w') || paramId.includes('wind') || paramId.includes('gust')) {
        tickValues = paramId === 'w250' || paramId === 'w300'
            ? [25, 50, 75, 100, 125, 150, 175, 200]
            : [15, 30, 45, 60, 80, 100, 120];
    } else {
        const minV = Number(scaling?.min_val ?? 0);
        const maxV = Number(scaling?.max_val ?? 100);
        const step = (maxV - minV) / 5;
        tickValues = Array.from({ length: 6 }, (_, i) => Math.round((minV + i * step) * 10) / 10);
    }

    // Find first non-transparent byte for cleaner leading edge
    let startByte = 0;
    for (let i = 0; i < palette256.length; i++) {
        if (palette256[i] && palette256[i] !== 'transparent') {
            startByte = Math.max(0, i - 1);
            break;
        }
    }
    const endByte = 255;

    const formatTick = (v) => {
        if (isMetric && (normUnit === 'in' || normUnit.includes('inch'))) {
            return `${Math.round(v * 25.4)}`;
        }
        if (isMetric && (normUnit === 'in/hr')) {
            return `${(v * 25.4).toFixed(0)}`;
        }
        return Number.isInteger(v) ? `${v}` : `${v}`;
    };

    const ticks = tickValues
        .map((val) => {
            const b = byteForPhysicalValue(val, scaling, 0, tickValues[tickValues.length - 1]);
            const pos = (b - startByte) / Math.max(1, endByte - startByte);
            return { pos, label: formatTick(val) };
        })
        .filter((t) => t.pos >= 0.02 && t.pos <= 0.98);

    return {
        type: 'gradient',
        palette: palette256.slice(startByte, endByte + 1),
        ticks
    };
}

function getColorRuns(palette) {
    const runs = [];
    for (let i = 0; i < palette.length; i++) {
        const c = palette[i];
        if (!c || c === 'transparent') continue;
        const css = paletteEntryToCss(c);
        if (runs.length > 0 && runs[runs.length - 1].css === css) {
            runs[runs.length - 1].count++;
        } else {
            runs.push({ css, count: 1 });
        }
    }
    return runs;
}

function renderColorKeyCanvas() {
    if (!legendRoot || sectionState.colorbar?.deleted) return;
    const canvas = legendRoot.querySelector('#legend-colorbar-canvas');
    const labelsRow = legendRoot.querySelector('#legend-colorbar-labels');
    const ptypeWrap = legendRoot.querySelector('#legend-ptype-wrap');
    const gradWrap = legendRoot.querySelector('#legend-gradient-wrap');
    if (!canvas || !labelsRow || !ptypeWrap || !gradWrap) return;

    const spec = getActiveColorKeySpec();

    if (spec.type === 'ptype') {
        gradWrap.style.display = 'none';
        ptypeWrap.style.display = 'flex';
        ptypeWrap.innerHTML = spec.bands.map((band) => {
            const runs = getColorRuns(band.palette);
            const segs = runs.map((r) =>
                `<span style="flex: ${r.count} 1 0; height: 100%; background: ${r.css};"></span>`
            ).join('');
            return `
                <div class="legend-ptype-item">
                    <span class="legend-ptype-label">${band.label}</span>
                    <div class="legend-ptype-bar" style="display: flex; overflow: hidden;">${segs}</div>
                </div>
            `;
        }).join('');
        return;
    }

    ptypeWrap.style.display = 'none';
    gradWrap.style.display = 'flex';

    const rect = canvas.getBoundingClientRect();
    const w = Math.max(140, Math.round(rect.width || 300));
    const h = Math.max(10, Math.round(rect.height || 14));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Draw exact discrete color bands with zero sub-pixel overlap or interpolation
    const pal = spec.palette;
    const len = Math.max(1, pal.length);
    for (let i = 0; i < len; i++) {
        const x0 = Math.floor((i / len) * w);
        const x1 = Math.floor(((i + 1) / len) * w);
        const segW = x1 - x0;
        if (segW <= 0) continue;
        ctx.fillStyle = paletteEntryToCss(pal[i]);
        ctx.fillRect(x0, 0, segW, h);
    }

    // Render tick labels positioned accurately along the bar
    labelsRow.innerHTML = spec.ticks.map((t) => {
        const pct = Math.max(2, Math.min(98, t.pos * 100));
        return `<span class="legend-tick-label" style="left: ${pct.toFixed(1)}%;">${t.label}</span>`;
    }).join('');
}

/* =========================================================================
   TEXT / DATA SYNC
   ========================================================================= */

function getResolvedUnitLabel() {
    const isMetric = stateManager.currentUnits === 'metric';
    if (stateManager.activeMode === 'radar') {
        const prod = (document.getElementById('radar-product-select')?.value || 'BR').toUpperCase();
        if (prod.includes('VEL') || prod === 'N0U' || prod === 'N0G') return isMetric ? 'km/h' : 'mph';
        if (prod === 'N0C' || prod === 'CC') return 'ρ';
        if (['DAA', 'N1P', 'OHA', 'N3P', 'DU3', 'DTA', 'DSP', 'NTP', 'STA'].includes(prod)) return isMetric ? 'mm' : 'in';
        return 'dBZ';
    }

    const rawUnit = (stateManager.manifest?.unit || stateManager.paramConfig?.unit || '').trim();
    const norm = rawUnit.toLowerCase();
    const paramId = (stateManager.paramConfig?.id || stateManager.activeParam || '').toLowerCase();

    if (rawUnit.includes('°') || norm === 'k' || norm === 'c' || norm === 'f' ||
        norm.includes('kelvin') || norm.includes('celsius') || norm.includes('fahrenheit') ||
        paramId === '2t' || paramId === 'd2m') {
        return isMetric ? '°C' : '°F';
    }
    if (norm === 'in' || norm.includes('inch')) return isMetric ? 'mm' : 'in';
    if (norm === 'in/hr') return isMetric ? 'mm/hr' : 'in/hr';
    return rawUnit;
}

export function updateLegendOverlay() {
    if (!legendRoot) return;

    // Hide on Coming Soon screens (Satellite / Tropics) or 10-panel Ensemble grid
    const hideModes = stateManager.activeMode === 'satellite' || stateManager.activeMode === 'tropics';
    if (hideModes) {
        legendRoot.style.display = 'none';
        return;
    }
    legendRoot.style.display = '';

    const modelText = document.querySelector('#btn-model-menu span')?.textContent?.trim() || 'ECMWF-IFS';
    const paramName = stateManager.manifest?.name || stateManager.paramConfig?.name ||
                      document.querySelector('#btn-param-menu span')?.textContent?.trim() || '2m Temperature';
    const unitLabel = getResolvedUnitLabel();

    const headerEl = legendRoot.querySelector('[data-section-id="header"] .legend-section-content');
    const initEl = legendRoot.querySelector('[data-section-id="init"] .legend-section-content');
    const fhrEl = legendRoot.querySelector('[data-section-id="fhr"] .legend-section-content');
    const validEl = legendRoot.querySelector('[data-section-id="valid"] .legend-section-content');

    if (headerEl) {
        headerEl.textContent = unitLabel ? `${modelText} • ${paramName} (${unitLabel})` : `${modelText} • ${paramName}`;
    }

    if (initEl) {
        if (stateManager.activeMode === 'radar') {
            initEl.textContent = 'Live NEXRAD';
        } else {
            const runText = document.querySelector('#btn-model-run span')?.textContent?.trim() || '--';
            initEl.textContent = `Init: ${runText}`;
        }
    }

    if (fhrEl) {
        const stepText = document.getElementById('step-readout')?.textContent?.trim() || 'F000';
        fhrEl.textContent = stateManager.activeMode === 'radar' ? `Frame ${stepText}` : stepText;
    }

    if (validEl) {
        const validText = document.getElementById('header-valid-time')?.textContent?.trim() || '--';
        validEl.textContent = `Valid: ${validText}`;
    }

    requestAnimationFrame(() => renderColorKeyCanvas());
}

/* =========================================================================
   DRAG & 8-HANDLE RESIZE INTERACTIONS (Outer Box + Individual Inner Sections)
   ========================================================================= */

function attachDragAndResizeHandlers() {
    let interaction = null;

    const onPointerMove = (e) => {
        if (!interaction) return;
        e.preventDefault();

        const dx = e.clientX - interaction.startX;
        const dy = e.clientY - interaction.startY;

        if (interaction.kind === 'move-box') {
            const maxLeft = Math.max(0, window.innerWidth - interaction.origW);
            const maxTop = Math.max(0, window.innerHeight - interaction.origH);
            boxRect.left = Math.max(0, Math.min(maxLeft, interaction.origLeft + dx));
            boxRect.top = Math.max(0, Math.min(maxTop, interaction.origTop + dy));
            applyBoxRect();
        } else if (interaction.kind === 'resize-box') {
            const minW = 260;
            const minH = 54;
            let { origLeft: l, origTop: t, origW: w, origH: h } = interaction;
            const dir = interaction.dir;

            if (dir.includes('e')) w = Math.max(minW, w + dx);
            if (dir.includes('s')) h = Math.max(minH, h + dy);
            if (dir.includes('w')) {
                const nextW = Math.max(minW, w - dx);
                l = l + (w - nextW);
                w = nextW;
            }
            if (dir.includes('n')) {
                const nextH = Math.max(minH, h - dy);
                t = t + (h - nextH);
                h = nextH;
            }

            boxRect = { left: l, top: t, width: w, height: h };
            applyBoxRect();
        } else if (interaction.kind === 'move-section') {
            const id = interaction.sectionId;
            const el = interaction.el;
            const newX = Math.max(0, Math.min(boxRect.width - interaction.origW, interaction.origX + dx));
            const newY = Math.max(0, Math.min(boxRect.height - interaction.origH, interaction.origY + dy));
            sectionState[id].x = Math.round(newX);
            sectionState[id].y = Math.round(newY);
            el.style.left = `${sectionState[id].x}px`;
            el.style.top = `${sectionState[id].y}px`;
        } else if (interaction.kind === 'resize-section') {
            const id = interaction.sectionId;
            const el = interaction.el;
            const minW = id === 'colorbar' ? 120 : 48;
            const minH = id === 'colorbar' ? 24 : 18;
            let { origX: x, origY: y, origW: w, origH: h } = interaction;
            const dir = interaction.dir;

            if (dir.includes('e')) w = Math.max(minW, Math.min(boxRect.width - x, w + dx));
            if (dir.includes('s')) h = Math.max(minH, Math.min(boxRect.height - y, h + dy));
            if (dir.includes('w')) {
                const clampedDx = Math.max(-x, Math.min(w - minW, dx));
                x += clampedDx;
                w -= clampedDx;
            }
            if (dir.includes('n')) {
                const clampedDy = Math.max(-y, Math.min(h - minH, dy));
                y += clampedDy;
                h -= clampedDy;
            }

            sectionState[id].x = Math.round(x);
            sectionState[id].y = Math.round(y);
            sectionState[id].w = Math.round(w);
            sectionState[id].h = Math.round(h);

            el.style.left = `${sectionState[id].x}px`;
            el.style.top = `${sectionState[id].y}px`;
            el.style.width = `${sectionState[id].w}px`;
            el.style.height = `${sectionState[id].h}px`;

            if (id === 'colorbar') renderColorKeyCanvas();
        }
    };

    const onPointerUp = () => {
        if (!interaction) return;
        interaction = null;
        document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    legendRoot.addEventListener('pointerdown', (e) => {
        if (!editMode) return;
        if (e.target.closest('#btn-legend-edit-pencil')) return;

        e.stopPropagation();

        // 1. Check outer box resize handle
        const boxHandle = e.target.closest('.legend-box-handle');
        if (boxHandle) {
            activateFreeLayoutIfNeeded();
            document.body.style.userSelect = 'none';
            interaction = {
                kind: 'resize-box',
                dir: boxHandle.dataset.dir,
                startX: e.clientX,
                startY: e.clientY,
                origLeft: boxRect.left,
                origTop: boxRect.top,
                origW: boxRect.width,
                origH: boxRect.height
            };
            return;
        }

        // 2. Check inner section resize handle
        const secHandle = e.target.closest('.legend-sec-handle');
        if (secHandle) {
            const secEl = secHandle.closest('.legend-section');
            if (!secEl) return;
            const id = secEl.dataset.sectionId;
            activateFreeLayoutIfNeeded();
            selectLegendSection(id);
            document.body.style.userSelect = 'none';
            interaction = {
                kind: 'resize-section',
                sectionId: id,
                el: secEl,
                dir: secHandle.dataset.dir,
                startX: e.clientX,
                startY: e.clientY,
                origX: sectionState[id].x,
                origY: sectionState[id].y,
                origW: sectionState[id].w,
                origH: sectionState[id].h
            };
            return;
        }

        // 3. Check click/drag on an inner section
        const secEl = e.target.closest('.legend-section');
        if (secEl) {
            const id = secEl.dataset.sectionId;
            activateFreeLayoutIfNeeded();
            selectLegendSection(id);
            document.body.style.userSelect = 'none';
            interaction = {
                kind: 'move-section',
                sectionId: id,
                el: secEl,
                startX: e.clientX,
                startY: e.clientY,
                origX: sectionState[id].x,
                origY: sectionState[id].y,
                origW: sectionState[id].w,
                origH: sectionState[id].h
            };
            return;
        }

        // 4. Drag anywhere else on the Legend box -> move entire box
        activateFreeLayoutIfNeeded();
        document.body.style.userSelect = 'none';
        interaction = {
            kind: 'move-box',
            startX: e.clientX,
            startY: e.clientY,
            origLeft: boxRect.left,
            origTop: boxRect.top,
            origW: boxRect.width,
            origH: boxRect.height
        };
    });

    // Keyboard Delete / Backspace removes selected section when in Edit Mode
    window.addEventListener('keydown', (e) => {
        if (!editMode || !selectedSectionId) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            deleteSelectedLegendSection();
        }
    });
}

/* =========================================================================
   DOM MOUNTING
   ========================================================================= */

const BOX_HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const SEC_HANDLE_DIRS = ['nw', 'ne', 'se', 'sw'];

function buildHandleHTML(cls, dirs) {
    return dirs.map((d) => `<span class="${cls} dir-${d}" data-dir="${d}"></span>`).join('');
}

export function initLegendOverlay() {
    if (legendRoot) return;

    legendRoot = document.createElement('div');
    legendRoot.id = 'legend-overlay-box';
    legendRoot.className = 'legend-overlay-box';
    legendRoot.innerHTML = `
        <div class="legend-meta-col">
            <div class="legend-section legend-sec-header" data-section-id="header">
                <div class="legend-section-content">ECMWF-IFS • 2m Temperature (°F)</div>
                ${buildHandleHTML('legend-sec-handle', SEC_HANDLE_DIRS)}
            </div>
            <div class="legend-times-row">
                <div class="legend-section legend-sec-time" data-section-id="init">
                    <div class="legend-section-content">Init: --</div>
                    ${buildHandleHTML('legend-sec-handle', SEC_HANDLE_DIRS)}
                </div>
                <div class="legend-section legend-sec-time legend-sec-fhr" data-section-id="fhr">
                    <div class="legend-section-content">F000</div>
                    ${buildHandleHTML('legend-sec-handle', SEC_HANDLE_DIRS)}
                </div>
                <div class="legend-section legend-sec-time" data-section-id="valid">
                    <div class="legend-section-content">Valid: --</div>
                    ${buildHandleHTML('legend-sec-handle', SEC_HANDLE_DIRS)}
                </div>
            </div>
        </div>

        <div class="legend-section legend-sec-colorbar" data-section-id="colorbar">
            <div id="legend-gradient-wrap" class="legend-gradient-wrap">
                <canvas id="legend-colorbar-canvas" class="legend-colorbar-canvas"></canvas>
                <div id="legend-colorbar-labels" class="legend-colorbar-labels"></div>
            </div>
            <div id="legend-ptype-wrap" class="legend-ptype-wrap" style="display: none;"></div>
            ${buildHandleHTML('legend-sec-handle', SEC_HANDLE_DIRS)}
        </div>

        <button
            id="btn-legend-edit-pencil"
            class="legend-edit-pencil-btn"
            type="button"
            title="Edit Legend"
            aria-label="Open Legend Editor"
        >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
        </button>

        ${buildHandleHTML('legend-box-handle', BOX_HANDLE_DIRS)}
    `;

    document.body.appendChild(legendRoot);

    const pencilBtn = document.getElementById('btn-legend-edit-pencil');
    if (pencilBtn) {
        pencilBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setLegendEditMode(!editMode);
        });
    }

    attachDragAndResizeHandlers();
    window.addEventListener('resize', () => renderColorKeyCanvas());
    updateLegendOverlay();
}
