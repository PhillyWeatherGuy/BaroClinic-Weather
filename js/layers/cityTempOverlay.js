// js/layers/cityTempOverlay.js
import { stateManager } from '../core/stateManager.js';

const GLOBAL_CITIES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson';

let allGlobalCities = [];
let isLoaded = false;

let cityGeoJSON = {
    type: 'FeatureCollection',
    features: []
};

export async function initCityTempOverlay(map) {
    if (map.getSource('city-temp-source')) return;

    map.addSource('city-temp-source', {
        type: 'geojson',
        data: cityGeoJSON
    });

    map.addLayer({
        id: 'city-temp-labels',
        type: 'symbol',
        source: 'city-temp-source',
        layout: {
            'text-field': ['concat', ['get', 'temp'], '°\n', ['get', 'name']],
            'text-size': 12,
            'text-line-height': 1.15,
            'text-transform': 'uppercase',
            'text-allow-overlap': false,
            'text-optional': true,
            'text-padding': 6,
            'symbol-sort-key': ['get', 'rank']
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 2.5,
            'text-halo-blur': 1
        }
    });

    map.on('moveend', () => {
        if (window.lastActiveFrameState && window.lastManifest) {
            updateCityTemperatures(map, window.lastActiveFrameState, window.lastManifest);
        }
    });

    try {
        const resp = await fetch(GLOBAL_CITIES_URL);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        allGlobalCities = data.features.map(f => ({
            name: f.properties.NAME || f.properties.name || f.properties.NAMEASCII,
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
            rank: f.properties.SCALERANK ?? 10
        }));

        isLoaded = true;

        if (window.lastActiveFrameState && window.lastManifest) {
            updateCityTemperatures(map, window.lastActiveFrameState, window.lastManifest);
        }
    } catch (err) {
        console.error("Failed to load global cities dataset:", err);
    }
}

/**
 * 🌟 1-MICROSECOND INSTANT TEMPERATURE SAMPLING: Reads directly from raw pre-cached memory array
 */
export function updateCityTemperatures(map, activeFrameState, manifest) {
    if (!activeFrameState || !manifest) return;

    const chunkIdx = activeFrameState.chunkIndex;
    const pixelData = stateManager.chunkPixelData[chunkIdx];

    window.lastActiveFrameState = activeFrameState;
    window.lastManifest = manifest;

    if (!pixelData || !isLoaded || allGlobalCities.length === 0) return;

    const source = map.getSource('city-temp-source');
    if (!source) return;

    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();

    const visibleCities = allGlobalCities.filter(c => {
        if (c.lat < south || c.lat > north) return false;
        if (west <= east) {
            return c.lng >= west && c.lng <= east;
        } else {
            return c.lng >= west || c.lng <= east;
        }
    });

    const frameW = manifest.frame_width;
    const frameH = manifest.frame_height;
    const chunkInfo = manifest.chunks[chunkIdx];
    const sheetW = chunkInfo.sheet_width || (frameW * chunkInfo.columns);

    const minK = manifest.temp_min_k || 210.0;
    const maxK = manifest.temp_max_k || 330.0;

    const updatedFeatures = [];

    for (let i = 0; i < visibleCities.length; i++) {
        const city = visibleCities[i];
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

            // 🌟 Instant 1-microsecond direct array memory lookup!
            const pixelIdx = (sheetY * sheetW + sheetX) * 4;
            const rawVal = pixelData[pixelIdx];

            if (rawVal !== undefined) {
                const tempK = minK + (rawVal / 255.0) * (maxK - minK);
                const tempC = tempK - 273.15;
                const tempF = Math.round((tempC * 9 / 5) + 32);

                if (!isNaN(tempF) && tempF > -100 && tempF < 160) {
                    updatedFeatures.push({
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [city.lng, city.lat] },
                        properties: {
                            name: city.name,
                            temp: `${tempF}`,
                            rank: city.rank
                        }
                    });
                }
            }
        }
    }

    source.setData({
        type: 'FeatureCollection',
        features: updatedFeatures
    });
}