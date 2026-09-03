// js/layers/cityOverlay.js
import { stateManager } from '../core/stateManager.js';

const GLOBAL_CITIES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson';

let allGlobalCities = [];
let activeCities = [];
let cityMarkers = {};
let isLoaded = false;
let mapInstance = null;
let listenersAttached = false;
let isUpdating = false;

const style = document.createElement('style');
style.textContent = `
    .city-callout-node {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        user-select: none;
        font-family: 'Rajdhani', -apple-system, sans-serif;
        text-transform: uppercase;
    }
    .city-callout-val {
        font-size: 21px;
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.5px;
        color: #ffffff;
        text-shadow: 0 0 4px #000, 0 1px 6px #000, 0 0 10px #000, 0 0 16px #000;
    }
    .city-callout-val.precip-val {
        color: #38bdf8;
    }
    .city-callout-name {
        font-size: 13px;
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: 0.5px;
        color: #f1f5f9;
        text-shadow: 0 0 3px #000, 0 1px 4px #000, 0 0 10px #000;
        margin-top: 2px;
    }
`;
document.head.appendChild(style);

/**
 * 🌟 DYNAMIC PIXEL DECODER
 */
export function decodePixelValue(rawVal, manifest) {
    if (rawVal === undefined) return 0.0;
    const val = Number(rawVal);
    if (isNaN(val)) return 0.0;

    const scaling = manifest?.scaling || stateManager.paramConfig?.scaling || stateManager.manifest?.scaling;

    if (scaling && scaling.mode === 'piecewise' && scaling.val_points && scaling.byte_points) {
        const vp = scaling.val_points.map(Number);
        const bp = scaling.byte_points.map(Number);

        for (let i = 0; i < bp.length - 1; i++) {
            if (val >= bp[i] && val <= bp[i + 1]) {
                const span = bp[i + 1] - bp[i];
                const t = span > 0 ? (val - bp[i]) / span : 0;
                return vp[i] + t * (vp[i + 1] - vp[i]);
            }
        }
        return vp[vp.length - 1];
    }

    const minVal = Number(scaling?.min_val ?? manifest?.min_val ?? manifest?.temp_min_k ?? 0.0);
    const maxVal = Number(scaling?.max_val ?? manifest?.max_val ?? manifest?.temp_max_k ?? 255.0);
    return minVal + (val / 255.0) * (maxVal - minVal);
}

/**
 * 🌟 GENERIC BILINEAR SAMPLER
 */
export function sampleBilinearValue(lng, lat, activeFrameState, manifest) {
    const frameState = activeFrameState || stateManager.activeFrameState;
    if (!frameState) return 0.0;

    const chunkIdx = frameState.chunkIndex ?? 0;
    const pixelData = stateManager.chunkPixelData[chunkIdx];
    if (!pixelData) return 0.0;

    let normLng = ((lng % 360) + 360) % 360;
    if (normLng > 180) normLng -= 360;

    const normX = (normLng + 180.0) / 360.0;
    const normY = (90.0 - lat) / 180.0;

    if (normY < 0 || normY > 1) return 0.0;

    const frameW = manifest?.frame_width || stateManager.manifest?.frame_width || 1440;
    const frameH = manifest?.frame_height || stateManager.manifest?.frame_height || 721;
    const frameSize = frameW * frameH;
    const frameIdx = frameState.frameIndex ?? frameState.col ?? 0;

    const contX = (((normX % 1) + 1) % 1) * frameW;
    const contY = Math.min(Math.max(normY * (frameH - 1), 0), frameH - 1);

    const x0 = Math.floor(contX) % frameW;
    const x1 = (x0 + 1) % frameW;
    const y0 = Math.floor(contY);
    const y1 = Math.min(y0 + 1, frameH - 1);

    const fracX = contX - Math.floor(contX);
    const fracY = contY - y0;

    const frameOffset = frameIdx * frameSize;

    const idx00 = frameOffset + y0 * frameW + x0;
    const idx10 = frameOffset + y0 * frameW + x1;
    const idx01 = frameOffset + y1 * frameW + x0;
    const idx11 = frameOffset + y1 * frameW + x1;

    const v00 = pixelData[idx00];
    const v10 = pixelData[idx10];
    const v01 = pixelData[idx01];
    const v11 = pixelData[idx11];

    if (v00 === undefined) return 0.0;

    const activeManifest = manifest || stateManager.manifest;

    const d00 = decodePixelValue(v00, activeManifest);
    const d10 = decodePixelValue(v10 ?? v00, activeManifest);
    const d01 = decodePixelValue(v01 ?? v00, activeManifest);
    const d11 = decodePixelValue(v11 ?? v00, activeManifest);

    const top = d00 * (1.0 - fracX) + d10 * fracX;
    const bottom = d01 * (1.0 - fracX) + d11 * fracX;
    return top * (1.0 - fracY) + bottom * fracY;
}

/**
 * 🌟 DYNAMIC UNIT FORMATTER
 */
export function formatParameterValue(decodedVal, manifest) {
    if (decodedVal === undefined || isNaN(decodedVal)) return "--";

    const unit = (manifest?.unit || stateManager.paramConfig?.unit || '').trim();

    if (unit === 'in' || unit.toLowerCase().includes('inch')) {
        return `${decodedVal.toFixed(2)}"`;
    }

    if (unit.includes('°') || unit.toLowerCase().includes('f') || unit.toLowerCase().includes('c')) {
        let tempVal = decodedVal;
        if (decodedVal > 150 && (unit.includes('F') || unit.includes('f'))) {
            tempVal = (decodedVal - 273.15) * 1.8 + 32.0;
        } else if (decodedVal > 150 && (unit.includes('C') || unit.includes('c'))) {
            tempVal = decodedVal - 273.15;
        }
        return `${Math.round(tempVal)}°`;
    }

    if (unit === '%') return `${Math.round(decodedVal)}%`;
    if (unit.length > 0) return `${Math.round(decodedVal)} ${unit}`;
    return `${Math.round(decodedVal)}`;
}

/**
 * 🌟 Toggle Basemap Native City Labels (Hidden for Models to prevent badge overlap)
 */
export function setBasemapLabelsVisibility(map, isVisible) {
    if (!map) return;
    const style = map.getStyle();
    if (!style || !style.layers) return;

    const visibilityVal = isVisible ? 'visible' : 'none';

    style.layers.forEach(layer => {
        const id = layer.id.toLowerCase();
        const sourceLayer = (layer['source-layer'] || '').toLowerCase();
        if (layer.type === 'symbol' && (
            id.includes('place_label_city') ||
            id.includes('place_label_town') ||
            id.includes('place_label_village') ||
            id.includes('settlement') ||
            sourceLayer.includes('place')
        )) {
            try {
                map.setLayoutProperty(layer.id, 'visibility', visibilityVal);
            } catch (e) {}
        }
    });
}

/**
 * 🌟 Shut down and completely remove all city callouts (Radar Mode)
 */
export function destroyCityOverlay() {
    for (const name in cityMarkers) {
        if (cityMarkers[name]) {
            cityMarkers[name].remove();
        }
    }
    cityMarkers = {};
    activeCities = [];
    isUpdating = false;
}

export async function initCityOverlay(map) {
    mapInstance = map;

    // 🛑 Hard shutdown if not in Model Viewer
    if (stateManager.activeMode !== 'modelViewer') {
        destroyCityOverlay();
        setBasemapLabelsVisibility(map, true);
        return;
    }

    destroyCityOverlay();
    setBasemapLabelsVisibility(map, false);

    if (!listenersAttached) {
        let timer = null;
        const throttledUpdate = () => {
            if (stateManager.activeMode !== 'modelViewer') return;
            if (timer) cancelAnimationFrame(timer);
            timer = requestAnimationFrame(() => {
                updateCityPositions();
            });
        };
        map.on('move', throttledUpdate);
        map.on('zoom', throttledUpdate);
        listenersAttached = true;
    }

    if (allGlobalCities.length > 0) {
        isLoaded = true;
        updateCityPositions();
        return;
    }

    try {
        const resp = await fetch(GLOBAL_CITIES_URL);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        allGlobalCities = data.features.map((f, i) => {
            const pop = f.properties.POP_MAX || f.properties.pop_max || 0;
            let minZoom = 6;
            if (pop >= 2000000) minZoom = 2;
            else if (pop >= 500000) minZoom = 4;
            else if (pop >= 100000) minZoom = 5;
            else minZoom = 6;

            return {
                id: i,
                name: f.properties.NAME || f.properties.name || f.properties.NAMEASCII,
                lng: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
                pop: pop,
                minZoom: minZoom
            };
        });

        isLoaded = true;
        updateCityPositions();
    } catch (err) {
        console.error("Failed to load global cities dataset:", err);
    }
}

export function updateCityPositions() {
    // 🛑 100% OFF during Radar mode
    if (stateManager.activeMode !== 'modelViewer') {
        destroyCityOverlay();
        return;
    }

    if (!mapInstance || !isLoaded || isUpdating) return;
    isUpdating = true;

    const isSuppressed = stateManager.paramConfig?.suppress_city_overlay 
                      || stateManager.manifest?.suppress_city_overlay;

    if (isSuppressed) {
        destroyCityOverlay();
        return;
    }

    const bounds = mapInstance.getBounds();
    const zoom = mapInstance.getZoom();

    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = Math.max(-85.0, bounds.getSouth());
    const north = Math.min(85.0, bounds.getNorth());

    let visible = allGlobalCities.filter(c => {
        if (zoom < c.minZoom) return false;
        if (c.lat < south || c.lat > north) return false;
        if (west <= east) return c.lng >= west && c.lng <= east;
        return c.lng >= west || c.lng <= east;
    });

    visible.sort((a, b) => b.pop - a.pop);

    const placedScreenPoints = [];
    const minDistancePx = 52;
    activeCities = [];

    for (let i = 0; i < visible.length; i++) {
        const city = visible[i];
        const pos = mapInstance.project([city.lng, city.lat]);

        const collides = placedScreenPoints.some(pt => Math.hypot(pt.x - pos.x, pt.y - pos.y) < minDistancePx);

        if (!collides) {
            placedScreenPoints.push(pos);
            activeCities.push(city);
            if (activeCities.length >= 40) break;
        }
    }

    const activeSet = new Set(activeCities.map(c => c.name));

    activeCities.forEach(city => {
        let marker = cityMarkers[city.name];
        if (!marker) {
            const node = document.createElement('div');
            node.className = 'city-callout-node';
            node.innerHTML = `
                <div class="city-callout-val">--</div>
                <div class="city-callout-name">${city.name}</div>
            `;

            marker = new maplibregl.Marker({
                element: node,
                anchor: 'center'
            }).setLngLat([city.lng, city.lat]).addTo(mapInstance);

            cityMarkers[city.name] = marker;
        }

        marker.getElement().style.display = 'flex';
    });

    for (const name in cityMarkers) {
        if (!activeSet.has(name)) {
            cityMarkers[name].getElement().style.display = 'none';
        }
    }

    if (window.lastActiveFrameState && window.lastManifest) {
        renderCityValues(window.lastActiveFrameState, window.lastManifest);
    }

    isUpdating = false;
}

function renderCityValues(activeFrameState, manifest) {
    if (!activeFrameState || stateManager.activeMode !== 'modelViewer') return;

    const activeUnit = (manifest?.unit || stateManager.paramConfig?.unit || '').trim().toLowerCase();
    const isPrecipType = activeUnit === 'in' || activeUnit.includes('inch');

    for (let i = 0; i < activeCities.length; i++) {
        const city = activeCities[i];
        const marker = cityMarkers[city.name];
        if (!marker) continue;

        const decodedVal = sampleBilinearValue(city.lng, city.lat, activeFrameState, manifest);
        const formattedText = formatParameterValue(decodedVal, manifest);

        const valEl = marker.getElement().querySelector('.city-callout-val');
        if (valEl) {
            valEl.className = isPrecipType ? 'city-callout-val precip-val' : 'city-callout-val';
            valEl.textContent = formattedText;
        }
    }
}

export function updateCityCallouts(map, activeFrameState, manifest) {
    // 🛑 100% OFF during Radar mode
    if (!isLoaded || stateManager.activeMode !== 'modelViewer') return;

    const isSuppressed = stateManager.paramConfig?.suppress_city_overlay 
                      || manifest?.suppress_city_overlay;

    if (isSuppressed) {
        destroyCityOverlay();
        return;
    }

    window.lastActiveFrameState = activeFrameState;
    window.lastManifest = manifest || stateManager.manifest;

    renderCityValues(activeFrameState, manifest);
}
