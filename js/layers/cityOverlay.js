// js/layers/cityOverlay.js
import { stateManager } from '../core/stateManager.js';

const GLOBAL_CITIES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson';

let allGlobalCities = [];
let activeCities = [];
let cityMarkers = {};
let isLoaded = false;
let mapInstance = null;
let modelsConfig = null;

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
 * Dynamically decodes arbitrary breakpoint arrays based on manifest.json
 */
export function decodePixelValue(rawVal, manifest) {
    if (rawVal === undefined || !manifest) return 0.0;

    const scaling = manifest.scaling;
    // 🌟 Handles any number of custom scale breakpoints dynamically
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

    // Standard Linear Decoding
    const minVal = manifest.min_val ?? manifest.temp_min_k ?? scaling?.min_val ?? 0.0;
    const maxVal = manifest.max_val ?? manifest.temp_max_k ?? scaling?.max_val ?? 255.0;
    return minVal + (rawVal / 255.0) * (maxVal - minVal);
}

/**
 * 🌟 TRULY DYNAMIC UNIT FORMATTER
 * Automatically formats display numbers based on manifest.unit
 */
export function formatParameterValue(decodedVal, manifest) {
    if (!manifest) return `${Math.round(decodedVal)}`;

    const unit = (manifest.unit || '').trim();

    // 1. Precipitation & Snowfall (Inches)
    if (unit === 'in' || unit.toLowerCase().includes('inch')) {
        return `${decodedVal.toFixed(2)}"`;
    }

    // 2. Temperature (Kelvin in raw GRIB -> °F)
    if (unit === '°F' || unit.includes('F') || manifest.parameter === '2t') {
        let tempF = decodedVal;
        if (decodedVal > 150) { // If raw data is in Kelvin
            const tempC = decodedVal - 273.15;
            tempF = (tempC * 9 / 5) + 32;
        }
        return `${Math.round(tempF)}°`;
    }

    // 3. Wind Speed / Wind Gusts (Knots or MPH)
    if (unit === 'kts' || unit === 'mph') {
        return `${Math.round(decodedVal)} ${unit}`;
    }

    // 4. Pressure (hPa / mb) or CAPE (J/kg) or Percentage (%)
    if (unit === 'hPa' || unit === 'mb' || unit === 'J/kg' || unit === '%') {
        return `${Math.round(decodedVal)}`;
    }

    // Fallback
    return `${Math.round(decodedVal)}`;
}

/**
 * 🌟 Thoroughly hides native MapTiler basemap city/place symbol layers
 */
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

    hideBasemapCityLabels(map);

    map.on('move', updateCityPositions);
    map.on('zoom', updateCityPositions);

    try {
        const cResp = await fetch('./config/models.json');
        if (cResp.ok) modelsConfig = await cResp.json();
    } catch (e) {}

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
            updateCityCallouts(map, window.lastActiveFrameState, window.lastManifest);
        }
    } catch (err) {
        console.error("Failed to load global cities dataset:", err);
    }
}

function updateCityPositions() {
    if (!mapInstance || !isLoaded) return;

    hideBasemapCityLabels(mapInstance);

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
 * 🌟 MASTER CALLOUT SAMPLER & FORMATTER
 * 100% dynamically decodes and formats city values based on manifest definitions
 */
export function updateCityCallouts(map, activeFrameState, manifest) {
    if (!activeFrameState || !manifest) return;

    hideBasemapCityLabels(map);

    const chunkIdx = activeFrameState.chunkIndex;
    const pixelData = stateManager.chunkPixelData[chunkIdx];

    window.lastActiveFrameState = activeFrameState;
    window.lastManifest = manifest;

    if (!pixelData || !isLoaded || activeCities.length === 0) return;

    const frameW = manifest.frame_width;
    const frameH = manifest.frame_height;
    const chunkInfo = manifest.chunks[chunkIdx];
    const sheetW = chunkInfo.sheet_width || (frameW * chunkInfo.columns);

    for (let i = 0; i < activeCities.length; i++) {
        const city = activeCities[i];

        let normX = (city.lng + 180.0) / 360.0;
        normX = ((normX % 1) + 1) % 1;

        const normY = (90.0 - city.lat) / 180.0;

        const marker = cityMarkers[city.name];
        if (!marker) continue;

        if (normY >= 0 && normY <= 1) {
            const px = Math.floor(normX * frameW);
            const py = Math.floor(normY * frameH);

            const sheetX = activeFrameState.col * frameW + px;
            const sheetY = activeFrameState.row * frameH + py;

            const pixelIdx = sheetY * sheetW + sheetX;
            const rawVal = pixelData[pixelIdx];

            if (rawVal !== undefined) {
                const valEl = marker.getElement().querySelector('.city-callout-val');
                
                // 🌟 Decode math and format text 100% dynamically from manifest definitions
                const decodedVal = decodePixelValue(rawVal, manifest);
                const formattedText = formatParameterValue(decodedVal, manifest);

                marker.getElement().style.display = 'flex';
                if (valEl) {
                    valEl.className = (manifest.unit === 'in' || manifest.parameter === 'tp') 
                        ? 'city-callout-val precip-val' 
                        : 'city-callout-val';
                    valEl.textContent = formattedText;
                }
            }
        }
    }
}