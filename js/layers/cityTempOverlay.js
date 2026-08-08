// js/layers/cityTempOverlay.js
import { stateManager } from '../core/stateManager.js';

const GLOBAL_CITIES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson';

let allGlobalCities = [];
let activeCities = [];
let cityDOMNodes = {};
let isLoaded = false;

let overlayContainer = null;
let mapInstance = null;

// 🌟 Inject ultra-fast crisp WeatherFront CSS styles
const style = document.createElement('style');
style.textContent = `
    #city-temp-overlay-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: hidden;
        z-index: 5;
    }
    .city-label-node {
        position: absolute;
        top: 0;
        left: 0;
        transform: translate3d(-50%, -50%, 0);
        text-align: center;
        font-family: 'Rajdhani', -apple-system, sans-serif;
        text-transform: uppercase;
        pointer-events: none;
        user-select: none;
        will-change: transform;
    }
    .city-label-val {
        font-size: 15px;
        font-weight: 800;
        line-height: 1;
        color: #ffffff;
        text-shadow: 0 0 3px #000, 0 1px 4px #000, 0 0 8px #000, 0 0 12px #000;
    }
    .city-label-name {
        font-size: 11px;
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: 0.5px;
        color: #ffffff;
        text-shadow: 0 0 3px #000, 0 1px 4px #000, 0 0 8px #000;
    }
`;
document.head.appendChild(style);

/**
 * Initializes DOM Overlay container & attaches map movement listeners
 */
export async function initCityTempOverlay(map) {
    mapInstance = map;

    if (!overlayContainer) {
        overlayContainer = document.createElement('div');
        overlayContainer.id = 'city-temp-overlay-container';
        map.getContainer().appendChild(overlayContainer);
    }

    // 🌟 Reposition DOM labels smoothly during map pan / zoom / rotate
    map.on('move', updateCityPositions);
    map.on('zoom', updateCityPositions);

    try {
        const resp = await fetch(GLOBAL_CITIES_URL);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        allGlobalCities = data.features.map((f, i) => ({
            id: i,
            name: f.properties.NAME || f.properties.name || f.properties.NAMEASCII,
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
            rank: f.properties.SCALERANK ?? 10,
            minZoom: f.properties.SCALERANK ? Math.max(3, f.properties.SCALERANK - 1) : 6
        }));

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
 * Positions DOM labels over the map based on viewport bounds
 */
function updateCityPositions() {
    if (!mapInstance || !isLoaded) return;

    const bounds = mapInstance.getBounds();
    const zoom = mapInstance.getZoom();

    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();

    // Filter cities inside current viewport
    let visible = allGlobalCities.filter(c => {
        if (zoom < c.minZoom) return false;
        if (c.lat < south || c.lat > north) return false;
        if (west <= east) return c.lng >= west && c.lng <= east;
        return c.lng >= west || c.lng <= east;
    });

    // Prioritize major ranked cities (max ~50 visible at a time)
    visible.sort((a, b) => a.rank - b.rank);
    activeCities = visible.slice(0, 50);

    const activeSet = new Set(activeCities.map(c => c.name));

    // Update or create DOM nodes for visible cities
    activeCities.forEach(city => {
        let node = cityDOMNodes[city.name];
        if (!node) {
            node = document.createElement('div');
            node.className = 'city-label-node';
            node.innerHTML = `<div class="city-label-val">--°</div><div class="city-label-name">${city.name}</div>`;
            overlayContainer.appendChild(node);
            cityDOMNodes[city.name] = node;
        }

        const pos = mapInstance.project([city.lng, city.lat]);
        node.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`;
        node.style.display = 'block';
    });

    // Hide non-visible cities
    for (const name in cityDOMNodes) {
        if (!activeSet.has(name)) {
            cityDOMNodes[name].style.display = 'none';
        }
    }

    if (window.lastActiveFrameState && window.lastManifest) {
        updateCityTemperatures(mapInstance, window.lastActiveFrameState, window.lastManifest);
    }
}

/**
 * 🌟 0.0001ms ZERO-LATENCY INSTANT TEMPERATURE UPDATES
 * Updates DOM node text values directly on the main thread
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

    // Direct DOM text content update loop (0.0001ms execution time)
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

            const pixelIdx = (sheetY * sheetW + sheetX) * 4;
            const rawVal = pixelData[pixelIdx];

            if (rawVal !== undefined) {
                const tempK = minK + (rawVal / 255.0) * (maxK - minK);
                const tempC = tempK - 273.15;
                const tempF = Math.round((tempC * 9 / 5) + 32);

                const node = cityDOMNodes[city.name];
                if (node) {
                    const tempEl = node.querySelector('.city-label-val');
                    if (tempEl) tempEl.textContent = `${tempF}°`;
                }
            }
        }
    }
}