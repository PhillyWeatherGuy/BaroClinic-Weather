// js/shaders/hrrrShader.js
// Native-grid HRRR layer: raw uint8 data in an R8 texture, NEAREST lookup, no interpolation.
// Each screen pixel is converted to lon/lat, forward-projected into the HRRR Lambert grid,
// and the matching native cell is read directly. Works in mercator (2D) and globe (3D) modes.
import { getPaletteForParameter as getLightPalette } from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

const DEG = Math.PI / 180;

function lonToMercX(lon) { return (lon + 180) / 360; }
function latToMercY(lat) {
    return 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) / (2 * Math.PI);
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
        if (hex === 'transparent' || !hex) return; // stays 0,0,0,0
        const num = parseInt(hex.replace('#', ''), 16);
        data[i * 4] = (num >> 16) & 255;
        data[i * 4 + 1] = (num >> 8) & 255;
        data[i * 4 + 2] = num & 255;
        data[i * 4 + 3] = 255;
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, paletteHexArray.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
}

const FRAGMENT_BODY = `
    in vec2 v_merc;
    out vec4 fragColor;

    uniform sampler2D u_dataTexture;     // R8, native HRRR grid, row 0 = south
    uniform sampler2D u_paletteTexture;
    uniform float u_opacity;
    uniform vec2  u_gridSize;            // nx, ny
    uniform vec2  u_gridOrigin;          // x0, y0 (meters, center of cell [0,0])
    uniform vec2  u_gridStep;            // dx, dy (meters)
    uniform vec4  u_lcc;                 // n, R*F, rho0, lon0 (radians)

    const float PI = 3.14159265358979;

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

        // meters -> native cell index (nearest cell center)
        vec2 idx = floor(vec2((x - u_gridOrigin.x) / u_gridStep.x,
                              (y - u_gridOrigin.y) / u_gridStep.y) + 0.5);
        if (idx.x < 0.0 || idx.y < 0.0 || idx.x >= u_gridSize.x || idx.y >= u_gridSize.y) discard;

        float v = texelFetch(u_dataTexture, ivec2(idx), 0).r;
        vec4 color = texture(u_paletteTexture, vec2(v, 0.5));
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
        },

        updatePalette: function (paramIdOrHexArray) {
            if (!this.gl) return;
            let hexArray;
            if (Array.isArray(paramIdOrHexArray)) {
                hexArray = paramIdOrHexArray;
            } else {
                const fn = stateManager.currentTheme === 'dark' ? getDarkPalette : getLightPalette;
                hexArray = fn(paramIdOrHexArray || stateManager.activeParam || '2t');
            }
            if (this.paletteTex) this.gl.deleteTexture(this.paletteTex);
            this.paletteTex = createPaletteTexture(this.gl, hexArray);
            mapInstance.triggerRepaint();
        },

        onAdd: function (map, gl) {
            this.gl = gl;
            this.vertexBuffer = gl.createBuffer();
            const fn = stateManager.currentTheme === 'dark' ? getDarkPalette : getLightPalette;
            this.paletteTex = createPaletteTexture(gl, fn(stateManager.activeParam || '2t'));
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

        /** source = { frames: Uint8Array[], width, height, isRaw: true } from dataLoader. */
        preloadChunkTexture: function (chunkIndex, source) {
            if (!this.gl || !source || !source.isRaw) return;
            const gl = this.gl;
            source.frames.forEach((bytes, fIdx) => {
                const key = `${chunkIndex}_${fIdx}`;
                if (this.chunkTextures[key] || !bytes) return;
                const tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // width 1799 is not a multiple of 4
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, source.width, source.height, 0,
                              gl.RED, gl.UNSIGNED_BYTE, bytes);
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

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.activeTex);
            gl.uniform1i(U('u_dataTexture'), 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
            gl.uniform1i(U('u_paletteTexture'), 1);

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
