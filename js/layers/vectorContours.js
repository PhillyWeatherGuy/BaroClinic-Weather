// js/layers/vectorContours.js
// GPU contour renderer: the lines are drawn by ONE MapLibre custom WebGL layer.
// Switching steps = swapping one vertex buffer. No GeoJSON tiling, no worker, no tile loading.
// Isobar labels stay a tiny GeoJSON point layer (a few hundred points, so setData is cheap).
import { stateManager } from '../core/stateManager.js';

let mapInstance = null;
let activeMasterContours = null;
let activeMasterKey = null;
let fetchPromise = null;
let activeContourBinary = null;
let currentVisibleStep = 0;

let displayedStep = null;
let pendingApply = null;
let applyQueued = false;

// Prepared GPU data per step (a compact byte array + label points), filled slowly in the background
const stepCache = new Map();
let preloadRun = 0;
let preloadStartedFor = null;
const PRELOAD_INTERVAL_MS = 30;

const GPU_LAYER_ID = 'contour-gpu-layer';
const LABEL_SOURCE_ID = 'contour-label-source';
const LABEL_LAYER_ID = 'contour-master-label-layer';
const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

function getPvaContourThemeColor() {
    return stateManager.currentTheme === 'dark' ? '#ffffff' : '#000000';
}

function getPvaContourGlowColor() {
    return stateManager.currentTheme === 'dark' ? '#00c8ff' : '#007c91';
}

function pvaZoomWidthExpression(baseWidth, isGlow = false) {
    const expression = ['interpolate', ['linear'], ['zoom']];
    const zoomStops = [[2, 0.9, 2.4], [5, 1.0, 2.6], [8, 1.4, 3.2], [11, 1.8, 4.0], [14, 2.1, 4.8]];

    for (const [zoom, scale, glowWidth] of zoomStops) {
        const scaledWidth = ['*', baseWidth, scale];
        expression.push(zoom, isGlow
            ? ['+', scaledWidth, glowWidth]
            : ['case', ['has', 'outlineColor'], scaledWidth, baseWidth]);
    }

    return expression;
}

function themeContourFeatures(featureCollection, masterData) {
    if (!featureCollection || !Array.isArray(featureCollection.features)) {
        return featureCollection;
    }

    const activeParam = (
        masterData?.parameter ||
        stateManager.paramConfig?.id ||
        stateManager.activeParam ||
        stateManager.manifest?.parameter ||
        ''
    ).toLowerCase();

    // 1. 2m Temperature (Freezing Line)
    if (activeParam === '2t') {
        const freezingLabel = stateManager.currentUnits === 'metric' ? '0°C' : '32°F';
        for (const feature of featureCollection.features) {
            const name = String(feature?.properties?.name || '');
            if (feature?.properties && (Number(name) === 273.15 || /freez|273\.15/i.test(name))) {
                feature.properties.name = freezingLabel;
            }
        }
        return featureCollection;
    }

    // 2. Surface Precipitation Rate (MSLP Isobars + 1000-500mb Thickness)
    const isPrate = activeParam.includes('prate') || activeParam.includes('precip') || masterData?.parameter === 'prate';
    if (isPrate) {
        const isDark = stateManager.currentTheme === 'dark';
        const mslpColor = isDark ? '#ffffff' : '#000000';
        const zoom = mapInstance ? mapInstance.getZoom() : 5;

        // Find how many features are MSLP isobars (values between 850 and 1100 mb)
        let mslpCount = 0;
        for (let i = 0; i < featureCollection.features.length; i++) {
            const v = parseFloat(String(featureCollection.features[i]?.properties?.name || ''));
            if (v >= 850 && v <= 1100) {
                mslpCount = i + 1;
            }
        }

        const totalFeatures = featureCollection.features.length;
        const thicknessCount = Math.max(1, totalFeatures - mslpCount);

        for (let i = 0; i < totalFeatures; i++) {
            const feature = featureCollection.features[i];
            if (!feature) continue;
            const props = feature.properties || (feature.properties = {});

            // Extract numeric value from any possible key
            const rawVal = props.name ?? props.level ?? props.value ?? props.val ?? props.target;
            let val = parseFloat(String(rawVal || '').replace(/[^0-9.-]/g, ''));

            const unit = String(props.unit || '').toLowerCase();
            const idStr = String(props.id || '').toLowerCase();
            const nameStr = String(props.name || '').toLowerCase();

            // Thickness Identification
            let isThickness = (mslpCount > 0 && i >= mslpCount) ||
                              unit === 'dam' || 
                              idStr.includes('thick') || 
                              nameStr.includes('thick') ||
                              (val >= 350 && val <= 750) || 
                              (val >= 3500 && val <= 7500);

            if (isThickness) {
                let thickDam = val;
                if (isNaN(thickDam) || thickDam < 350) {
                    const thickIdx = i - mslpCount;
                    const anchor540Idx = Math.round(thicknessCount * 0.4);
                    thickDam = 540 + (thickIdx - anchor540Idx) * 6;
                    props.name = String(thickDam);
                } else if (thickDam >= 3500) {
                    thickDam = thickDam / 10.0;
                    props.name = String(Math.round(thickDam));
                }

                // Red for > 540 dam, Blue for <= 540 dam
                const isCold = thickDam <= 540;
                const thickColor = isCold ? '#2563eb' : '#dc2626';

                props.color = thickColor;
                props.stroke = thickColor;
                props.labelColor = thickColor;
                props.labelHaloColor = isDark ? '#0b0f19' : '#ffffff';
                props.width = Math.abs(thickDam - 540) < 0.5 ? 2.0 : 1.4;
                props.opacity = 0.95;
                props.dotted = true;
            } else {
                // MSLP Isobars (solid line)
                props.color = mslpColor;
                props.stroke = mslpColor;
                props.labelColor = mslpColor;
                props.labelHaloColor = isDark ? '#0b0f19' : '#ffffff';
                props.width = 1.5;
                props.opacity = 0.9;
                props.dotted = false;
            }
        }

        // When zoomed out (< 5.0), decimate 2mb MSLP intervals down to 4mb; keep all thickness lines
        if (zoom < 5.0) {
            featureCollection.features = featureCollection.features.filter(f => {
                if (f?.properties?.dotted) return true;
                const v = parseFloat(String(f?.properties?.name || ''));
                return isNaN(v) || Math.round(v) % 4 === 0;
            });
        }

        return featureCollection;
    }

    // 3. 500mb PVA / Vorticity Heights
    if (activeParam === 'pva' || activeParam === 'z500_anom') {
        const contourColor = getPvaContourThemeColor();
        const glowColor = getPvaContourGlowColor();
        const isDarkTheme = stateManager.currentTheme === 'dark';

        for (const feature of featureCollection.features) {
            if (!feature || !feature.properties) continue;
            const is540Line = Number(feature.properties.name) === 540;
            const featureColor = is540Line ? '#4169E1' : contourColor;

            feature.properties.color = featureColor;
            feature.properties.stroke = featureColor;

            feature.properties.outlineColor = isDarkTheme ? glowColor : null;
            feature.properties.outlineOpacity = isDarkTheme ? 0.8 : 0;
            feature.properties.outlineBlur = isDarkTheme ? 2.0 : 0;

            feature.properties.labelColor = is540Line ? featureColor : (isDarkTheme ? '#ffffff' : '#000000');
            feature.properties.labelHaloColor = isDarkTheme ? '#0b0f19' : '#ffffff';

            if (is540Line) {
                feature.properties.width = Math.max(Number(feature.properties.width) || 1.6, 2.4);
            }
        }
    }

    return featureCollection;
}

// ───────────────────────── GPU line layer ─────────────────────────

// One instance per line segment, 28 bytes:
//   f32 p0.x p0.y p1.x p1.y (web-mercator 0..1) | f32 width (css px) | u8x4 line RGBA | u8x4 casing RGBA (alpha 0 = no casing)
const INSTANCE_STRIDE = 28;

// 🌟 [zoom, scale, glow, alpha]
// Stays 100% opaque down to continental zoom (3.2), then drops off significantly when zoomed out further (<3.2)
const WIDTH_STOPS = [
    [1.5,  0.45, 1.6, 0.25],
    [2.5,  0.60, 1.8, 0.40],
    [3.2,  0.85, 2.2, 1.00],
    [5.0,  1.00, 2.6, 1.00],
    [8.0,  1.30, 3.2, 1.00],
    [11.0, 1.70, 4.0, 1.00],
    [14.0, 2.10, 4.8, 1.00]
];

// Shared vertex shader body. PROJECT(p) turns a mercator (0..1) position into clip space.
const VERT_BODY = `
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_p0;
layout(location=2) in vec2 a_p1;
layout(location=3) in float a_width;
layout(location=4) in vec4 a_color;
layout(location=5) in vec4 a_outline;
uniform vec2 u_viewport;
uniform float u_offsetX;
uniform float u_pass;
uniform float u_scale;
uniform float u_glow;
uniform float u_alpha;
uniform float u_dpr;
out vec4 v_color;
void main() {
    vec4 c0 = PROJECT(vec2(a_p0.x + u_offsetX, a_p0.y));
    vec4 c1 = PROJECT(vec2(a_p1.x + u_offsetX, a_p1.y));
    vec2 hv = u_viewport * 0.5;
    vec2 s0 = c0.xy / c0.w * hv;
    vec2 s1 = c1.xy / c1.w * hv;

    bool outlined = a_outline.a > 0.0;
    float w = a_width;
    vec4 col = a_color;
    if (u_pass > 0.5) {
        if (!outlined) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); v_color = vec4(0.0); return; }
        w = a_width * u_scale + u_glow;
        col = a_outline;
    } else {
        w = a_width * u_scale;
    }
    w *= u_dpr;

    vec2 d = s1 - s0;
    float len = length(d);
    vec2 dir = len > 0.0001 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 pos = mix(s0, s1, a_corner.x) + dir * (a_corner.x - 0.5) * w + nrm * a_corner.y * w * 0.5;
    float wv = mix(c0.w, c1.w, a_corner.x);
    float zv = USE_PROJ_Z == 1 ? mix(c0.z, c1.z, a_corner.x) : 0.0;
    gl_Position = vec4(pos / hv * wv, zv, wv);
    
    // Zoom-dependent alpha fade for contours
    v_color = vec4(col.rgb, col.a * u_alpha);
}`;

// Flat map: our own matrix
const MERCATOR_VERT = `#version 300 es
uniform mat4 u_matrix;
#define PROJECT(p) (u_matrix * vec4((p), 0.0, 1.0))
#define USE_PROJ_Z 0
` + VERT_BODY;

// Globe: MapLibre injects its own projection code (projectTile) through args.shaderData
function makeGlobeVert(sd, preludeFirst) {
    const inject = preludeFirst
        ? `${sd.vertexShaderPrelude}\n${sd.define}`
        : `${sd.define}\n${sd.vertexShaderPrelude}`;
    return `#version 300 es\n${inject}\n#define PROJECT(p) projectTile(p)\n#define USE_PROJ_Z 1\n` + VERT_BODY;
}

const FRAG_SRC = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
    outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}`;

const _logged = new Set();
function logOnce(key, ...args) {
    if (_logged.has(key)) return;
    _logged.add(key);
    console.log('[contours]', key, ...args);
}

const gpu = {
    map: null, gl: null, ready: false,
    program: null, vao: null, cornerBuf: null, instBuf: null, u: {},
    pending: null, pendingCount: 0, dirty: false, count: 0,
    globePrograms: new Map(), dbg: {}
};

function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('Contour shader error:', gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
    }
    return sh;
}

function buildProgram(gl, vertSrc = MERCATOR_VERT) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('Contour program link error:', gl.getProgramInfoLog(prog));
        gl.deleteProgram(prog);
        return null;
    }
    return prog;
}

function getGlobeProgram(gl, sd) {
    const key = sd.variantName || 'default';
    if (gpu.globePrograms.has(key)) return gpu.globePrograms.get(key);

    let prog = buildProgram(gl, makeGlobeVert(sd, true));
    if (!prog) prog = buildProgram(gl, makeGlobeVert(sd, false));

    let entry = null;
    if (prog) {
        const L = (n) => gl.getUniformLocation(prog, n);
        entry = {
            program: prog,
            u: {
                viewport: L('u_viewport'), offsetX: L('u_offsetX'), pass: L('u_pass'),
                scale: L('u_scale'), glow: L('u_glow'), alpha: L('u_alpha'), dpr: L('u_dpr'),
                pMatrix: L('u_projection_matrix'),
                pTile: L('u_projection_tile_mercator_coords'),
                pClip: L('u_projection_clipping_plane'),
                pTrans: L('u_projection_transition'),
                pFallback: L('u_projection_fallback_matrix')
            }
        };
        logOnce('globe-program', 'compiled globe shader variant:', key);
    } else {
        logOnce('globe-program-failed', 'could not compile the globe shader variant:', key);
    }
    gpu.globePrograms.set(key, entry);
    return entry;
}

function zoomStops(zoom) {
    const first = WIDTH_STOPS[0];
    const last = WIDTH_STOPS[WIDTH_STOPS.length - 1];
    if (zoom <= first[0]) return { scale: first[1], glow: first[2], alpha: first[3] };
    if (zoom >= last[0]) return { scale: last[1], glow: last[2], alpha: last[3] };
    for (let i = 1; i < WIDTH_STOPS.length; i++) {
        const a = WIDTH_STOPS[i - 1];
        const b = WIDTH_STOPS[i];
        if (zoom <= b[0]) {
            const t = (zoom - a[0]) / (b[0] - a[0]);
            return {
                scale: a[1] + (b[1] - a[1]) * t,
                glow: a[2] + (b[2] - a[2]) * t,
                alpha: a[3] + (b[3] - a[3]) * t
            };
        }
    }
    return { scale: last[1], glow: last[2], alpha: last[3] };
}

const gpuLayer = {
    id: GPU_LAYER_ID,
    type: 'custom',
    renderingMode: '2d',

    onAdd(map, gl) {
        gpu.map = map;
        gpu.gl = gl;
        gpu.ready = false;
        if (typeof gl.createVertexArray !== 'function') {
            console.error('Contours need WebGL2 (this map is using WebGL1).');
            return;
        }
        const prog = buildProgram(gl);
        if (!prog) return;
        gpu.program = prog;
        gpu.u = {
            matrix: gl.getUniformLocation(prog, 'u_matrix'),
            viewport: gl.getUniformLocation(prog, 'u_viewport'),
            offsetX: gl.getUniformLocation(prog, 'u_offsetX'),
            pass: gl.getUniformLocation(prog, 'u_pass'),
            scale: gl.getUniformLocation(prog, 'u_scale'),
            glow: gl.getUniformLocation(prog, 'u_glow'),
            alpha: gl.getUniformLocation(prog, 'u_alpha'),
            dpr: gl.getUniformLocation(prog, 'u_dpr')
        };

        gpu.cornerBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.cornerBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        gpu.instBuf = gl.createBuffer();
        gpu.vao = gl.createVertexArray();
        gl.bindVertexArray(gpu.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.cornerBuf);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.instBuf);
        const S = INSTANCE_STRIDE;
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, 0);  gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, S, 8);  gl.vertexAttribDivisor(2, 1);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, S, 16); gl.vertexAttribDivisor(3, 1);
        gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, S, 20); gl.vertexAttribDivisor(4, 1);
        gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, true, S, 24); gl.vertexAttribDivisor(5, 1);

        gl.bindVertexArray(null);
        gpu.ready = true;
        window.__contourGPU = gpu;
        logOnce('ready', 'GPU layer initialised, WebGL2 OK');
    },

    render(gl, arg) {
        if (!gpu.ready) { logOnce('render-before-ready'); return; }

        if (gpu.dirty) {
            gl.bindBuffer(gl.ARRAY_BUFFER, gpu.instBuf);
            gl.bufferData(gl.ARRAY_BUFFER, gpu.pending || new Uint8Array(0), gl.DYNAMIC_DRAW);
            gpu.count = gpu.pending ? gpu.pendingCount : 0;
            gpu.dirty = false;
            logOnce('first-upload', 'segments:', gpu.count);
        }
        if (!gpu.count) { logOnce('no-segments', 'render ran but there is nothing to draw'); return; }

        const map = gpu.map;
        const pd = arg && arg.defaultProjectionData;
        const sd = arg && arg.shaderData;
        const globe = !!(pd && sd && pd.projectionTransition > 0);

        const zs = zoomStops(map.getZoom());
        const canvas = gl.canvas;
        const dpr = canvas && canvas.clientWidth ? canvas.width / canvas.clientWidth : (window.devicePixelRatio || 1);
        const wc = Math.floor((map.getCenter().lng + 180) / 360);

        let program, U, offsets, m = null, matrixName = null, probe = null;

        if (globe) {
            const gp = getGlobeProgram(gl, sd);
            if (!gp) return;
            program = gp.program;
            U = gp.u;
            offsets = [wc];
        } else {
            const candidates = [];
            if (pd && pd.fallbackMatrix) candidates.push(['fallbackMatrix', pd.fallbackMatrix]);
            if (pd && pd.mainMatrix) candidates.push(['mainMatrix', pd.mainMatrix]);
            if (arg && arg.modelViewProjectionMatrix) candidates.push(['modelViewProjectionMatrix', arg.modelViewProjectionMatrix]);
            if (arg && arg.length === 16) candidates.push(['matrix arg', arg]);

            const cc = map.getCenter();
            const cm = lonLatToMerc(cc.lng, cc.lat);
            probe = [];
            let bestDist = Infinity;
            for (const [name, mat] of candidates) {
                const wv = mat[3] * cm[0] + mat[7] * cm[1] + mat[15];
                const px = (mat[0] * cm[0] + mat[4] * cm[1] + mat[12]) / wv;
                const py = (mat[1] * cm[0] + mat[5] * cm[1] + mat[13]) / wv;
                probe.push({ name, centerNDC: [+px.toFixed(3), +py.toFixed(3)] });
                const dist = Math.hypot(px, py);
                if (isFinite(dist) && dist < bestDist) {
                    bestDist = dist;
                    m = mat;
                    matrixName = name;
                }
            }
            if (!m) { logOnce('no-matrix', 'render args keys:', arg ? Object.keys(arg) : arg); return; }
            program = gpu.program;
            U = gpu.u;
            offsets = [wc - 1, wc, wc + 1];
        }

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(true, true, true, true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        gl.useProgram(program);
        if (globe) {
            gl.uniformMatrix4fv(U.pMatrix, false, new Float32Array(pd.mainMatrix));
            gl.uniform4f(U.pTile, ...pd.tileMercatorCoords);
            gl.uniform4f(U.pClip, ...pd.clippingPlane);
            gl.uniform1f(U.pTrans, pd.projectionTransition);
            gl.uniformMatrix4fv(U.pFallback, false, new Float32Array(pd.fallbackMatrix));
        } else {
            gl.uniformMatrix4fv(U.matrix, false, new Float32Array(m));
        }
        gl.uniform2f(U.viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform1f(U.scale, zs.scale);
        gl.uniform1f(U.glow, zs.glow);
        gl.uniform1f(U.alpha, zs.alpha);
        gl.uniform1f(U.dpr, dpr);

        gl.bindVertexArray(gpu.vao);
        for (let pass = 1; pass >= 0; pass--) {
            gl.uniform1f(U.pass, pass);
            for (const w of offsets) {
                gl.uniform1f(U.offsetX, w);
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gpu.count);
            }
        }
        gl.bindVertexArray(null);

        const dk = globe ? 'globe' : 'flat';
        gpu.dbg[dk] = (gpu.dbg[dk] || 0) + 1;
        if (gpu.dbg[dk] <= 5) {
            const err = gl.getError();
            logOnce('draw-info-' + dk, {
                mode: dk,
                matrixUsed: matrixName, matrixProbe: probe,
                variant: sd && sd.variantName,
                projectionTransition: pd && pd.projectionTransition,
                zoom: map.getZoom(), dpr, worldIndex: wc,
                viewport: [gl.drawingBufferWidth, gl.drawingBufferHeight],
                segments: gpu.count, glError: err
            });
            if (err) logOnce('gl-error-' + dk + '-' + err, 'WebGL error code', err);
        }
    },

    onRemove(map, gl) {
        try {
            if (gpu.program) gl.deleteProgram(gpu.program);
            for (const e of gpu.globePrograms.values()) if (e && e.program) gl.deleteProgram(e.program);
            gpu.globePrograms.clear();
            if (gpu.cornerBuf) gl.deleteBuffer(gpu.cornerBuf);
            if (gpu.instBuf) gl.deleteBuffer(gpu.instBuf);
            if (gpu.vao) gl.deleteVertexArray(gpu.vao);
        } catch (e) {}
        gpu.program = gpu.cornerBuf = gpu.instBuf = gpu.vao = null;
        gpu.ready = false;
        gpu.count = 0;
        gpu.dirty = false;
        gpu.pending = null;
    }
};

function setActiveData(prepared) {
    gpu.pending = prepared && prepared.count ? prepared.bytes : null;
    gpu.pendingCount = prepared ? prepared.count : 0;
    gpu.dirty = true;
    if (mapInstance) mapInstance.triggerRepaint();
}

// ───────────────────────── Data prep (JS side, cached) ─────────────────────────

function lonLatToMerc(lon, lat) {
    const l = Math.max(-85.0511, Math.min(85.0511, lat));
    return [
        (lon + 180) / 360,
        0.5 - Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360)) / (2 * Math.PI)
    ];
}

function mercToLonLat(x, y) {
    let lon = x * 360 - 180;
    if (lon > 180) lon -= 360;
    else if (lon < -180) lon += 360;
    const latRad = 2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2;
    const lat = (latRad * 180) / Math.PI;
    return [lon, lat];
}

function smoothMercatorLine(rawCoords, subdivisions = 3, tension = 0.32) {
    if (!rawCoords || rawCoords.length < 3) {
        return rawCoords.map(c => lonLatToMerc(c[0], c[1]));
    }

    const pts = new Array(rawCoords.length);
    for (let i = 0; i < rawCoords.length; i++) {
        pts[i] = lonLatToMerc(rawCoords[i][0], rawCoords[i][1]);
    }

    const n = pts.length;
    const isClosed = Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]) < 1e-6;

    const ring = isClosed ? pts.slice(0, -1) : pts;
    const count = ring.length;
    if (count < 3) return pts;

    const smoothed = [];
    const numSegments = isClosed ? count : count - 1;

    for (let i = 0; i < numSegments; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % count];

        if (Math.abs(p2[0] - p1[0]) > 0.4) {
            smoothed.push(p1);
            continue;
        }

        let p0, p3;
        if (isClosed) {
            p0 = ring[(i - 1 + count) % count];
            p3 = ring[(i + 2) % count];
        } else {
            p0 = i > 0 ? ring[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
            p3 = (i + 2 < count) ? ring[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
        }

        if (Math.abs(p1[0] - p0[0]) > 0.4) p0 = [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
        if (Math.abs(p3[0] - p2[0]) > 0.4) p3 = [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];

        const t1x = tension * (p2[0] - p0[0]);
        const t1y = tension * (p2[1] - p0[1]);
        const t2x = tension * (p3[0] - p1[0]);
        const t2y = tension * (p3[1] - p1[1]);

        for (let s = 0; s < subdivisions; s++) {
            const t = s / subdivisions;
            const t2 = t * t;
            const t3 = t2 * t;

            const h00 = 2 * t3 - 3 * t2 + 1;
            const h10 = t3 - 2 * t2 + t;
            const h01 = -2 * t3 + 3 * t2;
            const h11 = t3 - t2;

            const x = h00 * p1[0] + h10 * t1x + h01 * p2[0] + h11 * t2x;
            const y = h00 * p1[1] + h10 * t1y + h01 * p2[1] + h11 * t2y;
            smoothed.push([x, y]);
        }
    }

    if (isClosed) {
        smoothed.push([smoothed[0][0], smoothed[0][1]]);
    } else {
        smoothed.push(pts[n - 1]);
    }

    return smoothed;
}

function emitDashedSegments(line, dashLen, gapLen, onSegment) {
    let isDrawing = true;
    let remainingInPhase = dashLen;

    let p0 = line[0];
    for (let i = 1; i < line.length; i++) {
        const p1 = line[i];
        const segDx = p1[0] - p0[0];
        const segDy = p1[1] - p0[1];

        if (Math.abs(segDx) > 0.4) {
            p0 = p1;
            isDrawing = true;
            remainingInPhase = dashLen;
            continue;
        }

        const segLen = Math.hypot(segDx, segDy);
        if (segLen < 1e-7) continue;

        let curT = 0;
        while (curT < 1.0) {
            const distAvail = (1.0 - curT) * segLen;
            if (distAvail <= remainingInPhase) {
                if (isDrawing) {
                    const startPt = [p0[0] + curT * segDx, p0[1] + curT * segDy];
                    onSegment(startPt, p1);
                }
                remainingInPhase -= distAvail;
                curT = 1.0;
            } else {
                const tNext = curT + (remainingInPhase / segLen);
                const endPt = [p0[0] + tNext * segDx, p0[1] + tNext * segDy];
                if (isDrawing) {
                    const startPt = [p0[0] + curT * segDx, p0[1] + curT * segDy];
                    onSegment(startPt, endPt);
                }
                isDrawing = !isDrawing;
                remainingInPhase = isDrawing ? dashLen : gapLen;
                curT = tNext;
            }
        }
        p0 = p1;
    }
}

function packColor(str, alpha, fallback = '#ffffff') {
    const s = String(str || fallback).trim();
    let r = 255, g = 255, b = 255;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (hex) {
        let h = hex[1];
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        r = parseInt(h.slice(0, 2), 16);
        g = parseInt(h.slice(2, 4), 16);
        b = parseInt(h.slice(4, 6), 16);
    } else {
        const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
        if (rgb) { r = +rgb[1]; g = +rgb[2]; b = +rgb[3]; }
    }
    const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

// Themed GeoJSON -> compact GPU instance bytes + label points
function prepareStep(featureCollection) {
    const feats = featureCollection?.features || [];
    const SUBDIVISIONS = 3;
    let maxSegs = 0;
    const items = [];
    for (const f of feats) {
        const g = f?.geometry;
        if (!g) continue;
        const lines = g.type === 'MultiLineString' ? g.coordinates : (g.type === 'LineString' ? [g.coordinates] : null);
        if (!lines) continue;
        for (const l of lines) {
            if (l.length > 1) {
                maxSegs += (l.length >= 3) ? (l.length - 1) * (SUBDIVISIONS + 2) + 8 : (l.length - 1);
            }
        }
        items.push({ props: f.properties || {}, lines });
    }

    const buf = new ArrayBuffer(Math.max(1, maxSegs) * INSTANCE_STRIDE);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    const labelFeatures = [];
    let n = 0;

    for (const { props, lines } of items) {
        const hasOutline = props.outlineColor !== undefined && props.outlineColor !== null;
        const width = Number(props.width) > 0 ? Number(props.width) : 2.0;
        const color = packColor(props.color || props.stroke, props.opacity ?? 0.95, '#4169E1');
        const outline = hasOutline ? packColor(props.outlineColor, props.outlineOpacity ?? 0.8) : 0;
        const name = props.name;

        for (const rawLine of lines) {
            if (rawLine.length < 2) continue;

            const line = smoothMercatorLine(rawLine, SUBDIVISIONS, 0.32);
            const len = line.length;
            if (len < 2) continue;

            if (props.dotted) {
                emitDashedSegments(line, 0.0030, 0.0020, (pA, pB) => {
                    if (n * 7 + 6 >= f32.length) return;
                    const o = n * 7;
                    f32[o]     = pA[0]; 
                    f32[o + 1] = pA[1];
                    f32[o + 2] = pB[0];  
                    f32[o + 3] = pB[1];
                    f32[o + 4] = width;
                    u32[o + 5] = color;
                    u32[o + 6] = outline;
                    n++;
                });
            } else {
                let prev = line[0];
                for (let i = 1; i < len; i++) {
                    const cur = line[i];
                    if (Math.abs(cur[0] - prev[0]) < 0.5) {
                        if (n * 7 + 6 >= f32.length) break;
                        const o = n * 7;
                        f32[o]     = prev[0]; 
                        f32[o + 1] = prev[1];
                        f32[o + 2] = cur[0];  
                        f32[o + 3] = cur[1];
                        f32[o + 4] = width;
                        u32[o + 5] = color;
                        u32[o + 6] = outline;
                        n++;
                    }
                    prev = cur;
                }
            }

            // One label per reasonably long line, positioned along smooth tangent
            if (name !== undefined && name !== null && len >= (6 * SUBDIVISIONS)) {
                const mid = len >> 1;
                const a = line[mid];
                const b = line[mid + 1];
                if (b && Math.abs(b[0] - a[0]) < 0.5) {
                    let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
                    if (angle > 90) angle -= 180;
                    else if (angle < -90) angle += 180;
                    const [lon, lat] = mercToLonLat(a[0], a[1]);
                    labelFeatures.push({
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [lon, lat] },
                        properties: {
                            name: String(name),
                            angle,
                            color: props.color,
                            labelColor: props.labelColor,
                            labelHaloColor: props.labelHaloColor
                        }
                    });
                }
            }
        }
    }

    const bytes = n === maxSegs ? new Uint8Array(buf) : new Uint8Array(buf.slice(0, n * INSTANCE_STRIDE));
    return { bytes, count: n, labels: { type: 'FeatureCollection', features: labelFeatures } };
}

function getStepData(stepNum, masterData, rawStep = stepNum) {
    const cacheKey = `${stepNum}_${stateManager.currentTheme || 'light'}`;
    if (stepCache.has(cacheKey)) return stepCache.get(cacheKey);

    const stepData = masterData.steps[String(stepNum)] ||
                     masterData.steps[String(stepNum).padStart(3, '0')] ||
                     masterData.steps[`F${String(stepNum).padStart(3, '0')}`] ||
                     masterData.steps[stepNum] ||
                     masterData.steps[rawStep];
    if (!stepData) return null;

    const decoded = binaryStepToGeoJson(stepNum, masterData) ||
                    { ...stepData, features: (stepData.features || []).slice() };
    const themed = themeContourFeatures(decoded, masterData);
    const prepared = prepareStep(themed);
    stepCache.set(cacheKey, prepared);
    return prepared;
}

// ───────────────────────── Layer plumbing ─────────────────────────

function ensureLayers() {
    if (!mapInstance) return false;
    try {
        if (!mapInstance.getLayer(GPU_LAYER_ID)) { mapInstance.addLayer(gpuLayer); logOnce('layer-added', 'custom layer added to map'); }

        if (!mapInstance.getSource(LABEL_SOURCE_ID)) {
            mapInstance.addSource(LABEL_SOURCE_ID, { type: 'geojson', data: EMPTY_GEOJSON });
        }
        if (!mapInstance.getLayer(LABEL_LAYER_ID)) {
            mapInstance.addLayer({
                id: LABEL_LAYER_ID,
                type: 'symbol',
                source: LABEL_SOURCE_ID,
                layout: {
                    'symbol-placement': 'point',
                    'text-field': ['get', 'name'],
                    'text-size': ['case', ['has', 'labelColor'], 14, 11],
                    'text-font': ['Noto Sans Bold'],
                    'text-rotate': ['get', 'angle'],
                    'text-rotation-alignment': 'map',
                    'text-pitch-alignment': 'map',
                    'text-padding': 12
                },
                paint: {
                    'text-color': ['coalesce', ['get', 'labelColor'], ['get', 'color'], '#FFFFFF'],
                    'text-halo-color': ['coalesce', ['get', 'labelHaloColor'], '#0b0f19'],
                    'text-halo-width': ['case', ['has', 'labelColor'], 2.5, 2.0],
                    // 🌟 Keep label values at 100% full opacity at every zoom level
                    'text-opacity': 1.0
                }
            });
        }
        return true;
    } catch (e) {
        console.warn('Contour layers not ready yet:', e);
        return false;
    }
}

function setLabels(fc) {
    const src = mapInstance && mapInstance.getSource(LABEL_SOURCE_ID);
    if (src) src.setData(fc || EMPTY_GEOJSON);
}

function applyStep(stepNum, masterData, rawStep, force) {
    if (!mapInstance) return;
    if (!ensureLayers()) return;

    const data = getStepData(stepNum, masterData, rawStep);

    if (!data) {
        setActiveData(null);
        setLabels(EMPTY_GEOJSON);
        displayedStep = null;
        return;
    }

    if (displayedStep !== stepNum || force) {
        setActiveData(data);
        setLabels(data.labels);
    }
    displayedStep = stepNum;
}

function scheduleApply(stepNum, rawStep, force) {
    pendingApply = { stepNum, rawStep, force: !!(force || pendingApply?.force) };
    if (applyQueued) return;
    applyQueued = true;
    requestAnimationFrame(() => {
        applyQueued = false;
        const p = pendingApply;
        pendingApply = null;
        if (p && activeMasterContours?.steps) applyStep(p.stepNum, activeMasterContours, p.rawStep, p.force);
    });
}

function startPreload(masterData, aroundStep) {
    const run = ++preloadRun;
    preloadStartedFor = masterData;
    const nums = Object.keys(masterData?.steps || {})
        .map(k => parseInt(String(k).replace(/\D/g, ''), 10))
        .filter(n => !isNaN(n))
        .sort((a, b) => Math.abs(a - aroundStep) - Math.abs(b - aroundStep));
    let idx = 0;

    const next = () => {
        if (run !== preloadRun || !mapInstance || activeMasterContours !== masterData) return;
        const currentTheme = stateManager.currentTheme || 'light';
        while (idx < nums.length && stepCache.has(`${nums[idx]}_${currentTheme}`)) idx++;
        if (idx >= nums.length) return;
        getStepData(nums[idx++], masterData);
        setTimeout(next, PRELOAD_INTERVAL_MS);
    };
    setTimeout(next, 0);
}

export function initVectorContours(map) {
    mapInstance = map;

    if (!map._contoursZoomBound) {
        map._contoursZoomBound = true;
        map._contoursLowZoom = map.getZoom() < 5.0;
        map.on('zoomend', () => {
            const lowZoom = map.getZoom() < 5.0;
            if (lowZoom === map._contoursLowZoom) return;
            map._contoursLowZoom = lowZoom;

            const activeParam = (stateManager.paramConfig?.id || stateManager.activeParam || '').toLowerCase();
            if (activeParam === 'prate' && stateManager.currentStepIndex !== undefined) {
                const step = stateManager.globalSteps?.[stateManager.currentStepIndex]?.step;
                if (step !== undefined) updateVectorContours(step, true);
            }
        });
    }
}

export function clearVectorContours() {
    activeMasterContours = null;
    activeContourBinary = null;
    activeMasterKey = null;
    fetchPromise = null;

    preloadRun++;
    preloadStartedFor = null;
    pendingApply = null;
    stepCache.clear();

    if (mapInstance) {
        try {
            if (mapInstance.getLayer(GPU_LAYER_ID)) mapInstance.removeLayer(GPU_LAYER_ID);
            if (mapInstance.getLayer(LABEL_LAYER_ID)) mapInstance.removeLayer(LABEL_LAYER_ID);
            if (mapInstance.getSource(LABEL_SOURCE_ID)) mapInstance.removeSource(LABEL_SOURCE_ID);
        } catch (e) {}
    }

    displayedStep = null;
    currentVisibleStep = 0;
}

function getMasterKeyComponents() {
    const model = (stateManager.manifest?.model || stateManager.activeModel || 'ecmwf').toLowerCase();
    const param = (stateManager.paramConfig?.id || stateManager.activeParam || stateManager.manifest?.parameter || '2t').toLowerCase();
    const targetDate = stateManager.manifest?.date || stateManager.currentDate;
    const runCycle = (stateManager.manifest?.run || stateManager.currentCycle || '').toLowerCase();
    return { model, param, targetDate, runCycle, key: `${model}_${param}_${targetDate}_${runCycle}` };
}

async function loadMasterContourFile() {
    const { model, param, targetDate, runCycle, key } = getMasterKeyComponents();

    if (activeMasterKey === key && activeMasterContours) {
        return activeMasterContours;
    }

    if (fetchPromise && activeMasterKey === key) {
        return await fetchPromise;
    }

    activeMasterKey = key;

    const urlsToTry = [];
    if (param === 'pva' || param === 'z500_anom') {
        if (targetDate && runCycle) {
            urlsToTry.push(`${stateManager.BASE_URL}${model}_z500_${targetDate}_${runCycle}_contours.json?v=${Date.now()}`);
        }
        urlsToTry.push(`${stateManager.BASE_URL}${model}_z500_contours.json?v=${Date.now()}`);
    }
    if (targetDate && runCycle) {
        urlsToTry.push(`${stateManager.BASE_URL}${model}_${param}_${targetDate}_${runCycle}_contours.json?v=${Date.now()}`);
    }
    urlsToTry.push(`${stateManager.BASE_URL}${model}_${param}_contours.json?v=${Date.now()}`);
    if (param === '2t' || param.includes('temp')) {
        urlsToTry.push(`${stateManager.BASE_URL}${model}_tmp2m_contours.json?v=${Date.now()}`);
    }

    fetchPromise = (async () => {
        for (const contourUrl of urlsToTry) {
            try {
                const resp = await fetch(contourUrl).catch(() => null);
                if (resp && resp.ok) {
                    const data = await resp.json().catch(() => null);
                    if (data && data.steps) {
                        activeMasterContours = data;
                        if (data.binary?.file && typeof DecompressionStream !== 'undefined') {
                            const binaryResp = await fetch(`${stateManager.BASE_URL}${data.binary.file}?v=${Date.now()}`).catch(() => null);
                            if (binaryResp?.ok) {
                                activeContourBinary = await decodeContourBinary(
                                    await binaryResp.arrayBuffer(),
                                    data.binary.scale || 1000
                                );
                            }
                        }
                        console.log(`✅ Loaded Master Contours from: ${contourUrl}`);
                        return activeMasterContours;
                    }
                }
            } catch (err) {}
        }
        activeMasterContours = null;
        return null;
    })();

    return await fetchPromise;
}

async function decodeContourBinary(buffer, coordinateScale = 1000) {
    let bytes = new Uint8Array(buffer);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const format = String.fromCharCode(...bytes.subarray(0, 4));
    if (format === 'CTV2') return decodeContourV2(view, coordinateScale);
    if (format !== 'CTV1') return null;
    let offset = 4;
    const stepCount = view.getUint32(offset, true);
    offset += 4;
    const steps = new Map();

    for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
        const step = view.getUint32(offset, true);
        const featureCount = view.getUint32(offset + 4, true);
        offset += 8;
        const features = [];
        for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
            const lineCount = view.getUint32(offset, true);
            offset += 4;
            const lines = [];
            for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
                const pointCount = view.getUint32(offset, true);
                offset += 4;
                const line = [];
                let x = 0;
                let y = 0;
                for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
                    x += view.getInt32(offset, true);
                    y += view.getInt32(offset + 4, true);
                    offset += 8;
                    line.push([x / 1000, y / 1000]);
                }
                lines.push(line);
            }
            features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines } });
        }
        steps.set(String(step), features);
    }
    return steps;
}

function decodeContourV2(view, coordinateScale) {
    let offset = 4;
    const stepCount = view.getUint32(offset, true);
    offset += 4;
    const steps = new Map();

    for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
        const step = view.getUint32(offset, true);
        const featureCount = view.getUint32(offset + 4, true);
        const payloadLength = view.getUint32(offset + 8, true);
        offset += 12;
        const payloadEnd = offset + payloadLength;
        const features = [];

        for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
            const lineCount = view.getUint32(offset, true);
            offset += 4;
            const lengths = [];
            let pointCount = 0;
            for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
                const length = view.getUint32(offset, true);
                offset += 4;
                lengths.push(length);
                pointCount += length;
            }

            const starts = [];
            for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
                starts.push([
                    view.getInt32(offset, true) / coordinateScale,
                    view.getInt32(offset + lineCount * 4, true) / coordinateScale
                ]);
                offset += 4;
            }
            offset += lineCount * 4;

            const deltaCount = pointCount - lineCount;
            const deltaX = [];
            const deltaY = [];
            for (let deltaIndex = 0; deltaIndex < deltaCount; deltaIndex++) {
                deltaX.push(view.getInt16(offset, true));
                offset += 2;
            }
            for (let deltaIndex = 0; deltaIndex < deltaCount; deltaIndex++) {
                deltaY.push(view.getInt16(offset, true));
                offset += 2;
            }

            const lines = [];
            let deltaIndex = 0;
            for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
                let x = starts[lineIndex][0];
                let y = starts[lineIndex][1];
                const line = [[x, y]];
                for (let pointIndex = 1; pointIndex < lengths[lineIndex]; pointIndex++) {
                    x += deltaX[deltaIndex] / coordinateScale;
                    y += deltaY[deltaIndex] / coordinateScale;
                    deltaIndex++;
                    line.push([x, y]);
                }
                lines.push(line);
            }
            features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines } });
        }

        if (offset !== payloadEnd) return null;
        steps.set(String(step), features);
    }
    return steps;
}

function binaryStepToGeoJson(step, masterData) {
    if (!masterData?.steps) return null;
    const stepNum = typeof step === 'number' ? step : parseInt(String(step).replace(/\D/g, ''), 10) || 0;
    const stepKey = String(stepNum);

    const features = activeContourBinary?.get(stepKey) || 
                     activeContourBinary?.get(String(step)) ||
                     activeContourBinary?.get(stepKey.padStart(3, '0'));

    const stepObj = masterData.steps[stepKey] ||
                    masterData.steps[stepKey.padStart(3, '0')] ||
                    masterData.steps[`F${stepKey.padStart(3, '0')}`] ||
                    masterData.steps[step] ||
                    masterData.steps[String(step)];

    const metadata = stepObj?.features?.map(feature => feature.properties) || [];
    if (!features) return null;
    return {
        type: 'FeatureCollection',
        features: features.map((feature, index) => ({
            ...feature,
            properties: metadata[index] || {}
        }))
    };
}

export async function updateVectorContours(step, forceUpdate = false) {
    if (!mapInstance) return;

    let stepNum = typeof step === 'number' ? step : parseInt(String(step).replace(/\D/g, ''), 10) || 0;
    currentVisibleStep = stepNum;

    const masterData = await loadMasterContourFile();
    if (!masterData?.steps || currentVisibleStep !== stepNum) return;

    if (forceUpdate) {
        stepCache.clear();
        preloadStartedFor = null;
    }

    scheduleApply(stepNum, step, forceUpdate);
    if (preloadStartedFor !== masterData) startPreload(masterData, stepNum);
}

export async function preloadAllContours() {
    const masterData = await loadMasterContourFile();
    if (!masterData?.steps && preloadStartedFor !== masterData) startPreload(masterData, currentVisibleStep);
}
