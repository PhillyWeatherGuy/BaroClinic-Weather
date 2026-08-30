// js/layers/cityOverlay.js
import { stateManager } from '../core/stateManager.js';

const GLOBAL_CITIES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson';

let allGlobalCities = [];
let activeCities = [];
let cityMarkers = {};
let isLoaded = false;
let mapInstance = null;
let modelsConfig = null;
let listenersAttached = false;

// 🌟 Parameter Piecewise Scaling Fallback Tables
const PARAM_SCALING_FALLBACKS = {
    pwat: {
        mode: 'piecewise',
        val_points: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
        byte_points: [0, 32, 64, 96, 128, 160, 192, 255]
    },
    tcwv: {
        mode: 'piecewise',
        val_points: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
        byte_points: [0, 32, 64, 96, 128, 160, 192, 255]
    },
    tp: {
        mode: 'piecewise',
        val_points: [0.0, 1.0, 10.0, 50.0],
        byte_points: [0, 100, 200, 255]
    },
    precip: {
        mode: 'piecewise',
        val_points: [0.0, 1.0, 10.0, 50.0],
        byte_points: [0, 100, 200, 255]
    },
    pva: {
        mode: 'piecewise',
        val_points: [0.0, 3.0, 80.0],
        byte_points: [0, 30, 107]
    }
};

// Clean CSS styling for city callout nodes
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
 * 🌟 UNIVERSAL PIXEL DECODER
 */
export function decodePixelValue(rawVal, manifest) {
    if (rawVal === undefined) return 0.0;

    const paramKey = (manifest?.parameter || manifest?.id || stateManager.activeParam || '').toLowerCase();
    const scaling = manifest?.scaling || PARAM_SCALING_FALLBACKS[paramKey];

    if (scaling && scaling.mode === 'piecewise' && scaling.val_points && scaling.byte_points) {
        const vp = scaling.val_points;
        const bp = scaling.byte_points;

        for (let i = 0; i < bp.length - 1; i++) {
            if (rawVal >= bp[i] && rawVal <= bp[i + 1]) {
                const t = (rawVal - bp[i]) / (bp[i + 1] - bp[i]);
                return vp[i] + t * (vp[i + 1] - vp[i]);
            }
        }
        return vp[vp.length - 1];
    }

    const minVal = manifest?.min_val ?? manifest?.temp_min_k ?? scaling?.min_val ?? (paramKey === '2t' ? 216.4833 : 0.0);
    const maxVal = manifest?.max_val ?? manifest?.temp_max_k ?? scaling?.max_val ?? (paramKey === '2t' ? 327.5944 : 255.0);
    return minVal + (rawVal / 255.0) * (maxVal - minVal);
}

/**
 * 🌟 SHARED BILINEAR SAMPLER (Time-Volume Compatible)
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
 * 🌟 TRULY DYNAMIC UNIT FORMATTER
 */
export function formatParameterValue(decodedVal, manifest) {
    if (decodedVal === undefined || isNaN(decodedVal)) return "--";

    const param = (manifest?.parameter || manifest?.id || stateManager.activeParam || '').toLowerCase();
    const unit = (manifest?.unit || '').trim().toLowerCase();

    // 🌟 Explicit PWAT / TCWV formatting
    if (param === 'pwat' || param === 'tcwv') {
        return `${decodedVal.toFixed(2)}"`;
    }

    // 🌟 Precipitation formatting
    if (param === 'tp' || param === 'precip' || unit === 'in' || unit.includes('inch')) {
        return `${decodedVal.toFixed(2)}"`;
    }

    // 🌟 Temperature formatting
    if (param === '2t' || param === 'temp' || unit === '°f' || unit.includes('f')) {
        let tempF = decodedVal;
        if (decodedVal > 150) {
            const tempC = decodedVal - 273.15;
            tempF = (tempC * 9 / 5) + 32;
        }
        return `${Math.round(tempF)}°`;
    }

    if (unit === 'kts' || unit === 'mph') {
        return `${Math.round(decodedVal)} ${unit}`;
    }

    if (unit === 'hpa' || unit === 'mb' || unit === 'j/kg' || unit === '%') {
        return `${Math.round(decodedVal)}`;
    }

    return `${Math.round(decodedVal)}`;
}

export function hideBasemapCityLabels(map) {
    if (!map) return;
    const style = map.getStyle();
    if (!style || !style.layers) return;

    style.layers.forEach(layer => {
        const id = layer.id.toLowerCase();
        const sourceLayer = (layer['source-layer'] || '').toLowerCase();
        if (layer.type === 'symbol' && (
            id.includes('place') || 
            id.includes('settlement') || 
            id.includes('city') || 
            id.includes('town') || 
            id.includes('village') ||
            id.includes('label') ||
            sourceLayer.includes('place') ||
            sourceLayer.includes('label')
        )) {
            try {
                map.setLayoutProperty(layer.id, 'visibility', 'none');
            } catch (e) {}
        }
    });
}

export async function initCityOverlay(map) {
    mapInstance = map;

    // Clean up any detached marker instances from previous basemap style
    for (const name in cityMarkers) {
        if (cityMarkers[name]) {
            cityMarkers[name].remove();
        }
    }
    cityMarkers = {};
    activeCities = [];

    hideBasemapCityLabels(map);

    if (!listenersAttached) {
        map.on('move', updateCityPositions);
        map.on('zoom', updateCityPositions);
        listenersAttached = true;
    }

    try {
        const cResp = await fetch('./config/models.json');
        if (cResp.ok) modelsConfig = await cResp.json();
    } catch (e) {}

    if (allGlobalCities.length > 0) {
        isLoaded = true;
        updateCityPositions();
        if (window.lastActiveFrameState && window.lastManifest) {
            updateCityCallouts(mapInstance, window.lastActiveFrameState, window.lastManifest);
        }
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

        if (window.lastActiveFrameState && window.lastManifest) {
            updateCityCallouts(mapInstance, window.lastActiveFrameState, window.lastManifest);
        }
    } catch (err) {
        console.error("Failed to load global cities dataset:", err);
    }
}

export function updateCityPositions() {
    if (!mapInstance || !isLoaded) return;

    hideBasemapCityLabels(mapInstance);

    // 🌟 Do not show city callouts for 500mb PVA
    const isPva = (stateManager.activeParam === 'pva' || stateManager.manifest?.parameter === 'pva');
    if (isPva) {
        for (const name in cityMarkers) {
            cityMarkers[name].getElement().style.display = 'none';
        }
        activeCities = [];
        return;
    }

    const bounds = mapInstance.getBounds();
    const zoom = mapInstance.getZoom();

    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();

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
        updateCityCallouts(mapInstance, window.lastActiveFrameState, window.lastManifest);
    }
}

/**
 * 🌟 MASTER CALLOUT SAMPLER (Uses Bilinear GPS Interpolation)
 */
export function updateCityCallouts(map, activeFrameState, manifest) {
    if (!activeFrameState || !isLoaded) return;

    hideBasemapCityLabels(map);

    const isPva = (stateManager.activeParam === 'pva' || manifest?.parameter === 'pva');
    if (isPva) {
        for (const name in cityMarkers) {
            cityMarkers[name].getElement().style.display = 'none';
        }
        return;
    }

    window.lastActiveFrameState = activeFrameState;
    window.lastManifest = manifest || stateManager.manifest;

    if (activeCities.length === 0) {
        updateCityPositions();
    }

    for (let i = 0; i < activeCities.length; i++) {
        const city = activeCities[i];
        const marker = cityMarkers[city.name];
        if (!marker) continue;

        const decodedVal = sampleBilinearValue(city.lng, city.lat, activeFrameState, manifest);
        const formattedText = formatParameterValue(decodedVal, manifest);

        const valEl = marker.getElement().querySelector('.city-callout-val');
        marker.getElement().style.display = 'flex';
        if (valEl) {
            valEl.className = (stateManager.activeParam === 'tp' || stateManager.activeParam === 'pwat' || manifest?.parameter === 'tp' || manifest?.parameter === 'pwat') 
                ? 'city-callout-val precip-val' 
                : 'city-callout-val';
            valEl.textContent = formattedText;
        }
    }
}
