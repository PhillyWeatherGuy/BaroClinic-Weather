// js/components/legendEditor.js
import {
    DEFAULT_EFFECT_PRESETS,
    setLegendCallbacks,
    setLegendEditMode,
    selectLegendElement,
    deleteSelectedLegendElement,
    restoreLegendSection,
    resetLegendToDefault,
    getSelectedLegendElement,
    getDeletedDefaultSections,
    updateSelectedLegendStyle,
    updateSelectedLegendEffect,
    updateSelectedLegendText,
    addLegendText,
    addLegendShape,
    addLegendImage,
    replaceSelectedLegendImage,
    undoLegend,
    redoLegend,
    canUndoLegend,
    canRedoLegend
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

const TEXT_EFFECT_CARDS = [
    { id: 'none', label: 'None' },
    { id: 'drop', label: 'Drop' },
    { id: 'glow', label: 'Glow' },
    { id: 'echo', label: 'Echo' },
    { id: 'outline', label: 'Outline' },
    { id: 'background', label: 'Background' },
    { id: 'splice', label: 'Splice' },
    { id: 'hollow', label: 'Hollow' },
    { id: 'neon', label: 'Neon' },
    { id: 'glitch', label: 'Glitch' }
];

const OBJECT_EFFECT_CARDS = [
    { id: 'none', label: 'None' },
    { id: 'drop', label: 'Drop' },
    { id: 'glow', label: 'Glow' },
    { id: 'echo', label: 'Echo' }
];

let panelEl = null;
let renderedKey = '';
let shapesMenuOpen = false;
let imageMode = 'add';

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

function syncHistoryButtons() {
    if (!panelEl) return;
    const undoBtn = panelEl.querySelector('#btn-legend-undo');
    const redoBtn = panelEl.querySelector('#btn-legend-redo');
    if (undoBtn) undoBtn.disabled = !canUndoLegend();
    if (redoBtn) redoBtn.disabled = !canRedoLegend();
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
        <span class="le-restore-label">Deleted:</span>
        ${deleted.map((sec) => `
            <button type="button" class="le-restore-pill" data-restore-id="${sec.id}">+ ${sec.label}</button>
        `).join('')}
    `;

    restoreWrap.querySelectorAll('[data-restore-id]').forEach((btn) => {
        btn.addEventListener('click', () => restoreLegendSection(btn.dataset.restoreId));
    });
}

function buildEffectSliderHTML(prop, label, min, max, val, step = 1) {
    return `
        <div class="le-eff-control" data-eff-prop="${prop}">
            <div class="le-eff-control-top">
                <span class="le-eff-control-label">${label}</span>
                <div class="le-stepper">
                    <button type="button" class="le-step-btn" data-step-dir="-1" data-prop="${prop}" data-min="${min}" data-max="${max}" data-step="${step}">−</button>
                    <span class="le-step-val" id="le-eff-val-${prop}">${val}</span>
                    <button type="button" class="le-step-btn" data-step-dir="1" data-prop="${prop}" data-min="${min}" data-max="${max}" data-step="${step}">+</button>
                </div>
            </div>
            <input id="le-eff-slider-${prop}" class="basemap-range-slider le-eff-slider" type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-prop="${prop}" />
        </div>
    `;
}

function buildActiveEffectParamsHTML(eff, isText = true) {
    const type = eff.type || 'none';
    if (type === 'none') return '';

    let html = '';
    if (type === 'drop') {
        html += buildEffectSliderHTML('direction', 'Direction', -180, 180, eff.direction ?? -45, 1);
        html += buildEffectSliderHTML('offset', 'Offset', 0, 100, eff.offset ?? 20, 1);
        html += buildEffectSliderHTML('blur', 'Blur', 0, 100, eff.blur ?? 10, 1);
        html += buildEffectSliderHTML('transparency', 'Transparency', 0, 100, eff.transparency ?? 50, 1);
        html += `
            <div class="le-row le-space-between">
                <span class="basemap-control-label">Color</span>
                <input id="le-eff-color" class="basemap-color-input" type="color" value="${eff.color || '#000000'}" />
            </div>
        `;
    } else if (type === 'glow') {
        html += buildEffectSliderHTML('intensity', 'Intensity', 0, 100, eff.intensity ?? 40, 1);
        if (!isText) {
            html += `
                <div class="le-row le-space-between">
                    <span class="basemap-control-label">Color</span>
                    <input id="le-eff-color" class="basemap-color-input" type="color" value="${eff.color || '#3b82f6'}" />
                </div>
            `;
        }
    } else if (type === 'echo') {
        html += buildEffectSliderHTML('direction', 'Direction', -180, 180, eff.direction ?? -52, 1);
        html += buildEffectSliderHTML('offset', 'Offset', 0, 100, eff.offset ?? 13, 1);
        html += `
            <div class="le-row le-space-between">
                <span class="basemap-control-label">Color</span>
                <input id="le-eff-color" class="basemap-color-input" type="color" value="${eff.color || (isText ? '#000000' : '#3b82f6')}" />
            </div>
        `;
    } else if (type === 'outline') {
        html += buildEffectSliderHTML('thickness', 'Thickness', 0, 100, eff.thickness ?? 50, 1);
        html += `
            <div class="le-row le-space-between">
                <span class="basemap-control-label">Color</span>
                <input id="le-eff-color" class="basemap-color-input" type="color" value="${eff.color || '#000000'}" />
            </div>
        `;
    } else if (type === 'background') {
        html += buildEffectSliderHTML('roundness', 'Roundness', 0, 100, eff.roundness ?? 50, 1);
        html += buildEffectSliderHTML('spread', 'Spread', 0, 100, eff.spread ?? 50, 1);
        html += buildEffectSliderHTML('transparency', 'Transparency', 0, 100, eff.transparency ?? 100, 1);
        html += `
            <div class="le-row le-space-between">
                <span class="basemap-control-label">Color</span>
                <input id="le-eff-color" class="basemap-color-input" type="color" value="${eff.color || '#facc15'}" />
            </div>
        `;
    } else if (type === 'splice') {
        html += buildEffectSliderHTML('thickness', 'Thickness', 0, 100, eff.thickness ?? 50, 1);
        html += buildEffectSliderHTML('offset', 'Offset', 0, 100, eff.offset ?? 50, 1);
        html += buildEffectSliderHTML('direction', 'Direction', -180, 180, eff.direction ?? -45, 1);
        html += `
            <div class="le-row le-space-between">
                <span class="basemap-control-label">Color</span>
                <input id="le-eff-color" class="basemap-color-input" type="color" value="${eff.color || '#6b7280'}" />
            </div>
        `;
    } else if (type === 'hollow') {
        html += buildEffectSliderHTML('thickness', 'Thickness', 0, 100, eff.thickness ?? 50, 1);
    } else if (type === 'neon') {
        html += buildEffectSliderHTML('intensity', 'Intensity', 0, 100, eff.intensity ?? 50, 1);
    } else if (type === 'glitch') {
        html += buildEffectSliderHTML('direction', 'Direction', -180, 180, eff.direction ?? -55, 1);
        html += buildEffectSliderHTML('offset', 'Offset', 0, 100, eff.offset ?? 9, 1);
        html += `
            <div class="le-row le-space-between">
                <span class="basemap-control-label">Colors</span>
                <div class="le-dual-colors">
                    <input id="le-eff-color" class="basemap-color-input" type="color" value="${eff.color || '#ff00ff'}" title="Primary Glitch Color" />
                    <input id="le-eff-color2" class="basemap-color-input" type="color" value="${eff.color2 || '#00ffff'}" title="Secondary Glitch Color" />
                </div>
            </div>
        `;
    }

    return `<div class="le-eff-params">${html}</div>`;
}

function buildObjectEffectsSectionHTML(eff) {
    return `
        <div class="le-effects-section">
            <div class="le-effects-title">Effects</div>
            <div class="le-effects-grid is-object-grid">
                ${OBJECT_EFFECT_CARDS.map((card) => `
                    <button
                        type="button"
                        class="le-effect-card ${(eff.type || 'none') === card.id ? 'active' : ''}"
                        data-effect-type="${card.id}"
                    >
                        <span class="le-obj-preview is-obj-${card.id}"></span>
                        <span class="le-effect-name">${card.label}</span>
                    </button>
                `).join('')}
            </div>
            ${buildActiveEffectParamsHTML(eff, false)}
        </div>
    `;
}

function bindEffectControls(host, isText = true) {
    host.querySelectorAll('.le-effect-card[data-effect-type]').forEach((card) => {
        card.addEventListener('click', () => {
            const type = card.dataset.effectType;
            const cur = getSelectedLegendElement()?.style?.effect || {};
            const nextType = (cur.type === type && type !== 'none') ? 'none' : type;
            const preset = { ...(DEFAULT_EFFECT_PRESETS[nextType] || {}) };
            if (!isText && nextType === 'echo' && !cur.color) preset.color = '#3b82f6';
            if (isText && nextType === 'echo' && !cur.color) preset.color = '#000000';
            updateSelectedLegendEffect({ type: nextType, ...preset });
        });
    });

    host.querySelector('#btn-le-curve-toggle')?.addEventListener('click', () => {
        const cur = getSelectedLegendElement()?.style?.effect || {};
        updateSelectedLegendEffect({
            curveEnabled: !cur.curveEnabled,
            curveAmount: cur.curveAmount ?? 19
        });
    });

    host.querySelectorAll('.le-eff-slider').forEach((slider) => {
        slider.addEventListener('input', (e) => {
            const prop = e.target.dataset.prop;
            const val = parseFloat(e.target.value);
            if (prop && Number.isFinite(val)) {
                updateSelectedLegendEffect({ [prop]: val });
            }
        });
    });

    host.querySelectorAll('.le-step-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const prop = btn.dataset.prop;
            const dir = parseFloat(btn.dataset.stepDir);
            const min = parseFloat(btn.dataset.min);
            const max = parseFloat(btn.dataset.max);
            const step = parseFloat(btn.dataset.step) || 1;
            const curEff = getSelectedLegendElement()?.style?.effect || {};
            const curVal = Number(curEff[prop] ?? 0);
            const nextVal = Math.max(min, Math.min(max, curVal + dir * step));
            const slider = host.querySelector(`#le-eff-slider-${prop}`);
            if (slider) slider.value = String(nextVal);
            updateSelectedLegendEffect({ [prop]: nextVal });
        });
    });

    host.querySelector('#le-eff-color')?.addEventListener('input', (e) => {
        updateSelectedLegendEffect({ color: e.target.value });
    });

    host.querySelector('#le-eff-color2')?.addEventListener('input', (e) => {
        updateSelectedLegendEffect({ color2: e.target.value });
    });
}

function renderInspectorForSelection(selected) {
    syncHistoryButtons();

    const host = panelEl?.querySelector('#legend-inspector-controls');
    const titleEl = panelEl?.querySelector('#legend-active-target-name');
    const deleteBtn = panelEl?.querySelector('#btn-le-delete');
    const bgBtn = panelEl?.querySelector('#btn-le-select-bg');
    if (!host) return;

    if (titleEl) {
        titleEl.textContent = selected ? selected.label : 'None';
    }
    if (deleteBtn) {
        deleteBtn.disabled = !selected;
    }
    if (bgBtn) {
        bgBtn.classList.toggle('active', selected?.id === 'bg');
    }

    if (!selected) {
        renderedKey = 'none';
        host.innerHTML = `<div class="le-empty-msg">Click any element on the screen to edit it.</div>`;
        return;
    }

    const s = selected.style || {};
    const eff = s.effect || { type: 'none', curveEnabled: false, curveAmount: 19 };
    const nextKey = `${selected.id}:${selected.kind}:${selected.shapeType || ''}:${eff.type || 'none'}:${Boolean(eff.curveEnabled)}`;

    if (nextKey === renderedKey) {
        syncExistingControlValues(selected, s, eff);
        return;
    }
    renderedKey = nextKey;

    if (selected.kind === 'text') {
        const activeColor = s.color || getDefaultColorHexForElement(selected);
        const opacityPct = Math.round((s.opacity ?? 1) * 100);
        const rotVal = Number.isFinite(s.rotation) ? s.rotation : 0;

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
                    <input id="le-font-size" class="basemap-font-size-input" type="number" min="8" max="96" step="1" value="${s.fontSize || 13}" aria-label="Font size" />
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
                <span class="basemap-slider-label">Opacity</span>
                <input id="le-opacity" class="basemap-range-slider" type="range" min="0" max="100" step="1" value="${opacityPct}" />
                <span id="le-opacity-val" class="basemap-slider-value">${opacityPct}%</span>
            </div>

            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Angle</span>
                <input id="le-rotation-slider" class="basemap-range-slider" type="range" min="-180" max="180" step="1" value="${rotVal}" />
                <span id="le-rotation-val" class="basemap-slider-value" style="min-width:34px;">${rotVal}°</span>
                <button id="btn-le-reset-rot" class="le-mini-btn" type="button" title="Reset to 0°">0°</button>
            </div>

            <div class="le-effects-section">
                <div class="le-effects-title">Effects</div>
                <div class="le-effects-grid">
                    ${TEXT_EFFECT_CARDS.map((card) => `
                        <button
                            type="button"
                            class="le-effect-card ${(eff.type || 'none') === card.id ? 'active' : ''}"
                            data-effect-type="${card.id}"
                        >
                            <span class="le-effect-preview is-preview-${card.id}">Aa</span>
                            <span class="le-effect-name">${card.label}</span>
                        </button>
                    `).join('')}
                </div>

                ${buildActiveEffectParamsHTML(eff, true)}

                <div class="le-effects-title le-shape-title">Shape</div>
                <div class="le-shape-curve-row">
                    <button
                        type="button"
                        id="btn-le-curve-toggle"
                        class="le-effect-card le-curve-card ${eff.curveEnabled ? 'active' : ''}"
                    >
                        <svg class="le-curve-preview-svg" width="44" height="22" viewBox="0 0 60 28">
                            <defs><path id="le_preview_arc" d="M 6 22 Q 30 6 54 22" /></defs>
                            <text font-size="11" font-weight="800" fill="currentColor">
                                <textPath href="#le_preview_arc" startOffset="50%" text-anchor="middle">ABCD</textPath>
                            </text>
                        </svg>
                        <span class="le-effect-name">Curve</span>
                    </button>
                    ${eff.curveEnabled ? `
                        <div class="le-curve-slider-wrap">
                            ${buildEffectSliderHTML('curveAmount', 'Curve', -100, 100, eff.curveAmount ?? 19, 1)}
                        </div>
                    ` : ''}
                </div>
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
            if (Number.isFinite(v) && v >= 8 && v <= 96) updateSelectedLegendStyle({ fontSize: Math.round(v) });
        });
        sizeEl?.addEventListener('change', (e) => {
            const raw = parseFloat(e.target.value);
            const clamped = Number.isFinite(raw) ? Math.min(96, Math.max(8, Math.round(raw))) : 13;
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
        host.querySelector('#le-rotation-slider')?.addEventListener('input', (e) => {
            const ang = parseFloat(e.target.value);
            if (Number.isFinite(ang)) updateSelectedLegendStyle({ rotation: ang });
        });
        host.querySelector('#btn-le-reset-rot')?.addEventListener('click', () => {
            updateSelectedLegendStyle({ rotation: 0 });
        });

        bindEffectControls(host, true);

    } else if (selected.kind === 'colorbar') {
        const isLight = document.body.classList.contains('light-mode');
        const tickColor = s.tickColor || (isLight ? '#1e293b' : '#e2e8f0');
        const opacityPct = Math.round((s.opacity ?? 1) * 100);
        const rotVal = Number.isFinite(s.rotation) ? s.rotation : 0;

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
                <span class="basemap-slider-label">Opacity</span>
                <input id="le-opacity" class="basemap-range-slider" type="range" min="0" max="100" step="1" value="${opacityPct}" />
                <span id="le-opacity-val" class="basemap-slider-value">${opacityPct}%</span>
            </div>

            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Angle</span>
                <input id="le-rotation-slider" class="basemap-range-slider" type="range" min="-180" max="180" step="1" value="${rotVal}" />
                <span id="le-rotation-val" class="basemap-slider-value" style="min-width:34px;">${rotVal}°</span>
                <button id="btn-le-reset-rot" class="le-mini-btn" type="button" title="Reset to 0°">0°</button>
            </div>

            ${buildObjectEffectsSectionHTML(eff)}
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
        host.querySelector('#le-rotation-slider')?.addEventListener('input', (e) => {
            const ang = parseFloat(e.target.value);
            if (Number.isFinite(ang)) updateSelectedLegendStyle({ rotation: ang });
        });
        host.querySelector('#btn-le-reset-rot')?.addEventListener('click', () => {
            updateSelectedLegendStyle({ rotation: 0 });
        });

        bindEffectControls(host, false);

    } else if (selected.kind === 'shape') {
        const opacityPct = Math.round((s.opacity ?? 0.9) * 100);
        const rotVal = Number.isFinite(s.rotation) ? s.rotation : 0;
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
                <span class="basemap-slider-label">Opacity</span>
                <input id="le-opacity" class="basemap-range-slider" type="range" min="0" max="100" step="1" value="${opacityPct}" />
                <span id="le-opacity-val" class="basemap-slider-value">${opacityPct}%</span>
            </div>
            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Angle</span>
                <input id="le-rotation-slider" class="basemap-range-slider" type="range" min="-180" max="180" step="1" value="${rotVal}" />
                <span id="le-rotation-val" class="basemap-slider-value" style="min-width:34px;">${rotVal}°</span>
                <button id="btn-le-reset-rot" class="le-mini-btn" type="button" title="Reset to 0°">0°</button>
            </div>

            ${buildObjectEffectsSectionHTML(eff)}
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
        host.querySelector('#le-rotation-slider')?.addEventListener('input', (e) => {
            const ang = parseFloat(e.target.value);
            if (Number.isFinite(ang)) updateSelectedLegendStyle({ rotation: ang });
        });
        host.querySelector('#btn-le-reset-rot')?.addEventListener('click', () => {
            updateSelectedLegendStyle({ rotation: 0 });
        });

        bindEffectControls(host, false);

    } else if (selected.kind === 'image') {
        const opacityPct = Math.round((s.opacity ?? 1) * 100);
        const rotVal = Number.isFinite(s.rotation) ? s.rotation : 0;

        host.innerHTML = `
            <div class="le-row">
                <button id="btn-le-replace-img" class="basemap-highlight-btn" type="button" style="justify-content:center;">Replace Image</button>
            </div>
            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Opacity</span>
                <input id="le-opacity" class="basemap-range-slider" type="range" min="0" max="100" step="1" value="${opacityPct}" />
                <span id="le-opacity-val" class="basemap-slider-value">${opacityPct}%</span>
            </div>
            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Angle</span>
                <input id="le-rotation-slider" class="basemap-range-slider" type="range" min="-180" max="180" step="1" value="${rotVal}" />
                <span id="le-rotation-val" class="basemap-slider-value" style="min-width:34px;">${rotVal}°</span>
                <button id="btn-le-reset-rot" class="le-mini-btn" type="button" title="Reset to 0°">0°</button>
            </div>

            ${buildObjectEffectsSectionHTML(eff)}
        `;

        host.querySelector('#btn-le-replace-img')?.addEventListener('click', () => {
            imageMode = 'replace';
            panelEl.querySelector('#le-hidden-file-input')?.click();
        });
        host.querySelector('#le-opacity')?.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value);
            if (Number.isFinite(pct)) updateSelectedLegendStyle({ opacity: pct / 100 });
        });
        host.querySelector('#le-rotation-slider')?.addEventListener('input', (e) => {
            const ang = parseFloat(e.target.value);
            if (Number.isFinite(ang)) updateSelectedLegendStyle({ rotation: ang });
        });
        host.querySelector('#btn-le-reset-rot')?.addEventListener('click', () => {
            updateSelectedLegendStyle({ rotation: 0 });
        });

        bindEffectControls(host, false);

    } else if (selected.kind === 'box') {
        const isLight = document.body.classList.contains('light-mode');
        const bgHex = s.bgColor || (isLight ? '#ffffff' : '#131722');
        const borderHex = s.borderColor || (isLight ? '#cbd5e1' : '#334155');
        const bgPct = Math.round((s.bgOpacity ?? 0.92) * 100);
        const rotVal = Number.isFinite(s.rotation) ? s.rotation : 0;

        host.innerHTML = `
            <div class="le-row le-space-between">
                <span class="basemap-control-label">Fill Color</span>
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
                <span class="basemap-slider-label">Border W</span>
                <input id="le-box-bw" class="basemap-range-slider" type="range" min="0" max="4" step="0.5" value="${s.borderWidth ?? 1}" />
                <span id="le-box-bw-val" class="basemap-slider-value">${(s.borderWidth ?? 1).toFixed(1)}px</span>
            </div>
            <div class="le-row le-slider-row">
                <span class="basemap-slider-label">Angle</span>
                <input id="le-rotation-slider" class="basemap-range-slider" type="range" min="-180" max="180" step="1" value="${rotVal}" />
                <span id="le-rotation-val" class="basemap-slider-value" style="min-width:34px;">${rotVal}°</span>
                <button id="btn-le-reset-rot" class="le-mini-btn" type="button" title="Reset to 0°">0°</button>
            </div>

            ${buildObjectEffectsSectionHTML(eff)}
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
        host.querySelector('#le-rotation-slider')?.addEventListener('input', (e) => {
            const ang = parseFloat(e.target.value);
            if (Number.isFinite(ang)) updateSelectedLegendStyle({ rotation: ang });
        });
        host.querySelector('#btn-le-reset-rot')?.addEventListener('click', () => {
            updateSelectedLegendStyle({ rotation: 0 });
        });

        bindEffectControls(host, false);
    }
}

function syncExistingControlValues(selected, s, eff) {
    const host = panelEl?.querySelector('#legend-inspector-controls');
    if (!host) return;

    const opVal = host.querySelector('#le-opacity-val');
    if (opVal) opVal.textContent = `${Math.round((s.opacity ?? 1) * 100)}%`;
    const opSlider = host.querySelector('#le-opacity');
    if (opSlider && document.activeElement !== opSlider) {
        opSlider.value = String(Math.round((s.opacity ?? 1) * 100));
    }

    const rotVal = host.querySelector('#le-rotation-val');
    if (rotVal) rotVal.textContent = `${Number.isFinite(s.rotation) ? s.rotation : 0}°`;
    const rotSlider = host.querySelector('#le-rotation-slider');
    if (rotSlider && document.activeElement !== rotSlider) {
        rotSlider.value = String(s.rotation || 0);
    }

    ['direction', 'offset', 'blur', 'transparency', 'intensity', 'thickness', 'roundness', 'spread', 'curveAmount'].forEach((prop) => {
        const span = host.querySelector(`#le-eff-val-${prop}`);
        if (span && eff[prop] !== undefined) {
            span.textContent = String(eff[prop]);
        }
        const slider = host.querySelector(`#le-eff-slider-${prop}`);
        if (slider && document.activeElement !== slider && eff[prop] !== undefined) {
            slider.value = String(eff[prop]);
        }
    });

    const effCol = host.querySelector('#le-eff-color');
    if (effCol && document.activeElement !== effCol && eff.color) effCol.value = eff.color;
    const effCol2 = host.querySelector('#le-eff-color2');
    if (effCol2 && document.activeElement !== effCol2 && eff.color2) effCol2.value = eff.color2;

    if (selected.kind === 'text') {
        const textInput = host.querySelector('#le-text-content');
        if (textInput && document.activeElement !== textInput) textInput.value = selected.text || '';

        const fontSelect = host.querySelector('#le-font-family');
        if (fontSelect && document.activeElement !== fontSelect && s.fontFamily) fontSelect.value = s.fontFamily;

        const fontSizeInput = host.querySelector('#le-font-size');
        if (fontSizeInput && document.activeElement !== fontSizeInput) fontSizeInput.value = String(s.fontSize || 13);

        const colorInput = host.querySelector('#le-text-color');
        if (colorInput && document.activeElement !== colorInput) {
            colorInput.value = s.color || getDefaultColorHexForElement(selected);
        }

        host.querySelector('#le-btn-bold')?.classList.toggle('active', Boolean(s.bold));
        host.querySelector('#le-btn-italic')?.classList.toggle('active', Boolean(s.italic));
        host.querySelector('#le-btn-underline')?.classList.toggle('active', Boolean(s.underline));
        host.querySelectorAll('.le-align-btn').forEach((b) => {
            b.classList.toggle('active', (s.align || 'left') === b.dataset.align);
        });
    } else if (selected.kind === 'colorbar') {
        const hVal = host.querySelector('#le-cb-height-val');
        if (hVal) hVal.textContent = `${s.barHeight ?? 13}px`;
        const hSlider = host.querySelector('#le-cb-height');
        if (hSlider && document.activeElement !== hSlider) hSlider.value = String(s.barHeight ?? 13);
        const cbSizeInput = host.querySelector('#le-cb-size');
        if (cbSizeInput && document.activeElement !== cbSizeInput) cbSizeInput.value = String(s.tickFontSize || 10);
    } else if (selected.kind === 'shape') {
        const bwVal = host.querySelector('#le-shape-bw-val');
        if (bwVal) bwVal.textContent = `${(s.borderWidth ?? 1.5).toFixed(1)}px`;
        const radVal = host.querySelector('#le-shape-radius-val');
        if (radVal) radVal.textContent = `${s.borderRadius ?? 0}px`;
    } else if (selected.kind === 'box') {
        const aVal = host.querySelector('#le-box-alpha-val');
        if (aVal) aVal.textContent = `${Math.round((s.bgOpacity ?? 0.92) * 100)}%`;
        const aSlider = host.querySelector('#le-box-alpha');
        if (aSlider && document.activeElement !== aSlider) aSlider.value = String(Math.round((s.bgOpacity ?? 0.92) * 100));
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
            <div class="le-title-undo-group">
                <span class="basemap-editor-title">Legend Editor</span>
                <div class="le-history-btns">
                    <button id="btn-legend-undo" class="le-history-btn" type="button" title="Undo (Cmd/Ctrl+Z)" aria-label="Undo" disabled>↶</button>
                    <button id="btn-legend-redo" class="le-history-btn" type="button" title="Redo (Cmd/Ctrl+Shift+Z)" aria-label="Redo" disabled>↷</button>
                </div>
            </div>
            <div class="basemap-header-actions">
                <button id="btn-legend-done-editing" class="legend-editor-done-btn" type="button">Done</button>
                <button id="btn-close-legend-editor" class="ctrl-btn close-btn" type="button" aria-label="Close Legend Editor">✕</button>
            </div>
        </div>

        <div class="le-body">
            <div class="le-presets-row">
                <span class="basemap-slider-label">Presets</span>
                <span class="le-presets-empty">—</span>
            </div>

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

            <div id="legend-restore-strip" class="le-restore-strip" style="display: none;"></div>

            <div class="le-inspector-card">
                <div class="le-inspector-head">
                    <span id="legend-active-target-name" class="le-target-name">Header</span>
                    <div class="le-head-actions">
                        <button id="btn-le-select-bg" class="le-mini-btn" type="button" title="Select Background Bar">BG</button>
                        <button id="btn-le-delete" class="le-mini-btn is-danger" type="button" title="Delete Selected">Delete</button>
                    </div>
                </div>
                <div id="legend-inspector-controls" class="le-inspector-controls"></div>
            </div>
        </div>

        <div class="le-footer">
            <button id="btn-reset-legend-default" class="basemap-reset-all-btn" type="button">
                Reset Legend
            </button>
        </div>
    `;

    document.body.appendChild(panelEl);

    panelEl.querySelector('#btn-legend-undo')?.addEventListener('click', () => undoLegend());
    panelEl.querySelector('#btn-legend-redo')?.addEventListener('click', () => redoLegend());
    panelEl.querySelector('#btn-close-legend-editor')?.addEventListener('click', () => setLegendEditMode(false));
    panelEl.querySelector('#btn-legend-done-editing')?.addEventListener('click', () => setLegendEditMode(false));
    panelEl.querySelector('#btn-le-delete')?.addEventListener('click', () => deleteSelectedLegendElement());
    panelEl.querySelector('#btn-le-select-bg')?.addEventListener('click', () => {
        const deletedBg = getDeletedDefaultSections().some((s) => s.id === 'bg');
        if (deletedBg) restoreLegendSection('bg');
        else selectLegendElement('bg');
    });
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
            if (document.activeElement?.isContentEditable) return;
            setLegendEditMode(false);
        }
    });
}
