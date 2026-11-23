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

// Drop shadow settings. The shadow is drawn on a small overlay canvas (Canvas 2D can clip natively),
// and it is clipped so it can NEVER be drawn over the highlighted area.
const SHADOW_OFFSET_PX = [4, 5];            // direction/size of the shadow (right, down)
const SHADOW_BLUR_PX = 10;                  // softness
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.8)';  // strength

const RAD = Math.PI / 180;
const DENSIFY_STEP = 0.0015; // long straight edges are split into pieces this long (Mercator units, ~0.5° of longitude)

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

let pickingListenersBound = false;

let shadowCanvas = null;
let shadowCtx = null;
let shadowShapes = [];      // [{ bbox, rings: [Float64Array xy], xyz: null, cap: null }] in Mercator 0..1 units
let shadowRenderKey = '';

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
    'highlight-rim-glow',
    'highlight-border'
];
const SPOTLIGHT_SOURCE_IDS = [
    'highlight-dim-src',
    'highlight-outline-src'
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

function buildSpotlightGeometry() {
    const selected = Array.from(selectedFeaturesMap.values());
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

    if (landCount > 0 && selectedLandCount === landCount && selected.length === landCount && regionCache.water) {
        activeOutlineGeoJSON = regionCache.land.fc;
        activeDimMaskGeoJSON = regionCache.water.fc;
        return;
    }
    if (waterCount > 0 && selectedWaterCount === waterCount && selected.length === waterCount && regionCache.land) {
        activeOutlineGeoJSON = regionCache.water.fc;
        activeDimMaskGeoJSON = regionCache.land.fc;
        return;
    }

    let merged = selected[0];
    if (selected.length > 1) {
        try {
            merged = turf.union(turf.featureCollection(selected)) || selected[0];
        } catch (err) {
            merged = selected[0];
            for (let i = 1; i < selected.length; i++) {
                try {
                    const next = turf.union(turf.featureCollection([merged, selected[i]]));
                    if (next) merged = next;
                } catch (e) {}
            }
        }
    }

    let dimMask = null;
    try {
        dimMask = turf.difference(turf.featureCollection([worldPoly, merged]));
    } catch (err) {
        dimMask = null;
    }

    activeOutlineGeoJSON = { type: 'FeatureCollection', features: [merged] };
    activeDimMaskGeoJSON = dimMask ? { type: 'FeatureCollection', features: [dimMask] } : EMPTY_FC;
}

/* =========================================================================
   DROP SHADOW (overlay canvas, clipped so it never touches the highlight)

   Works on the flat map (fast Mercator math, with perspective 3D projection when tilted)
   and on the 3D globe (perspective-sphere model, with fallback to camera projection).
   ========================================================================= */

function lngToMercX(lng) {
    return (lng + 180) / 360;
}

function latToMercY(lat) {
    const c = Math.max(-85.0511, Math.min(85.0511, lat));
    return 0.5 - Math.log(Math.tan(Math.PI / 4 + (c * Math.PI) / 360)) / (2 * Math.PI);
}

function mercToLng(x) {
    return x * 360 - 180;
}

function mercToLat(y) {
    const rad = 2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2;
    return (rad * 180) / Math.PI;
}

function ensureShadowCanvas() {
    if (shadowCanvas || !mapRef) return;
    shadowCanvas = document.createElement('canvas');
    shadowCanvas.id = 'highlight-shadow-canvas';
    shadowCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;display:none;';
    mapRef.getCanvasContainer().appendChild(shadowCanvas);
    shadowCtx = shadowCanvas.getContext('2d');
    mapRef.on('render', () => drawShadow());
}

// Converts a ring of [lng, lat] to Mercator x,y. Long straight edges are split into short pieces so
// they still follow the curve of the globe or perspective pitch.
function densifyRing(ring) {
    const out = [];
    let px = 0;
    let py = 0;
    for (let i = 0; i < ring.length; i++) {
        const x = lngToMercX(ring[i][0]);
        const y = latToMercY(ring[i][1]);
        if (i > 0) {
            const m = Math.max(Math.abs(x - px), Math.abs(y - py));
            if (m > DENSIFY_STEP) {
                const steps = Math.ceil(m / DENSIFY_STEP);
                for (let k = 1; k < steps; k++) {
                    const t = k / steps;
                    out.push(px + (x - px) * t, py + (y - py) * t);
                }
            }
        }
        out.push(x, y);
        px = x;
        py = y;
    }
    return Float64Array.from(out);
}

// Converts the highlighted shapes once, so redrawing is cheap
function rebuildShadowShapes() {
    shadowShapes = [];
    shadowRenderKey = '';

    const features = activeOutlineGeoJSON?.features || [];
    features.forEach((f) => {
        const g = f.geometry;
        if (!g) return;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];

        polys.forEach((poly) => {
            const rings = poly.map(densifyRing);

            const outer = rings[0];
            if (!outer || outer.length < 6) return;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < outer.length; i += 2) {
                if (outer[i] < minX) minX = outer[i];
                if (outer[i] > maxX) maxX = outer[i];
                if (outer[i + 1] < minY) minY = outer[i + 1];
                if (outer[i + 1] > maxY) maxY = outer[i + 1];
            }
            shadowShapes.push({ bbox: [minX, minY, maxX, maxY], rings, xyz: null, cap: null });
        });
    });

    ensureShadowCanvas();
    drawShadow(true);
}

/* ---------- flat map (Mercator - untilted fast path) ---------- */

function makeFlatView(cw, ch, center, bearing, zoom) {
    const rad = bearing * RAD;
    return {
        worldSize: 512 * Math.pow(2, zoom),
        cx: lngToMercX(center.lng),
        cy: latToMercY(center.lat),
        cos: Math.cos(rad),
        sin: Math.sin(rad),
        hw: cw / 2,
        hh: ch / 2
    };
}

function flatPoint(v, mx, my) {
    const dx = (mx - v.cx) * v.worldSize;
    const dy = (my - v.cy) * v.worldSize;
    return [v.hw + dx * v.cos + dy * v.sin, v.hh - dx * v.sin + dy * v.cos];
}

// True if the map currently draws like an untilted flat Mercator map
function isFlatProjection(map, view, cw, ch) {
    if (map.getPitch() >= 0.01) return false;
    const probes = [[0.3, 0.3], [0.7, 0.35], [0.5, 0.75]];
    for (const [fx, fy] of probes) {
        try {
            const sx = cw * fx;
            const sy = ch * fy;
            const ll = map.unproject([sx, sy]);
            if (!ll || !isFinite(ll.lng) || !isFinite(ll.lat)) return false;
            const q = flatPoint(view, lngToMercX(ll.lng), latToMercY(ll.lat));
            if (!(Math.abs(q[0] - sx) < 1.5 && Math.abs(q[1] - sy) < 1.5)) return false;
        } catch (e) {
            return false;
        }
    }
    return true;
}

function buildFlatPaths(map, view, cw, ch) {
    const { worldSize, cx, cy, cos, sin, hw, hh } = view;

    const reach = (Math.hypot(cw, ch) / 2 + 60) / worldSize;
    const offsets = (typeof map.getRenderWorldCopies === 'function' ? map.getRenderWorldCopies() : true) ? [-1, 0, 1] : [0];

    const path = new Path2D();
    const addRing = (ring, off) => {
        let lastX = 0;
        let lastY = 0;
        let started = false;
        for (let i = 0; i < ring.length; i += 2) {
            const dx = (ring[i] + off - cx) * worldSize;
            const dy = (ring[i + 1] - cy) * worldSize;
            const x = hw + dx * cos + dy * sin;
            const y = hh - dx * sin + dy * cos;
            if (!started) {
                path.moveTo(x, y);
                started = true;
            } else {
                if (Math.abs(x - lastX) < 0.5 && Math.abs(y - lastY) < 0.5) continue;
                path.lineTo(x, y);
            }
            lastX = x;
            lastY = y;
        }
        path.closePath();
    };

    for (const shape of shadowShapes) {
        for (const off of offsets) {
            const b = shape.bbox;
            if (b[2] + off < cx - reach || b[0] + off > cx + reach || b[3] < cy - reach || b[1] > cy + reach) continue;
            for (const ring of shape.rings) addRing(ring, off);
        }
    }

    return { fill: path, stroke: path };
}

/* ---------- 🌟 3D perspective projection (for tilted maps & dynamic camera views) ---------- */

function buildProjectedPaths(map, cw, ch) {
    const fill = new Path2D();
    const stroke = new Path2D();

    const isGlobe = (map.getProjection ? map.getProjection()?.type === 'globe' : false);
    const offsets = (!isGlobe && (typeof map.getRenderWorldCopies === 'function' ? map.getRenderWorldCopies() : true))
        ? [-1, 0, 1]
        : [0];

    const pad = 140;

    for (const shape of shadowShapes) {
        for (const off of offsets) {
            for (const ring of shape.rings) {
                let started = false;
                let lastX = 0;
                let lastY = 0;
                let firstX = 0;
                let firstY = 0;
                let anyVisible = false;

                for (let i = 0; i < ring.length; i += 2) {
                    const mx = ring[i] + off;
                    const my = ring[i + 1];

                    const lng = mercToLng(mx);
                    const lat = mercToLat(my);

                    let pt;
                    try {
                        pt = map.project([lng, lat]);
                    } catch (e) {
                        continue;
                    }

                    if (!pt || !isFinite(pt.x) || !isFinite(pt.y)) continue;

                    const x = pt.x;
                    const y = pt.y;

                    if (x >= -pad && x <= cw + pad && y >= -pad && y <= ch + pad) {
                        anyVisible = true;
                    }

                    if (!started) {
                        fill.moveTo(x, y);
                        stroke.moveTo(x, y);
                        firstX = x;
                        firstY = y;
                        started = true;
                    } else {
                        if (Math.abs(x - lastX) < 0.5 && Math.abs(y - lastY) < 0.5) continue;
                        fill.lineTo(x, y);
                        stroke.lineTo(x, y);
                    }
                    lastX = x;
                    lastY = y;
                }

                if (started && anyVisible) {
                    fill.closePath();
                    stroke.lineTo(firstX, firstY);
                }
            }
        }
    }

    return { fill, stroke };
}

/* ---------- 3D globe (untilted fast path) ---------- */

function vecMix(a, b, theta) {
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    return [a[0] * ct + b[0] * st, a[1] * ct + b[1] * st, a[2] * ct + b[2] * st];
}

function vecToScreen(map, v) {
    const lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD;
    const lng = Math.atan2(v[1], v[0]) / RAD;
    return map.project([lng, lat]);
}

function projectWithModel(m, v) {
    const d = v[0] * m.c[0] + v[1] * m.c[1] + v[2] * m.c[2];
    const pr = v[0] * m.r[0] + v[1] * m.r[1] + v[2] * m.r[2];
    const pu = v[0] * m.u[0] + v[1] * m.u[1] + v[2] * m.u[2];
    const k = m.f / (m.s - d);
    return [m.px + pr * k, m.py - pu * k];
}

function fitGlobeModel(map, p0, c, r, u) {
    for (let th2 = 1.0, tries = 0; tries < 9; tries++, th2 *= 0.72) {
        const thA = th2 * 0.5;
        const thM = th2 * 0.75;
        const thB = th2;

        const A = vecToScreen(map, vecMix(c, r, thA)).x - p0.x;
        const M = vecToScreen(map, vecMix(c, r, thM)).x - p0.x;
        const B = vecToScreen(map, vecMix(c, r, thB)).x - p0.x;
        if (!(A > 0.5 && M > A + 0.2 && B > M + 0.2)) continue;

        const sa = Math.sin(thA);
        const ca = Math.cos(thA);
        const sb = Math.sin(thB);
        const cb = Math.cos(thB);
        const den = A * sb - B * sa;
        if (Math.abs(den) < 1e-9) continue;

        const s = (A * sb * ca - B * sa * cb) / den;
        if (!isFinite(s) || !(s > 1.0001)) continue;
        const f = (A * (s - ca)) / sa;
        if (!isFinite(f) || !(f > 0)) continue;

        const h = 1 / s;
        const model = {
            c, r, u, f, s, h,
            limbSin: Math.sqrt(Math.max(0, 1 - h * h)),
            px: p0.x,
            py: p0.y
        };

        const diag = [(r[0] + u[0]) * Math.SQRT1_2, (r[1] + u[1]) * Math.SQRT1_2, (r[2] + u[2]) * Math.SQRT1_2];
        const checks = [
            vecMix(c, r, thM),
            vecMix(c, u, th2 * 0.8),
            vecMix(c, r, -th2 * 0.6),
            vecMix(c, u, -th2 * 0.7),
            vecMix(c, diag, th2 * 0.7)
        ];
        let ok = true;
        for (const v of checks) {
            const q = projectWithModel(model, v);
            const actual = vecToScreen(map, v);
            if (!(Math.abs(q[0] - actual.x) < 2 && Math.abs(q[1] - actual.y) < 2)) {
                ok = false;
                break;
            }
        }
        if (ok) return model;
    }
    return null;
}

function buildGlobeModel(map, center, bearingDeg) {
    if (map.getPitch() >= 0.01) return null;

    const lam = center.lng * RAD;
    const phi = Math.max(-89.9, Math.min(89.9, center.lat)) * RAD;
    const cl = Math.cos(phi);
    const sl = Math.sin(phi);

    const c = [cl * Math.cos(lam), cl * Math.sin(lam), sl];
    const e = [-Math.sin(lam), Math.cos(lam), 0];
    const n = [-sl * Math.cos(lam), -sl * Math.sin(lam), cl];
    const p0 = map.project(center);

    for (const sign of [1, -1]) {
        const b = sign * bearingDeg * RAD;
        const cb = Math.cos(b);
        const sb = Math.sin(b);
        const r = [e[0] * cb - n[0] * sb, e[1] * cb - n[1] * sb, e[2] * cb - n[2] * sb];
        const u = [n[0] * cb + e[0] * sb, n[1] * cb + e[1] * sb, n[2] * cb + e[2] * sb];
        const model = fitGlobeModel(map, p0, c, r, u);
        if (model) return model;
    }
    return null;
}

function ensureShapeXYZ(shape) {
    if (shape.xyz) return;

    shape.xyz = shape.rings.map((ring) => {
        const n = ring.length / 2;
        const out = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) {
            const lng = ring[i * 2] * 2 * Math.PI - Math.PI;
            const lat = 2 * Math.atan(Math.exp(Math.PI * (1 - 2 * ring[i * 2 + 1]))) - Math.PI / 2;
            const cl = Math.cos(lat);
            out[i * 3] = cl * Math.cos(lng);
            out[i * 3 + 1] = cl * Math.sin(lng);
            out[i * 3 + 2] = Math.sin(lat);
        }
        return out;
    });

    const o = shape.xyz[0];
    const n = o.length / 3;
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) {
        mx += o[i * 3];
        my += o[i * 3 + 1];
        mz += o[i * 3 + 2];
    }
    const len = Math.hypot(mx, my, mz);
    if (len < 0.2 * n) {
        shape.cap = null;
        return;
    }
    const ax = mx / len, ay = my / len, az = mz / len;
    let minDot = 1;
    for (let i = 0; i < n; i++) {
        const d = o[i * 3] * ax + o[i * 3 + 1] * ay + o[i * 3 + 2] * az;
        if (d < minDot) minDot = d;
    }
    shape.cap = { ax, ay, az, rad: Math.acos(Math.max(-1, Math.min(1, minDot))) };
}

function addGlobeRing(fill, stroke, ring, m) {
    const n = ring.length / 3;
    let started = false;
    let lastX = 0, lastY = 0, lastVis = false;
    let firstX = 0, firstY = 0, firstVis = false;

    for (let i = 0; i < n; i++) {
        const X = ring[i * 3];
        const Y = ring[i * 3 + 1];
        const Z = ring[i * 3 + 2];
        const d = X * m.c[0] + Y * m.c[1] + Z * m.c[2];
        const pr = X * m.r[0] + Y * m.r[1] + Z * m.r[2];
        const pu = X * m.u[0] + Y * m.u[1] + Z * m.u[2];
        const vis = d >= m.h;

        let x;
        let y;
        if (vis) {
            const k = m.f / (m.s - d);
            x = m.px + pr * k;
            y = m.py - pu * k;
        } else {
            const len = Math.hypot(pr, pu);
            if (len < 1e-9) continue;
            const k = (m.f * m.limbSin) / ((m.s - m.h) * len);
            x = m.px + pr * k;
            y = m.py - pu * k;
        }

        if (!started) {
            fill.moveTo(x, y);
            started = true;
            firstX = x;
            firstY = y;
            firstVis = vis;
            if (vis) stroke.moveTo(x, y);
        } else {
            if (vis === lastVis && Math.abs(x - lastX) < 0.5 && Math.abs(y - lastY) < 0.5) continue;
            fill.lineTo(x, y);
            if (vis) {
                if (lastVis) stroke.lineTo(x, y);
                else stroke.moveTo(x, y);
            }
        }
        lastX = x;
        lastY = y;
        lastVis = vis;
    }

    if (started) {
        fill.closePath();
        if (lastVis && firstVis) stroke.lineTo(firstX, firstY);
    }
}

function buildGlobePaths(model) {
    const fill = new Path2D();
    const stroke = new Path2D();
    const thetaH = Math.acos(model.h);

    for (const shape of shadowShapes) {
        ensureShapeXYZ(shape);
        const cap = shape.cap;
        if (cap) {
            const d = cap.ax * model.c[0] + cap.ay * model.c[1] + cap.az * model.c[2];
            const ang = Math.acos(Math.max(-1, Math.min(1, d)));
            if (ang - cap.rad > thetaH + 0.02) continue;
        }
        for (const ring of shape.xyz) addGlobeRing(fill, stroke, ring, model);
    }

    return { fill, stroke };
}

/* ---------- drawing ---------- */

function drawShadow(force = false) {
    const map = mapRef;
    if (!shadowCanvas || !shadowCtx || !map) return;

    const glCanvas = map.getCanvas();
    const cw = glCanvas.clientWidth;
    const ch = glCanvas.clientHeight;

    // 🌟 Pitch no longer blocks drawing!
    if (isPicking || shadowShapes.length === 0 || cw <= 0 || ch <= 0) {
        if (shadowCanvas.style.display !== 'none') shadowCanvas.style.display = 'none';
        shadowRenderKey = '';
        return;
    }

    const dpr = window.devicePixelRatio || 1;
    const center = map.getCenter();
    const zoom = map.getZoom();
    const bearing = map.getBearing();
    const pitch = map.getPitch();

    const probe = map.project([center.lng + 1, center.lat]);
    const key = [
        cw, ch, dpr,
        center.lng.toFixed(4), center.lat.toFixed(4),
        zoom.toFixed(2), bearing.toFixed(2), pitch.toFixed(2),
        probe.x.toFixed(1), probe.y.toFixed(1)
    ].join('|');

    if (!force && key === shadowRenderKey) return;
    shadowRenderKey = key;

    let paths = null;
    const isUntilted = pitch < 0.01;

    // Fast-path analytical calculations when untilted
    if (isUntilted) {
        const view = makeFlatView(cw, ch, center, bearing, zoom);
        if (isFlatProjection(map, view, cw, ch)) {
            paths = buildFlatPaths(map, view, cw, ch);
        } else {
            const model = buildGlobeModel(map, center, bearing);
            if (model) paths = buildGlobePaths(model);
        }
    }

    // 🌟 3D perspective projection when tilted / pitched
    if (!paths) {
        paths = buildProjectedPaths(map, cw, ch);
    }

    if (!paths) {
        if (shadowCanvas.style.display !== 'none') shadowCanvas.style.display = 'none';
        return;
    }
    shadowCanvas.style.display = 'block';

    const pw = Math.round(cw * dpr);
    const ph = Math.round(ch * dpr);
    if (shadowCanvas.width !== pw || shadowCanvas.height !== ph) {
        shadowCanvas.width = pw;
        shadowCanvas.height = ph;
    }
    shadowCanvas.style.width = `${cw}px`;
    shadowCanvas.style.height = `${ch}px`;

    const ctx = shadowCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clip = everything EXCEPT the highlighted area
    ctx.save();
    const clipPath = new Path2D();
    clipPath.rect(-100, -100, cw + 200, ch + 200);
    clipPath.addPath(paths.fill);
    ctx.clip(clipPath, 'evenodd');

    // Soft drop shadow outside the cutout
    ctx.shadowColor = SHADOW_COLOR;
    ctx.shadowBlur = SHADOW_BLUR_PX * dpr;
    ctx.shadowOffsetX = SHADOW_OFFSET_PX[0] * dpr;
    ctx.shadowOffsetY = SHADOW_OFFSET_PX[1] * dpr;
    ctx.fillStyle = '#000000';
    ctx.fill(paths.fill, 'evenodd');
    ctx.restore();

    // Redraw the crisp white border on top
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(paths.stroke);
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
    hoveredKey = null;

    if (isPicking) {
        finishPickingMode(false);
    } else if (mapRef) {
        removeLayersAndSources(mapRef, SPOTLIGHT_LAYER_IDS, SPOTLIGHT_SOURCE_IDS);
    }

    rebuildShadowShapes();
    notifyStatusChange();
}

async function startPickingMode(categories) {
    if (!mapRef || !Array.isArray(categories) || categories.length === 0) return;

    snapshotBeforePick = {
        features: Array.from(selectedFeaturesMap.entries()),
        dimMask: activeDimMaskGeoJSON,
        outline: activeOutlineGeoJSON
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
    drawShadow();
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
    } else if (applyChanges) {
        buildSpotlightGeometry();
    }

    snapshotBeforePick = null;
    applyHighlightLayers(mapRef);
    rebuildShadowShapes();
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
    ensureShadowCanvas();
}
