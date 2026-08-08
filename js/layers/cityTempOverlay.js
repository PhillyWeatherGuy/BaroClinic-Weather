// js/layers/cityTempOverlay.js

const CITIES = [
    // 🌟 MEGA HUBS (minZoom: 3)
    { name: "New York", coords: [-74.006, 40.712], minZoom: 3 },
    { name: "Los Angeles", coords: [-118.243, 34.052], minZoom: 3 },
    { name: "Chicago", coords: [-87.629, 41.878], minZoom: 3 },
    { name: "Houston", coords: [-95.369, 29.760], minZoom: 3 },
    { name: "Phoenix", coords: [-112.074, 33.448], minZoom: 3 },
    { name: "Toronto", coords: [-79.383, 43.653], minZoom: 3 },
    { name: "Mexico City", coords: [-99.133, 19.433], minZoom: 3 },
    { name: "Denver", coords: [-104.990, 39.739], minZoom: 3 },
    { name: "Seattle", coords: [-122.332, 47.606], minZoom: 3 },
    { name: "Miami", coords: [-80.191, 25.761], minZoom: 3 },

    // 🌟 REGIONAL HUBS (minZoom: 5)
    { name: "Dallas", coords: [-96.797, 32.776], minZoom: 5 },
    { name: "Atlanta", coords: [-84.388, 33.749], minZoom: 5 },
    { name: "San Francisco", coords: [-122.419, 37.774], minZoom: 5 },
    { name: "Philadelphia", coords: [-75.165, 39.952], minZoom: 5 },
    { name: "Boston", coords: [-71.058, 42.360], minZoom: 5 },
    { name: "Minneapolis", coords: [-93.265, 44.977], minZoom: 5 },
    { name: "Detroit", coords: [-83.045, 42.331], minZoom: 5 },
    { name: "St. Louis", coords: [-90.199, 38.627], minZoom: 5 },
    { name: "Salt Lake City", coords: [-111.891, 40.760], minZoom: 5 },
    { name: "Las Vegas", coords: [-115.139, 36.169], minZoom: 5 },
    { name: "Boise", coords: [-116.202, 43.618], minZoom: 5 },
    { name: "Albuquerque", coords: [-106.650, 35.084], minZoom: 5 },
    { name: "Kansas City", coords: [-94.578, 39.099], minZoom: 5 },
    { name: "Montreal", coords: [-73.567, 45.501], minZoom: 5 },
    { name: "Vancouver", coords: [-123.121, 49.282], minZoom: 5 },
    { name: "Calgary", coords: [-114.071, 51.045], minZoom: 5 },
    { name: "Monterrey", coords: [-100.316, 25.686], minZoom: 5 },

    // 🌟 STATE CAPITALS & MID-SIZED CITIES (minZoom: 6)
    { name: "San Diego", coords: [-117.161, 32.715], minZoom: 6 },
    { name: "Sacramento", coords: [-121.494, 38.581], minZoom: 6 },
    { name: "Portland", coords: [-122.678, 45.515], minZoom: 6 },
    { name: "Reno", coords: [-119.813, 39.529], minZoom: 6 },
    { name: "Spokane", coords: [-117.426, 47.658], minZoom: 6 },
    { name: "Tucson", coords: [-110.974, 32.222], minZoom: 6 },
    { name: "El Paso", coords: [-106.487, 31.761], minZoom: 6 },
    { name: "Oklahoma City", coords: [-97.516, 35.468], minZoom: 6 },
    { name: "San Antonio", coords: [-98.493, 29.424], minZoom: 6 },
    { name: "Austin", coords: [-97.743, 30.267], minZoom: 6 },
    { name: "New Orleans", coords: [-90.071, 29.951], minZoom: 6 },
    { name: "Memphis", coords: [-90.049, 35.149], minZoom: 6 },
    { name: "Nashville", coords: [-86.781, 36.162], minZoom: 6 },
    { name: "Indianapolis", coords: [-86.158, 39.768], minZoom: 6 },
    { name: "Columbus", coords: [-82.998, 39.961], minZoom: 6 },
    { name: "Cleveland", coords: [-81.694, 41.499], minZoom: 6 },
    { name: "Pittsburgh", coords: [-79.995, 40.440], minZoom: 6 },
    { name: "Baltimore", coords: [-76.612, 39.290], minZoom: 6 },
    { name: "Washington DC", coords: [-77.036, 38.895], minZoom: 6 },
    { name: "Charlotte", coords: [-80.843, 35.227], minZoom: 6 },
    { name: "Raleigh", coords: [-78.638, 35.779], minZoom: 6 },
    { name: "Jacksonville", coords: [-81.655, 30.332], minZoom: 6 },
    { name: "Orlando", coords: [-81.379, 28.538], minZoom: 6 },
    { name: "Tampa", coords: [-82.457, 27.950], minZoom: 6 },
    { name: "Buffalo", coords: [-78.878, 42.886], minZoom: 6 },
    { name: "Albany", coords: [-73.756, 42.652], minZoom: 6 },
    { name: "Ottawa", coords: [-75.697, 45.421], minZoom: 6 },
    { name: "Quebec City", coords: [-71.208, 46.813], minZoom: 6 },
    { name: "Hermosillo", coords: [-110.955, 29.073], minZoom: 6 },
    { name: "Chihuahua", coords: [-106.069, 28.633], minZoom: 6 },

    // 🌟 LOCAL CITIES & TOWNS (minZoom: 7 - 8)
    { name: "Atlantic City", coords: [-74.423, 39.364], minZoom: 7 },
    { name: "Trenton", coords: [-74.743, 40.221], minZoom: 7 },
    { name: "Vineland", coords: [-75.026, 39.486], minZoom: 7 },
    { name: "Ocean City", coords: [-74.575, 39.278], minZoom: 7 },
    { name: "Harrisburg", coords: [-76.884, 40.273], minZoom: 7 },
    { name: "Scranton", coords: [-75.662, 41.409], minZoom: 7 },
    { name: "Erie", coords: [-80.085, 42.129], minZoom: 7 },
    { name: "Syracuse", coords: [-76.147, 43.048], minZoom: 7 },
    { name: "Hartford", coords: [-72.685, 41.765], minZoom: 7 },
    { name: "Providence", coords: [-71.412, 41.824], minZoom: 7 },
    { name: "Portland ME", coords: [-70.255, 43.661], minZoom: 7 },
    { name: "Burlington VT", coords: [-73.212, 44.476], minZoom: 7 },
    { name: "Roanoke", coords: [-79.941, 37.271], minZoom: 7 },
    { name: "Norfolk", coords: [-76.285, 36.850], minZoom: 7 },
    { name: "Wilmington DE", coords: [-75.547, 39.746], minZoom: 7 },
    { name: "Charleston SC", coords: [-79.931, 32.776], minZoom: 7 },
    { name: "Savannah", coords: [-81.099, 32.081], minZoom: 7 },
    { name: "Tallahassee", coords: [-84.280, 30.438], minZoom: 7 },
    { name: "Pensacola", coords: [-87.216, 30.421], minZoom: 7 },
    { name: "Mobile", coords: [-88.043, 30.695], minZoom: 7 },
    { name: "Jackson MS", coords: [-90.184, 32.299], minZoom: 7 },
    { name: "Little Rock", coords: [-92.289, 34.746], minZoom: 7 },
    { name: "Tulsa", coords: [-95.992, 36.154], minZoom: 7 },
    { name: "Wichita", coords: [-97.337, 37.687], minZoom: 7 },
    { name: "Fargo", coords: [-96.789, 46.877], minZoom: 7 },
    { name: "Bismarck", coords: [-100.783, 46.808], minZoom: 7 },
    { name: "Rapid City", coords: [-103.231, 44.080], minZoom: 7 },
    { name: "Cheyenne", coords: [-104.820, 41.140], minZoom: 7 },
    { name: "Casper", coords: [-106.313, 42.866], minZoom: 7 },
    { name: "Billings", coords: [-108.500, 45.783], minZoom: 7 },
    { name: "Missoula", coords: [-113.996, 46.872], minZoom: 7 },
    { name: "Flagstaff", coords: [-111.651, 35.198], minZoom: 7 },
    { name: "Yuma", coords: [-114.627, 32.692], minZoom: 7 },
    { name: "Fresno", coords: [-119.772, 36.746], minZoom: 7 },
    { name: "Bakersfield", coords: [-119.018, 35.373], minZoom: 7 },
    { name: "Redding", coords: [-122.391, 40.586], minZoom: 7 },
    { name: "Bend OR", coords: [-121.315, 44.058], minZoom: 7 },
    { name: "Eugene", coords: [-123.086, 44.052], minZoom: 7 },
    { name: "Culiacan", coords: [-107.394, 24.809], minZoom: 7 },
    { name: "Mazatlan", coords: [-106.425, 23.249], minZoom: 7 },
    { name: "Chihuahua", coords: [-106.069, 28.633], minZoom: 7 }
];

const sampleCanvas = document.createElement('canvas');
let sampleCtx = null;

let cityGeoJSON = {
    type: 'FeatureCollection',
    features: CITIES.map(city => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: city.coords },
        properties: { name: city.name, temp: '--', minZoom: city.minZoom }
    }))
};

/**
 * Initializes MapLibre source and styled dynamic symbol layer
 */
export function initCityTempOverlay(map) {
    if (map.getSource('city-temp-source')) return;

    map.addSource('city-temp-source', {
        type: 'geojson',
        data: cityGeoJSON
    });

    map.addLayer({
        id: 'city-temp-labels',
        type: 'symbol',
        source: 'city-temp-source',
        // 🌟 Filter layer to only display cities matching current zoom or higher
        filter: ['<=', ['get', 'minZoom'], ['zoom']],
        layout: {
            // 🌟 WeatherFront Style: Bold Temp on line 1, City on line 2
            'text-field': ['concat', ['get', 'temp'], '°\n', ['get', 'name']],
            'text-size': 13,
            'text-line-height': 1.15,
            'text-transform': 'uppercase',
            'text-allow-overlap': false, // MapLibre prevents text collisions automatically
            'text-ignore-placement': false,
            'text-padding': 8,
            // 🌟 Sort Priority: Major cities (minZoom 3) get placed first before smaller towns
            'symbol-sort-key': ['get', 'minZoom']
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 2.5,
            'text-halo-blur': 1
        }
    });
}

/**
 * Samples pixel temperatures for all cities in <0.2ms whenever the frame changes
 */
export function updateCityTemperatures(map, activeFrameState, manifest) {
    if (!activeFrameState || !activeFrameState.chunkImg || !manifest) return;

    const source = map.getSource('city-temp-source');
    if (!source) return;

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

    cityGeoJSON.features.forEach(feature => {
        const [lng, lat] = feature.geometry.coordinates;

        let normX = (lng + 180) / 360;
        normX = ((normX % 1) + 1) % 1;

        const latRad = lat * Math.PI / 180;
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

            feature.properties.temp = `${tempF}`;
        }
    });

    source.setData(cityGeoJSON);
}
