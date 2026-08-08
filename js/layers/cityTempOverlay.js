// js/layers/cityTempOverlay.js
import { stateManager } from '../core/stateManager.js';

const GLOBAL_CITIES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson';

let allGlobalCities = [];
let activeCities = [];
let cityMarkers = {};
let isLoaded = false;
let mapInstance = null;

// 🌟 Bigger typography & enhanced black halos
const style = document.createElement('style');
style.textContent = `
    .city-label-node {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        user-select: none;
        font-family: 'Rajdhani', -apple-system, sans-serif;
        text-transform: uppercase;
    }
    .city-dot {
        width: 5px;
        height: 5px;
        background-color: #ffffff;
        border-radius: 50%;
        box-shadow: 0 0 4px #000, 0 0 8px #000;
        margin: 2px 0;
    }
    .city-label-val {
        font-size: 18px;
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.5px;
        color: #ffffff;
        text-shadow: 0 0 3px #000, 0 1px 5px #000, 0 0 8px #000, 0 0 14px #000;
    }
    .city-label-name {
        font-size: 12px;
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: 0.5px;
        color: #f1f5f9;
        text-shadow: 0 0 3px #000, 0 1px 4px #000, 0 0 8px #000;
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

export async function initCityTempOverlay(map) {
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
            
            // 🌟 Assign minimum zoom based on city population
            let minZoom = 6;
            if (pop >= 2000000) minZoom = 2;      // Mega Metros (NYC, LA, Chicago, Phoenix, Mexico City)
            else if (pop >= 500000) minZoom = 4;  // Major Cities (Denver, Salt Lake, Seattle)
            else if (pop >= 100000) minZoom = 5;  // Mid-size Cities (Trenton, Atlantic City)
            else minZoom = 6;                     // Towns

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
            updateCityTemperatures(map, window.lastActiveFrameState, window.lastManifest);
        }
    } catch (err) {
        console.error("Failed to load global cities dataset:", err);
    }
}

/**
 * 🌟 Population-Ranked Screen Collision System
 */
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

    // 🌟 Sort strictly by Population Descending (Highest population gets placed first!)
    visible.sort((a, b) => b.pop - a.pop);

    const placedScreenPoints = [];
    const minDistancePx = 42; // Buffer spacing for 18px text
    activeCities = [];

    for (let i = 0; i < visible.length; i++) {
        const city = visible[i];
        const pos = mapInstance.project([city.lng, city.lat]);

        const collides = placedScreenPoints.some(pt => Math.hypot(pt.x - pos.x, pt.y - pos.y) < minDistancePx);

        if (!collides) {
            placedScreenPoints.push(pos);
            activeCities.push(city);
            if (activeCities.length >= 45) break;
        }
    }

    const activeSet = new Set(activeCities.map(c => c.name));

    activeCities.forEach(city => {
        let marker = cityMarkers[city.name];
        if (!marker) {
            const node = document.createElement('div');
            node.className = 'city-label-node';
            node.innerHTML = `
                <div class="city-label-val">--°</div>
                <div class="city-dot"></div>
                <div class="city-label-name">${city.name}</div>
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
        updateCityTemperatures(mapInstance, window.lastActiveFrameState, window.lastManifest);
    }
}

/**
 * 🌟 0.0001ms INSTANT TEMPERATURE UPDATES
 */
export function updateCityTemperatures(map, activeFrameState, manifest) {
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

    const minK = manifest.temp_min_k || 210.0;
    const maxK = manifest.temp_max_k || 330.0;

    for (let i = 0; i < activeCities.length; i++) {
        const city = activeCities[i];
        let normX = (city.lng + 180) / 360;
        normX = ((normX % 1) + 1) % 1;

        const latRad = city.lat * Math.PI / 180;
        const mercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
        const normY = 0.5 - (mercY / (2 * Math.PI));

        if (normY >= 0 && normY <= 1) {
            const px = Math.floor(normX * frameW);
            const py = Math.floor(normY * frameH);

            const sheetX = activeFrameState.col * frameW + px;
            const sheetY = activeFrameState.row * frameH + py;

            const pixelIdx = sheetY * sheetW + sheetX;
            const rawVal = pixelData[pixelIdx];

            if (rawVal !== undefined) {
                const tempK = minK + (rawVal / 255.0) * (maxK - minK);
                const tempC = tempK - 273.15;
                const tempF = Math.round((tempC * 9 / 5) + 32);

                const marker = cityMarkers[city.name];
                if (marker) {
                    const tempEl = marker.getElement().querySelector('.city-label-val');
                    if (tempEl) tempEl.textContent = `${tempF}°`;
                }
            }
        }
    }
}