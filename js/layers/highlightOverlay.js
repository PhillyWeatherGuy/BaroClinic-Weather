// js/layers/highlightOverlay.js
import { showToast, hideToast } from '../components/viewerUI.js';

const REGION_CONFIG = {
    country: {
        id: 'country',
        label: 'Country',
        url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'
    },
    state: {
        id: 'state',
        label: 'State / Province',
        url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'
    },
    county: {
        id: 'county',
        label: 'County',
        url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_2_counties.geojson'
    },
    land: {
        id: 'land',
        label: 'Land',
        url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson'
    },
    water: {
        id: 'water',
        label: 'Water',
        url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_ocean.geojson',
        extraUrl: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson'
    }
};

const CATEGORY_ORDER = ['country', 'state', 'county', 'land', 'water'];

const WORLD_RING = [
    [-179.99, -85.05],
    [179.99, -85.05],
    [179.99, 85.05],
    [-179.99, 85.05],
    [-179.99, -85.05]
];

const EMPTY_FC = { type: 'FeatureCollection', features: [] };
const WORLD_FC = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD_RING] } }]
};

// Drop shadow settings (shadow is built as geometry that can only exist OUTSIDE the highlight)
const SHADOW_PX = [4, 5];          // direction/size of the shadow in screen pixels (right, down)
const SHADOW_STEPS = 6;            // stacked slivers that make the soft falloff
const SHADOW_STEP_OPACITY = 0.14;  // 6 stacked steps ≈ 0.6 at the edge
const SHADOW_SIMPLIFY_PX = 0.4;    // shape is simplified to this many screen px (hidden under the white border line)
const SHADOW_VIEW_PAD = 0.75;      // shadow is only built for the viewport + this much padding on each side
const SHADOW_DEBOUNCE_MS = 250;    // wait for pan/zoom to settle before rebuilding

const regionCache = {};
const selectedFeaturesMap = new Map();

let mapRef = null;
let isPicking = false;
let activePickCategories = [];
let currentPickTarget = null;
let hoveredKey = null;
let snapshotBeforePick = null;
let statusChangeCallback = null;

let activeDimMaskGeoJSON = null;
let activeOutlineGeoJSON = null;
let activeShadowBase = null;
let activeShadowGeoJSON = EMPTY_FC;
let shadowTimer = null;
let shadowJobId = 0;
let shadowCoverage = null;

let pickingListenersBound = false;

const PICK_LAYER_IDS = [
    'highlight-pick-backdrop',
    'highlight-pick-base-fill',
    'highlight-pick-hover-fill',
    'highlight-pick-selected-fill',
    'highlight-pick-outline'
];
const PICK_SOURCE_IDS = [
    'highlight-pick-world-src',
    'highlight-pick-base-src',
    'highlight-pick-hover-src',
    'highlight-pick-selected-src'
];

const SPOTLIGHT_LAYER_IDS = [
    'highlight-dim-mask',
    'highlight-shadow',
    'highlight-rim-glow',
    'highlight-border'
];
const SPOTLIGHT_SOURCE_IDS = [
    'highlight-dim-src',
    'highlight-outline-src',
    'highlight-shadow-src'
];

export function setHighlightStatusCallback(cb) {
    statusChangeCallback = cb;
}

export function isHighlightPickingActive() {
    return isPicking;
}

export function getHighlightStatus() {
    return {
        isActive: Boolean(activeOutlineGeoJSON && activeOutlineGeoJSON.features.length > 0),
        count: selectedFeaturesMap.size,
        isPicking
    };
}

function notifyStatusChange() {
    if (typeof statusChangeCallback === 'function') {
        statusChangeCallback(getHighlightStatus());
    }
}

function getFeatureDisplayName(props = {}, category) {
    return props.NAME || props.name || props.ADMIN || props.name_en || props.NAME_EN || REGION_CONFIG[category]?.label || 'Region';
}

function normalizeGeoJSON(rawData, category) {
    const features = [];
    const byKey = {};

    (rawData?.features || []).forEach((f, idx) => {
        if (!f || !f.geometry) return;
        const gType = f.geometry.type;
        if (gType !== 'Polygon' && gType !== 'MultiPolygon') return;

        const key = `${category}:${idx}`;
        const cleanFeature = {
            type: 'Feature',
            properties: {
                ...(f.properties || {}),
                _hlKey: key,
                _hlCategory: category,
                _hlName: getFeatureDisplayName(f.properties, category)
            },
            geometry: f.geometry
        };

        features.push(cleanFeature);
        byKey[key] = cleanFeature;
    });

    return {
        fc: { type: 'FeatureCollection', features },
        byKey
    };
}

async function loadRegionCategory(category) {
    if (regionCache[category]) return regionCache[category];
    const cfg = REGION_CONFIG[category];
    if (!cfg) throw new Error(`Unknown region type: ${category}`);

    showToast(`Loading ${cfg.label} boundaries...`);
    try {
        const resp = await fetch(cfg.url);
        if (!resp.ok) throw new Error(`Failed to fetch ${cfg.label} boundaries (${resp.status})`);
        const data = await resp.json();

        let combinedFeatures = data.features || [];

        if (cfg.extraUrl) {
            try {
                const extraResp = await fetch(cfg.extraUrl);
                if (extraResp.ok) {
                    const extraData = await extraResp.json();
                    if (Array.isArray(extraData.features)) {
                        combinedFeatures = combinedFeatures.concat(extraData.features);
                    }
                }
            } catch (e) {}
        }

        const normalized = normalizeGeoJSON({ type: 'FeatureCollection', features: combinedFeatures }, category);
        regionCache[category] = normalized;
        return normalized;
    } finally {
        hideToast();
    }
}

function getSelectedFeatureCollection() {
    return {
        type: 'FeatureCollection',
        features: Array.from(selectedFeaturesMap.values())
    };
}

function removeLayersAndSources(map, layerIds, sourceIds) {
    if (!map || !map.getStyle()) return;
    layerIds.forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    sourceIds.forEach((id) => {
        if (map.getSource(id)) map.removeSource(id);
    });
}

function getActivePickingFeatures() {
    if (!currentPickTarget || !regionCache[currentPickTarget]) return EMPTY_FC;
    return regionCache[currentPickTarget].fc;
}

function updatePickingSources(updateBase = false) {
    if (!mapRef || !isPicking) return;

    // 🌟 ONLY re-parse the giant world boundary dataset when switching categories, NEVER on clicks!
    if (updateBase) {
        const baseSrc = mapRef.getSource('highlight-pick-base-src');
        if (baseSrc) {
            baseSrc.setData(getActivePickingFeatures());
        }
    }

    const selSrc = mapRef.getSource('highlight-pick-selected-src');
    if (selSrc) {
        selSrc.setData(getSelectedFeatureCollection());
    }

    const hoverSrc = mapRef.getSource('highlight-pick-hover-src');
    if (hoverSrc) {
        if (hoveredKey) {
            const cat = hoveredKey.split(':')[0];
            const feat = regionCache[cat]?.byKey[hoveredKey];
            hoverSrc.setData(feat ? { type: 'FeatureCollection', features: [feat] } : EMPTY_FC);
        } else {
            hoverSrc.setData(EMPTY_FC);
        }
    }

    updatePickingBarUI();
}

function mountPickingLayers() {
    if (!mapRef || !mapRef.getStyle()) return;

    removeLayersAndSources(mapRef, SPOTLIGHT_LAYER_IDS, SPOTLIGHT_SOURCE_IDS);
    removeLayersAndSources(mapRef, PICK_LAYER_IDS, PICK_SOURCE_IDS);

    mapRef.addSource('highlight-pick-world-src', { type: 'geojson', data: WORLD_FC });
    mapRef.addSource('highlight-pick-base-src', { type: 'geojson', data: getActivePickingFeatures() });
    mapRef.addSource('highlight-pick-hover-src', { type: 'geojson', data: EMPTY_FC });
    mapRef.addSource('highlight-pick-selected-src', { type: 'geojson', data: getSelectedFeatureCollection() });

    mapRef.addLayer({
        id: 'highlight-pick-backdrop',
        type: 'fill',
        source: 'highlight-pick-world-src',
        paint: {
            'fill-color': '#555b66',
            'fill-opacity': 1
        }
    });

    mapRef.addLayer({
        id: 'highlight-pick-base-fill',
        type: 'fill',
        source: 'highlight-pick-base-src',
        paint: {
            'fill-color': '#6d7482',
            'fill-opacity': 0.92
        }
    });

    mapRef.addLayer({
        id: 'highlight-pick-hover-fill',
        type: 'fill',
        source: 'highlight-pick-hover-src',
        paint: {
            'fill-color': '#ffffff',
            'fill-opacity': 0.28
        }
    });

    mapRef.addLayer({
        id: 'highlight-pick-selected-fill',
        type: 'fill',
        source: 'highlight-pick-selected-src',
        paint: {
            'fill-color': '#ffffff',
            'fill-opacity': 1
        }
    });

    mapRef.addLayer({
        id: 'highlight-pick-outline',
        type: 'line',
        source: 'highlight-pick-base-src',
        paint: {
            'line-color': '#1f2937',
            'line-width': currentPickTarget === 'county' ? 0.65 : 1.1,
            'line-opacity': 0.9
        }
    });
}

function updatePickingOutlineWidth() {
    if (!mapRef || !mapRef.getLayer('highlight-pick-outline')) return;
    mapRef.setPaintProperty('highlight-pick-outline', 'line-width', currentPickTarget === 'county' ? 0.65 : 1.1);
}

function handlePickMouseMove(e) {
    if (!isPicking || !mapRef || !mapRef.getLayer('highlight-pick-base-fill')) return;

    const hits = mapRef.queryRenderedFeatures(e.point, { layers: ['highlight-pick-base-fill'] });
    const nextKey = hits?.[0]?.properties?._hlKey || null;

    mapRef.getCanvas().style.cursor = nextKey ? 'pointer' : '';

    if (nextKey !== hoveredKey) {
        hoveredKey = nextKey;
        const hoverSrc = mapRef.getSource('highlight-pick-hover-src');
        if (hoverSrc) {
            if (hoveredKey) {
                const cat = hoveredKey.split(':')[0];
                const feat = regionCache[cat]?.byKey[hoveredKey];
                hoverSrc.setData(feat ? { type: 'FeatureCollection', features: [feat] } : EMPTY_FC);
            } else {
                hoverSrc.setData(EMPTY_FC);
            }
        }
    }
}

function handlePickClick(e) {
    if (!isPicking || !mapRef || !mapRef.getLayer('highlight-pick-base-fill')) return;

    const hits = mapRef.queryRenderedFeatures(e.point, { layers: ['highlight-pick-base-fill'] });
    const key = hits?.[0]?.properties?._hlKey;
    if (!key) return;

    const cat = key.split(':')[0];
    const fullFeature = regionCache[cat]?.byKey[key];
    if (!fullFeature) return;

    if (selectedFeaturesMap.has(key)) {
        selectedFeaturesMap.delete(key);
    } else {
        selectedFeaturesMap.set(key, fullFeature);
    }

    updatePickingSources();
}

function bindPickingMapListeners() {
    if (!mapRef || pickingListenersBound) return;
    mapRef.on('mousemove', handlePickMouseMove);
    mapRef.on('click', handlePickClick);
    pickingListenersBound = true;
}

function setEditorChromeHiddenForPicking(hidden) {
    const editorBtn = document.getElementById('btn-basemap-editor');
    const editorPanel = document.getElementById('basemap-editor-panel');
    if (editorBtn) {
        editorBtn.style.display = hidden ? 'none' : '';
    }
    if (editorPanel && hidden) {
        editorPanel.classList.remove('open');
        editorPanel.setAttribute('aria-hidden', 'true');
        if (editorBtn) {
            editorBtn.classList.remove('active');
            editorBtn.setAttribute('aria-expanded', 'false');
        }
    }
}

function unionFeatures(features) {
    const turf = window.turf;
    if (features.length === 1) return features[0];
    try {
        return turf.union(turf.featureCollection(features)) || features[0];
    } catch (err) {
        let merged = features[0];
        for (let i = 1; i < features.length; i++) {
            try {
                const next = turf.union(turf.featureCollection([merged, features[i]]));
                if (next) merged = next;
            } catch (e) {}
        }
        return merged;
    }
}

const DEG = Math.PI / 180;
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

function latToMercY(lat) {
    const c = Math.max(-85.0511, Math.min(85.0511, lat));
    return Math.log(Math.tan(Math.PI / 4 + (c * DEG) / 2)) / DEG;
}

function mercYToLat(y) {
    return (2 * Math.atan(Math.exp(y * DEG)) - Math.PI / 2) / DEG;
}

// Shift a polygon by a fixed number of SCREEN pixels. Done in Mercator space so the shadow
// looks the same size at every latitude. (dyMercDeg > 0 moves it down the screen)
function translateFeature(feature, dxDeg, dyMercDeg) {
    const mapRing = (ring) => ring.map(([lon, lat]) => [lon + dxDeg, mercYToLat(latToMercY(lat) - dyMercDeg)]);
    const g = feature.geometry;
    const coordinates = g.type === 'Polygon'
        ? g.coordinates.map(mapRing)
        : g.coordinates.map((poly) => poly.map(mapRing));
    return { type: 'Feature', properties: {}, geometry: { type: g.type, coordinates } };
}

// Bundle non-overlapping polygons (land, or ocean + lakes) into one feature without a slow union
function combineAsMultiPolygon(features) {
    const polys = [];
    features.forEach((f) => {
        const g = f.geometry;
        if (g.type === 'Polygon') polys.push(g.coordinates);
        else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => polys.push(p));
    });
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } };
}

// Keep only the parts of the shape near the viewport (cheap, no boolean ops)
function clipToBBox(feature, bbox) {
    const turf = window.turf;
    const g = feature.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const [minX, minY, maxX, maxY] = bbox;
    const out = [];

    for (const rings of polys) {
        const outer = rings[0];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < outer.length; i++) {
            const x = outer[i][0];
            const y = outer[i][1];
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
        if (x1 < minX || x0 > maxX || y1 < minY || y0 > maxY) continue;                      // fully outside
        if (x0 >= minX && x1 <= maxX && y0 >= minY && y1 <= maxY) { out.push(rings); continue; } // fully inside
        try {
            const clipped = turf.bboxClip(turf.polygon(rings), bbox);
            const c = clipped.geometry.coordinates;
            if (c.length > 0 && c[0].length >= 4) out.push(c);
        } catch (e) {}
    }

    if (out.length === 0) return null;
    return {
        type: 'Feature',
        properties: {},
        geometry: out.length === 1
            ? { type: 'Polygon', coordinates: out[0] }
            : { type: 'MultiPolygon', coordinates: out }
    };
}

// Builds the shadow in the background, one small step per task, so the UI never freezes
async function rebuildShadowGeometry() {
    const jobId = ++shadowJobId;
    const turf = window.turf;
    if (!turf || !activeShadowBase || !mapRef) return;
    const map = mapRef;

    const commit = (features, coverage) => {
        activeShadowGeoJSON = { type: 'FeatureCollection', features };
        shadowCoverage = coverage;
        const src = mapRef && mapRef.getSource('highlight-shadow-src');
        if (src) src.setData(activeShadowGeoJSON);
    };

    // 1 screen pixel in degrees at this zoom (MapLibre/Mapbox world = 512 * 2^zoom px)
    const zoom = map.getZoom();
    const degPerPx = 360 / (512 * Math.pow(2, zoom));
    const dxDeg = SHADOW_PX[0] * degPerPx;
    const dyDeg = SHADOW_PX[1] * degPerPx;

    // Only build the shadow for the viewport plus some padding
    const b = map.getBounds();
    const cosLat = Math.max(0.1, Math.cos(map.getCenter().lat * DEG));
    const padX = (b.getEast() - b.getWest()) * SHADOW_VIEW_PAD + dxDeg * 4;
    const padY = (b.getNorth() - b.getSouth()) * SHADOW_VIEW_PAD + dyDeg * cosLat * 4;
    const bbox = [
        Math.max(-180, b.getWest() - padX),
        Math.max(-85.05, b.getSouth() - padY),
        Math.min(180, b.getEast() + padX),
        Math.min(85.05, b.getNorth() + padY)
    ];
    const coverage = { bbox, zoom };

    let base = clipToBBox(activeShadowBase, bbox);
    if (!base) {
        commit([], coverage);
        return;
    }

    await nextTask();
    if (jobId !== shadowJobId) return;

    // Simplify to ~half a pixel. Any tiny mismatch with the real border is hidden under the white border line.
    try {
        base = turf.simplify(base, { tolerance: degPerPx * SHADOW_SIMPLIFY_PX, highQuality: false });
    } catch (e) {}

    const pieces = [];
    for (let i = 1; i <= SHADOW_STEPS; i++) {
        await nextTask();
        if (jobId !== shadowJobId) return;
        try {
            const shifted = translateFeature(base, dxDeg * i / SHADOW_STEPS, dyDeg * i / SHADOW_STEPS);
            // shifted minus the highlight => can only exist OUTSIDE the highlight
            const piece = turf.difference(turf.featureCollection([shifted, base]));
            if (piece) pieces.push(piece);
        } catch (e) {}
    }

    if (jobId !== shadowJobId) return;
    commit(pieces, coverage);
}

function scheduleShadowRebuild(delay = SHADOW_DEBOUNCE_MS) {
    clearTimeout(shadowTimer);
    if (!activeShadowBase) return;
    shadowTimer = setTimeout(rebuildShadowGeometry, delay);
}

// True if the shadow we already built still covers what's on screen at the same zoom
function viewStillCovered() {
    if (!shadowCoverage || !mapRef) return false;
    if (Math.abs(mapRef.getZoom() - shadowCoverage.zoom) > 0.01) return false;
    const b = mapRef.getBounds();
    const [w, s, e, n] = shadowCoverage.bbox;
    return Math.max(-180, b.getWest()) >= w
        && Math.min(180, b.getEast()) <= e
        && Math.max(-85.05, b.getSouth()) >= s
        && Math.min(85.05, b.getNorth()) <= n;
}

function buildSpotlightGeometry() {
    const selected = Array.from(selectedFeaturesMap.values());
    activeShadowBase = null;
    activeShadowGeoJSON = EMPTY_FC;
    shadowCoverage = null;
    shadowJobId++;

    if (selected.length === 0) {
        activeDimMaskGeoJSON = null;
        activeOutlineGeoJSON = null;
        return;
    }

    if (typeof window.turf === 'undefined') {
        activeOutlineGeoJSON = { type: 'FeatureCollection', features: selected };
        activeDimMaskGeoJSON = EMPTY_FC;
        return;
    }

    const turf = window.turf;
    const worldPoly = turf.polygon([WORLD_RING]);

    // Fast path if all Land or all Water was selected
    const landCount = regionCache.land?.fc?.features?.length || 0;
    const waterCount = regionCache.water?.fc?.features?.length || 0;
    const selectedLandCount = selected.filter(f => f.properties._hlCategory === 'land').length;
    const selectedWaterCount = selected.filter(f => f.properties._hlCategory === 'water').length;

    const allLand = landCount > 0 && selectedLandCount === landCount && selected.length === landCount && regionCache.water;
    const allWater = waterCount > 0 && selectedWaterCount === waterCount && selected.length === waterCount && regionCache.land;

    if (allLand || allWater) {
        activeOutlineGeoJSON = allLand ? regionCache.land.fc : regionCache.water.fc;
        activeDimMaskGeoJSON = allLand ? regionCache.water.fc : regionCache.land.fc;
        // These polygons don't overlap, so skip the slow union and just bundle them together
        activeShadowBase = combineAsMultiPolygon(selected);
        return;
    }

    const merged = unionFeatures(selected);

    let dimMask = null;
    try {
        dimMask = turf.difference(turf.featureCollection([worldPoly, merged]));
    } catch (err) {
        dimMask = null;
    }

    activeOutlineGeoJSON = { type: 'FeatureCollection', features: [merged] };
    activeDimMaskGeoJSON = dimMask ? { type: 'FeatureCollection', features: [dimMask] } : EMPTY_FC;

    activeShadowBase = merged;
}

export function applyHighlightLayers(map = mapRef) {
    if (!map) return;
    mapRef = map;

    if (!map.getStyle()) return;

    if (isPicking) {
        mountPickingLayers();
        return;
    }

    removeLayersAndSources(map, PICK_LAYER_IDS, PICK_SOURCE_IDS);
    removeLayersAndSources(map, SPOTLIGHT_LAYER_IDS, SPOTLIGHT_SOURCE_IDS);

    if (!activeOutlineGeoJSON || !activeDimMaskGeoJSON || activeOutlineGeoJSON.features.length === 0) {
        return;
    }

    map.addSource('highlight-dim-src', { type: 'geojson', data: activeDimMaskGeoJSON });
    map.addSource('highlight-outline-src', { type: 'geojson', data: activeOutlineGeoJSON });
    map.addSource('highlight-shadow-src', { type: 'geojson', data: activeShadowGeoJSON });

    // Dim everything outside the selected regions
    map.addLayer({
        id: 'highlight-dim-mask',
        type: 'fill',
        source: 'highlight-dim-src',
        paint: {
            'fill-color': '#020612',
            'fill-opacity': 0.65
        }
    });

    // Drop shadow: geometry that exists only outside the highlight
    map.addLayer({
        id: 'highlight-shadow',
        type: 'fill',
        source: 'highlight-shadow-src',
        paint: {
            'fill-color': '#000000',
            'fill-opacity': SHADOW_STEP_OPACITY,
            'fill-antialias': false
        }
    });

    // Subtle outer glow
    map.addLayer({
        id: 'highlight-rim-glow',
        type: 'line',
        source: 'highlight-outline-src',
        layout: {
            'line-cap': 'round',
            'line-join': 'round'
        },
        paint: {
            'line-color': 'rgba(255, 255, 255, 0.45)',
            'line-width': 4,
            'line-blur': 2.5
        }
    });

    // Crisp highlighted perimeter edge
    map.addLayer({
        id: 'highlight-border',
        type: 'line',
        source: 'highlight-outline-src',
        layout: {
            'line-cap': 'round',
            'line-join': 'round'
        },
        paint: {
            'line-color': '#ffffff',
            'line-width': 1.75,
            'line-opacity': 0.95
        }
    });
}

export function clearHighlightOverlay() {
    selectedFeaturesMap.clear();
    activeDimMaskGeoJSON = null;
    activeOutlineGeoJSON = null;
    activeShadowBase = null;
    activeShadowGeoJSON = EMPTY_FC;
    clearTimeout(shadowTimer);
    shadowJobId++;
    shadowCoverage = null;
    hoveredKey = null;

    if (isPicking) {
        finishPickingMode(false);
    } else if (mapRef) {
        removeLayersAndSources(mapRef, SPOTLIGHT_LAYER_IDS, SPOTLIGHT_SOURCE_IDS);
    }

    notifyStatusChange();
}

async function startPickingMode(categories) {
    if (!mapRef || !Array.isArray(categories) || categories.length === 0) return;

    snapshotBeforePick = {
        features: Array.from(selectedFeaturesMap.entries()),
        dimMask: activeDimMaskGeoJSON,
        outline: activeOutlineGeoJSON,
        shadowBase: activeShadowBase,
        shadow: activeShadowGeoJSON
    };

    activePickCategories = categories;
    currentPickTarget = categories[0];
    hoveredKey = null;

    try {
        await Promise.all(categories.map((cat) => loadRegionCategory(cat)));
        if (categories.includes('land') && !regionCache.water) {
            loadRegionCategory('water').catch(() => {});
        }
        if (categories.includes('water') && !regionCache.land) {
            loadRegionCategory('land').catch(() => {});
        }
    } catch (err) {
        showToast(`❌ ${err.message}`);
        return;
    }

    isPicking = true;
    bindPickingMapListeners();
    setEditorChromeHiddenForPicking(true);
    mountPickingLayers();
    showPickingBarUI();
    updatePickingBarUI();
    notifyStatusChange();
}

function finishPickingMode(applyChanges = true) {
    isPicking = false;
    hoveredKey = null;

    if (mapRef) {
        mapRef.getCanvas().style.cursor = '';
        removeLayersAndSources(mapRef, PICK_LAYER_IDS, PICK_SOURCE_IDS);
    }

    hidePickingBarUI();
    setEditorChromeHiddenForPicking(false);

    if (!applyChanges && snapshotBeforePick) {
        selectedFeaturesMap.clear();
        snapshotBeforePick.features.forEach(([k, v]) => selectedFeaturesMap.set(k, v));
        activeDimMaskGeoJSON = snapshotBeforePick.dimMask;
        activeOutlineGeoJSON = snapshotBeforePick.outline;
        activeShadowBase = snapshotBeforePick.shadowBase;
        activeShadowGeoJSON = snapshotBeforePick.shadow;
    } else if (applyChanges) {
        buildSpotlightGeometry();
    }

    snapshotBeforePick = null;
    applyHighlightLayers(mapRef);
    scheduleShadowRebuild(0);
    notifyStatusChange();
}

/* =========================================================================
   UI CREATION: MODAL & TOP-RIGHT PICKING BAR
   ========================================================================= */

function ensureHighlightUI() {
    if (!document.getElementById('highlight-type-modal')) {
        const modal = document.createElement('div');
        modal.id = 'highlight-type-modal';
        modal.className = 'highlight-modal-backdrop';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="highlight-modal-card" role="dialog" aria-modal="true" aria-labelledby="highlight-modal-title">
                <div class="highlight-modal-header">
                    <span id="highlight-modal-title" class="highlight-modal-title">Pick type of region to highlight</span>
                    <button id="btn-close-highlight-modal" class="ctrl-btn close-btn" type="button" aria-label="Close">✕</button>
                </div>
                <div class="highlight-modal-body">
                    <div class="highlight-type-grid">
                        <button type="button" class="highlight-type-btn" data-region-type="country">Country</button>
                        <button type="button" class="highlight-type-btn" data-region-type="state">State / Province</button>
                        <button type="button" class="highlight-type-btn" data-region-type="county">County</button>
                        <button type="button" class="highlight-type-btn" data-region-type="land">Land</button>
                        <button type="button" class="highlight-type-btn" data-region-type="water">Water</button>
                        <button type="button" id="btn-highlight-multiple" class="highlight-type-btn is-multiple">Multiple</button>
                    </div>

                    <div id="highlight-multiple-box" class="highlight-multiple-box" style="display: none;">
                        <div class="highlight-multiple-title">Select categories to pick from:</div>
                        <div class="highlight-multiple-list">
                            ${CATEGORY_ORDER.map((id) => `
                                <label class="basemap-checkbox-label">
                                    <input type="checkbox" class="basemap-checkbox highlight-multi-cb" value="${id}" />
                                    <span>${REGION_CONFIG[id].label}</span>
                                </label>
                            `).join('')}
                        </div>
                        <button type="button" id="btn-start-multi-highlight" class="highlight-start-multi-btn" disabled>
                            Start Selecting
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeModal = () => {
            modal.style.display = 'none';
        };

        document.getElementById('btn-close-highlight-modal')?.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        modal.querySelectorAll('.highlight-type-btn[data-region-type]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.regionType;
                closeModal();
                startPickingMode([type]);
            });
        });

        const multiBtn = document.getElementById('btn-highlight-multiple');
        const multiBox = document.getElementById('highlight-multiple-box');
        const startMultiBtn = document.getElementById('btn-start-multi-highlight');
        const multiCbs = modal.querySelectorAll('.highlight-multi-cb');

        if (multiBtn && multiBox) {
            multiBtn.addEventListener('click', () => {
                const isOpen = multiBox.style.display === 'flex';
                multiBox.style.display = isOpen ? 'none' : 'flex';
                multiBtn.classList.toggle('active', !isOpen);
            });
        }

        multiCbs.forEach((cb) => {
            cb.addEventListener('change', () => {
                const anyChecked = Array.from(multiCbs).some((c) => c.checked);
                if (startMultiBtn) startMultiBtn.disabled = !anyChecked;
            });
        });

        if (startMultiBtn) {
            startMultiBtn.addEventListener('click', () => {
                const chosen = Array.from(multiCbs).filter((c) => c.checked).map((c) => c.value);
                if (chosen.length === 0) return;
                closeModal();
                startPickingMode(chosen);
            });
        }
    }

    if (!document.getElementById('highlight-picking-bar')) {
        const bar = document.createElement('div');
        bar.id = 'highlight-picking-bar';
        bar.className = 'highlight-picking-bar';
        bar.style.display = 'none';
        bar.innerHTML = `
            <div id="highlight-pick-tabs" class="highlight-pick-tabs"></div>
            <span id="highlight-pick-count" class="highlight-pick-count">0 selected</span>
            <button id="btn-highlight-select-all" class="highlight-bar-btn" type="button" style="display: none;">Select All</button>
            <button id="btn-highlight-clear-pick" class="highlight-bar-btn" type="button">Clear</button>
            <button id="btn-highlight-cancel" class="highlight-bar-btn" type="button">Cancel</button>
            <button id="btn-highlight-done" class="highlight-bar-done-btn" type="button">Done</button>
        `;
        document.body.appendChild(bar);

        document.getElementById('btn-highlight-select-all')?.addEventListener('click', () => {
            if (!currentPickTarget || !regionCache[currentPickTarget]) return;
            regionCache[currentPickTarget].fc.features.forEach((feat) => {
                selectedFeaturesMap.set(feat.properties._hlKey, feat);
            });
            updatePickingSources();
        });

        document.getElementById('btn-highlight-clear-pick')?.addEventListener('click', () => {
            selectedFeaturesMap.clear();
            updatePickingSources();
        });

        document.getElementById('btn-highlight-cancel')?.addEventListener('click', () => {
            finishPickingMode(false);
        });

        document.getElementById('btn-highlight-done')?.addEventListener('click', () => {
            finishPickingMode(true);
        });
    }
}

function showPickingBarUI() {
    ensureHighlightUI();
    const bar = document.getElementById('highlight-picking-bar');
    if (bar) bar.style.display = 'flex';
}

function hidePickingBarUI() {
    const bar = document.getElementById('highlight-picking-bar');
    if (bar) bar.style.display = 'none';
}

function updatePickingBarUI() {
    const tabsEl = document.getElementById('highlight-pick-tabs');
    const countEl = document.getElementById('highlight-pick-count');
    const selectAllBtn = document.getElementById('btn-highlight-select-all');

    if (tabsEl) {
        if (activePickCategories.length > 1) {
            tabsEl.innerHTML = activePickCategories.map((cat) => `
                <button
                    type="button"
                    class="highlight-pick-tab ${cat === currentPickTarget ? 'active' : ''}"
                    data-pick-cat="${cat}"
                >${REGION_CONFIG[cat].label}</button>
            `).join('');

            tabsEl.querySelectorAll('.highlight-pick-tab').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const nextCat = btn.dataset.pickCat;
                    if (!nextCat || nextCat === currentPickTarget) return;
                    currentPickTarget = nextCat;
                    hoveredKey = null;
                    updatePickingOutlineWidth();
                    updatePickingSources(true);
                });
            });
        } else if (currentPickTarget) {
            tabsEl.innerHTML = `<span class="highlight-pick-single-label">Picking: ${REGION_CONFIG[currentPickTarget].label}</span>`;
        }
    }

    if (countEl) {
        countEl.textContent = `${selectedFeaturesMap.size} selected`;
    }

    if (selectAllBtn) {
        selectAllBtn.style.display = (currentPickTarget === 'land' || currentPickTarget === 'water') ? '' : 'none';
    }
}

export function openHighlightTypeModal(map = mapRef) {
    if (map) mapRef = map;
    ensureHighlightUI();

    const modal = document.getElementById('highlight-type-modal');
    const multiBox = document.getElementById('highlight-multiple-box');
    const multiBtn = document.getElementById('btn-highlight-multiple');
    if (multiBox) multiBox.style.display = 'none';
    if (multiBtn) multiBtn.classList.remove('active');

    if (modal) {
        modal.querySelectorAll('.highlight-multi-cb').forEach((cb) => {
            cb.checked = false;
        });
        const startBtn = document.getElementById('btn-start-multi-highlight');
        if (startBtn) startBtn.disabled = true;
        modal.style.display = 'flex';
    }
}

export function initHighlightOverlay(map) {
    mapRef = map;
    ensureHighlightUI();

    // Rebuild the shadow after panning/zooming (only if the view left the area it was built for)
    map.on('moveend', () => {
        if (isPicking || !activeShadowBase || viewStillCovered()) return;
        scheduleShadowRebuild();
    });
}
