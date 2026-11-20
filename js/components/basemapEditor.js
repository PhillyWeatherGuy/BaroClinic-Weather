// js/components/basemapEditor.js
import { stateManager } from '../core/stateManager.js';

const BASEMAP_PRESETS = [
    {
        id: 'default',
        name: 'Default',
        previewLight: './assets/preset-default-light.png.JPEG',
        previewDark: './assets/preset-default-dark.png.JPEG'
    }
];

let presetCallback = null;

function getPreviewUrl(preset, theme) {
    return theme === 'light' ? preset.previewLight : preset.previewDark;
}

export function setBasemapPresetCallback(callback) {
    presetCallback = callback;
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

function renderPresetsSection(bodyEl) {
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
    `;

    bodyEl.querySelectorAll('.basemap-preset-card').forEach((card) => {
        card.addEventListener('click', () => {
            const presetId = card.dataset.presetId;
            stateManager.activeBasemapPreset = presetId;

            bodyEl.querySelectorAll('.basemap-preset-card').forEach((c) => {
                c.classList.toggle('active', c.dataset.presetId === presetId);
            });

            if (typeof presetCallback === 'function') {
                presetCallback(presetId);
            }
        });
    });
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

    if (bodyEl) {
        renderPresetsSection(bodyEl);
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
