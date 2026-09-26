// js/layers/polarMap.js
import { getPaletteForParameter as getLightPalette, TEMP_PALETTE } from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

// 🌐 High-Definition 50m & 10m Natural Earth Datasets
const LAND_POLYGONS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_land.geojson';
const LAKES_POLYGONS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_lakes.geojson';
const COASTLINES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_coastline.geojson';
const COUNTRY_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_boundary_lines_land.geojson';
const STATE_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces_lines.geojson';
const COUNTY_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_admin_2_counties.geojson';

let scene, camera, renderer, polarGroup, polarMesh, material, paletteTex;
let isPolarActive = false;
let polarAnimationId = null;

// Dual High-DPI Vector Canvases (Underlay = Land/Water, Overlay = Coastlines/Borders/Collar)
let underlayCanvas = null;
let underlayCtx = null;
let overlayCanvas = null;
let overlayCtx = null;

// Cached Path2D Vector Objects
let pathLand = null;
let pathLakes = null;
let pathCoastlines = null;
let pathCountries = null;
let pathStates = null;
let pathCounties = null;
let pathGraticule = null;
let pathCollar = null;

let rawLandFeatures = [];
let rawLakesFeatures = [];
let rawCoastlineFeatures = [];
let rawCountryFeatures = [];
let rawStateFeatures = [];
let rawCountyFeatures = [];

// Map State
let currentPole = 'north';
let mapRotation = 0.0;
let mapTargetY = -0.45;
let mapTargetX = 0.0;
let mapZoom = 1.0;

// Central meridians
const NORTH_CENTRAL_LON = -95.0 * (Math.PI / 180.0);
const SOUTH_CENTRAL_LON = 0.0 * (Math.PI / 180.0);

// Outer polar radius boundary (~31.8° latitude into opposite hemisphere)
const POLAR_OUTER_RADIUS = 1.76;

// 🌟 Exact Toner Color Matrices matching 2D Mercator (style_dark.json & map_style_light.json)
const THEME_COLORS = {
    dark: {
        bg: '#050a15',
        ocean: '#021425',          // Exact 2D Toner Dark ocean: rgba(2, 20, 37, 1)
        land: '#3B333B',           // Exact 2D Toner Dark land: rgba(59, 51, 59, 1)
        lakes: '#021425',          // Same as ocean
        coastline: '#ffffff',      // Crisp white coastline
        countryBorders: '#f8fafc',
        stateBorders: 'rgba(255, 255, 255, 0.85)',
        countyBorders: 'rgba(255, 255, 255, 0.35)',
        graticule: 'rgba(56, 189, 248, 0.22)',
        collarRim: 'rgba(56, 189, 248, 0.7)',
        collarTicks: '#38bdf8',
        labelColor: '#38bdf8'
    },
    light: {
        bg: '#e2e8f0',
        ocean: '#E7F1F4',          // Exact 2D Toner Light water: #E7F1F4
        land: '#FDE5CF',           // Exact 2D Toner Light parchment: rgba(253, 229, 207, 1)
        lakes: '#E7F1F4',          // Same as ocean
        coastline: '#000000',      // Crisp black coastline
        countryBorders: '#000000',
        stateBorders: 'rgba(0, 0, 0, 0.85)',
        countyBorders: 'rgba(0, 0, 0, 0.35)',
        graticule: 'rgba(71, 85, 105, 0.22)',
        collarRim: 'rgba(15, 23, 42, 0.7)',
        collarTicks: '#0f172a',
        labelColor: '#0f172a'
    }
};

const style = document.createElement('style');
style.textContent = `
    #polar-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2;
        touch-action: none !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        overflow: hidden;
    }
    #polar-underlay-canvas,
    #polar-overlay-canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100% !important;
        height: 100% !important;
        display: block;
        pointer-events: none;
    }
    #polar-underlay-canvas {
        z-index: 1;
    }
    #polar-container canvas:not(#polar-underlay-canvas):not(#polar-overlay-canvas) {
        position: absolute;
        top: 0;
        left: 0;
        width: 100% !important;
        height: 100% !important;
        display: block;
        z-index: 2;
    }
    #polar-overlay-canvas {
        z-index: 3;
    }
    .polar-top-controls {
        position: absolute;
        top: 62px;
        right: 16px;
        z-index: 28;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: nowrap;
    }
    .polar-compass-btn {
        background: rgba(11, 15, 25, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #38bdf8;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        transition: all 0.2s ease;
        flex-shrink: 0;
    }
    .polar-compass-btn svg {
        transition: transform 0.1s linear;
    }
    .polar-rot-capsule {
        display: none;
        align-items: center;
        background: rgba(11, 15, 25, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        padding: 4px 8px;
        gap: 6px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    }
    @media (min-width: 1024px) {
        .polar-rot-capsule {
            display: flex;
        }
    }
    .rot-nudge-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 13px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.15s ease;
    }
    .rot-nudge-btn:hover {
        color: #38bdf8;
    }
    #polar-rot-slider {
        width: 70px;
        accent-color: #38bdf8;
        cursor: pointer;
        height: 4px;
        appearance: none;
        -webkit-appearance: none;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 2px;
        outline: none;
    }
    #polar-rot-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #38bdf8;
        cursor: pointer;
        box-shadow: 0 0 6px rgba(56, 189, 248, 0.8);
    }
    .polar-pole-switcher {
        display: flex;
        align-items: center;
        background: rgba(11, 15, 25, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        padding: 3px;
        gap: 3px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        flex-shrink: 0;
    }
    .pole-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-family: 'Rajdhani', sans-serif;
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 0.5px;
        padding: 5px 12px;
        border-radius: 16px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    .pole-btn:hover {
        color: #ffffff;
    }
    .pole-btn.active {
        background: rgba(56, 189, 248, 0.25);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.6);
        box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
    }
`;
document.head.appendChild(style);

const vsPolar = `
    varying vec2 v_pos;
    void main() {
        v_pos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fsPolar = `
    precision highp float;
    uniform sampler2D u_dataTexture;
    uniform sampler2D u_paletteTexture;
    uniform vec2 u_uvOffset;
    uniform vec2 u_uvScale;
    uniform float u_opacity;
    uniform float u_centralLon;
    uniform float u_poleSign;
    uniform vec2 u_texResolution;
    varying vec2 v_pos;

    const float PI = 3.141592653589793;

    vec4 cubicBSpline(float f) {
        float f2 = f * f;
        float f3 = f2 * f;
        return vec4(
            (1.0 - 3.0*f + 3.0*f2 - f3) / 6.0,
            (4.0 - 6.0*f2 + 3.0*f3) / 6.0,
            (1.0 + 3.0*f + 3.0*f2 - 3.0*f3) / 6.0,
            f3 / 6.0
        );
    }

    float sampleSmoothSpline(sampler2D tex, vec2 uv, vec2 texRes) {
        vec2 pos = uv * texRes - 0.5;
        vec2 f = fract(pos);
        vec2 i = floor(pos);

        vec4 wx = cubicBSpline(f.x);
        vec4 wy = cubicBSpline(f.y);

        vec2 invTex = 1.0 / texRes;
        float x0 = (i.x - 0.5) * invTex.x;
        float x1 = (i.x + 0.5) * invTex.x;
        float x2 = (i.x + 1.5) * invTex.x;
        float x3 = (i.x + 2.5) * invTex.x;

        float total = 0.0;
        for (int y = -1; y <= 2; y++) {
            float yCoord = clamp((i.y + float(y) + 0.5) * invTex.y, 0.0, 1.0);
            
            float rowVal = wx.x * texture2D(tex, vec2(x0, yCoord)).r +
                           wx.y * texture2D(tex, vec2(x1, yCoord)).r +
                           wx.z * texture2D(tex, vec2(x2, yCoord)).r +
                           wx.w * texture2D(tex, vec2(x3, yCoord)).r;

            float w_y = (y == -1) ? wy.x : ((y == 0) ? wy.y : ((y == 1) ? wy.z : wy.w));
            total += w_y * rowVal;
        }

        return clamp(total, 0.0, 1.0);
    }

    void main() {
        float r = length(v_pos);

        // Clip exactly at polar collar boundary
        if (r > 1.76) {
            discard;
        }

        float c = 2.0 * atan(r);
        float lat = u_poleSign * ((PI * 0.5) - c);
        
        float lon;
        if (u_poleSign > 0.0) {
            lon = u_centralLon + atan(v_pos.x, -v_pos.y);
        } else {
            lon = u_centralLon + atan(v_pos.x, v_pos.y);
        }

        lon = mod(lon + PI, 2.0 * PI) - PI;

        float u = (lon + PI) / (2.0 * PI);
        float v = (PI * 0.5 - lat) / PI;

        vec2 sprite_uv = u_uvOffset + vec2(fract(u), clamp(v, 0.0, 1.0)) * u_uvScale;

        float rawVal = sampleSmoothSpline(u_dataTexture, sprite_uv, u_texResolution);

        if (rawVal < 0.00001) {
            discard;
        }

        float palIndex = clamp(rawVal * 255.0, 0.0, 255.0);
        float palU = (palIndex + 0.5) / 256.0;
        vec4 color = texture2D(u_paletteTexture, vec2(palU, 0.5));

        if (color.a == 0.0) {
            discard;
        }

        gl_FragColor = vec4(color.rgb, color.a * u_opacity);
    }
`;

function createPaletteTexture(paletteHexArray = TEMP_PALETTE) {
    const canvas = document.createElement('canvas');
    canvas.width = paletteHexArray.length;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const isPrecip = (stateManager.activeParam === 'tp' || stateManager.activeShader === 'precip');

    paletteHexArray.forEach((hex, i) => {
        if (isPrecip && i === 0) {
            ctx.clearRect(i, 0, 1, 1);
        } else {
            ctx.fillStyle = hex;
            ctx.fillRect(i, 0, 1, 1);
        }
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

/**
 * 🌟 Exact Forward Polar Stereographic Coordinate Projection
 */
function lngLatToPolarPlanar(lng, lat, isNorth = true) {
    if (isNorth && lat < -35.0) return null;
    if (!isNorth && lat > 35.0) return null;

    const lambda = lng * (Math.PI / 180.0);
    const phi = lat * (Math.PI / 180.0);

    let c, r, deltaLambda, x, y;

    if (isNorth) {
        c = (Math.PI * 0.5) - phi;
        r = Math.tan(c * 0.5);
        deltaLambda = lambda - NORTH_CENTRAL_LON;
        x = r * Math.sin(deltaLambda);
        y = -r * Math.cos(deltaLambda);
    } else {
        c = (Math.PI * 0.5) + phi;
        r = Math.tan(c * 0.5);
        deltaLambda = lambda - SOUTH_CENTRAL_LON;
        x = r * Math.sin(deltaLambda);
        y = r * Math.cos(deltaLambda);
    }

    return { x, y };
}

/**
 * 🌟 High-Performance Polygon Path2D Builder for Flawless Land/Lake Fills
 */
function buildPolygonPath2D(features, isNorth) {
    const path = new Path2D();

    features.forEach(feat => {
        const geom = feat.geometry;
        if (!geom) return;

        let polygons = [];
        if (geom.type === 'Polygon') polygons = [geom.coordinates];
        else if (geom.type === 'MultiPolygon') polygons = geom.coordinates;

        polygons.forEach(polyCoords => {
            polyCoords.forEach(ring => {
                let isDrawing = false;
                for (let i = 0; i < ring.length; i++) {
                    const pt = lngLatToPolarPlanar(ring[i][0], ring[i][1], isNorth);
                    if (!pt) {
                        isDrawing = false;
                        continue;
                    }

                    if (!isDrawing) {
                        path.moveTo(pt.x, pt.y);
                        isDrawing = true;
                    } else {
                        const prev = ring[i - 1];
                        if (prev && Math.abs(ring[i][0] - prev[0]) > 180) {
                            path.moveTo(pt.x, pt.y);
                        } else {
                            path.lineTo(pt.x, pt.y);
                        }
                    }
                }
                if (isDrawing) path.closePath();
            });
        });
    });

    return path;
}

/**
 * 🌟 Line Path2D Builder for Coastlines, Countries, States, and Counties
 */
function buildLinePath2D(features, isNorth) {
    const path = new Path2D();

    features.forEach(feature => {
        const geom = feature.geometry;
        if (!geom) return;

        let lineStrings = [];
        if (geom.type === 'LineString') lineStrings = [geom.coordinates];
        else if (geom.type === 'MultiLineString') lineStrings = geom.coordinates;
        else if (geom.type === 'Polygon') lineStrings = geom.coordinates;
        else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly => poly.forEach(r => lineStrings.push(r)));

        lineStrings.forEach(coords => {
            let isDrawing = false;
            for (let i = 0; i < coords.length; i++) {
                const pt = lngLatToPolarPlanar(coords[i][0], coords[i][1], isNorth);
                if (!pt) {
                    isDrawing = false;
                    continue;
                }

                if (!isDrawing) {
                    path.moveTo(pt.x, pt.y);
                    isDrawing = true;
                } else {
                    const prevCoords = coords[i - 1];
                    if (prevCoords && Math.abs(coords[i][0] - prevCoords[0]) > 180) {
                        path.moveTo(pt.x, pt.y);
                    } else {
                        path.lineTo(pt.x, pt.y);
                    }
                }
            }
        });
    });

    return path;
}

/**
 * 🌟 Meteorological Graticule Grid & Polar Collar
 */
function buildGraticuleAndCollar(isNorth) {
    const graticule = new Path2D();
    const collar = new Path2D();

    // Standard Synoptic Parallels: 80°, 60°, 40°, 20°, 0° (Equator)
    const parallels = [80, 60, 40, 20, 0];
    parallels.forEach(lat => {
        const phi = (isNorth ? lat : -lat) * (Math.PI / 180.0);
        const c = isNorth ? (Math.PI * 0.5 - phi) : (Math.PI * 0.5 + phi);
        const r = Math.tan(c * 0.5);
        if (r > 0 && r <= POLAR_OUTER_RADIUS) {
            graticule.moveTo(r, 0);
            graticule.arc(0, 0, r, 0, Math.PI * 2);
        }
    });

    // Meridian spokes every 30°
    for (let deg = 0; deg < 360; deg += 30) {
        const pStart = lngLatToPolarPlanar(deg, isNorth ? 85 : -85, isNorth);
        const pEnd = lngLatToPolarPlanar(deg, isNorth ? -30 : 30, isNorth);
        if (pStart && pEnd) {
            graticule.moveTo(pStart.x, pStart.y);
            graticule.lineTo(pEnd.x, pEnd.y);
        }
    }

    // Outer Boundary Circle
    collar.moveTo(POLAR_OUTER_RADIUS, 0);
    collar.arc(0, 0, POLAR_OUTER_RADIUS, 0, Math.PI * 2);

    return { graticule, collar };
}

function rebuildAllPaths() {
    const isNorth = (currentPole === 'north');

    // 1. Vector Fills
    pathLand = buildPolygonPath2D(rawLandFeatures, isNorth);
    pathLakes = buildPolygonPath2D(rawLakesFeatures, isNorth);

    // 2. Vector Strokes
    pathCoastlines = buildLinePath2D(rawCoastlineFeatures, isNorth);
    pathCountries = buildLinePath2D(rawCountryFeatures, isNorth);
    pathStates = buildLinePath2D(rawStateFeatures, isNorth);
    pathCounties = buildLinePath2D(rawCountyFeatures, isNorth);

    // 3. Grid & Rim
    const { graticule, collar } = buildGraticuleAndCollar(isNorth);
    pathGraticule = graticule;
    pathCollar = collar;

    renderCanvases();
}

/**
 * 🌟 RENDER RETINA UNDERLAY (Land, Ocean & Water)
 */
function renderUnderlay() {
    if (!underlayCanvas || !underlayCtx || !camera) return;

    const w = underlayCanvas.width;
    const h = underlayCanvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    underlayCtx.clearRect(0, 0, w, h);

    const visibleHeight = (camera.top - camera.bottom) / camera.zoom;
    const scale = (h / visibleHeight);

    const screenCenterX = (w / 2) - (camera.position.x * scale);
    const screenCenterY = (h / 2) + (camera.position.y * scale);

    const themeKey = (stateManager.currentTheme === 'dark') ? 'dark' : 'light';
    const cfg = THEME_COLORS[themeKey];

    underlayCtx.save();
    underlayCtx.translate(screenCenterX, screenCenterY);
    underlayCtx.rotate(-mapRotation);
    underlayCtx.scale(scale, -scale);

    // 1. Circular Ocean Disk
    underlayCtx.beginPath();
    underlayCtx.arc(0, 0, POLAR_OUTER_RADIUS, 0, Math.PI * 2);
    underlayCtx.fillStyle = cfg.ocean;
    underlayCtx.fill();

    // Clip all land fills neatly to the polar disc
    underlayCtx.clip();

    // 2. High-DPI Anti-Aliased Landmasses
    if (pathLand) {
        underlayCtx.fillStyle = cfg.land;
        underlayCtx.fill(pathLand, 'evenodd');
    }

    // 3. Inland Lakes & Seas
    if (pathLakes) {
        underlayCtx.fillStyle = cfg.lakes;
        underlayCtx.fill(pathLakes, 'evenodd');
    }

    // 4. Subtle Under-Weather Graticule
    if (pathGraticule) {
        underlayCtx.lineWidth = (0.75 * dpr) / scale;
        underlayCtx.strokeStyle = cfg.graticule;
        underlayCtx.setLineDash([3 * dpr / scale, 5 * dpr / scale]);
        underlayCtx.stroke(pathGraticule);
        underlayCtx.setLineDash([]);
    }

    underlayCtx.restore();
}

/**
 * 🌟 RENDER RETINA OVERLAY (Borders, Coastlines, Collar & Ticks)
 */
function renderOverlay() {
    if (!overlayCanvas || !overlayCtx || !camera) return;

    const w = overlayCanvas.width;
    const h = overlayCanvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    overlayCtx.clearRect(0, 0, w, h);

    const visibleHeight = (camera.top - camera.bottom) / camera.zoom;
    const scale = (h / visibleHeight);

    const screenCenterX = (w / 2) - (camera.position.x * scale);
    const screenCenterY = (h / 2) + (camera.position.y * scale);

    const themeKey = (stateManager.currentTheme === 'dark') ? 'dark' : 'light';
    const cfg = THEME_COLORS[themeKey];

    overlayCtx.save();
    overlayCtx.translate(screenCenterX, screenCenterY);
    overlayCtx.rotate(-mapRotation);
    overlayCtx.scale(scale, -scale);

    // 1. County Borders (Fade in at higher zoom)
    if (pathCounties && camera.zoom > 2.2) {
        overlayCtx.lineWidth = (0.75 * dpr) / scale;
        overlayCtx.strokeStyle = cfg.countyBorders;
        overlayCtx.stroke(pathCounties);
    }

    // 2. State & Province Borders
    if (pathStates) {
        overlayCtx.lineWidth = (1.2 * dpr) / scale;
        overlayCtx.strokeStyle = cfg.stateBorders;
        overlayCtx.stroke(pathStates);
    }

    // 3. International Country Boundaries
    if (pathCountries) {
        overlayCtx.lineWidth = (1.8 * dpr) / scale;
        overlayCtx.strokeStyle = cfg.countryBorders;
        overlayCtx.stroke(pathCountries);
    }

    // 4. Razor-Sharp Coastlines
    if (pathCoastlines) {
        overlayCtx.lineWidth = (1.8 * dpr) / scale;
        overlayCtx.strokeStyle = cfg.coastline;
        overlayCtx.stroke(pathCoastlines);
    }

    // 5. Styled Meteorological Collar Rim
    if (pathCollar) {
        overlayCtx.lineWidth = (2.4 * dpr) / scale;
        overlayCtx.strokeStyle = cfg.collarRim;
        overlayCtx.stroke(pathCollar);

        // Degree Tick Marks along collar
        const tickLength = 0.028;
        overlayCtx.lineWidth = (1.5 * dpr) / scale;
        overlayCtx.strokeStyle = cfg.collarTicks;
        overlayCtx.beginPath();
        for (let a = 0; a < 360; a += 10) {
            const rad = a * (Math.PI / 180);
            const isMajor = (a % 30 === 0);
            const len = isMajor ? tickLength * 1.5 : tickLength;
            const rIn = POLAR_OUTER_RADIUS - len;
            overlayCtx.moveTo(rIn * Math.cos(rad), rIn * Math.sin(rad));
            overlayCtx.lineTo(POLAR_OUTER_RADIUS * Math.cos(rad), POLAR_OUTER_RADIUS * Math.sin(rad));
        }
        overlayCtx.stroke();
    }

    // 6. Latitude Reference Badges (80°N, 60°N, 40°N, 20°N)
    const isNorth = (currentPole === 'north');
    const badgeLats = [80, 60, 40, 20];
    overlayCtx.font = `bold ${Math.max(10, Math.round(11 * dpr))}px Rajdhani, sans-serif`;
    overlayCtx.textAlign = 'center';
    overlayCtx.textBaseline = 'middle';

    badgeLats.forEach(lat => {
        const phi = (isNorth ? lat : -lat) * (Math.PI / 180.0);
        const c = isNorth ? (Math.PI * 0.5 - phi) : (Math.PI * 0.5 + phi);
        const r = Math.tan(c * 0.5);

        if (r > 0 && r < POLAR_OUTER_RADIUS) {
            overlayCtx.save();
            overlayCtx.translate(0, r);
            overlayCtx.scale(1 / scale, -1 / scale); // Keep text upright

            const text = `${lat}°${isNorth ? 'N' : 'S'}`;
            overlayCtx.fillStyle = (themeKey === 'dark') ? '#0b0f19' : '#ffffff';
            overlayCtx.strokeStyle = cfg.collarRim;
            overlayCtx.lineWidth = 2 * dpr;

            overlayCtx.strokeText(text, 0, 0);
            overlayCtx.fillStyle = cfg.labelColor;
            overlayCtx.fillText(text, 0, 0);
            overlayCtx.restore();
        }
    });

    overlayCtx.restore();
}

function renderCanvases() {
    renderUnderlay();
    renderOverlay();
}

async function loadAllBasemapGeoJson() {
    try {
        const [landResp, lakesResp, coastResp, countryResp, stateResp, countyResp] = await Promise.all([
            fetch(LAND_POLYGONS_URL).catch(() => null),
            fetch(LAKES_POLYGONS_URL).catch(() => null),
            fetch(COASTLINES_URL).catch(() => null),
            fetch(COUNTRY_BORDERS_URL).catch(() => null),
            fetch(STATE_BORDERS_URL).catch(() => null),
            fetch(COUNTY_BORDERS_URL).catch(() => null)
        ]);

        if (landResp && landResp.ok) {
            const data = await landResp.json();
            if (data?.features) rawLandFeatures = data.features;
        }
        if (lakesResp && lakesResp.ok) {
            const data = await lakesResp.json();
            if (data?.features) rawLakesFeatures = data.features;
        }
        if (coastResp && coastResp.ok) {
            const data = await coastResp.json();
            if (data?.features) rawCoastlineFeatures = data.features;
        }
        if (countryResp && countryResp.ok) {
            const data = await countryResp.json();
            if (data?.features) rawCountryFeatures = data.features;
        }
        if (stateResp && stateResp.ok) {
            const data = await stateResp.json();
            if (data?.features) rawStateFeatures = data.features;
        }
        if (countyResp && countyResp.ok) {
            const data = await countyResp.json();
            if (data?.features) rawCountyFeatures = data.features;
        }

        rebuildAllPaths();
    } catch (err) {
        console.warn("Polar GeoJSON load error:", err);
    }
}

function initPolarUI(container) {
    let topControls = container.querySelector('.polar-top-controls');
    if (topControls) return;

    topControls = document.createElement('div');
    topControls.className = 'polar-top-controls';
    topControls.innerHTML = `
        <button id="btn-polar-compass" class="polar-compass-btn" title="Reset Orientation (North Up)">
            <svg id="polar-compass-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12 2 15 11 12 9 9 11 12 2" fill="#ef4444"/>
                <polygon points="12 22 15 13 12 15 9 13 12 22" fill="#94a3b8"/>
            </svg>
        </button>

        <div class="polar-rot-capsule" title="Rotate Map Around Pole">
            <button class="rot-nudge-btn" id="btn-rot-left" title="Rotate Left">⟲</button>
            <input id="polar-rot-slider" type="range" min="0" max="360" value="0" step="1">
            <button class="rot-nudge-btn" id="btn-rot-right" title="Rotate Right">⟳</button>
        </div>

        <div class="polar-pole-switcher">
            <button class="pole-btn active" data-pole="north">North</button>
            <button class="pole-btn" data-pole="south">South</button>
        </div>
    `;

    const compassBtn = topControls.querySelector('#btn-polar-compass');
    if (compassBtn) {
        compassBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            resetRotation();
        });
    }

    const rotSlider = topControls.querySelector('#polar-rot-slider');
    if (rotSlider) {
        rotSlider.addEventListener('input', (e) => {
            setRotationDegrees(parseFloat(e.target.value));
        });
    }

    const btnRotLeft = topControls.querySelector('#btn-rot-left');
    if (btnRotLeft) {
        btnRotLeft.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentDeg = (THREE.MathUtils.radToDeg(mapRotation) % 360 + 360) % 360;
            setRotationDegrees(currentDeg - 15);
        });
    }

    const btnRotRight = topControls.querySelector('#btn-rot-right');
    if (btnRotRight) {
        btnRotRight.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentDeg = (THREE.MathUtils.radToDeg(mapRotation) % 360 + 360) % 360;
            setRotationDegrees(currentDeg + 15);
        });
    }

    const poleButtons = topControls.querySelectorAll('.pole-btn');
    poleButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            poleButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetPole = btn.getAttribute('data-pole');
            setHemisphere(targetPole);
        });
    });

    container.appendChild(topControls);
}

function updateCompassUI() {
    const icon = document.getElementById('polar-compass-icon');
    if (icon) {
        icon.style.transform = `rotate(${-mapRotation}rad)`;
    }

    const slider = document.getElementById('polar-rot-slider');
    if (slider) {
        const deg = (THREE.MathUtils.radToDeg(mapRotation) % 360 + 360) % 360;
        slider.value = Math.round(deg);
    }
}

export function setRotationDegrees(deg) {
    const normalizedDeg = (deg % 360 + 360) % 360;
    mapRotation = THREE.MathUtils.degToRad(normalizedDeg);
    if (polarGroup) {
        polarGroup.rotation.z = mapRotation;
    }
    updateCompassUI();
    renderCanvases();
}

export function resetRotation() {
    setRotationDegrees(0);
}

export function setHemisphere(pole) {
    currentPole = pole;
    const isNorth = (pole === 'north');

    if (material) {
        material.uniforms.u_poleSign.value = isNorth ? 1.0 : -1.0;
        material.uniforms.u_centralLon.value = isNorth ? NORTH_CENTRAL_LON : SOUTH_CENTRAL_LON;
        material.needsUpdate = true;
    }

    rebuildAllPaths();
    fitSynopticSector();
}

export function fitSynopticSector() {
    if (!camera || !renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;

    const sectorHeight = (w < 768) ? 1.45 : 1.35;
    const sectorWidth = sectorHeight * aspect;

    camera.left = -sectorWidth / 2;
    camera.right = sectorWidth / 2;
    camera.top = sectorHeight / 2;
    camera.bottom = -sectorHeight / 2;
    camera.zoom = 1.0;
    mapZoom = 1.0;

    mapTargetX = 0.0;
    mapTargetY = (currentPole === 'north') ? -0.45 : 0.0;
    mapRotation = 0.0;

    if (polarGroup) polarGroup.rotation.z = 0.0;

    camera.position.set(0.0, mapTargetY, 10);
    camera.rotation.z = 0;
    camera.updateProjectionMatrix();
    updateCompassUI();
    renderCanvases();
}

export function zoomPolarAtPoint(direction, clientX, clientY) {
    if (!camera || !renderer) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    
    const visibleHeight = (camera.top - camera.bottom) / camera.zoom;
    const unitsPerPixelY = visibleHeight / h;

    const screenY = clientY - (h / 2);
    const worldPointY = camera.position.y - screenY * unitsPerPixelY;

    const zoomFactor = direction > 0 ? 1.25 : 0.8;
    const newZoom = Math.max(0.4, Math.min(6.0, camera.zoom * zoomFactor));

    const newVisibleHeight = (camera.top - camera.bottom) / newZoom;
    const newUnitsPerPixelY = newVisibleHeight / h;

    camera.zoom = newZoom;
    camera.updateProjectionMatrix();

    mapTargetY = worldPointY + screenY * newUnitsPerPixelY;
    mapTargetY = Math.max(-1.5, Math.min(1.5, mapTargetY));
    camera.position.y = mapTargetY;

    renderCanvases();
}

function init2DMapControls(canvas) {
    let isDragging = false;
    let dragMode = 'none';
    let startX = 0, startY = 0;
    let accumDx = 0, accumDy = 0;
    const DRAG_LOCK_THRESHOLD = 5;
    let initialTouchDist = 0;

    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        dragMode = 'none';
        accumDx = 0;
        accumDy = 0;
        startX = e.clientX;
        startY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;

        if (dragMode === 'none') {
            accumDx += Math.abs(dx);
            accumDy += Math.abs(dy);
            if (accumDx + accumDy >= DRAG_LOCK_THRESHOLD) {
                dragMode = (accumDx > accumDy) ? 'rotate' : 'pan';
            }
        }

        if (dragMode === 'rotate') {
            mapRotation += dx * 0.004;
            if (polarGroup) {
                polarGroup.rotation.z = mapRotation;
            }
            updateCompassUI();
            renderCanvases();
        } else if (dragMode === 'pan') {
            const h = window.innerHeight;
            const visibleHeight = (camera.top - camera.bottom) / camera.zoom;
            const unitsPerPixel = visibleHeight / h;

            mapTargetY += dy * unitsPerPixel * 0.9;
            mapTargetY = Math.max(-1.5, Math.min(1.5, mapTargetY));
            camera.position.y = mapTargetY;
            renderCanvases();
        }
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        dragMode = 'none';
        accumDx = 0;
        accumDy = 0;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomSensitivity = 0.0012;
        const factor = Math.exp(-e.deltaY * zoomSensitivity);
        const clampedFactor = Math.max(0.93, Math.min(1.07, factor));

        const newZoom = Math.max(0.4, Math.min(6.0, camera.zoom * clampedFactor));
        camera.zoom = newZoom;
        camera.updateProjectionMatrix();
        renderCanvases();
    }, { passive: false });

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isDragging = true;
            dragMode = 'none';
            accumDx = 0;
            accumDy = 0;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            isDragging = false;
            dragMode = 'none';
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            initialTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            mapZoom = camera.zoom;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();

        if (e.touches.length === 1 && isDragging) {
            const clientX = e.touches[0].clientX;
            const clientY = e.touches[0].clientY;

            const dx = clientX - startX;
            const dy = clientY - startY;
            startX = clientX;
            startY = clientY;

            if (dragMode === 'none') {
                accumDx += Math.abs(dx);
                accumDy += Math.abs(dy);
                if (accumDx + accumDy >= DRAG_LOCK_THRESHOLD) {
                    dragMode = (accumDx > accumDy) ? 'rotate' : 'pan';
                }
            }

            if (dragMode === 'rotate') {
                mapRotation += dx * 0.005;
                if (polarGroup) {
                    polarGroup.rotation.z = mapRotation;
                }
                updateCompassUI();
                renderCanvases();
            } else if (dragMode === 'pan') {
                const h = window.innerHeight;
                const visibleHeight = (camera.top - camera.bottom) / camera.zoom;
                const unitsPerPixel = visibleHeight / h;

                mapTargetY += dy * unitsPerPixel * 0.9;
                mapTargetY = Math.max(-1.5, Math.min(1.5, mapTargetY));
                camera.position.y = mapTargetY;
                renderCanvases();
            }
        } else if (e.touches.length === 2 && initialTouchDist > 0) {
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const pinchRatio = currentDist / initialTouchDist;
            camera.zoom = Math.max(0.4, Math.min(6.0, mapZoom * pinchRatio));
            camera.updateProjectionMatrix();
            renderCanvases();
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length === 1) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isDragging = true;
            dragMode = 'none';
            accumDx = 0;
            accumDy = 0;
        } else {
            isDragging = false;
            dragMode = 'none';
            accumDx = 0;
            accumDy = 0;
        }
    });
}

function animate() {
    if (!isPolarActive) {
        polarAnimationId = null;
        return;
    }
    polarAnimationId = requestAnimationFrame(animate);
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

export function initPolarMap() {
    let container = document.getElementById('polar-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'polar-container';
        container.style.display = 'none';
        document.body.appendChild(container);
    }

    initPolarUI(container);

    if (scene) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // 1. Retina Underlay Canvas (Ocean, Land, Lakes, Graticule)
    underlayCanvas = document.createElement('canvas');
    underlayCanvas.id = 'polar-underlay-canvas';
    underlayCanvas.width = window.innerWidth * dpr;
    underlayCanvas.height = window.innerHeight * dpr;
    container.appendChild(underlayCanvas);
    underlayCtx = underlayCanvas.getContext('2d');

    // 2. Three.js WebGL Weather Canvas
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(dpr);
    container.appendChild(renderer.domElement);

    // 3. Retina Overlay Canvas (Coastlines, Country/State/County Borders, Polar Collar, Badges)
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'polar-overlay-canvas';
    overlayCanvas.width = window.innerWidth * dpr;
    overlayCanvas.height = window.innerHeight * dpr;
    container.appendChild(overlayCanvas);
    overlayCtx = overlayCanvas.getContext('2d');

    init2DMapControls(renderer.domElement);

    const themeKey = (stateManager.currentTheme === 'dark') ? 'dark' : 'light';
    const cfg = THEME_COLORS[themeKey];
    container.style.background = cfg.bg;

    polarGroup = new THREE.Group();
    scene.add(polarGroup);

    // Weather Shader Layer
    const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
    const initialPalette = paletteFunc(stateManager.activeParam || '2t');
    paletteTex = createPaletteTexture(initialPalette);

    material = new THREE.ShaderMaterial({
        vertexShader: vsPolar,
        fragmentShader: fsPolar,
        uniforms: {
            u_dataTexture: { value: null },
            u_paletteTexture: { value: paletteTex },
            u_uvOffset: { value: new THREE.Vector2(0, 0) },
            u_uvScale: { value: new THREE.Vector2(1, 1) },
            u_opacity: { value: 1 },
            u_centralLon: { value: NORTH_CENTRAL_LON },
            u_poleSign: { value: 1.0 },
            u_texResolution: { value: new THREE.Vector2(2880.0, 1442.0) }
        },
        transparent: true,
        depthWrite: false
    });

    const weatherGeom = new THREE.PlaneGeometry(6.0, 6.0);
    polarMesh = new THREE.Mesh(weatherGeom, material);
    polarGroup.add(polarMesh);

    loadAllBasemapGeoJson();
    fitSynopticSector();

    window.addEventListener('resize', () => {
        if (!renderer || !camera || !overlayCanvas || !underlayCanvas) return;
        const newDpr = Math.min(window.devicePixelRatio || 1, 2);
        underlayCanvas.width = window.innerWidth * newDpr;
        underlayCanvas.height = window.innerHeight * newDpr;
        overlayCanvas.width = window.innerWidth * newDpr;
        overlayCanvas.height = window.innerHeight * newDpr;
        renderer.setSize(window.innerWidth, window.innerHeight);
        fitSynopticSector();
    });

    if (isPolarActive && !polarAnimationId) {
        animate();
    }
}

export function updatePolarPalette(paramIdOrHexArray) {
    if (!material) return;
    let hexArray;
    if (Array.isArray(paramIdOrHexArray)) {
        hexArray = paramIdOrHexArray;
    } else {
        const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
        hexArray = paletteFunc(paramIdOrHexArray || stateManager.activeParam);
    }

    if (paletteTex) {
        paletteTex.dispose();
    }
    paletteTex = createPaletteTexture(hexArray);
    material.uniforms.u_paletteTexture.value = paletteTex;
    material.needsUpdate = true;

    const themeKey = (stateManager.currentTheme === 'dark') ? 'dark' : 'light';
    const cfg = THEME_COLORS[themeKey];

    const container = document.getElementById('polar-container');
    if (container) container.style.background = cfg.bg;

    renderCanvases();
}

export function updatePolarFrame(frameState) {
    if (!material || !frameState || !frameState.chunkImg) return;

    const cIdx = frameState.chunkIndex;
    const fIdx = frameState.frameIndex !== undefined ? frameState.frameIndex : (frameState.col || 0);
    const frameKey = `${cIdx}_${fIdx}`;
    const source = frameState.chunkImg;

    if (!polarChunkTextures[frameKey]) {
        let texture;
        if (source.data && source.width && source.height) {
            texture = new THREE.DataTexture(
                source.data,
                source.width,
                source.height,
                THREE.LuminanceFormat,
                THREE.UnsignedByteType
            );
            texture.needsUpdate = true;
        } else {
            texture = new THREE.CanvasTexture(source);
        }
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        polarChunkTextures[frameKey] = texture;
    }

    material.uniforms.u_dataTexture.value = polarChunkTextures[frameKey];
    material.uniforms.u_uvOffset.value.set(frameState.uvOffset[0], frameState.uvOffset[1]);
    material.uniforms.u_uvScale.value.set(frameState.uvScale[0], frameState.uvScale[1]);
    
    if (source.width && source.height) {
        material.uniforms.u_texResolution.value.set(source.width, source.height);
    }
    
    material.needsUpdate = true;
}

export function clearPolarTextures() {
    for (const key in polarChunkTextures) {
        if (polarChunkTextures[key]) {
            polarChunkTextures[key].dispose();
        }
    }
    polarChunkTextures = {};
}

export function showPolarMap() {
    const container = document.getElementById('polar-container');
    const globeContainer = document.getElementById('globe-container');
    const mapDiv = document.getElementById('map');

    if (container) container.style.display = 'block';
    if (globeContainer) globeContainer.style.display = 'none';
    if (mapDiv) mapDiv.style.display = 'none';

    isPolarActive = true;
    fitSynopticSector();

    if (!polarAnimationId) {
        animate();
    }
}

export function hidePolarMap() {
    const container = document.getElementById('polar-container');
    if (container) container.style.display = 'none';
    isPolarActive = false;

    if (polarAnimationId) {
        cancelAnimationFrame(polarAnimationId);
        polarAnimationId = null;
    }
}
