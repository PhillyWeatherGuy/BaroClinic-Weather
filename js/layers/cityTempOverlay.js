// js/layers/cityTempOverlay.js

// 🌍 Industry standard open vector dataset containing 7,300+ global cities
const GLOBAL_CITIES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson';

let allGlobalCities = [];
let isLoaded = false;

const sampleCanvas = document.createElement('canvas');
let sampleCtx = null;

let cityGeoJSON = {
    type: 'FeatureCollection',
    features: []
};

/**
 * Initializes MapLibre source, styled layer, and fetches 7,300+ Global Cities asynchronously
 */
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
            // 🌟 WeatherFront Style: Bold Temp on line 1, City on line 2
            'text-field': ['concat', ['get', 'temp'], '°\n', ['get', 'name']],
            'text-size': 12,
            'text-line-height': 1.15,
            'text-transform': 'uppercase',
            'text-allow-overlap': false, // MapLibre handles label collision automatically
            'text-ignore-placement': false,
            'text-padding': 10,
            // 🌟 Sort Priority: Major global hubs get placed first before smaller towns
            'symbol-sort-key': ['get', 'rank']
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 2.5,
            'text-halo-blur': 1
        }
    });

    // 🌟 Re-sample temperatures whenever the user pans or zooms the map
    map.on('moveend', () => {
        if (window.lastActiveFrameState && window.lastManifest) {
            updateCityTemperatures(map, window.lastActiveFrameState, window.lastManifest);
        }
    });

    // 🌐 Asynchronously fetch 7,300+ Global Cities from Natural Earth CDN
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

        // If a frame is already active, trigger temperature calculation immediately
        if (window.lastActiveFrameState && window.lastManifest) {
            updateCityTemperatures(map, window.lastActiveFrameState, window.lastManifest);
        }
    } catch (err) {
        console.error("Failed to load global cities dataset:", err);
    }
}

/**
 * Samples pixel temperatures ONLY for cities currently visible inside the viewport bounds (<0.1ms execution time)
 */
export function updateCityTemperatures(map, activeFrameState, manifest) {
    if (!activeFrameState || !activeFrameState.chunkImg || !manifest) return;

    // Cache state so map moveend events can re-sample immediately
    window.lastActiveFrameState = activeFrameState;
    window.lastManifest = manifest;

    if (!isLoaded || allGlobalCities.length === 0) return;

    const source = map.getSource('city-temp-source');
    if (!source) return;

    // 🌟 Viewport Bounding Box Filter: Only sample cities currently visible on screen!
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
            return c.lng >= west || c.lng <= east; // Handles anti-meridian wrap
        }
    });

    const frameW = manifest.frame_width;
    const frameH = manifest.frame_height;

    if (sampleCanvas.width !== frameW || sampleCanvas.height !== frameH) {
        sampleCanvas.width = frameW;
        sampleCanvas.height = frameH;
        sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (!sampleCtx) return;

    sampleCtx.clearRect(0, 0, frameW, frameH);
    sampleCtx.drawImage(
        activeFrameState.chunkImg,
        activeFrameState.col * frameW, activeFrameState.row * frameH, frameW, frameH,
        0, 0, frameW, frameH
    );

    const pixelData = sampleCtx.getImageData(0, 0, frameW, frameH).data;
    const minK = manifest.temp_min_k || 210.0;
    const maxK = manifest.temp_max_k || 330.0;

    const updatedFeatures = [];

    visibleCities.forEach(city => {
        let normX = (city.lng + 180) / 360;
        normX = ((normX % 1) + 1) % 1;

        const latRad = city.lat * Math.PI / 180;
        const mercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
        const normY = 0.5 - (mercY / (2 * Math.PI));

        if (normY >= 0 && normY <= 1) {
            const px = Math.floor(normX * frameW);
            const py = Math.floor(normY * frameH);

            const pixelIdx = (py * frameW + px) * 4;
            const rawVal = pixelData[pixelIdx];

            const tempK = minK + (rawVal / 255.0) * (maxK - minK);
            const tempC = tempK - 273.15;
            const tempF = Math.round((tempC * 9 / 5) + 32);

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
    });

    // Update MapLibre source with visible cities
    source.setData({
        type: 'FeatureCollection',
        features: updatedFeatures
    });
}