// js/shaders/ensembleShader.js
import { getPaletteForParameter as getLightPalette } from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

function createSubdividedGrid(minX = -1.0, maxX = 2.0, cols = 96, rows = 48) {
    const vertices = [];
    const dx = (maxX - minX) / cols;
    const dy = 1.0 / rows;

    function mercatorYToV(y) {
        const mercY = (0.5 - y) * 6.28318530718;
        const latRad = 2.0 * Math.atan(Math.exp(mercY)) - 1.57079632679;
        return 0.5 - (latRad / 3.14159265359);
    }

    const vTopEdge = mercatorYToV(0.0);
    const vBottomEdge = mercatorYToV(1.0);

    for (let c = 0; c < cols; c++) {
        const x0 = minX + c * dx;
        const x1 = minX + (c + 1) * dx;
        const xMid = (x0 + x1) * 0.5;
        vertices.push(x0, 0.0, x0, vTopEdge, x1, 0.0, x1, vTopEdge, xMid, -10.0, xMid, 0.0);
    }

    for (let r = 0; r < rows; r++) {
        const y0 = r * dy;
        const y1 = (r + 1) * dy;
        const v0 = mercatorYToV(y0);
        const v1 = mercatorYToV(y1);

        for (let c = 0; c < cols; c++) {
            const x0 = minX + c * dx;
            const x1 = minX + (c + 1) * dx;
            vertices.push(
                x0, y0, x0, v0, x1, y0, x1, v0, x0, y1, x0, v1,
                x0, y1, x0, v1, x1, y0, x1, v0, x1, y1, x1, v1
            );
        }
    }

    for (let c = 0; c < cols; c++) {
        const x0 = minX + c * dx;
        const x1 = minX + (c + 1) * dx;
        const xMid = (x0 + x1) * 0.5;
        vertices.push(x0, 1.0, x0, vBottomEdge, xMid, 10.0, xMid, 1.0, x1, 1.0, x1, vBottomEdge);
    }

    return new Float32Array(vertices);
}

const fragmentShaderBody = `
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
            float rowVal = wx.x * texture(tex, vec2(x0, yCoord)).r +
                           wx.y * texture(tex, vec2(x1, yCoord)).r +
                           wx.z * texture(tex, vec2(x2, yCoord)).r +
                           wx.w * texture(tex, vec2(x3, yCoord)).r;

            float w_y = (y == -1) ? wy.x : ((y == 0) ? wy.y : ((y == 1) ? wy.z : wy.w));
            total += w_y * rowVal;
        }
        return clamp(total, 0.0, 1.0);
    }
`;

function createPaletteTexture(gl, paletteHexArray) {
    const paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    const paletteData = new Uint8Array(paletteHexArray.length * 4);
    
    paletteHexArray.forEach((hex, i) => {
        if (hex === 'transparent' || !hex || i === 0) {
            paletteData[i * 4]     = 0;
            paletteData[i * 4 + 1] = 0;
            paletteData[i * 4 + 2] = 0;
            paletteData[i * 4 + 3] = 0;
        } else {
            const num = parseInt(hex.replace('#', ''), 16);
            paletteData[i * 4]     = (num >> 16) & 255;
            paletteData[i * 4 + 1] = (num >> 8) & 255;
            paletteData[i * 4 + 2] = num & 255;
            paletteData[i * 4 + 3] = 255;
        }
    });

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, paletteHexArray.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return paletteTex;
}

export function createEnsembleShaderLayer(mapInstance) {
    const layer = {
        // Same id as the other shaders so initLayer()/unloadActiveViewer() remove it correctly
        id: 'weather-gpu-shader',
        type: 'custom',
        chunkTextures: {},
        activeTextures: null,
        paletteTex: null,
        texResolution: [2880.0, 1442.0],
        program: null,
        uLoc: null,
        vertexCount: 0,
        lastMatrix: null,
        canvas: null,
        gl: null,

        // 🌟 Weather is drawn on its OWN canvas + GL context, stacked above the card canvases.
        // MapLibre's canvas stays a clean basemap, so the cards never copy weather into themselves.
        initOverlay: function() {
            const canvas = document.createElement('canvas');
            canvas.id = 'ensemble-weather-overlay';
            canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
            const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
            if (!gl) {
                console.warn('[Ensemble] WebGL2 unavailable for overlay canvas');
                return;
            }
            this.canvas = canvas;
            this.gl = gl;
            (document.getElementById('ensemble-grid') || document.body).appendChild(canvas);

            const gridData = createSubdividedGrid(-1.0, 2.0, 96, 48);
            this.vertexCount = gridData.length / 4;
            this.vertexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.STATIC_DRAW);

            const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
            this.paletteTex = createPaletteTexture(gl, paletteFunc(stateManager.activeParam || 'tp'));
        },

        clearTextures: function() {
            if (!this.gl) return;
            for (const key in this.chunkTextures) {
                if (Array.isArray(this.chunkTextures[key])) {
                    this.chunkTextures[key].forEach(tex => this.gl.deleteTexture(tex));
                } else if (this.chunkTextures[key]) {
                    this.gl.deleteTexture(this.chunkTextures[key]);
                }
            }
            this.chunkTextures = {};
            this.activeTextures = null;
        },

        updatePalette: function(paramIdOrHexArray) {
            if (!this.gl) return;
            let hexArray;
            if (Array.isArray(paramIdOrHexArray)) {
                hexArray = paramIdOrHexArray;
            } else {
                const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
                hexArray = paletteFunc(paramIdOrHexArray || stateManager.activeParam || 'tp');
            }

            if (this.paletteTex) {
                this.gl.deleteTexture(this.paletteTex);
            }
            this.paletteTex = createPaletteTexture(this.gl, hexArray);
            mapInstance.triggerRepaint();
        },

        // MapLibre's GL context is intentionally unused
        onAdd: function () {},

        onRemove: function () {
            if (this.canvas && this.canvas.parentNode) {
                this.canvas.parentNode.removeChild(this.canvas);
            }
        },

        getProgram: function(gl) {
            if (this.program) return this.program;

            // Mercator only: the overlay has its own context, so MapLibre's projection prelude isn't available
            const vsSource = `#version 300 es
            in vec2 a_pos;
            in vec2 a_uv;
            out vec2 v_uv;
            uniform mat4 u_matrix;
            void main() {
                v_uv = a_uv;
                if (a_pos.y < -5.0 || a_pos.y > 5.0) {
                    gl_Position = vec4(0.0, 0.0, -2.0, 0.0);
                } else {
                    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
                }
            }`;
            const fsSource = `#version 300 es
            precision highp float;
            in vec2 v_uv;
            out vec4 fragColor;
            uniform sampler2D u_dataTexture;
            uniform sampler2D u_paletteTexture;
            uniform vec2 u_texResolution;
            ${fragmentShaderBody}
            void main() {
                vec2 uv = vec2(fract(v_uv.x), clamp(v_uv.y, 0.0, 1.0));
                float rawVal = sampleSmoothSpline(u_dataTexture, uv, u_texResolution);
                if (rawVal < 0.00001) discard;
                float palU = (clamp(rawVal * 255.0, 0.0, 255.0) + 0.5) / 256.0;
                vec4 color = texture(u_paletteTexture, vec2(palU, 0.5));
                if (color.a == 0.0) discard;
                fragColor = vec4(color.rgb * color.a, color.a); // premultiplied for the overlay canvas
            }`;

            const vs = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vs, vsSource);
            gl.compileShader(vs);
            const fs = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fs, fsSource);
            gl.compileShader(fs);
            const prog = gl.createProgram();
            gl.attachShader(prog, vs);
            gl.attachShader(prog, fs);
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                console.error('[Ensemble] shader error:', gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs), gl.getProgramInfoLog(prog));
                return null;
            }
            this.uLoc = {
                matrix: gl.getUniformLocation(prog, 'u_matrix'),
                data: gl.getUniformLocation(prog, 'u_dataTexture'),
                palette: gl.getUniformLocation(prog, 'u_paletteTexture'),
                res: gl.getUniformLocation(prog, 'u_texResolution'),
                aPos: gl.getAttribLocation(prog, 'a_pos'),
                aUv: gl.getAttribLocation(prog, 'a_uv')
            };
            this.program = prog;
            return prog;
        },

        preloadChunkTexture: function(chunkIndex, source) {
            if (!this.gl || !source) return;
            const gl = this.gl;

            const uploadSingle = (img) => {
                const tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                return tex;
            };

            if (source.frames && Array.isArray(source.frames)) {
                if (source.width && source.height) {
                    this.texResolution = [source.width, source.height];
                }

                source.frames.forEach((memberBitmaps, fIdx) => {
                    const key = `${chunkIndex}_${fIdx}`;
                    if (memberBitmaps && Array.isArray(memberBitmaps) && !this.chunkTextures[key]) {
                        this.chunkTextures[key] = memberBitmaps.map(bmp => uploadSingle(bmp));
                    }
                });
            }
        },

        updateFrame: function (frameState) {
            if (!this.gl || !frameState) return;
            const cIdx = frameState.chunkIndex;
            const fIdx = frameState.frameIndex !== undefined ? frameState.frameIndex : (frameState.col || 0);

            this.activeTextures = this.chunkTextures[`${cIdx}_${fIdx}`];
            mapInstance.triggerRepaint();
        },

        // MapLibre calls this every frame: just record the camera matrix, then draw on our own canvas
        render: function (mapGl, matrixOrArgs) {
            const isV5 = Boolean(matrixOrArgs && (matrixOrArgs.defaultProjectionData || matrixOrArgs.shaderData));
            const projData = isV5 ? matrixOrArgs.defaultProjectionData : null;
            this.lastMatrix = isV5 ? (matrixOrArgs.modelViewProjectionMatrix || projData?.mainMatrix) : matrixOrArgs;
            this.draw();
        },

        draw: function () {
            const gl = this.gl;
            if (!gl) return;

            const dpr = window.devicePixelRatio || 1;
            const W = Math.round(window.innerWidth * dpr);
            const H = Math.round(window.innerHeight * dpr);
            if (this.canvas.width !== W || this.canvas.height !== H) {
                this.canvas.width = W;
                this.canvas.height = H;
            }

            gl.viewport(0, 0, W, H);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            // Globe isn't supported on the overlay (needs the globe projection in our own shader)
            if (!this.activeTextures || this.activeTextures.length !== 10 || !this.lastMatrix) return;
            if (stateManager.activeView === '3d') return;

            const cards = document.querySelectorAll('.map-card');
            if (cards.length !== 10) return;

            const program = this.getProgram(gl);
            if (!program) return;

            gl.useProgram(program);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
            gl.uniform1i(this.uLoc.palette, 1);
            gl.uniform2f(this.uLoc.res, this.texResolution[0], this.texResolution[1]);
            gl.uniform1i(this.uLoc.data, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.enableVertexAttribArray(this.uLoc.aPos);
            gl.vertexAttribPointer(this.uLoc.aPos, 2, gl.FLOAT, false, 16, 0);
            if (this.uLoc.aUv !== -1) {
                gl.enableVertexAttribArray(this.uLoc.aUv);
                gl.vertexAttribPointer(this.uLoc.aUv, 2, gl.FLOAT, false, 16, 8);
            }

            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

            const mapCanvas = mapInstance.getCanvas();
            const srcAspect = mapCanvas.width / mapCanvas.height;

            cards.forEach((card, index) => {
                const rect = card.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return;

                const w = Math.round(rect.width * dpr);
                const h = Math.round(rect.height * dpr);
                gl.viewport(Math.round(rect.left * dpr), Math.round(H - rect.bottom * dpr), w, h);

                // Same center-crop ("object-fit: cover") the basemap copy uses
                const dstAspect = w / h;
                let scaleX = 1.0, scaleY = 1.0;
                if (srcAspect > dstAspect) scaleX = srcAspect / dstAspect;
                else scaleY = dstAspect / srcAspect;

                // Scale the whole clip-space x/y rows (incl. translation), not just the diagonal
                const m = new Float32Array(this.lastMatrix);
                for (const i of [0, 4, 8, 12]) m[i] *= scaleX;
                for (const i of [1, 5, 9, 13]) m[i] *= scaleY;
                gl.uniformMatrix4fv(this.uLoc.matrix, false, m);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.activeTextures[index]);
                gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
            });

            gl.viewport(0, 0, W, H);
        }
    };

    layer.initOverlay();
    return layer;
}
