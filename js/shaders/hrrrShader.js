// js/shaders/hrrrShader.js
// Native-grid HRRR layer: raw uint8 data in an R8 or RG8 texture with Bicubic B-Spline interpolation.
// Each screen pixel is converted to lon/lat, forward-projected into the HRRR Lambert grid,
// and smoothly interpolated across neighboring native cells. Works in mercator (2D) and globe (3D) modes.
import { 
    getPaletteForParameter as getLightPalette, 
    FRZR_PALETTE, 
    SLEET_PALETTE, 
    SNOW_PALETTE 
} from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

const DEG = Math.PI / 180;

function lonToMercX(lon) { return (lon + 180) / 360; }
function latToMercY(lat) {
    return 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) / (2 * Math.PI);
}

/** 🌟 Ryan Maue's Radar Reflectivity stops (from maue_radar.json: 9 dBZ to 72 dBZ) */
const MAUE_RADAR_STOPS = [
    [9, "#c9c9c9"], [9.75, "#c4c4c4"], [10.5, "#bfbfbf"], [11.25, "#b1b1b1"],
    [12, "#a2a2a2"], [12.75, "#949494"], [13.5, "#858585"], [14.25, "#777777"],
    [15, "#686868"], [15.75, "#5a5a5a"], [16.5, "#546854"], [17.25, "#4d784d"],
    [18, "#458845"], [18.75, "#3c993c"], [19.5, "#32ab32"], [20.25, "#28be28"],
    [21, "#1cd21c"], [21.75, "#0fe70f"], [22.5, "#00e01e"], [23.25, "#02fd02"],
    [24, "#0af50a"], [24.75, "#13eb13"], [25.5, "#1be41b"], [26.25, "#24db24"],
    [27, "#2cd32c"], [27.75, "#30c930"], [28.5, "#2ebe2e"], [29.25, "#2bb32b"],
    [30, "#28a728"], [30.75, "#269d26"], [31.5, "#239223"], [32.25, "#2f921f"],
    [33, "#52a219"], [33.75, "#74b314"], [34.5, "#97c40e"], [35.25, "#bad507"],
    [36, "#dce503"], [36.75, "#eeed0a"], [37.5, "#eeea20"], [38.25, "#eee636"],
    [39, "#eee44c"], [39.75, "#eee062"], [40.5, "#eede78"], [41.25, "#eed379"],
    [42, "#eec168"], [42.75, "#eeb158"], [43.5, "#ee9f48"], [44.25, "#ee8d37"],
    [45, "#ee7d27"], [45.75, "#f06f22"], [46.5, "#f36325"], [47.25, "#f65727"],
    [48, "#f94b2a"], [48.75, "#fc3f2c"], [49.5, "#ff342f"], [50.25, "#f63035"],
    [51, "#e9303d"], [51.75, "#dc3045"], [52.5, "#cd304d"], [53.25, "#c13056"],
    [54, "#b4305e"], [54.75, "#b03060"], [55.5, "#b03060"], [56.25, "#b03060"],
    [57, "#b03060"], [57.75, "#b03060"], [58.5, "#b03060"], [59.25, "#b2356f"],
    [60, "#b33b83"], [60.75, "#b54196"], [61.5, "#b747aa"], [62.25, "#b84ebd"],
    [63, "#ba53d1"], [63.75, "#c448da"], [64.5, "#d03ae1"], [65.25, "#dc2be9"],
    [66, "#e71df0"], [66.75, "#f30ff8"], [67.5, "#ff00ff"], [68.25, "#ff28ff"],
    [69, "#ff53ff"], [69.75, "#ff7eff"], [70.5, "#ff92ff"], [71.25, "#ffa6ff"],
    [72, "#ffbaff"]
];

/** Converts maue_radar stops into a 256-entry array matching HRRR 0-75 dBZ scaling */
function buildMaueRadarPalette() {
    const palette = new Array(256).fill('transparent');
    for (let i = 0; i < 256; i++) {
        const dbz = (i / 255.0) * 75.0;
        if (dbz < 9.0) {
            palette[i] = 'transparent';
        } else if (dbz >= 72.0) {
            palette[i] = '#ffbaff';
        } else {
            let closestColor = MAUE_RADAR_STOPS[0][1];
            for (let s = 0; s < MAUE_RADAR_STOPS.length; s++) {
                if (MAUE_RADAR_STOPS[s][0] <= dbz) {
                    closestColor = MAUE_RADAR_STOPS[s][1];
                } else {
                    break;
                }
            }
            palette[i] = closestColor;
        }
    }
    return palette;
}

/** Mesh over the HRRR bounding box in MapLibre mercator tile space: [x, y] per vertex. */
function createBoundsMesh(bounds, cols = 96, rows = 64, pad = 0.5) {
    const x0 = lonToMercX(bounds.west - pad), x1 = lonToMercX(bounds.east + pad);
    const y0 = latToMercY(Math.min(bounds.north + pad, 85)), y1 = latToMercY(Math.max(bounds.south - pad, -85));
    const v = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const xa = x0 + (x1 - x0) * (c / cols), xb = x0 + (x1 - x0) * ((c + 1) / cols);
            const ya = y0 + (y1 - y0) * (r / rows), yb = y0 + (y1 - y0) * ((r + 1) / rows);
            v.push(xa, ya, xb, ya, xa, yb, xa, yb, xb, ya, xb, yb);
        }
    }
    return new Float32Array(v);
}

function createPaletteTexture(gl, paletteHexArray) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const data = new Uint8Array(paletteHexArray.length * 4);
    paletteHexArray.forEach((hex, i) => {
        if (hex === 'transparent' || !hex) return;
        const num = parseInt(hex.replace('#', ''), 16);
        data[i * 4] = (num >> 16) & 255;
        data[i * 4 + 1] = (num >> 8) & 255;
        data[i * 4 + 2] = num & 255;
        data[i * 4 + 3] = 255;
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, paletteHexArray.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
}

const FRAGMENT_BODY = `
    in vec2 v_merc;
    out vec4 fragColor;

    uniform sampler2D u_dataTexture;     // R8 (scalar) or RG8 (Reflectivity + P-Type)
    uniform sampler2D u_paletteTexture;  // Base / Rain palette (maue_radar)
    uniform sampler2D u_frzrPalette;     // Freezing Rain palette (pinks)
    uniform sampler2D u_sleetPalette;    // Sleet palette (purples)
    uniform sampler2D u_snowPalette;     // Snow palette (blues)

    uniform float u_hasPtype;
    uniform float u_opacity;
    uniform vec2  u_gridSize;            // nx, ny
    uniform vec2  u_gridOrigin;          // x0, y0 (meters, center of cell [0,0])
    uniform vec2  u_gridStep;            // dx, dy (meters)
    uniform vec4  u_lcc;                 // n, R*F, rho0, lon0 (radians)

    const float PI = 3.14159265358979;

    // 🌟 Cubic B-Spline basis functions
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

    // 🌟 16-tap bicubic B-spline sampling on the native Lambert grid
    float sampleSmoothSplineHRRR(sampler2D tex, vec2 gridPos, vec2 gridSize) {
        vec2 f = fract(gridPos);
        vec2 i = floor(gridPos);

        vec4 wx = cubicBSpline(f.x);
        vec4 wy = cubicBSpline(f.y);

        ivec2 maxCoord = ivec2(gridSize) - 1;

        float total = 0.0;
        for (int dy = -1; dy <= 2; dy++) {
            int yCoord = clamp(int(i.y) + dy, 0, maxCoord.y);
            
            float rowVal = wx.x * texelFetch(tex, ivec2(clamp(int(i.x) - 1, 0, maxCoord.x), yCoord), 0).r +
                           wx.y * texelFetch(tex, ivec2(clamp(int(i.x) + 0, 0, maxCoord.x), yCoord), 0).r +
                           wx.z * texelFetch(tex, ivec2(clamp(int(i.x) + 1, 0, maxCoord.x), yCoord), 0).r +
                           wx.w * texelFetch(tex, ivec2(clamp(int(i.x) + 2, 0, maxCoord.x), yCoord), 0).r;

            float w_y = (dy == -1) ? wy.x : ((dy == 0) ? wy.y : ((dy == 1) ? wy.z : wy.w));
            total += w_y * rowVal;
        }

        return clamp(total, 0.0, 1.0);
    }

    void main() {
        // mercator tile space -> lon/lat (radians)
        float lon = (v_merc.x - floor(v_merc.x)) * 2.0 * PI - PI;
        float lat = 2.0 * atan(exp((0.5 - v_merc.y) * 2.0 * PI)) - 0.5 * PI;

        // Lambert conformal conic forward projection
        float n = u_lcc.x;
        float rho = u_lcc.y / pow(tan(0.25 * PI + 0.5 * lat), n);
        float theta = n * (mod(lon - u_lcc.w + PI, 2.0 * PI) - PI);
        float x = rho * sin(theta);
        float y = u_lcc.z - rho * cos(theta);

        // meters -> native continuous cell coordinates
        vec2 gridPos = vec2((x - u_gridOrigin.x) / u_gridStep.x,
                            (y - u_gridOrigin.y) / u_gridStep.y);
        
        if (gridPos.x < 0.0 || gridPos.y < 0.0 || gridPos.x >= u_gridSize.x || gridPos.y >= u_gridSize.y) {
            discard;
        }

        // 🌟 Bicubic B-Spline smooth value lookup
        float v = sampleSmoothSplineHRRR(u_dataTexture, gridPos, u_gridSize);

        vec4 color;
        if (u_hasPtype > 0.5) {
            // Sample categorical p-type code at the nearest cell center to prevent border artifacts
            ivec2 nearestIdx = clamp(ivec2(floor(gridPos + 0.5)), ivec2(0), ivec2(u_gridSize) - 1);
            float ptypeCode = floor(texelFetch(u_dataTexture, nearestIdx, 0).g * 255.0 + 0.5);

            // P-type routing: Snow (5,6,9,10), Freezing Rain (3,4,12), Sleet (7,8), Rain (1 or fallback)
            if (ptypeCode >= 4.5 && ptypeCode <= 6.5 || ptypeCode == 9.0 || ptypeCode == 10.0) {
                color = texture(u_snowPalette, vec2(v, 0.5));
            } else if (ptypeCode >= 2.5 && ptypeCode <= 4.5 || ptypeCode == 12.0) {
                color = texture(u_frzrPalette, vec2(v, 0.5));
            } else if (ptypeCode >= 6.5 && ptypeCode <= 8.5) {
                color = texture(u_sleetPalette, vec2(v, 0.5));
            } else {
                color = texture(u_paletteTexture, vec2(v, 0.5));
            }
        } else {
            color = texture(u_paletteTexture, vec2(v, 0.5));
        }

        if (color.a == 0.0) discard;
        fragColor = vec4(color.rgb, color.a * u_opacity);
    }
`;

export function createHrrrShaderLayer(mapInstance) {
    return {
        id: 'weather-gpu-shader',
        type: 'custom',
        chunkTextures: {},
        activeTex: null,
        paletteTex: null,
        frzrPaletteTex: null,
        sleetPaletteTex: null,
        snowPaletteTex: null,
        hasPtype: false,
        grid: null,
        programs: {},
        vertexCount: 0,
        meshBuiltFor: null,

        clearTextures: function () {
            if (!this.gl) return;
            for (const key in this.chunkTextures) {
                if (this.chunkTextures[key]) this.gl.deleteTexture(this.chunkTextures[key]);
            }
            this.chunkTextures = {};
            this.activeTex = null;
            if (this.paletteTex) { this.gl.deleteTexture(this.paletteTex); this.paletteTex = null; }
            if (this.frzrPaletteTex) { this.gl.deleteTexture(this.frzrPaletteTex); this.frzrPaletteTex = null; }
            if (this.sleetPaletteTex) { this.gl.deleteTexture(this.sleetPaletteTex); this.sleetPaletteTex = null; }
            if (this.snowPaletteTex) { this.gl.deleteTexture(this.snowPaletteTex); this.snowPaletteTex = null; }
        },

        updatePalette: function (paramIdOrHexArray) {
            if (!this.gl) return;
            const activeParam = stateManager.activeParam || '2t';

            let hexArray;
            if (activeParam === 'refc') {
                hexArray = buildMaueRadarPalette();
            } else if (Array.isArray(paramIdOrHexArray)) {
                hexArray = paramIdOrHexArray;
            } else {
                const fn = stateManager.currentTheme === 'dark' ? getDarkPalette : getLightPalette;
                hexArray = fn(paramIdOrHexArray || activeParam);
            }

            if (this.paletteTex) this.gl.deleteTexture(this.paletteTex);
            this.paletteTex = createPaletteTexture(this.gl, hexArray);
            mapInstance.triggerRepaint();
        },

        onAdd: function (map, gl) {
            this.gl = gl;
            this.vertexBuffer = gl.createBuffer();
            
            const activeParam = stateManager.activeParam || '2t';
            const basePalette = (activeParam === 'refc') 
                ? buildMaueRadarPalette() 
                : ((stateManager.currentTheme === 'dark' ? getDarkPalette : getLightPalette)(activeParam));

            this.paletteTex = createPaletteTexture(gl, basePalette);
            this.frzrPaletteTex = createPaletteTexture(gl, FRZR_PALETTE || []);
            this.sleetPaletteTex = createPaletteTexture(gl, SLEET_PALETTE || []);
            this.snowPaletteTex = createPaletteTexture(gl, SNOW_PALETTE || []);
        },

        /** Build per-manifest constants + the mesh covering the HRRR bounds. */
        setupGrid: function (g) {
            if (!g || this.meshBuiltFor === g) return;
            const R = g.earth_radius, p1 = g.lat_1 * DEG, p0 = g.lat_0 * DEG;
            const n = Math.sin(p1);
            const F = (Math.cos(p1) * Math.pow(Math.tan(Math.PI / 4 + p1 / 2), n)) / n;
            const RF = R * F;
            this.grid = {
                nx: g.nx, ny: g.ny, x0: g.x0, y0: g.y0, dx: g.dx, dy: g.dy,
                lcc: [n, RF, RF / Math.pow(Math.tan(Math.PI / 4 + p0 / 2), n), g.lon_0 * DEG],
            };
            const mesh = createBoundsMesh(g.bounds);
            this.vertexCount = mesh.length / 2;
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, mesh, this.gl.STATIC_DRAW);
            this.meshBuiltFor = g;
        },

        getProgram: function (gl, shaderData) {
            const variant = shaderData?.variantName || 'default';
            if (this.programs[variant]) return this.programs[variant];
            let vs;
            if (shaderData && shaderData.vertexShaderPrelude) {
                vs = `#version 300 es
                ${shaderData.vertexShaderPrelude}
                ${shaderData.define || ''}
                in vec2 a_pos;
                out vec2 v_merc;
                void main() {
                    v_merc = a_pos;
                    gl_Position = projectTile(a_pos);
                }`;
            } else {
                vs = `#version 300 es
                in vec2 a_pos;
                out vec2 v_merc;
                uniform mat4 u_matrix;
                void main() {
                    v_merc = a_pos;
                    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
                }`;
            }
            const fs = `#version 300 es
                precision highp float;
                ${FRAGMENT_BODY}`;

            const compile = (type, src) => {
                const s = gl.createShader(type);
                gl.shaderSource(s, src);
                gl.compileShader(s);
                if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                    console.error('[HRRR shader] compile error:', gl.getShaderInfoLog(s));
                }
                return s;
            };
            const prog = gl.createProgram();
            gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
            gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                console.error('[HRRR shader] link error:', gl.getProgramInfoLog(prog));
            }
            this.programs[variant] = prog;
            return prog;
        },

        /** source = { frames: Uint8Array[], ptypeFrames?: Uint8Array[], width, height, isRaw: true } */
        preloadChunkTexture: function (chunkIndex, source) {
            if (!this.gl || !source || !source.isRaw) return;
            const gl = this.gl;
            const hasPtype = Boolean(source.hasPtype && source.ptypeFrames);
            this.hasPtype = hasPtype;

            source.frames.forEach((bytes, fIdx) => {
                const key = `${chunkIndex}_${fIdx}`;
                if (this.chunkTextures[key] || !bytes) return;

                const tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

                if (hasPtype && source.ptypeFrames[fIdx]) {
                    // Interleave R (Reflectivity) and G (P-type category)
                    const ptypeBytes = source.ptypeFrames[fIdx];
                    const numPixels = source.width * source.height;
                    const rgData = new Uint8Array(numPixels * 2);
                    for (let i = 0; i < numPixels; i++) {
                        rgData[i * 2]     = bytes[i];
                        rgData[i * 2 + 1] = ptypeBytes[i];
                    }
                    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, source.width, source.height, 0,
                                  gl.RG, gl.UNSIGNED_BYTE, rgData);
                } else {
                    // Standard single-channel R8 for temperature, height, wind, etc.
                    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, source.width, source.height, 0,
                                  gl.RED, gl.UNSIGNED_BYTE, bytes);
                }

                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
                this.chunkTextures[key] = tex;
            });
        },

        updateFrame: function (frameState) {
            if (!this.gl || !frameState) return;
            const fIdx = frameState.frameIndex !== undefined ? frameState.frameIndex : (frameState.col || 0);
            this.activeTex = this.chunkTextures[`${frameState.chunkIndex}_${fIdx}`] || this.activeTex;
            mapInstance.triggerRepaint();
        },

        render: function (gl, matrixOrArgs) {
            const g = stateManager.manifest?.grid;
            if (!this.activeTex || !g) return;
            this.setupGrid(g);

            const isV5 = Boolean(matrixOrArgs && (matrixOrArgs.defaultProjectionData || matrixOrArgs.shaderData));
            const shaderData = isV5 ? matrixOrArgs.shaderData : null;
            const projData = isV5 ? matrixOrArgs.defaultProjectionData : null;
            const matrix = isV5 ? (matrixOrArgs.modelViewProjectionMatrix || projData?.mainMatrix) : matrixOrArgs;

            const program = this.getProgram(gl, shaderData);
            gl.useProgram(program);
            const U = (name) => gl.getUniformLocation(program, name);

            // Texture 0: Native HRRR Grid Data
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.activeTex);
            gl.uniform1i(U('u_dataTexture'), 0);

            // Texture 1: Rain / Base Radar Palette
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
            gl.uniform1i(U('u_paletteTexture'), 1);

            // Texture 2: Freezing Rain Palette
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.frzrPaletteTex);
            gl.uniform1i(U('u_frzrPalette'), 2);

            // Texture 3: Sleet Palette
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, this.sleetPaletteTex);
            gl.uniform1i(U('u_sleetPalette'), 3);

            // Texture 4: Snow Palette
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, this.snowPaletteTex);
            gl.uniform1i(U('u_snowPalette'), 4);

            gl.uniform1f(U('u_hasPtype'), this.hasPtype ? 1.0 : 0.0);

            if (projData) {
                const m = U('u_projection_matrix'); if (m) gl.uniformMatrix4fv(m, false, projData.mainMatrix);
                const f = U('u_projection_fallback_matrix'); if (f) gl.uniformMatrix4fv(f, false, projData.fallbackMatrix);
                const c = U('u_projection_tile_mercator_coords');
                if (c) gl.uniform4f(c, ...projData.tileMercatorCoords);
                const k = U('u_projection_clipping_plane');
                if (k) gl.uniform4f(k, ...projData.clippingPlane);
                const t = U('u_projection_transition'); if (t) gl.uniform1f(t, projData.projectionTransition);
            } else if (matrix) {
                const m = U('u_matrix'); if (m) gl.uniformMatrix4fv(m, false, matrix);
            }

            const G = this.grid;
            gl.uniform1f(U('u_opacity'), 1.0);
            gl.uniform2f(U('u_gridSize'), G.nx, G.ny);
            gl.uniform2f(U('u_gridOrigin'), G.x0, G.y0);
            gl.uniform2f(U('u_gridStep'), G.dx, G.dy);
            gl.uniform4f(U('u_lcc'), ...G.lcc);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            const aPos = gl.getAttribLocation(program, 'a_pos');
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 8, 0);

            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
        },
    };
}
