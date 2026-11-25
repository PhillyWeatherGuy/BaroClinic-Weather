// js/layers/legendOverlay.js
import { stateManager } from '../core/stateManager.js';
import {
    getPaletteForParameter as getLightPalette,
    PRATE_PALETTE,
    SNOW_PALETTE,
    FRZR_PALETTE,
    SLEET_PALETTE
} from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { getRadarPalette, WXTOOLS_PALETTE_256 } from '../config/radarPalettes.js';

const DEFAULT_ELEMENT_ORDER = ['bg', 'header', 'init', 'fhr', 'valid', 'colorbar'];

const ELEMENT_LABELS = {
    bg: 'Background',
    header: 'Header',
    init: 'Init Time',
    fhr: 'Forecast Hour',
    valid: 'Valid Time',
    colorbar: 'Color Key'
};

const DESKTOP_RAIL_W = 48;
const DESKTOP_EDITOR_W = 420;

let mapRef = null;
let canvasRoot = null;
let dockWrap = null;
let editMode = false;
let selectedId = null;
let freeLayoutActive = false;
let lastFreeWorkspace = null;

let elementsMap = createDefaultElementsMap();
let customOrder = [];
let customCounter = 0;

let editToggleCallback = null;
let selectionChangeCallback = null;

function getCssZoomFactor() {
    if (canvasRoot && typeof canvasRoot.currentCSSZoom === 'number' && canvasRoot.currentCSSZoom > 0) {
        return canvasRoot.currentCSSZoom;
    }
    const htmlZoom = parseFloat(getComputedStyle(document.documentElement).zoom);
    const bodyZoom = parseFloat(getComputedStyle(document.body).zoom);
    const z = (Number.isFinite(htmlZoom) && htmlZoom > 0 ? htmlZoom : 1) *
              (Number.isFinite(bodyZoom) && bodyZoom > 0 ? bodyZoom : 1);
    return z > 0 ? z : 1;
}

function getWorkspaceBounds(isEditing = editMode) {
    const z = getCssZoomFactor();
    const isDesktop = window.innerWidth >= 1024;
    const left = isDesktop ? DESKTOP_RAIL_W : 0;
    const right = (window.innerWidth / z) - (isDesktop && isEditing ? DESKTOP_EDITOR_W : 0);
    return { left, right, span: Math.max(160, right - left) };
}

function createDefaultElementStyle(id) {
    if (id === 'bg') {
        return {
            bgColor: null,
            bgOpacity: 0.92,
            borderColor: null,
            borderWidth: 1,
            opacity: 1
        };
    }
    if (id === 'header') {
        return {
            fontFamily: "'Roboto', -apple-system, sans-serif",
            fontSize: 13,
            color: null,
            bold: true,
            italic: false,
            underline: false,
            align: 'left',
            opacity: 1
        };
    }
    if (id === 'fhr') {
        return {
            fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 11,
            color: null,
            bold: true,
            italic: false,
            underline: false,
            align: 'center',
            opacity: 1
        };
    }
    if (id === 'init' || id === 'valid') {
        return {
            fontFamily: "'Roboto', -apple-system, sans-serif",
            fontSize: 11,
            color: null,
            bold: false,
            italic: false,
            underline: false,
            align: 'left',
            opacity: 1
        };
    }
    if (id === 'colorbar') {
        return {
            barHeight: 13,
            tickFontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            tickFontSize: 10,
            tickColor: null,
            opacity: 1
        };
    }
    return {};
}

function createDefaultElementsMap() {
    const out = {};
    DEFAULT_ELEMENT_ORDER.forEach((id) => {
        out[id] = {
            id,
            kind: id === 'bg' ? 'box' : (id === 'colorbar' ? 'colorbar' : 'text'),
            isDefault: true,
            label: ELEMENT_LABELS[id],
            deleted: false,
            x: null,
            y: null,
            w: null,
            h: null,
            style: createDefaultElementStyle(id)
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

export function getSelectedLegendElement() {
    if (!selectedId) return null;
    const el = elementsMap[selectedId];
    if (!el || el.deleted) return null;
    return { ...el, style: { ...el.style } };
}

export function getDeletedDefaultSections() {
    return DEFAULT_ELEMENT_ORDER
        .filter((id) => elementsMap[id]?.deleted)
        .map((id) => ({ id, label: ELEMENT_LABELS[id] }));
}

function notifySelectionChange() {
    if (typeof selectionChangeCallback === 'function') {
        selectionChangeCallback(getSelectedLegendElement());
    }
}

function getElementDom(id) {
    return canvasRoot?.querySelector(`.legend-item[data-element-id="${id}"]`) || null;
}

function rescaleFreeLayoutToCurrentWorkspace() {
    if (!freeLayoutActive || !canvasRoot) return;
    const nextBounds = getWorkspaceBounds(editMode);
    if (!lastFreeWorkspace) {
        lastFreeWorkspace = nextBounds;
        return;
    }

    if (Math.abs(lastFreeWorkspace.span - nextBounds.span) < 2 && Math.abs(lastFreeWorkspace.left - nextBounds.left) < 2) {
        return;
    }

    const scaleX = nextBounds.span / lastFreeWorkspace.span;
    const allIds = [...DEFAULT_ELEMENT_ORDER, ...customOrder];

    allIds.forEach((id) => {
        const item = elementsMap[id];
        const el = getElementDom(id);
        if (!item || item.deleted || !el || !Number.isFinite(item.x)) return;

        const relX = item.x - lastFreeWorkspace.left;
        item.x = Math.round(nextBounds.left + relX * scaleX);

        if (item.kind === 'box' || item.kind === 'colorbar' || item.kind === 'shape' || item.kind === 'image') {
            const minW = item.kind === 'colorbar' ? 90 : 20;
            item.w = Math.max(minW, Math.round(item.w * scaleX));
            el.style.width = `${item.w}px`;
        } else if (item.x + item.w > nextBounds.right) {
            item.x = Math.max(nextBounds.left, Math.round(nextBounds.right - item.w));
        }

        el.style.left = `${item.x}px`;
    });

    lastFreeWorkspace = nextBounds;
}

export function setLegendEditMode(active) {
    editMode = Boolean(active);
    if (!canvasRoot) return;

    canvasRoot.classList.toggle('is-editing', editMode);
    document.body.classList.toggle('legend-editor-open', editMode);

    // Proportionally map free-layout elements so editor left edge == full-screen right edge
    rescaleFreeLayoutToCurrentWorkspace();

    if (!editMode) {
        selectedId = null;
        updateSelectionClasses();
    } else if (!selectedId) {
        const firstVisible = ['header', 'init', 'fhr', 'valid', 'colorbar', 'bg']
            .find((id) => !elementsMap[id].deleted) || customOrder[0] || null;
        selectedId = firstVisible;
        updateSelectionClasses();
    }

    if (typeof editToggleCallback === 'function') {
        editToggleCallback(editMode);
    }
    notifySelectionChange();

    requestAnimationFrame(() => {
        if (mapRef && typeof mapRef.resize === 'function') {
            mapRef.resize();
        }
        renderColorKeyCanvas();
    });
    setTimeout(() => {
        if (mapRef && typeof mapRef.resize === 'function') {
            mapRef.resize();
        }
        renderColorKeyCanvas();
    }, 240);
}

export function selectLegendElement(id) {
    if (id && elementsMap[id]?.deleted) return;
    selectedId = id || null;
    updateSelectionClasses();
    notifySelectionChange();
}

export function deleteSelectedLegendElement() {
    if (!selectedId) return;
    const item = elementsMap[selectedId];
    if (!item) return;

    const domEl = getElementDom(selectedId);

    if (item.isDefault) {
        item.deleted = true;
        if (domEl) domEl.style.display = 'none';
    } else {
        delete elementsMap[selectedId];
        customOrder = customOrder.filter((cid) => cid !== selectedId);
        if (domEl) domEl.remove();
    }

    const nextVisible = ['header', 'init', 'fhr', 'valid', 'colorbar', 'bg']
        .find((id) => !elementsMap[id].deleted) || customOrder[0] || null;
    selectedId = nextVisible;
    updateSelectionClasses();
    notifySelectionChange();
}

export function restoreLegendSection(id) {
    const item = elementsMap[id];
    if (!item) return;
    item.deleted = false;
    const domEl = getElementDom(id);
    if (domEl) {
        domEl.style.display = '';
    }
    selectedId = id;
    updateSelectionClasses();
    requestAnimationFrame(() => renderColorKeyCanvas());
    notifySelectionChange();
}

export function resetLegendToDefault() {
    freeLayoutActive = false;
    lastFreeWorkspace = null;
    elementsMap = createDefaultElementsMap();
    customOrder = [];

    if (canvasRoot && dockWrap) {
        canvasRoot.classList.remove('is-free-layout');
        canvasRoot.querySelectorAll('.legend-item.is-custom-element').forEach((el) => el.remove());

        const bgEl = getElementDom('bg');
        const headerEl = getElementDom('header');
        const initEl = getElementDom('init');
        const fhrEl = getElementDom('fhr');
        const validEl = getElementDom('valid');
        const cbEl = getElementDom('colorbar');

        const metaCol = dockWrap.querySelector('.legend-meta-col');
        const timesRow = dockWrap.querySelector('.legend-times-row');

        if (bgEl) dockWrap.insertBefore(bgEl, dockWrap.firstChild);
        if (metaCol && headerEl) metaCol.insertBefore(headerEl, timesRow);
        if (timesRow) {
            if (initEl) timesRow.appendChild(initEl);
            if (fhrEl) timesRow.appendChild(fhrEl);
            if (validEl) timesRow.appendChild(validEl);
        }
        if (cbEl) dockWrap.appendChild(cbEl);

        DEFAULT_ELEMENT_ORDER.forEach((id) => {
            const el = getElementDom(id);
            if (!el) return;
            el.style.display = '';
            el.style.left = '';
            el.style.top = '';
            el.style.width = '';
            el.style.height = '';
            applyElementVisualStyles(id);
        });
    }

    selectedId = editMode ? 'header' : null;
    updateSelectionClasses();
    requestAnimationFrame(() => renderColorKeyCanvas());
    notifySelectionChange();
}

function updateSelectionClasses() {
    if (!canvasRoot) return;
    canvasRoot.querySelectorAll('.legend-item').forEach((el) => {
        el.classList.toggle('is-selected', editMode && el.dataset.elementId === selectedId);
    });
}

/* =========================================================================
   STYLE UPDATES (Text, Colorbar, Background Box, Shape, Image)
   ========================================================================= */

function hexToRgba(hex, alpha = 1) {
    if (!hex || typeof hex !== 'string') return `rgba(19, 23, 34, ${alpha})`;
    const clean = hex.replace('#', '').trim();
    if (clean.length !== 6) return `rgba(19, 23, 34, ${alpha})`;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyElementVisualStyles(id) {
    if (!canvasRoot) return;
    const item = elementsMap[id];
    const el = getElementDom(id);
    if (!item || !el) return;

    const s = item.style || {};

    if (item.kind === 'box') {
        el.style.opacity = Number.isFinite(s.opacity) ? String(s.opacity) : '1';
        if (s.bgColor) {
            el.style.background = hexToRgba(s.bgColor, s.bgOpacity ?? 0.92);
        } else if (s.bgOpacity !== 0.92) {
            const isLight = document.body.classList.contains('light-mode');
            el.style.background = isLight
                ? `rgba(255, 255, 255, ${s.bgOpacity})`
                : `rgba(19, 23, 34, ${s.bgOpacity})`;
        } else {
            el.style.background = '';
        }

        el.style.borderColor = s.borderColor || '';
        if (Number.isFinite(s.borderWidth) && s.borderWidth !== 1) {
            el.style.borderWidth = `${s.borderWidth}px`;
            el.style.borderStyle = s.borderWidth <= 0 ? 'none' : 'solid';
        } else {
            el.style.borderWidth = '';
            el.style.borderStyle = '';
        }
        return;
    }

    el.style.opacity = Number.isFinite(s.opacity) ? String(s.opacity) : '1';

    if (item.kind === 'text') {
        const contentEl = el.querySelector('.legend-section-content');
        if (!contentEl) return;

        contentEl.style.fontFamily = s.fontFamily || '';
        contentEl.style.fontSize = Number.isFinite(s.fontSize) ? `${s.fontSize}px` : '';
        contentEl.style.color = s.color || '';
        contentEl.style.fontWeight = s.bold ? '700' : '400';
        contentEl.style.fontStyle = s.italic ? 'italic' : 'normal';
        contentEl.style.textDecoration = s.underline ? 'underline' : 'none';
        contentEl.style.textAlign = s.align || 'left';

        if (!item.isDefault && item.text !== undefined) {
            contentEl.textContent = item.text;
        }
    } else if (item.kind === 'colorbar') {
        const canvas = el.querySelector('#legend-colorbar-canvas');
        if (canvas && Number.isFinite(s.barHeight)) {
            canvas.style.height = `${s.barHeight}px`;
        }
        el.querySelectorAll('.legend-tick-label').forEach((lbl) => {
            lbl.style.fontFamily = s.tickFontFamily || '';
            lbl.style.fontSize = Number.isFinite(s.tickFontSize) ? `${s.tickFontSize}px` : '';
            lbl.style.color = s.tickColor || '';
        });
        renderColorKeyCanvas();
    } else if (item.kind === 'shape') {
        const shapeBox = el.querySelector('.legend-shape-node');
        if (!shapeBox) return;
        if (item.shapeType === 'line') {
            shapeBox.style.background = s.borderColor || s.fillColor || '#ffffff';
            shapeBox.style.height = `${Math.max(1, s.borderWidth || 3)}px`;
            shapeBox.style.border = 'none';
            shapeBox.style.borderRadius = '0';
        } else {
            shapeBox.style.height = '100%';
            shapeBox.style.background = s.fillColor || 'rgba(59, 130, 246, 0.25)';
            shapeBox.style.border = `${s.borderWidth ?? 1.5}px solid ${s.borderColor || '#ffffff'}`;
            shapeBox.style.borderRadius = item.shapeType === 'circle'
                ? '50%'
                : `${s.borderRadius ?? 0}px`;
        }
    }
}

export function updateSelectedLegendStyle(patch = {}) {
    if (!selectedId) return;
    const item = elementsMap[selectedId];
    if (!item) return;

    item.style = { ...item.style, ...patch };
    applyElementVisualStyles(selectedId);
    notifySelectionChange();
}

export function updateSelectedLegendText(newText) {
    if (!selectedId) return;
    const item = elementsMap[selectedId];
    if (!item || item.kind !== 'text' || item.isDefault) return;
    item.text = String(newText ?? '');
    applyElementVisualStyles(selectedId);
}

/* =========================================================================
   ADD CUSTOM ELEMENTS: TEXT, SHAPES, UPLOAD IMAGE
   ========================================================================= */

function getWorkspaceCenter() {
    const z = getCssZoomFactor();
    const bounds = getWorkspaceBounds(editMode);
    return {
        cx: Math.round((bounds.left + bounds.right) / 2),
        cy: Math.round(160 / z)
    };
}

export function addLegendText(initialText = 'Custom Text') {
    if (!canvasRoot) return;
    activateFreeLayoutIfNeeded();

    const id = `custom_text_${++customCounter}`;
    const { cx, cy } = getWorkspaceCenter();
    const elW = 160;
    const elH = 30;
    const x = Math.max(8, cx - Math.round(elW / 2));
    const y = cy;

    elementsMap[id] = {
        id,
        kind: 'text',
        isDefault: false,
        label: 'Text',
        text: initialText,
        deleted: false,
        x, y, w: elW, h: elH,
        style: {
            fontFamily: "'Roboto', -apple-system, sans-serif",
            fontSize: 16,
            color: '#ffffff',
            bold: true,
            italic: false,
            underline: false,
            align: 'center',
            opacity: 1
        }
    };
    customOrder.push(id);

    const node = document.createElement('div');
    node.className = 'legend-item is-custom-element legend-sec-custom-text';
    node.dataset.elementId = id;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.width = `${elW}px`;
    node.style.height = `${elH}px`;
    node.innerHTML = `
        <div class="legend-section-content">${initialText}</div>
        ${buildHandleHTML('legend-sec-handle', HANDLE_DIRS)}
    `;

    node.addEventListener('dblclick', (e) => {
        if (!editMode) return;
        e.stopPropagation();
        const contentEl = node.querySelector('.legend-section-content');
        if (!contentEl) return;
        contentEl.contentEditable = 'true';
        contentEl.focus();
        const range = document.createRange();
        range.selectNodeContents(contentEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        const finishEdit = () => {
            contentEl.contentEditable = 'false';
            elementsMap[id].text = contentEl.textContent || 'Text';
            notifySelectionChange();
        };
        contentEl.addEventListener('blur', finishEdit, { once: true });
        contentEl.addEventListener('keydown', (ke) => {
            if (ke.key === 'Enter') {
                ke.preventDefault();
                contentEl.blur();
            }
        });
    });

    canvasRoot.appendChild(node);
    applyElementVisualStyles(id);
    selectLegendElement(id);
}

export function addLegendShape(shapeType = 'rect') {
    if (!canvasRoot) return;
    activateFreeLayoutIfNeeded();

    const id = `custom_shape_${++customCounter}`;
    const { cx, cy } = getWorkspaceCenter();
    const elW = shapeType === 'line' ? 160 : (shapeType === 'circle' ? 56 : 130);
    const elH = shapeType === 'line' ? 14 : (shapeType === 'circle' ? 56 : 44);
    const x = Math.max(8, cx - Math.round(elW / 2));
    const y = cy;

    const shapeNames = { rect: 'Rectangle', circle: 'Circle', line: 'Line' };

    elementsMap[id] = {
        id,
        kind: 'shape',
        shapeType,
        isDefault: false,
        label: shapeNames[shapeType] || 'Shape',
        deleted: false,
        x, y, w: elW, h: elH,
        style: {
            fillColor: '#2563eb',
            borderColor: '#ffffff',
            borderWidth: shapeType === 'line' ? 3 : 1.5,
            borderRadius: 0,
            opacity: 0.9
        }
    };
    customOrder.push(id);

    const node = document.createElement('div');
    node.className = 'legend-item is-custom-element legend-sec-custom-shape';
    node.dataset.elementId = id;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.width = `${elW}px`;
    node.style.height = `${elH}px`;
    node.innerHTML = `
        <div class="legend-shape-node"></div>
        ${buildHandleHTML('legend-sec-handle', HANDLE_DIRS)}
    `;

    canvasRoot.appendChild(node);
    applyElementVisualStyles(id);
    selectLegendElement(id);
}

export function addLegendImage(dataUrl) {
    if (!canvasRoot || !dataUrl) return;
    activateFreeLayoutIfNeeded();

    const img = new Image();
    img.onload = () => {
        const id = `custom_img_${++customCounter}`;
        const { cx, cy } = getWorkspaceCenter();
        const elH = 72;
        const ratio = img.naturalWidth && img.naturalHeight ? (img.naturalWidth / img.naturalHeight) : 1;
        const elW = Math.max(36, Math.round(elH * ratio));
        const x = Math.max(8, cx - Math.round(elW / 2));
        const y = cy;

        elementsMap[id] = {
            id,
            kind: 'image',
            isDefault: false,
            label: 'Image',
            src: dataUrl,
            deleted: false,
            x, y, w: elW, h: elH,
            style: {
                opacity: 1
            }
        };
        customOrder.push(id);

        const node = document.createElement('div');
        node.className = 'legend-item is-custom-element legend-sec-custom-image';
        node.dataset.elementId = id;
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        node.style.width = `${elW}px`;
        node.style.height = `${elH}px`;
        node.innerHTML = `
            <img class="legend-custom-img" src="${dataUrl}" alt="Custom legend graphic" draggable="false" />
            ${buildHandleHTML('legend-sec-handle', HANDLE_DIRS)}
        `;

        canvasRoot.appendChild(node);
        applyElementVisualStyles(id);
        selectLegendElement(id);
    };
    img.src = dataUrl;
}

export function replaceSelectedLegendImage(dataUrl) {
    if (!selectedId || !dataUrl) return;
    const item = elementsMap[selectedId];
    if (!item || item.kind !== 'image') return;
    item.src = dataUrl;
    const imgEl = getElementDom(selectedId)?.querySelector('.legend-custom-img');
    if (imgEl) imgEl.src = dataUrl;
}

/* =========================================================================
   DETACH TO INDEPENDENT FREE-FLOATING ELEMENTS (Zoom-compensated 1:1!)
   ========================================================================= */

function activateFreeLayoutIfNeeded() {
    if (freeLayoutActive || !canvasRoot) return;

    const z = getCssZoomFactor();
    lastFreeWorkspace = getWorkspaceBounds(editMode);

    const rects = {};
    DEFAULT_ELEMENT_ORDER.forEach((id) => {
        const el = getElementDom(id);
        if (!el || elementsMap[id].deleted) return;
        const r = el.getBoundingClientRect();
        const extraW = elementsMap[id].kind === 'text' ? 6 : 0;
        rects[id] = {
            x: Math.round(r.left / z),
            y: Math.round(r.top / z),
            w: Math.round((r.width / z) + extraW),
            h: Math.round(r.height / z)
        };
    });

    freeLayoutActive = true;
    canvasRoot.classList.add('is-free-layout');

    DEFAULT_ELEMENT_ORDER.forEach((id) => {
        const el = getElementDom(id);
        const r = rects[id];
        if (!el) return;

        canvasRoot.appendChild(el);
        if (r) {
            elementsMap[id].x = r.x;
            elementsMap[id].y = r.y;
            elementsMap[id].w = r.w;
            elementsMap[id].h = r.h;

            el.style.left = `${r.x}px`;
            el.style.top = `${r.y}px`;
            el.style.width = `${r.w}px`;
            el.style.height = `${r.h}px`;
        }
    });

    requestAnimationFrame(() => renderColorKeyCanvas());
}

/* =========================================================================
   COLOR KEY & UNIT RESOLUTION (Zero interpolation exact colors)
   ========================================================================= */

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

    const isTemp = rawUnit.includes('°') || normUnit === 'k' || normUnit === 'c' || normUnit === 'f' ||
        normUnit.includes('kelvin') || normUnit.includes('celsius') || normUnit.includes('fahrenheit') ||
        (paramId.startsWith('t') && !paramId.startsWith('tp')) || paramId === '2t' || paramId === 'd2m';

    if (isTemp) {
        const minK = Number(scaling?.min_val ?? manifest.min_val ?? manifest.temp_min_k ?? 216.4833);
        const maxK = Number(scaling?.max_val ?? manifest.max_val ?? manifest.temp_max_k ?? 327.5944);
        const toF = (v) => (v > 150 ? (v - 273.15) * 9 / 5 + 32 : (normUnit.includes('c') ? v * 9 / 5 + 32 : v));
        const minF = toF(minK);
        const maxF = toF(maxK);

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
        if (isMetric && normUnit === 'in/hr') {
            return `${(v * 25.4).toFixed(0)}`;
        }
        return `${v}`;
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
    if (!canvasRoot || elementsMap.colorbar?.deleted) return;
    const cbEl = getElementDom('colorbar');
    if (!cbEl) return;

    const canvas = cbEl.querySelector('#legend-colorbar-canvas');
    const labelsRow = cbEl.querySelector('#legend-colorbar-labels');
    const ptypeWrap = cbEl.querySelector('#legend-ptype-wrap');
    const gradWrap = cbEl.querySelector('#legend-gradient-wrap');
    if (!canvas || !labelsRow || !ptypeWrap || !gradWrap) return;

    const cbStyle = elementsMap.colorbar?.style || {};
    const spec = getActiveColorKeySpec();

    if (spec.type === 'ptype') {
        gradWrap.style.display = 'none';
        ptypeWrap.style.display = 'flex';
        const barH = Number.isFinite(cbStyle.barHeight) ? cbStyle.barHeight : 10;
        ptypeWrap.innerHTML = spec.bands.map((band) => {
            const runs = getColorRuns(band.palette);
            const segs = runs.map((r) =>
                `<span style="flex: ${r.count} 1 0; height: 100%; background: ${r.css};"></span>`
            ).join('');
            return `
                <div class="legend-ptype-item">
                    <span class="legend-ptype-label">${band.label}</span>
                    <div class="legend-ptype-bar" style="display: flex; overflow: hidden; height: ${barH}px;">${segs}</div>
                </div>
            `;
        }).join('');
        return;
    }

    ptypeWrap.style.display = 'none';
    gradWrap.style.display = 'flex';

    const z = getCssZoomFactor();
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(120, Math.round(canvas.clientWidth || (rect.width / z) || 300));
    const h = Math.max(6, Math.round(canvas.clientHeight || (rect.height / z) || cbStyle.barHeight || 13));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

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

    const tickFont = cbStyle.tickFontFamily || "SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    const tickSize = Number.isFinite(cbStyle.tickFontSize) ? cbStyle.tickFontSize : 10;
    const tickColorStyle = cbStyle.tickColor ? `color: ${cbStyle.tickColor};` : '';

    labelsRow.innerHTML = spec.ticks.map((t) => {
        const pct = Math.max(2, Math.min(98, t.pos * 100));
        return `<span class="legend-tick-label" style="left: ${pct.toFixed(1)}%; font-family: ${tickFont}; font-size: ${tickSize}px; ${tickColorStyle}">${t.label}</span>`;
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
    if (!canvasRoot) return;

    const hideModes = stateManager.activeMode === 'satellite' || stateManager.activeMode === 'tropics';
    canvasRoot.style.display = hideModes ? 'none' : '';
    if (hideModes) return;

    const modelText = document.querySelector('#btn-model-menu span')?.textContent?.trim() || 'ECMWF-IFS';
    const paramName = stateManager.manifest?.name || stateManager.paramConfig?.name ||
                      document.querySelector('#btn-param-menu span')?.textContent?.trim() || '2m Temperature';
    const unitLabel = getResolvedUnitLabel();

    const headerEl = getElementDom('header')?.querySelector('.legend-section-content');
    const initEl = getElementDom('init')?.querySelector('.legend-section-content');
    const fhrEl = getElementDom('fhr')?.querySelector('.legend-section-content');
    const validEl = getElementDom('valid')?.querySelector('.legend-section-content');

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

    applyElementVisualStyles('bg');
    requestAnimationFrame(() => renderColorKeyCanvas());
}

/* =========================================================================
   UNBOUNDED DRAG & RESIZE INTERACTIONS
   (Moving/resizing 'bg' also moves & shapes elements inside 'bg'!)
   ========================================================================= */

function captureBgChildrenSnapshot() {
    const bg = elementsMap.bg;
    if (!bg || bg.deleted) return [];

    const children = [];
    const allIds = [...DEFAULT_ELEMENT_ORDER, ...customOrder];
    allIds.forEach((cid) => {
        if (cid === 'bg') return;
        const c = elementsMap[cid];
        const cEl = getElementDom(cid);
        if (!c || c.deleted || !cEl || !Number.isFinite(c.x)) return;

        const cx = c.x + c.w / 2;
        const cy = c.y + c.h / 2;
        if (cx >= bg.x - 4 && cx <= bg.x + bg.w + 4 && cy >= bg.y - 4 && cy <= bg.y + bg.h + 4) {
            children.push({
                id: cid,
                el: cEl,
                kind: c.kind,
                origX: c.x,
                origY: c.y,
                origW: c.w,
                origH: c.h
            });
        }
    });
    return children;
}

function attachDragAndResizeHandlers() {
    let interaction = null;

    const onPointerMove = (e) => {
        if (!interaction) return;
        e.preventDefault();

        const z = getCssZoomFactor();

        if (!interaction.detached) {
            if (Math.hypot(e.clientX - interaction.startX, e.clientY - interaction.startY) < 4 && interaction.kind === 'move') {
                return;
            }
            activateFreeLayoutIfNeeded();
            const item = elementsMap[interaction.id];
            interaction.origX = item.x;
            interaction.origY = item.y;
            interaction.origW = item.w;
            interaction.origH = item.h;
            if (interaction.id === 'bg') {
                interaction.bgChildren = captureBgChildrenSnapshot();
            }
            interaction.detached = true;
        }

        const dx = (e.clientX - interaction.startX) / z;
        const dy = (e.clientY - interaction.startY) / z;
        const id = interaction.id;
        const el = interaction.el;
        const item = elementsMap[id];

        if (interaction.kind === 'move') {
            const viewW = window.innerWidth / z;
            const viewH = window.innerHeight / z;
            const maxX = Math.max(0, viewW - interaction.origW);
            const maxY = Math.max(0, viewH - interaction.origH);
            item.x = Math.round(Math.max(0, Math.min(maxX, interaction.origX + dx)));
            item.y = Math.round(Math.max(0, Math.min(maxY, interaction.origY + dy)));
            el.style.left = `${item.x}px`;
            el.style.top = `${item.y}px`;

            if (id === 'bg' && interaction.bgChildren?.length) {
                const actualDx = item.x - interaction.origX;
                const actualDy = item.y - interaction.origY;
                interaction.bgChildren.forEach((child) => {
                    const c = elementsMap[child.id];
                    c.x = Math.round(child.origX + actualDx);
                    c.y = Math.round(child.origY + actualDy);
                    child.el.style.left = `${c.x}px`;
                    child.el.style.top = `${c.y}px`;
                });
            }
        } else if (interaction.kind === 'resize') {
            const minW = id === 'colorbar' ? 120 : (id === 'bg' ? 160 : 28);
            const minH = id === 'colorbar' ? 24 : (id === 'bg' ? 32 : 12);
            let { origX: x, origY: y, origW: w, origH: h } = interaction;
            const dir = interaction.dir;

            if (dir.includes('e')) w = Math.max(minW, w + dx);
            if (dir.includes('s')) h = Math.max(minH, h + dy);
            if (dir.includes('w')) {
                const nextW = Math.max(minW, w - dx);
                x += (w - nextW);
                w = nextW;
            }
            if (dir.includes('n')) {
                const nextH = Math.max(minH, h - dy);
                y += (h - nextH);
                h = nextH;
            }

            item.x = Math.round(x);
            item.y = Math.round(y);
            item.w = Math.round(w);
            item.h = Math.round(h);

            el.style.left = `${item.x}px`;
            el.style.top = `${item.y}px`;
            el.style.width = `${item.w}px`;
            el.style.height = `${item.h}px`;

            if (id === 'bg' && interaction.bgChildren?.length) {
                const sx = item.w / Math.max(1, interaction.origW);
                const sy = item.h / Math.max(1, interaction.origH);
                let touchesColorbar = false;

                interaction.bgChildren.forEach((child) => {
                    const c = elementsMap[child.id];
                    const relX = child.origX - interaction.origX;
                    const relY = child.origY - interaction.origY;

                    c.x = Math.round(item.x + relX * sx);
                    c.y = Math.round(item.y + relY * sy);

                    const minCW = child.id === 'colorbar' ? 90 : 20;
                    const minCH = child.id === 'colorbar' ? 20 : 12;
                    c.w = Math.max(minCW, Math.round(child.origW * sx));
                    c.h = Math.max(minCH, Math.round(child.origH * sy));

                    child.el.style.left = `${c.x}px`;
                    child.el.style.top = `${c.y}px`;
                    child.el.style.width = `${c.w}px`;
                    child.el.style.height = `${c.h}px`;

                    if (child.id === 'colorbar') touchesColorbar = true;
                });

                if (touchesColorbar) renderColorKeyCanvas();
            } else if (id === 'colorbar') {
                renderColorKeyCanvas();
            }
        }
    };

    const onPointerUp = () => {
        if (!interaction) return;
        interaction = null;
        document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    window.addEventListener('pointermove', (e) => {
        if (!canvasRoot) return;
        if (e.target?.closest?.('#basemap-editor-panel, #legend-editor-panel')) {
            canvasRoot.classList.remove('is-pencil-visible');
            return;
        }
        const z = getCssZoomFactor();
        const cssX = e.clientX / z;
        const cssY = e.clientY / z;
        const bounds = getWorkspaceBounds(editMode);
        const topLimit = window.innerWidth >= 1024 ? 50 : 96;
        const nearTopOfMap = cssY >= topLimit && cssY <= topLimit + 95 && cssX >= bounds.left && cssX <= bounds.right;
        const overLegendItem = Boolean(e.target?.closest?.('.legend-item, #btn-legend-edit-pencil'));
        canvasRoot.classList.toggle('is-pencil-visible', nearTopOfMap || overLegendItem);
    });

    document.addEventListener('mouseleave', () => {
        canvasRoot?.classList.remove('is-pencil-visible');
    });

    canvasRoot.addEventListener('pointerdown', (e) => {
        if (!editMode) return;
        if (e.target.closest('#btn-legend-edit-pencil')) return;
        if (e.target.isContentEditable) return;

        // 1. Check resize handle on any item
        const handleEl = e.target.closest('.legend-sec-handle');
        if (handleEl) {
            const itemEl = handleEl.closest('.legend-item');
            if (!itemEl) return;
            e.stopPropagation();
            const id = itemEl.dataset.elementId;
            activateFreeLayoutIfNeeded();
            selectLegendElement(id);
            document.body.style.userSelect = 'none';
            interaction = {
                kind: 'resize',
                detached: true,
                id,
                el: itemEl,
                dir: handleEl.dataset.dir,
                startX: e.clientX,
                startY: e.clientY,
                origX: elementsMap[id].x,
                origY: elementsMap[id].y,
                origW: elementsMap[id].w,
                origH: elementsMap[id].h,
                bgChildren: id === 'bg' ? captureBgChildrenSnapshot() : null
            };
            return;
        }

        // 2. Check click/drag on any item
        const itemEl = e.target.closest('.legend-item');
        if (itemEl) {
            e.stopPropagation();
            const id = itemEl.dataset.elementId;
            selectLegendElement(id);
            document.body.style.userSelect = 'none';
            interaction = {
                kind: 'move',
                detached: freeLayoutActive,
                id,
                el: itemEl,
                startX: e.clientX,
                startY: e.clientY,
                origX: elementsMap[id].x,
                origY: elementsMap[id].y,
                origW: elementsMap[id].w,
                origH: elementsMap[id].h,
                bgChildren: (freeLayoutActive && id === 'bg') ? captureBgChildrenSnapshot() : null
            };
        }
    });

    window.addEventListener('keydown', (e) => {
        if (!editMode || !selectedId) return;
        if (document.activeElement?.isContentEditable) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            deleteSelectedLegendElement();
        }
    });
}

/* =========================================================================
   DOM MOUNTING
   ========================================================================= */

const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function buildHandleHTML(cls, dirs) {
    return dirs.map((d) => `<span class="${cls} dir-${d}" data-dir="${d}"></span>`).join('');
}

export function initLegendOverlay(map = null) {
    if (map) mapRef = map;
    if (canvasRoot) return;

    canvasRoot = document.createElement('div');
    canvasRoot.id = 'legend-canvas-root';
    canvasRoot.className = 'legend-canvas-root';
    canvasRoot.innerHTML = `
        <div id="legend-dock-wrap" class="legend-dock-wrap">
            <div class="legend-item legend-bg-bar" data-element-id="bg">
                ${buildHandleHTML('legend-sec-handle', HANDLE_DIRS)}
            </div>

            <div class="legend-meta-col">
                <div class="legend-item legend-sec-header" data-element-id="header">
                    <div class="legend-section-content">ECMWF-IFS • 2m Temperature (°F)</div>
                    ${buildHandleHTML('legend-sec-handle', HANDLE_DIRS)}
                </div>
                <div class="legend-times-row">
                    <div class="legend-item legend-sec-time" data-element-id="init">
                        <div class="legend-section-content">Init: --</div>
                        ${buildHandleHTML('legend-sec-handle', HANDLE_DIRS)}
                    </div>
                    <div class="legend-item legend-sec-time legend-sec-fhr" data-element-id="fhr">
                        <div class="legend-section-content">F000</div>
                        ${buildHandleHTML('legend-sec-handle', HANDLE_DIRS)}
                    </div>
                    <div class="legend-item legend-sec-time" data-element-id="valid">
                        <div class="legend-section-content">Valid: --</div>
                        ${buildHandleHTML('legend-sec-handle', HANDLE_DIRS)}
                    </div>
                </div>
            </div>

            <div class="legend-item legend-sec-colorbar" data-element-id="colorbar">
                <div id="legend-gradient-wrap" class="legend-gradient-wrap">
                    <canvas id="legend-colorbar-canvas" class="legend-colorbar-canvas"></canvas>
                    <div id="legend-colorbar-labels" class="legend-colorbar-labels"></div>
                </div>
                <div id="legend-ptype-wrap" class="legend-ptype-wrap" style="display: none;"></div>
                ${buildHandleHTML('legend-sec-handle', HANDLE_DIRS)}
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
        </div>
    `;

    document.body.appendChild(canvasRoot);
    dockWrap = document.getElementById('legend-dock-wrap');

    const pencilBtn = document.getElementById('btn-legend-edit-pencil');
    if (pencilBtn) {
        pencilBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setLegendEditMode(!editMode);
        });
    }

    attachDragAndResizeHandlers();
    window.addEventListener('resize', () => {
        rescaleFreeLayoutToCurrentWorkspace();
        renderColorKeyCanvas();
    });
    updateLegendOverlay();
}
