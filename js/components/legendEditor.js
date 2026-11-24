// js/components/legendEditor.js
import {
    setLegendCallbacks,
    setLegendEditMode,
    selectLegendSection,
    deleteSelectedLegendSection,
    restoreLegendSection,
    resetLegendToDefault,
    getSelectedLegendSection,
    getLegendSectionsSummary
} from '../layers/legendOverlay.js';
import { showToast } from './viewerUI.js';

let panelEl = null;

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
    }
    panelEl.classList.toggle('open', isOpen);
    panelEl.setAttribute('aria-hidden', String(!isOpen));
}

function syncLegendInspector() {
    if (!panelEl) return;

    const selected = getSelectedLegendSection();
    const summary = getLegendSectionsSummary();

    const chipsEl = panelEl.querySelector('#legend-section-chips');
    const activeTitleEl = panelEl.querySelector('#legend-selected-title');
    const coordsEl = panelEl.querySelector('#legend-selected-coords');
    const deleteBtn = panelEl.querySelector('#btn-legend-delete-section');

    if (chipsEl) {
        chipsEl.innerHTML = summary.map((sec) => {
            if (sec.deleted) {
                return `
                    <button type="button" class="legend-sec-chip is-deleted" data-restore-id="${sec.id}" title="Restore ${sec.label}">
                        <span>+ ${sec.label}</span>
                    </button>
                `;
            }
            const isSel = selected && selected.id === sec.id;
            return `
                <button type="button" class="legend-sec-chip ${isSel ? 'active' : ''}" data-select-id="${sec.id}">
                    <span>${sec.label}</span>
                </button>
            `;
        }).join('');

        chipsEl.querySelectorAll('[data-select-id]').forEach((btn) => {
            btn.addEventListener('click', () => selectLegendSection(btn.dataset.selectId));
        });
        chipsEl.querySelectorAll('[data-restore-id]').forEach((btn) => {
            btn.addEventListener('click', () => restoreLegendSection(btn.dataset.restoreId));
        });
    }

    if (activeTitleEl) {
        activeTitleEl.textContent = selected ? selected.label : 'No Section Selected';
    }

    if (coordsEl) {
        if (selected && Number.isFinite(selected.x)) {
            coordsEl.textContent = `X: ${selected.x}  Y: ${selected.y}  •  ${selected.w} × ${selected.h}`;
        } else if (selected) {
            coordsEl.textContent = 'Drag or resize directly on the legend';
        } else {
            coordsEl.textContent = 'Click any box on the legend to select it';
        }
    }

    if (deleteBtn) {
        deleteBtn.disabled = !selected;
    }
}

export function initLegendEditor() {
    if (panelEl) return;

    panelEl = document.createElement('aside');
    panelEl.id = 'legend-editor-panel';
    panelEl.className = 'basemap-editor-panel legend-editor-panel';
    panelEl.setAttribute('aria-hidden', 'true');
    panelEl.innerHTML = `
        <div class="basemap-editor-header">
            <span class="basemap-editor-title">Legend Editor</span>
            <div class="basemap-header-actions">
                <button id="btn-legend-done-editing" class="legend-editor-done-btn" type="button">Done</button>
                <button id="btn-close-legend-editor" class="ctrl-btn close-btn" type="button" aria-label="Close Legend Editor">✕</button>
            </div>
        </div>

        <div class="basemap-editor-body">
            <!-- Reserved Presets Section -->
            <section class="basemap-editor-section">
                <h3 class="basemap-section-header">Presets</h3>
                <div class="legend-presets-placeholder">
                    Custom legend presets coming soon
                </div>
            </section>

            <!-- Canvas Tools Bar (Select, Add Text, Shapes, Upload Image) -->
            <section class="basemap-editor-section">
                <h3 class="basemap-section-header">Tools</h3>
                <div class="legend-tools-bar">
                    <button type="button" class="legend-tool-btn active" data-tool="select" title="Select & Move">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
                        </svg>
                        <span>Select</span>
                    </button>
                    <button type="button" class="legend-tool-btn" data-tool="text" title="Add Text (Phase 2)">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="4 7 4 4 20 4 20 7"></polyline>
                            <line x1="9" y1="20" x2="15" y2="20"></line>
                            <line x1="12" y1="4" x2="12" y2="20"></line>
                        </svg>
                        <span>Text</span>
                    </button>
                    <button type="button" class="legend-tool-btn" data-tool="shape" title="Add Shape (Phase 2)">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="11" height="11" rx="1"></rect>
                            <circle cx="16.5" cy="16.5" r="4.5"></circle>
                        </svg>
                        <span>Shapes</span>
                    </button>
                    <button type="button" class="legend-tool-btn" data-tool="image" title="Upload Image / Logo (Phase 2)">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <span>Image</span>
                    </button>
                </div>
            </section>

            <!-- Active Section Selection & Layout -->
            <section class="basemap-editor-section">
                <h3 class="basemap-section-header">Sections</h3>
                <div id="legend-section-chips" class="legend-section-chips"></div>

                <div class="legend-selected-card">
                    <div class="legend-selected-top">
                        <div>
                            <div class="legend-selected-kicker">Editing Object</div>
                            <div id="legend-selected-title" class="legend-selected-title">Header</div>
                        </div>
                        <button id="btn-legend-delete-section" class="legend-delete-btn" type="button" title="Delete Selected Section">
                            Delete
                        </button>
                    </div>
                    <div id="legend-selected-coords" class="legend-selected-coords">
                        Drag or resize directly on the legend
                    </div>
                </div>
            </section>

            <!-- Phase 2 & 3 Formatting + Canva Effects Placeholder -->
            <section class="basemap-editor-section">
                <h3 class="basemap-section-header">Typography & Effects</h3>
                <div class="legend-presets-placeholder">
                    Font, Size, B / I / U, Alignment, Transparency &amp; Canva Effects coming in Phase 2 &amp; 3
                </div>
            </section>

            <div class="basemap-editor-footer">
                <button id="btn-reset-legend-default" class="basemap-reset-all-btn" type="button">
                    Reset Legend to Default
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(panelEl);

    panelEl.querySelector('#btn-close-legend-editor')?.addEventListener('click', () => setLegendEditMode(false));
    panelEl.querySelector('#btn-legend-done-editing')?.addEventListener('click', () => setLegendEditMode(false));
    panelEl.querySelector('#btn-legend-delete-section')?.addEventListener('click', () => deleteSelectedLegendSection());
    panelEl.querySelector('#btn-reset-legend-default')?.addEventListener('click', () => resetLegendToDefault());

    panelEl.querySelectorAll('.legend-tool-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tool = btn.dataset.tool;
            if (tool !== 'select') {
                showToast(`${btn.querySelector('span')?.textContent} tool comes in Phase 2!`);
            }
        });
    });

    // Auto-close Legend Editor if the user opens Basemap Editor
    document.getElementById('btn-basemap-editor')?.addEventListener('click', () => {
        setLegendEditMode(false);
    });

    setLegendCallbacks({
        onEditToggle: (isActive) => {
            setPanelOpen(isActive);
            syncLegendInspector();
        },
        onSelectionChange: () => {
            syncLegendInspector();
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panelEl?.classList.contains('open')) {
            setLegendEditMode(false);
        }
    });

    syncLegendInspector();
}
