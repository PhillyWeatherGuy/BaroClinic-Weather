// js/components/legendEditor.js
import {
    setLegendCallbacks,
    setLegendEditMode,
    selectLegendElement,
    deleteSelectedLegendElement,
    restoreLegendSection,
    resetLegendToDefault,
    getSelectedLegendElement,
    getDeletedDefaultSections,
    updateSelectedLegendStyle,
    updateSelectedLegendText,
    addLegendText,
    addLegendShape,
    addLegendImage,
    replaceSelectedLegendImage
} from '../layers/legendOverlay.js';

const FONT_OPTIONS = [
    { label: 'Roboto', value: "'Roboto', -apple-system, sans-serif" },
    { label: 'Inter', value: "'Inter', -apple-system, sans-serif" },
    { label: 'Montserrat', value: "'Montserrat', sans-serif" },
    { label: 'Poppins', value: "'Poppins', sans-serif" },
    { label: 'Oswald', value: "'Oswald', 'Arial Narrow', sans-serif" },
    { label: 'Bebas Neue', value: "'Bebas Neue', Impact, sans-serif" },
    { label: 'System Sans', value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
    { label: 'Arial', value: "Arial, Helvetica, sans-serif" },
    { label: 'Trebuchet MS', value: "'Trebuchet MS', 'Lucida Sans Unicode', sans-serif" },
    { label: 'Impact', value: "Impact, 'Arial Narrow', sans-serif" },
    { label: 'JetBrains Mono', value: "'JetBrains Mono', Consolas, monospace" },
    { label: 'Monospace', value: "SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
    { label: 'Merriweather', value: "'Merriweather', Georgia, serif" },
    { label: 'Georgia', value: "Georgia, 'Times New Roman', serif" }
];

let panelEl = null;
let renderedKey = '';
let shapesMenuOpen = false;
let imageMode = 'add'; // 'add' | 'replace'

function closeBasemapEditorIfOpen() {
    const basemapPanel = document.getElementById('basemap-editor-panel');
    const basemapBtn = document.getElementById('btn-basemap-editor');
    if (basemapPanel && basemapPanel.classList.contains('open')) {
        basemapPanel.classList.remove('open');
        basemapPanel.setAttribute('aria-hidden', 'true');
    }
    if (basemapBtn) {
        basemapBtn.classList.remove('active');
        basemapBtn.setAttribute('aria-expanded', 'false');
    }
}

function setPanelOpen(isOpen) {
    if (!panelEl) return;
    if (isOpen) {
        closeBasemapEditorIfOpen();
    } else {
        shapesMenuOpen = false;
        const shapesPop = panelEl.querySelector('#legend-shapes-popover');
        if (shapesPop) shapesPop.style.display = 'none';
    }
    panelEl.classList.toggle('open', isOpen);
    panelEl.setAttribute('aria-hidden', String(!isOpen));
}

function getDefaultColorHexForElement(selected) {
    const isLight = document.body.classList.contains('light-mode');
    if (selected?.id === 'fhr') return isLight ? '#1d4ed8' : '#93c5fd';
    if (selected?.id === 'init' || selected?.id === 'valid') return isLight ? '#334155' : '#cbd5e1';
    return isLight ? '#0f172a' : '#f8fafc';
}

function syncRestoreStrip() {
    const restoreWrap = panelEl?.querySelector('#legend-restore-strip');
    if (!restoreWrap) return;

    const deleted = getDeletedDefaultSections();
    if (deleted.length === 0) {
        restoreWrap.style.display = 'none';
        restoreWrap.innerHTML = '';
        return;
    }

    restoreWrap.style.display = 'flex';
    restoreWrap.innerHTML = `
        <span class="le-restore-label">Hidden:</span>
        ${deleted.map((sec) => `
            <button type="button" class="le-restore-pill" data-restore-id="${sec.id}">+ ${sec.label}</button>
        `).join('')}
    `;

    restoreWrap.querySelectorAll('[data-restore-id]').forEach((btn) => {
        btn.addEventListener('click', () => restoreLegendSection(btn.dataset.restoreId));
    });
}

function renderInspectorForSelection(selected) {
    const host = panelEl?.querySelector('#legend-inspector-controls');
    const titleEl = panelEl?.querySelector('#legend-active-target-name');
    const deleteBtn = panelEl?.querySelector('#btn-le-delete');
    const boxBtn = panelEl?.querySelector('#btn-le-select-box');
    if (!host) return;

    if (titleEl) {
        titleEl.textContent = selected ? selected.label : 'Nothing Selected';
    }
    if (deleteBtn) {
        deleteBtn.disabled = !selected || selected.id === '__box__';
    }
    if (boxBtn) {
        boxBtn.classList.toggle('active', selected?.id === '__box__');
    }

    if (!selected) {
        renderedKey = 'none';
        host.innerHTML = `<div class="le-empty-msg">Click any element on the legend to edit it.</div>`;
        return;
    }

    const nextKey = `${selected.id}:${selected.kind}:${selected.shapeType || ''}`;
    const s = selected.style || {};

    // Update existing inputs without rebuilding DOM while user is dragging sliders or typing
    if (nextKey === renderedKey) {
        syncExistingControlValues(selected, s);
        return;
    }
    renderedKey = nextKey;

    if (selected.kind === 'text') {
        const activeColor = s.color || getDefaultColorHexForElement(selected);
        const opacityPct = Math.round((s.opacity ?? 1) * 100);

        host.innerHTML = `
            ${!selected.isDefault ? `
                <div class="le-row">
                    <input id="le-text-content" class="le-text-input" type="text" value="${(selected.text || '').replace(/"/g, '&quot;')}" placeholder="Enter text..." />
                </div>
            ` : ''}

            <div class="le-row le-font-row">
                <select id="le-font-family" class="basemap-font-select" aria-label="Font family">
                    ${FONT_OPTIONS.map((f) => `<option value="${f.value}" ${s.fontFamily === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}
                </select>
                <div class="basemap-font-size-wrap">
                    <input id="le-font-size" class="basemap-font-size-input" type="number" min="8" max="64" step="1" value="${s.fontSize || 13}" aria-label="Font size" />
                    <span class="basemap-font-size-unit">px</span>
                </div>
            </div>

            <div class="le-row le-style-toolbar">
                <input id="le-text-color" class="basemap-color-input" type="color" value="${activeColor}" aria-label="Text color" title="Text Color" />
                <div class="le-btn-group">
                    <button id="le-btn-bold" type="button" class="le-fmt-btn ${s.bold ? 'active' : ''}" title="Bold"><b>B</b></button>
                    <button id="le-btn-italic" type="button" class="le-fmt-btn ${s.italic ? 'active' : ''}" title="Italic"><i>I</i></button>
                    <button id="le-btn-underline" type="button" class="le-fmt-btn ${s.underline ? 'active' : ''}" title="Underline"><u>U</u></button>
                </div>
                <div class="le-btn-group">
                    <button type="button" class="le-align-btn ${(s.align || 'left') === 'left' ? 'active' : ''}" data-align="left" title="Align Left">L</button>
                    <button type="button" class="le-align-btn ${s.align === 'center' ? 'active' : ''}" data-align="center" title="Align Center">C</button>
                    <button type="button" class="le-align-btn ${s.align === 'right' ? 'active' : ''}" data-align="right" title="Align Right">R</button>
                </div>
            </div>

            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Transparency</span>
                <input id="le-opacity" class="basemap-range-slider" type="range" min="0" max="100" step="1" value="${opacityPct}" />
                <span id="le-opacity-val" class="basemap-slider-value">${opacityPct}%</span>
            </div>
        `;

        host.querySelector('#le-text-content')?.addEventListener('input', (e) => {
            updateSelectedLegendText(e.target.value);
        });
        host.querySelector('#le-font-family')?.addEventListener('change', (e) => {
            updateSelectedLegendStyle({ fontFamily: e.target.value });
        });
        const sizeEl = host.querySelector('#le-font-size');
        sizeEl?.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 8 && v <= 64) updateSelectedLegendStyle({ fontSize: Math.round(v) });
        });
        sizeEl?.addEventListener('change', (e) => {
            const raw = parseFloat(e.target.value);
            const clamped = Number.isFinite(raw) ? Math.min(64, Math.max(8, Math.round(raw))) : 13;
            e.target.value = String(clamped);
            updateSelectedLegendStyle({ fontSize: clamped });
        });
        host.querySelector('#le-text-color')?.addEventListener('input', (e) => {
            updateSelectedLegendStyle({ color: e.target.value });
        });
        host.querySelector('#le-btn-bold')?.addEventListener('click', () => {
            const cur = getSelectedLegendElement()?.style?.bold;
            updateSelectedLegendStyle({ bold: !cur });
        });
        host.querySelector('#le-btn-italic')?.addEventListener('click', () => {
            const cur = getSelectedLegendElement()?.style?.italic;
            updateSelectedLegendStyle({ italic: !cur });
        });
        host.querySelector('#le-btn-underline')?.addEventListener('click', () => {
            const cur = getSelectedLegendElement()?.style?.underline;
            updateSelectedLegendStyle({ underline: !cur });
        });
        host.querySelectorAll('.le-align-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                updateSelectedLegendStyle({ align: btn.dataset.align });
            });
        });
        host.querySelector('#le-opacity')?.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value);
            if (Number.isFinite(pct)) updateSelectedLegendStyle({ opacity: pct / 100 });
        });

    } else if (selected.kind === 'colorbar') {
        const isLight = document.body.classList.contains('light-mode');
        const tickColor = s.tickColor || (isLight ? '#1e293b' : '#e2e8f0');
        const opacityPct = Math.round((s.opacity ?? 1) * 100);

        host.innerHTML = `
            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Bar Height</span>
                <input id="le-cb-height" class="basemap-range-slider" type="range" min="6" max="36" step="1" value="${s.barHeight ?? 13}" />
                <span id="le-cb-height-val" class="basemap-slider-value">${s.barHeight ?? 13}px</span>
            </div>

            <div class="le-row le-font-row">
                <select id="le-cb-font" class="basemap-font-select" aria-label="Label font">
                    ${FONT_OPTIONS.map((f) => `<option value="${f.value}" ${s.tickFontFamily === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}
                </select>
                <div class="basemap-font-size-wrap">
                    <input id="le-cb-size" class="basemap-font-size-input" type="number" min="7" max="24" step="1" value="${s.tickFontSize || 10}" aria-label="Label size" />
                    <span class="basemap-font-size-unit">px</span>
                </div>
            </div>

            <div class="le-row le-space-between">
                <span class="basemap-control-label">Label Color</span>
                <input id="le-cb-color" class="basemap-color-input" type="color" value="${tickColor}" />
            </div>

            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Transparency</span>
                <input id="le-opacity" class="basemap-range-slider" type="range" min="0" max="100" step="1" value="${opacityPct}" />
                <span id="le-opacity-val" class="basemap-slider-value">${opacityPct}%</span>
            </div>
        `;

        host.querySelector('#le-cb-height')?.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) updateSelectedLegendStyle({ barHeight: v });
        });
        host.querySelector('#le-cb-font')?.addEventListener('change', (e) => {
            updateSelectedLegendStyle({ tickFontFamily: e.target.value });
        });
        host.querySelector('#le-cb-size')?.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 7 && v <= 24) updateSelectedLegendStyle({ tickFontSize: Math.round(v) });
        });
        host.querySelector('#le-cb-color')?.addEventListener('input', (e) => {
            updateSelectedLegendStyle({ tickColor: e.target.value });
        });
        host.querySelector('#le-opacity')?.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value);
            if (Number.isFinite(pct)) updateSelectedLegendStyle({ opacity: pct / 100 });
        });

    } else if (selected.kind === 'shape') {
        const opacityPct = Math.round((s.opacity ?? 0.9) * 100);
        const isLine = selected.shapeType === 'line';

        host.innerHTML = `
            ${!isLine ? `
                <div class="le-row le-space-between">
                    <span class="basemap-control-label">Fill Color</span>
                    <input id="le-shape-fill" class="basemap-color-input" type="color" value="${s.fillColor || '#2563eb'}" />
                </div>
            ` : ''}
            <div class="le-row le-space-between">
                <span class="basemap-control-label">${isLine ? 'Line Color' : 'Border Color'}</span>
                <input id="le-shape-border" class="basemap-color-input" type="color" value="${s.borderColor || '#ffffff'}" />
            </div>
            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">${isLine ? 'Thickness' : 'Border'}</span>
                <input id="le-shape-bw" class="basemap-range-slider" type="range" min="${isLine ? 1 : 0}" max="10" step="0.5" value="${s.borderWidth ?? 1.5}" />
                <span id="le-shape-bw-val" class="basemap-slider-value">${(s.borderWidth ?? 1.5).toFixed(1)}px</span>
            </div>
            ${selected.shapeType === 'rect' ? `
                <div class="le-row le-slider-row">
                    <span class="basemap-slider-label">Corners</span>
                    <input id="le-shape-radius" class="basemap-range-slider" type="range" min="0" max="24" step="1" value="${s.borderRadius ?? 0}" />
                    <span id="le-shape-radius-val" class="basemap-slider-value">${s.borderRadius ?? 0}px</span>
                </div>
            ` : ''}
            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Transparency</span>
                <input id="le-opacity" class="basemap-range-slider" type="range" min="0" max="100" step="1" value="${opacityPct}" />
                <span id="le-opacity-val" class="basemap-slider-value">${opacityPct}%</span>
            </div>
        `;

        host.querySelector('#le-shape-fill')?.addEventListener('input', (e) => {
            updateSelectedLegendStyle({ fillColor: e.target.value });
        });
        host.querySelector('#le-shape-border')?.addEventListener('input', (e) => {
            updateSelectedLegendStyle({ borderColor: e.target.value });
        });
        host.querySelector('#le-shape-bw')?.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) updateSelectedLegendStyle({ borderWidth: v });
        });
        host.querySelector('#le-shape-radius')?.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) updateSelectedLegendStyle({ borderRadius: v });
        });
        host.querySelector('#le-opacity')?.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value);
            if (Number.isFinite(pct)) updateSelectedLegendStyle({ opacity: pct / 100 });
        });

    } else if (selected.kind === 'image') {
        const opacityPct = Math.round((s.opacity ?? 1) * 100);
        host.innerHTML = `
            <div class="le-row">
                <button id="btn-le-replace-img" class="basemap-highlight-btn" type="button" style="justify-content:center;">Replace Image</button>
            </div>
            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Transparency</span>
                <input id="le-opacity" class="basemap-range-slider" type="range" min="0" max="100" step="1" value="${opacityPct}" />
                <span id="le-opacity-val" class="basemap-slider-value">${opacityPct}%</span>
            </div>
        `;

        host.querySelector('#btn-le-replace-img')?.addEventListener('click', () => {
            imageMode = 'replace';
            panelEl.querySelector('#le-hidden-file-input')?.click();
        });
        host.querySelector('#le-opacity')?.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value);
            if (Number.isFinite(pct)) updateSelectedLegendStyle({ opacity: pct / 100 });
        });

    } else if (selected.kind === 'box') {
        const isLight = document.body.classList.contains('light-mode');
        const bgHex = s.bgColor || (isLight ? '#ffffff' : '#131722');
        const borderHex = s.borderColor || (isLight ? '#cbd5e1' : '#334155');
        const bgPct = Math.round((s.bgOpacity ?? 0.92) * 100);

        host.innerHTML = `
            <div class="le-row le-space-between">
                <span class="basemap-control-label">Background</span>
                <input id="le-box-bg" class="basemap-color-input" type="color" value="${bgHex}" />
            </div>
            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">BG Opacity</span>
                <input id="le-box-alpha" class="basemap-range-slider" type="range" min="0" max="100" step="1" value="${bgPct}" />
                <span id="le-box-alpha-val" class="basemap-slider-value">${bgPct}%</span>
            </div>
            <div class="le-row le-space-between">
                <span class="basemap-control-label">Border</span>
                <input id="le-box-border" class="basemap-color-input" type="color" value="${borderHex}" />
            </div>
            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Border Width</span>
                <input id="le-box-bw" class="basemap-range-slider" type="range" min="0" max="4" step="0.5" value="${s.borderWidth ?? 1}" />
                <span id="le-box-bw-val" class="basemap-slider-value">${(s.borderWidth ?? 1).toFixed(1)}px</span>
            </div>
        `;

        host.querySelector('#le-box-bg')?.addEventListener('input', (e) => {
            updateSelectedLegendStyle({ bgColor: e.target.value });
        });
        host.querySelector('#le-box-alpha')?.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value);
            if (Number.isFinite(pct)) updateSelectedLegendStyle({ bgOpacity: pct / 100 });
        });
        host.querySelector('#le-box-border')?.addEventListener('input', (e) => {
            updateSelectedLegendStyle({ borderColor: e.target.value });
        });
        host.querySelector('#le-box-bw')?.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) updateSelectedLegendStyle({ borderWidth: v });
        });
    }
}

function syncExistingControlValues(selected, s) {
    const host = panelEl?.querySelector('#legend-inspector-controls');
    if (!host) return;

    const opVal = host.querySelector('#le-opacity-val');
    if (opVal) opVal.textContent = `${Math.round((s.opacity ?? 1) * 100)}%`;

    if (selected.kind === 'text') {
        host.querySelector('#le-btn-bold')?.classList.toggle('active', Boolean(s.bold));
        host.querySelector('#le-btn-italic')?.classList.toggle('active', Boolean(s.italic));
        host.querySelector('#le-btn-underline')?.classList.toggle('active', Boolean(s.underline));
        host.querySelectorAll('.le-align-btn').forEach((b) => {
            b.classList.toggle('active', (s.align || 'left') === b.dataset.align);
        });
    } else if (selected.kind === 'colorbar') {
        const hVal = host.querySelector('#le-cb-height-val');
        if (hVal) hVal.textContent = `${s.barHeight ?? 13}px`;
    } else if (selected.kind === 'shape') {
        const bwVal = host.querySelector('#le-shape-bw-val');
        if (bwVal) bwVal.textContent = `${(s.borderWidth ?? 1.5).toFixed(1)}px`;
        const radVal = host.querySelector('#le-shape-radius-val');
        if (radVal) radVal.textContent = `${s.borderRadius ?? 0}px`;
    } else if (selected.kind === 'box') {
        const aVal = host.querySelector('#le-box-alpha-val');
        if (aVal) aVal.textContent = `${Math.round((s.bgOpacity ?? 0.92) * 100)}%`;
        const bwVal = host.querySelector('#le-box-bw-val');
        if (bwVal) bwVal.textContent = `${(s.borderWidth ?? 1).toFixed(1)}px`;
    }
}

export function initLegendEditor() {
    if (panelEl) return;

    panelEl = document.createElement('aside');
    panelEl.id = 'legend-editor-panel';
    panelEl.className = 'legend-editor-panel';
    panelEl.setAttribute('aria-hidden', 'true');
    panelEl.innerHTML = `
        <div class="basemap-editor-header">
            <span class="basemap-editor-title">Legend Editor</span>
            <div class="basemap-header-actions">
                <button id="btn-legend-done-editing" class="legend-editor-done-btn" type="button">Done</button>
                <button id="btn-close-legend-editor" class="ctrl-btn close-btn" type="button" aria-label="Close Legend Editor">✕</button>
            </div>
        </div>

        <div class="le-body">
            <!-- Compact Presets Slot (ready for presets) -->
            <div class="le-presets-row">
                <span class="basemap-slider-label">Presets</span>
                <span class="le-presets-empty">—</span>
            </div>

            <!-- Elements Toolbar -->
            <div class="le-tools-wrap">
                <div class="legend-tools-bar">
                    <button type="button" class="legend-tool-btn active" data-tool="select" title="Select & Move">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
                        </svg>
                        <span>Select</span>
                    </button>
                    <button type="button" class="legend-tool-btn" data-tool="text" title="Add Text">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="4 7 4 4 20 4 20 7"></polyline>
                            <line x1="9" y1="20" x2="15" y2="20"></line>
                            <line x1="12" y1="4" x2="12" y2="20"></line>
                        </svg>
                        <span>Text</span>
                    </button>
                    <button type="button" class="legend-tool-btn" data-tool="shape" title="Add Shape">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="11" height="11"></rect>
                            <circle cx="16.5" cy="16.5" r="4.5"></circle>
                        </svg>
                        <span>Shapes</span>
                    </button>
                    <button type="button" class="legend-tool-btn" data-tool="image" title="Upload Image">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <span>Image</span>
                    </button>
                </div>

                <div id="legend-shapes-popover" class="le-shapes-popover" style="display: none;">
                    <button type="button" class="le-shape-pick-btn" data-shape="rect">Rectangle</button>
                    <button type="button" class="le-shape-pick-btn" data-shape="circle">Circle</button>
                    <button type="button" class="le-shape-pick-btn" data-shape="line">Line</button>
                </div>
                <input id="le-hidden-file-input" type="file" accept="image/*" style="display: none;" />
            </div>

            <!-- Only shown if user deleted a default section -->
            <div id="legend-restore-strip" class="le-restore-strip" style="display: none;"></div>

            <!-- Active Selection Header + Controls -->
            <div class="le-inspector-card">
                <div class="le-inspector-head">
                    <span id="legend-active-target-name" class="le-target-name">Header</span>
                    <div class="le-head-actions">
                        <button id="btn-le-select-box" class="le-mini-btn" type="button" title="Edit Legend Container Background & Border">Box</button>
                        <button id="btn-le-delete" class="le-mini-btn is-danger" type="button" title="Delete Selected Element">Delete</button>
                    </div>
                </div>
                <div id="legend-inspector-controls" class="le-inspector-controls"></div>
            </div>
        </div>

        <div class="le-footer">
            <button id="btn-reset-legend-default" class="basemap-reset-all-btn" type="button">
                Reset Legend to Default
            </button>
        </div>
    `;

    document.body.appendChild(panelEl);

    panelEl.querySelector('#btn-close-legend-editor')?.addEventListener('click', () => setLegendEditMode(false));
    panelEl.querySelector('#btn-legend-done-editing')?.addEventListener('click', () => setLegendEditMode(false));
    panelEl.querySelector('#btn-le-delete')?.addEventListener('click', () => deleteSelectedLegendElement());
    panelEl.querySelector('#btn-le-select-box')?.addEventListener('click', () => selectLegendElement('__box__'));
    panelEl.querySelector('#btn-reset-legend-default')?.addEventListener('click', () => {
        renderedKey = '';
        resetLegendToDefault();
    });

    const shapesPop = panelEl.querySelector('#legend-shapes-popover');
    const fileInput = panelEl.querySelector('#le-hidden-file-input');

    panelEl.querySelectorAll('.legend-tool-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tool = btn.dataset.tool;
            if (tool === 'select') {
                shapesMenuOpen = false;
                if (shapesPop) shapesPop.style.display = 'none';
            } else if (tool === 'text') {
                shapesMenuOpen = false;
                if (shapesPop) shapesPop.style.display = 'none';
                addLegendText('Custom Text');
            } else if (tool === 'shape') {
                shapesMenuOpen = !shapesMenuOpen;
                if (shapesPop) shapesPop.style.display = shapesMenuOpen ? 'grid' : 'none';
            } else if (tool === 'image') {
                shapesMenuOpen = false;
                if (shapesPop) shapesPop.style.display = 'none';
                imageMode = 'add';
                fileInput?.click();
            }
        });
    });

    panelEl.querySelectorAll('.le-shape-pick-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            shapesMenuOpen = false;
            if (shapesPop) shapesPop.style.display = 'none';
            addLegendShape(btn.dataset.shape);
        });
    });

    fileInput?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                if (imageMode === 'replace') replaceSelectedLegendImage(reader.result);
                else addLegendImage(reader.result);
            }
            e.target.value = '';
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('btn-basemap-editor')?.addEventListener('click', () => {
        setLegendEditMode(false);
    });

    setLegendCallbacks({
        onEditToggle: (isActive) => {
            renderedKey = '';
            setPanelOpen(isActive);
            syncRestoreStrip();
            renderInspectorForSelection(getSelectedLegendElement());
        },
        onSelectionChange: (selected) => {
            syncRestoreStrip();
            renderInspectorForSelection(selected);
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panelEl?.classList.contains('open')) {
            setLegendEditMode(false);
        }
    });
}
