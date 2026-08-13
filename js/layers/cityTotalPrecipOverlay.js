// js/layers/cityTotalPrecipOverlay.js
import { stateManager } from '../core/stateManager.js';

const GLOBAL_CITIES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson';

let allGlobalCities = [];
let activeCities = [];
let cityMarkers = {};
let isLoaded = false;
let mapInstance = null;

const style = document.createElement('style');
style.textContent = `
    .city-precip-node {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        user-select: none;
        font-family: 'Rajdhani', -apple-system, sans-serif;
        text-transform: uppercase;
    }
    .city-precip-val {
        font-size: 21px;
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.5px;
        color: #38bdf8;
        text-shadow: 0 0 4px #000, 0 1px 6px #000, 0 0 10px #000, 0 0 16px #000;
    }
    .city-precip-name {
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

function hideBasemapCityLabels(map) {
    const style = map.getStyle();
    if (!style || !style.layers) return;

    style.layers.forEach(layer => {
        const id = layer.id.toLowerCase();
        if (layer.type === 'symbol' && (
            id.includes('place') || 
            id.includes('settlement') || 
            id.includes('city') || 
            id.includes('town') || 
            id.includes('village') ||
            id.includes('state') ||
            id.includes('country') ||
            id.includes('region')
        )) {
            try {
                map.setLayoutProperty(layer.id, 'visibility', 'none');
            } catch (e) {}
        }
    });
}

export async function initCityTotalPrecipOverlay(map) {
    mapInstance = map;

    hideBasemapCityLabels(map);

    map.on('move', updateCityPositions);
    map.on('zoom', updateCityPositions);

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
            updateCityPrecipitation(map, window.lastActiveFrameState, window.lastManifest);
        }
    } catch (err) {
        console.error("Failed to load global cities dataset for precipitation:", err);
    }
}

function updateCityPositions() {
    if (!mapInstance || !isLoaded) return;

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
            node.className = 'city-precip-node';
            node.innerHTML = `
                <div class="city-precip-val">--</div>
                <div class="city-precip-name">${city.name}</div>
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
        updateCityPrecipitation(mapInstance, window.lastActiveFrameState, window.lastManifest);
    }
}

/**
 * 🌟 0.0001ms INSTANT PRECIPITATION UPDATES (Inches)
 */
export function updateCityPrecipitation(map, activeFrameState, manifest) {
    if (!activeFrameState || !manifest) return;

    const chunkIdx = activeFrameState.chunkIndex;
    const pixelData = stateManager.chunkPixelData[chunkIdx];

    window.lastActiveFrameState = activeFrameState;
    window.lastManifest = manifest;

    if (!pixelData || !isLoaded || activeCities.length === 0) return;

    const frameW = manifest.frame_width;
    const frameH = manifest.frame_height;
    const chunkInfo = manifest.chunks[chunkIdx];
    const sheetW = chunkInfo.sheet_width || (frameW * chunkInfo.columns);

    const minVal = manifest.temp_min_k !== undefined ? manifest.temp_min_k : 0.0;
    const maxVal = manifest.temp_max_k !== undefined ? manifest.temp_max_k : 0.762;

    for (let i = 0; i < activeCities.length; i++) {
        const city = activeCities[i];

        // 🌟 X-axis: Longitude (-180° to +180° -> 0 to 1)
        let normX = (city.lng + 180.0) / 360.0;
        normX = ((normX % 1) + 1) % 1;

        // 🌟 Y-axis: Equirectangular Latitude (+90°N to -90°S -> 0 to 1)
        const normY = (90.0 - city.lat) / 180.0;

        if (normY >= 0 && normY <= 1) {
            const px = Math.floor(normX * frameW);
            const py = Math.floor(normY * frameH);

            const sheetX = activeFrameState.col * frameW + px;
            const sheetY = activeFrameState.row * frameH + py;

            const pixelIdx = sheetY * sheetW + sheetX;
            const rawVal = pixelData[pixelIdx];

            if (rawVal !== undefined) {
                let inches = minVal + (rawVal / 255.0) * (maxVal - minVal);
                if (maxVal < 5.0) {
                    // Convert meters to inches if maxVal is in meters (0.762 m = 30 in)
                    inches = inches * 39.3701;
                }

                const marker = cityMarkers[city.name];
                if (marker) {
                    // Hide marker if dry (< 0.01") to keep map clean
                    if (inches < 0.01) {
                        marker.getElement().style.display = 'none';
                    } else {
                        marker.getElement().style.display = 'flex';
                        const precipEl = marker.getElement().querySelector('.city-precip-val');
                        if (precipEl) precipEl.textContent = `${inches.toFixed(2)}"`;
                    }
                }
            }
        }
    }
}
/**
 * 🌟 Hides all precipitation city markers when switching back to Temperature
 */
export function hideCityPrecipitationMarkers() {
    for (const name in cityMarkers) {
        if (cityMarkers[name] && cityMarkers[name].getElement()) {
            cityMarkers[name].getElement().style.display = 'none';
        }
    }
}