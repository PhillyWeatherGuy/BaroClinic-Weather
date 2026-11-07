// js/shaders/ensembleShader.js
import { getPaletteForParameter as getLightPalette, FRZR_PALETTE, SLEET_PALETTE, SNOW_PALETTE } from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

/**
 * 🌟 Generates an interleaved vertex buffer [x, y, u, v]
 * Continuous x values prevent any antimeridian wrapping streak in 2D and 3D!
 */
function createSubdividedGrid(minX = -1.0, maxX = 2.0, cols = 96, rows = 48) {
    const vertices = [];
    const dx = (maxX - minX) / cols;
    const dy = 1.0 / rows;

    function mercatorYToV(y) {
        const mercY = (0.5 - y) * 6.28318530718;
        const latRad = 2.0 * Math.atan(Math.exp(mercY)) - 1.57079632679;
        return 0.5 - (latRad / 3.14159265359);
    }

    const vTopEdge = mercatorYToV(0.0);    // ~0.0275 (85.05°N)
    const vBottomEdge = mercatorYToV(1.0); // ~0.9725 (85.05°S)

    // 1. North Polar Cap (85.05°N to exact 90°N pole)
    for (let c = 0; c < cols; c++) {
        const x0 = minX + c * dx;
        const x1 = minX + (c + 1) * dx;
        const xMid = (x0 + x1) * 0.5;

        vertices.push(
            x0, 0.0, x0, vTopEdge,
            x1, 0.0, x1, vTopEdge,
            xMid, -10.0, xMid, 0.0
        );
    }

    // 2. Main Grid Body (85.05°N to 85.05°S)
    for (let r = 0; r < rows; r++) {
        const y0 = r * dy;
        const y1 = (r + 1) * dy;
        const v0 = mercatorYToV(y0);
        const v1 = mercatorYToV(y1);

        for (let c = 0; c < cols; c++) {
            const x0 = minX + c * dx;
            const x1 = minX + (c + 1) * dx;

            vertices.push(
                x0, y0, x0, v0,
                x1, y0, x1, v0,
                x0, y1, x0, v1,
                x0, y1, x0, v1,
                x1, y0, x1, v0,
                x1, y1, x1, v1
            );
        }
    }

    // 3. South Polar Cap (-85.05°S to exact -90°S pole)
    for (let c = 0; c < cols; c++) {
        const x0 = minX + c * dx;
        const x1 = minX + (c + 1) * dx;
        const xMid = (x0 + x1) * 0.5;

        vertices.push(
            x0, 1.0, x0, vBottomEdge,
            xMid, 10.0, xMid, 1.0,
            x1, 1.0, x1, vBottomEdge
        );
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

    vec4 sampleSmoothPtypeColor(sampler2D ptypeTex, vec2 uv, vec2 texRes, float palU, sampler2D palTex, sampler2D frzrTex, sampler2D sleetTex, sampler2D snowTex) {
        vec2 pos = uv * texRes - 0.5;
        vec2 i = floor(pos);
        vec2 f = fract(pos);
        vec2 invTex = 1.0 / texRes;

        // 🌟 5x5 Isotropic Gaussian Curvature Filter (sigma = 1.15)
        const float invTwoSigmaSq = 0.378;

        float wy[5];
        for (int y = 0; y < 5; y++) {
            float d = float(y - 2) - f.y;
            wy[y] = exp(-d * d * invTwoSigmaSq);
        }

        float wx[5];
        for (int x = 0; x < 5; x++) {
            float d = float(x - 2) - f.x;
            wx[x] = exp(-d * d * invTwoSigmaSq);
        }

        float wSnow = 0.0;
        float wFrzr = 0.0;
        float wSleet = 0.0;
        float wRain = 0.0;

        for (int dy = -2; dy <= 2; dy++) {
            float yCoord = clamp((i.y + float(dy) + 0.5) * invTex.y, 0.0, 1.0);
            float weightY = wy[dy + 2];

            for (int dx = -2; dx <= 2; dx++) {
                float xCoord = fract((i.x + float(dx) + 0.5) * invTex.x + 1.0);
                float weight = weightY * wx[dx + 2];

                // 🌟 P-Type code is sampled directly from the green channel
                float code = floor(texture(ptypeTex, vec2(xCoord, yCoord)).g * 255.0 + 0.5);

                if (code == 5.0 || code == 6.0 || code == 9.0 || code == 10.0) {
                    wSnow += weight;
                } else if (code == 3.0 || code == 4.0 || code == 12.0) {
                    wFrzr += weight;
                } else if (code == 7.0 || code == 8.0) {
                    wSleet += weight;
                } else if (code > 0.5) {
                    wRain += weight;
                }
            }
        }

        float totalPrecip = wSnow + wFrzr + wSleet + wRain;
        if (totalPrecip < 0.0001) {
            return texture(palTex, vec2(palU, 0.5));
        }

        // Dominant category selection with clean solid colors
        float maxW = max(max(wSnow, wSleet), max(wFrzr, wRain));

        if (maxW == wFrzr) {
            return texture(frzrTex, vec2(palU, 0.5));
        } else if (maxW == wSleet) {
            return texture(sleetTex, vec2(palU, 0.5));
        } else if (maxW == wSnow) {
            return texture(snowTex, vec2(palU, 0.5));
        } else {
            return texture(palTex, vec2(palU, 0.5));
        }
    }
`;

function createEnsemblePaletteTexture(gl, paletteHexArray, transparentFirst = false) {
    const paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    const paletteData = new Uint8Array(paletteHexArray.length * 4);
    
    const isPrecip = (
        stateManager.activeParam === 'tp' || 
        stateManager.activeParam?.startsWith('tp_') || 
        stateManager.activeParam?.startsWith('asnow') || 
        stateManager.activeParam === 'prate' ||
        transparentFirst
    );

    paletteHexArray.forEach((hex, i) => {
        if (hex === 'transparent' || !hex || (isPrecip && i === 0)) {
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
    return {
        id: 'weather-gpu-shader',
        type: 'custom',
        chunkTextures: {},
        loadedChunkIndices: [],
        activeTex: null,
        paletteTex: null,
        frzrPaletteTex: null,
        sleetPaletteTex: null,
        snowPaletteTex: null,
        activeMember: 0,
        currentFrameState: null,
        isGridMode: false,
        gridRects: null,
        gridSourceRect: null,
        texResolution: [1440.0, 721.0],
        programs: {},
        vertexCount: 0,

        clearTextures: function() {
            if (!this.gl) return;
            for (const key in this.chunkTextures) {
                if (this.chunkTextures[key]) {
                    this.gl.deleteTexture(this.chunkTextures[key]);
                }
            }
            this.chunkTextures = {};
            this.loadedChunkIndices = [];
            this.activeTex = null;
            for (const key of ['frzrPaletteTex', 'sleetPaletteTex', 'snowPaletteTex']) {
                if (this[key]) this.gl.deleteTexture(this[key]);
                this[key] = null;
            }
        },

        updatePalette: function(paramIdOrHexArray) {
            if (!this.gl) return;
            let hexArray;
            if (Array.isArray(paramIdOrHexArray)) {
                hexArray = paramIdOrHexArray;
            } else {
                const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
                hexArray = paletteFunc(paramIdOrHexArray || stateManager.activeParam || '2t');
            }

            if (this.paletteTex) {
                this.gl.deleteTexture(this.paletteTex);
            }
            this.paletteTex = createEnsemblePaletteTexture(this.gl, hexArray, stateManager.activeParam === 'prate');
            mapInstance.triggerRepaint();
        },
        
        onAdd: function (map, gl) {
            this.gl = gl;

            const gridData = createSubdividedGrid(-1.0, 2.0, 96, 48);
            this.vertexCount = gridData.length / 4;

            this.vertexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.STATIC_DRAW);

            const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
            const initialPalette = paletteFunc(stateManager.activeParam || '2t');
            this.paletteTex = createEnsemblePaletteTexture(gl, initialPalette, stateManager.activeParam === 'prate');
            
            // 🌟 Load P-Type Palettes
            this.frzrPaletteTex = createEnsemblePaletteTexture(gl, FRZR_PALETTE, true);
            this.sleetPaletteTex = createEnsemblePaletteTexture(gl, SLEET_PALETTE, true);
            this.snowPaletteTex = createEnsemblePaletteTexture(gl, SNOW_PALETTE, true);
        },

        getProgram: function(gl, shaderData) {
            const variant = shaderData?.variantName || 'default';
            if (this.programs[variant]) {
                return this.programs[variant];
            }

            const isGlobe = (variant === 'globe');
            let vsSource, fsSource;

            if (shaderData && shaderData.vertexShaderPrelude) {
                vsSource = `#version 300 es
                ${shaderData.vertexShaderPrelude}
                ${shaderData.define || ''}

                in vec2 a_pos;
                in vec2 a_uv;
                out vec2 v_uv;
                uniform vec4 u_grid_transform;

                void main() {
                    v_uv = a_uv;

                    ${isGlobe ? `
                    if (a_pos.y < -5.0) {
                        vec3 pos = vec3(0.0, 1.0, 0.0);
                        if (dot(pos, u_projection_clipping_plane.xyz) + u_projection_clipping_plane.w < 0.0) {
                            gl_Position = vec4(0.0, 0.0, -2.0, 0.0);
                        } else {
                            gl_Position = u_projection_matrix * vec4(pos, 1.0);
                        }
                    } else if (a_pos.y > 5.0) {
                        vec3 pos = vec3(0.0, -1.0, 0.0);
                        if (dot(pos, u_projection_clipping_plane.xyz) + u_projection_clipping_plane.w < 0.0) {
                            gl_Position = vec4(0.0, 0.0, -2.0, 0.0);
                        } else {
                            gl_Position = u_projection_matrix * vec4(pos, 1.0);
                        }
                    } else {
                        gl_Position = projectTile(a_pos);
                    }
                    ` : `
                    if (a_pos.y < -5.0 || a_pos.y > 5.0) {
                        gl_Position = vec4(0.0, 0.0, -2.0, 0.0);
                    } else {
                        gl_Position = projectTile(a_pos);
                    }
                    `}
                    gl_Position.xy = gl_Position.xy * u_grid_transform.xy + u_grid_transform.zw;
                }
                `;

                fsSource = `#version 300 es
                precision highp float;

                in vec2 v_uv;
                out vec4 fragColor;

                uniform sampler2D u_dataTexture;
                uniform sampler2D u_paletteTexture;
                uniform sampler2D u_frzrPalette;
                uniform sampler2D u_sleetPalette;
                uniform sampler2D u_snowPalette;
                uniform float u_hasPtype;
                uniform float u_opacity;
                uniform vec2 u_texResolution;
                uniform float u_isPixelated;

                ${fragmentShaderBody}

                void main() {
                    vec2 uv = vec2(fract(v_uv.x), clamp(v_uv.y, 0.0, 1.0));
                    
                    float rawVal;
                    if (u_isPixelated > 0.5) {
                        rawVal = texture(u_dataTexture, uv).r;
                    } else {
                        rawVal = sampleSmoothSpline(u_dataTexture, uv, u_texResolution);
                    }

                    if (rawVal < 0.00001) {
                        discard;
                    }

                    float palIndex = clamp(rawVal * 255.0, 0.0, 255.0);
                    float palU = (palIndex + 0.5) / 256.0;
                    vec4 color = texture(u_paletteTexture, vec2(palU, 0.5));

                    if (u_hasPtype > 0.5) {
                        color = sampleSmoothPtypeColor(u_dataTexture, uv, u_texResolution, palU, u_paletteTexture, u_frzrPalette, u_sleetPalette, u_snowPalette);
                    }
                    
                    if (color.a == 0.0) {
                        discard;
                    }

                    fragColor = vec4(color.rgb, color.a * u_opacity);
                }
                `;
            } else {
                vsSource = `
                attribute vec2 a_pos;
                attribute vec2 a_uv;
                varying vec2 v_uv;
                uniform vec4 u_grid_transform;
                uniform mat4 u_matrix;

                void main() {
                    v_uv = a_uv;
                    if (a_pos.y < -5.0 || a_pos.y > 5.0) {
                        gl_Position = vec4(0.0, 0.0, -2.0, 0.0);
                    } else {
                        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
                    }
                    gl_Position.xy = gl_Position.xy * u_grid_transform.xy + u_grid_transform.zw;
                }
                `;

                fsSource = `
                precision highp float;
                varying vec2 v_uv;
                uniform sampler2D u_dataTexture;
                uniform sampler2D u_paletteTexture;
                uniform sampler2D u_frzrPalette;
                uniform sampler2D u_sleetPalette;
                uniform sampler2D u_snowPalette;
                uniform float u_hasPtype;
                uniform float u_opacity;
                uniform vec2 u_texResolution;
                uniform float u_isPixelated;

                ${fragmentShaderBody.replace(/texture\(/g, 'texture2D(')}

                void main() {
                    vec2 uv = vec2(fract(v_uv.x), clamp(v_uv.y, 0.0, 1.0));
                    
                    float rawVal;
                    if (u_isPixelated > 0.5) {
                        rawVal = texture2D(u_dataTexture, uv).r;
                    } else {
                        rawVal = sampleSmoothSpline(u_dataTexture, uv, u_texResolution);
                    }

                    if (rawVal < 0.00001) {
                        discard;
                    }

                    float palIndex = clamp(rawVal * 255.0, 0.0, 255.0);
                    float palU = (palIndex + 0.5) / 256.0;
                    vec4 color = texture2D(u_paletteTexture, vec2(palU, 0.5));

                    if (u_hasPtype > 0.5) {
                        color = sampleSmoothPtypeColor(u_dataTexture, uv, u_texResolution, palU, u_paletteTexture, u_frzrPalette, u_sleetPalette, u_snowPalette);
                    }
                    
                    if (color.a == 0.0) {
                        discard;
                    }

                    gl_FragColor = vec4(color.rgb, color.a * u_opacity);
                }
                `;
            }

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

            this.programs[variant] = prog;
            return prog;
        },
        
        preloadChunkTexture: function(chunkIndex, source) {
            if (!this.gl || !source) return;
            const gl = this.gl;

            const w = source.width || 1440;
            const h = source.height || 721;

            // 🌟 Option 2: Uploads 1-byte R8 for scalar parameters, 2-byte RG8 for ptype
            const uploadSingle = (item) => {
                if (!item) return null;
                const tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

                // Zero-copy raw byte slice from dataLoader
                if (item.data && item.data instanceof Uint8Array) {
                    if (item.ptype && item.ptype instanceof Uint8Array) {
                        const total = w * h;
                        const rg = new Uint8Array(total * 2);
                        const d = item.data;
                        const p = item.ptype;
                        for (let i = 0; i < total; i++) {
                            rg[i * 2]     = d[i];
                            rg[i * 2 + 1] = p[i];
                        }
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, rg);
                    } else {
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, item.data);
                    }
                } 
                // Legacy ImageBitmap / canvas fallback
                else {
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, item);
                }
                
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                return tex;
            };

            // 🌟 Option 1: Texture Pool Management (Evict distant chunks so VRAM stays under ~100MB)
            if (!this.loadedChunkIndices) this.loadedChunkIndices = [];
            if (!this.loadedChunkIndices.includes(chunkIndex)) {
                this.loadedChunkIndices.push(chunkIndex);
            }

            while (this.loadedChunkIndices.length > 2) {
                const oldChunkIdx = this.loadedChunkIndices.shift();
                if (oldChunkIdx === chunkIndex) continue;

                for (const key in this.chunkTextures) {
                    if (key.startsWith(`${oldChunkIdx}_`) || key === String(oldChunkIdx)) {
                        if (this.chunkTextures[key]) {
                            gl.deleteTexture(this.chunkTextures[key]);
                        }
                        delete this.chunkTextures[key];
                    }
                }
            }

            if (source.width && source.height) {
                this.texResolution = [source.width, source.height];
            }

            if (source.frames && Array.isArray(source.frames)) {
                source.frames.forEach((frameItem, fIdx) => {
                    if (Array.isArray(frameItem)) {
                        frameItem.forEach((memberBmp, mIdx) => {
                            const key = `${chunkIndex}_${fIdx}_m${mIdx}`;
                            if (!this.chunkTextures[key] && memberBmp) {
                                this.chunkTextures[key] = uploadSingle(memberBmp);
                            }
                        });
                        this.chunkTextures[`${chunkIndex}_${fIdx}`] = this.chunkTextures[`${chunkIndex}_${fIdx}_m0`];
                    } else if (frameItem) {
                        const key = `${chunkIndex}_${fIdx}_m0`;
                        if (!this.chunkTextures[key]) {
                            this.chunkTextures[key] = uploadSingle(frameItem);
                        }
                        this.chunkTextures[`${chunkIndex}_${fIdx}`] = this.chunkTextures[key];
                    }
                });
            } else {
                const key = `${chunkIndex}_0_m0`;
                if (!this.chunkTextures[key]) {
                    this.chunkTextures[key] = uploadSingle(source);
                }
                this.chunkTextures[`${chunkIndex}_0`] = this.chunkTextures[key];
                this.chunkTextures[chunkIndex] = this.chunkTextures[key];
            }
        },

        setActiveMember: function(memberIndex) {
            this.activeMember = Math.max(0, Math.min(9, memberIndex));
            if (this.currentFrameState) {
                const cIdx = this.currentFrameState.chunkIndex;
                const fIdx = this.currentFrameState.frameIndex !== undefined ? this.currentFrameState.frameIndex : (this.currentFrameState.col || 0);
                this.activeTex = this.chunkTextures[`${cIdx}_${fIdx}_m${this.activeMember}`] 
                              || this.chunkTextures[`${cIdx}_${fIdx}`] 
                              || this.chunkTextures[cIdx];
            }
        },

        setGridMode: function(enabled, rects = null, sourceRect = null) {
            this.isGridMode = enabled;
            this.gridRects = rects;
            this.gridSourceRect = sourceRect;
            mapInstance.triggerRepaint();
        },

        getMemberTexture: function(chunkIndex, frameIndex, memberIndex) {
            return this.chunkTextures[`${chunkIndex}_${frameIndex}_m${memberIndex}`] || null;
        },

        updateFrame: function (frameState) {
            if (!this.gl || !frameState) return;
            this.currentFrameState = frameState;

            const cIdx = frameState.chunkIndex;
            const fIdx = frameState.frameIndex !== undefined ? frameState.frameIndex : (frameState.col || 0);
            
            const memberKey = `${cIdx}_${fIdx}_m${this.activeMember}`;
            const fallbackKey = `${cIdx}_${fIdx}`;

            this.activeTex = this.chunkTextures[memberKey] || this.chunkTextures[fallbackKey] || this.chunkTextures[cIdx];
            mapInstance.triggerRepaint();
        },

        renderAllMembersGrid: function(gl, matrixOrArgs, boxRects) {
            if (!this.currentFrameState || !boxRects || boxRects.length === 0) return;
            const cIdx = this.currentFrameState.chunkIndex;
            const fIdx = this.currentFrameState.frameIndex !== undefined ? this.currentFrameState.frameIndex : (this.currentFrameState.col || 0);

            const isV5 = Boolean(matrixOrArgs && (matrixOrArgs.defaultProjectionData || matrixOrArgs.shaderData));
            const shaderData = isV5 ? matrixOrArgs.shaderData : null;
            const projData = isV5 ? matrixOrArgs.defaultProjectionData : null;
            const matrix = isV5 
                ? (matrixOrArgs.modelViewProjectionMatrix || projData?.mainMatrix) 
                : matrixOrArgs;

            const program = this.getProgram(gl, shaderData);
            if (!program) return;

            gl.useProgram(program);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_paletteTexture'), 1);

            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.frzrPaletteTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_frzrPalette'), 2);

            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, this.sleetPaletteTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_sleetPalette'), 3);

            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, this.snowPaletteTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_snowPalette'), 4);

            // 🌟 Protect against rainbow glitch: only use P-Type if the file actually exists on this chunk
            const chunkManifest = stateManager.manifest?.chunks?.[cIdx];
            const hasPtype = (stateManager.activeParam === 'prate' && chunkManifest?.ptype_file) ? 1.0 : 0.0;
            gl.uniform1f(gl.getUniformLocation(program, 'u_hasPtype'), hasPtype);

            if (projData) {
                const locMain = gl.getUniformLocation(program, 'u_projection_matrix');
                if (locMain) gl.uniformMatrix4fv(locMain, false, projData.mainMatrix);

                const locFallback = gl.getUniformLocation(program, 'u_projection_fallback_matrix');
                if (locFallback) gl.uniformMatrix4fv(locFallback, false, projData.fallbackMatrix);

                const locCoords = gl.getUniformLocation(program, 'u_projection_tile_mercator_coords');
                if (locCoords) gl.uniform4f(locCoords, projData.tileMercatorCoords[0], projData.tileMercatorCoords[1], projData.tileMercatorCoords[2], projData.tileMercatorCoords[3]);

                const locClip = gl.getUniformLocation(program, 'u_projection_clipping_plane');
                if (locClip) gl.uniform4f(locClip, projData.clippingPlane[0], projData.clippingPlane[1], projData.clippingPlane[2], projData.clippingPlane[3]);

                const locTrans = gl.getUniformLocation(program, 'u_projection_transition');
                if (locTrans) gl.uniform1f(locTrans, projData.projectionTransition);
            } else if (matrix) {
                const locMat = gl.getUniformLocation(program, 'u_matrix');
                if (locMat) gl.uniformMatrix4fv(locMat, false, matrix);
            }

            gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), 1.0);
            gl.uniform2f(gl.getUniformLocation(program, 'u_texResolution'), this.texResolution[0], this.texResolution[1]);
            gl.uniform1f(gl.getUniformLocation(program, 'u_isPixelated'), 0.0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            const aPos = gl.getAttribLocation(program, 'a_pos');
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);

            const aUv = gl.getAttribLocation(program, 'a_uv');
            if (aUv !== -1) {
                gl.enableVertexAttribArray(aUv);
                gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
            }

            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.enable(gl.SCISSOR_TEST);

            const sourceRect = this.gridSourceRect;
            const sourceW = sourceRect?.w || gl.drawingBufferWidth;
            const sourceH = sourceRect?.h || gl.drawingBufferHeight;
            const canvasW = sourceRect?.canvasW || gl.drawingBufferWidth;
            const canvasH = sourceRect?.canvasH || gl.drawingBufferHeight;
            const sourceX = sourceRect?.x || 0;
            const sourceY = sourceRect?.y || 0;
            const gridTransform = [
                canvasW / sourceW,
                canvasH / sourceH,
                canvasW / sourceW - (2.0 * sourceX / sourceW) - 1.0,
                1.0 - canvasH / sourceH + (2.0 * sourceY / sourceH)
            ];

            for (let m = 0; m < 10; m++) {
                const rect = boxRects[m];
                if (!rect || rect.w <= 0 || rect.h <= 0) continue;

                gl.viewport(rect.x, rect.y, rect.w, rect.h);
                gl.scissor(rect.x, rect.y, rect.w, rect.h);

                const tex = this.chunkTextures[`${cIdx}_${fIdx}_m${m}`] || this.activeTex;
                if (!tex) continue;

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.uniform1i(gl.getUniformLocation(program, 'u_dataTexture'), 0);
                gl.uniform4f(
                    gl.getUniformLocation(program, 'u_grid_transform'),
                    gridTransform[0], gridTransform[1], gridTransform[2], gridTransform[3]
                );

                gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
            }

            gl.disable(gl.SCISSOR_TEST);
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        },

        render: function (gl, matrixOrArgs) {
            if (this.isGridMode && this.gridRects) {
                this.renderAllMembersGrid(gl, matrixOrArgs, this.gridRects);
                return;
            }

            if (!this.activeTex) return;

            const isV5 = Boolean(matrixOrArgs && (matrixOrArgs.defaultProjectionData || matrixOrArgs.shaderData));
            const shaderData = isV5 ? matrixOrArgs.shaderData : null;
            const projData = isV5 ? matrixOrArgs.defaultProjectionData : null;
            const matrix = isV5 
                ? (matrixOrArgs.modelViewProjectionMatrix || projData?.mainMatrix) 
                : matrixOrArgs;

            const program = this.getProgram(gl, shaderData);
            if (!program) return;

            gl.useProgram(program);
            gl.uniform4f(gl.getUniformLocation(program, 'u_grid_transform'), 1.0, 1.0, 0.0, 0.0);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.activeTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_dataTexture'), 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_paletteTexture'), 1);

            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.frzrPaletteTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_frzrPalette'), 2);

            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, this.sleetPaletteTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_sleetPalette'), 3);

            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, this.snowPaletteTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_snowPalette'), 4);

            // 🌟 Protect against rainbow glitch: only use P-Type if the file actually exists on this chunk
            const cIdx = this.currentFrameState ? this.currentFrameState.chunkIndex : 0;
            const chunkManifest = stateManager.manifest?.chunks?.[cIdx];
            const hasPtype = (stateManager.activeParam === 'prate' && chunkManifest?.ptype_file) ? 1.0 : 0.0;
            gl.uniform1f(gl.getUniformLocation(program, 'u_hasPtype'), hasPtype);

            if (projData) {
                const locMain = gl.getUniformLocation(program, 'u_projection_matrix');
                if (locMain) gl.uniformMatrix4fv(locMain, false, projData.mainMatrix);

                const locFallback = gl.getUniformLocation(program, 'u_projection_fallback_matrix');
                if (locFallback) gl.uniformMatrix4fv(locFallback, false, projData.fallbackMatrix);

                const locCoords = gl.getUniformLocation(program, 'u_projection_tile_mercator_coords');
                if (locCoords) gl.uniform4f(locCoords, projData.tileMercatorCoords[0], projData.tileMercatorCoords[1], projData.tileMercatorCoords[2], projData.tileMercatorCoords[3]);

                const locClip = gl.getUniformLocation(program, 'u_projection_clipping_plane');
                if (locClip) gl.uniform4f(locClip, projData.clippingPlane[0], projData.clippingPlane[1], projData.clippingPlane[2], projData.clippingPlane[3]);

                const locTrans = gl.getUniformLocation(program, 'u_projection_transition');
                if (locTrans) gl.uniform1f(locTrans, projData.projectionTransition);
            } else if (matrix) {
                const locMat = gl.getUniformLocation(program, 'u_matrix');
                if (locMat) gl.uniformMatrix4fv(locMat, false, matrix);
            }

            gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), 1.0);
            gl.uniform2f(gl.getUniformLocation(program, 'u_texResolution'), this.texResolution[0], this.texResolution[1]);
            gl.uniform1f(gl.getUniformLocation(program, 'u_isPixelated'), 0.0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            
            const aPos = gl.getAttribLocation(program, 'a_pos');
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);

            const aUv = gl.getAttribLocation(program, 'a_uv');
            if (aUv !== -1) {
                gl.enableVertexAttribArray(aUv);
                gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
            }

            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
        }
    };
}
