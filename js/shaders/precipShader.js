// js/shaders/precipShader.js
import { getPaletteForParameter as getLightPalette } from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

// 🌟 Generates a smooth, subdivided vertex grid that bends around the 3D globe and lies flat in 2D
function createSubdividedGrid(minX = -1.0, maxX = 2.0, cols = 96, rows = 48) {
    const vertices = [];
    const dx = (maxX - minX) / cols;
    const dy = 1.0 / rows;

    // 1. North Polar Cap Fan (Closes the 85.05°N to 90°N hole)
    // In MapLibre globe math, y = -0.45 converges to the exact North Pole (lat = +90°)
    const northPoleY = -0.45;
    for (let c = 0; c < cols; c++) {
        const x0 = minX + c * dx;
        const x1 = minX + (c + 1) * dx;
        const xMid = (x0 + x1) * 0.5;

        vertices.push(
            x0, 0.0,
            x1, 0.0,
            xMid, northPoleY
        );
    }

    // 2. Main Body Grid (85.05°N to 85.05°S)
    for (let r = 0; r < rows; r++) {
        const y0 = r * dy;
        const y1 = (r + 1) * dy;
        for (let c = 0; c < cols; c++) {
            const x0 = minX + c * dx;
            const x1 = minX + (c + 1) * dx;

            vertices.push(
                x0, y0,
                x1, y0,
                x0, y1,
                x0, y1,
                x1, y0,
                x1, y1
            );
        }
    }

    // 3. South Polar Cap Fan (Closes the 85.05°S to -90°S hole)
    // y = 1.45 converges to the exact South Pole (lat = -90°)
    const southPoleY = 1.45;
    for (let c = 0; c < cols; c++) {
        const x0 = minX + c * dx;
        const x1 = minX + (c + 1) * dx;
        const xMid = (x0 + x1) * 0.5;

        vertices.push(
            x0, 1.0,
            xMid, southPoleY,
            x1, 1.0
        );
    }

    return new Float32Array(vertices);
}

// 🌟 GLSL shared fragment logic for C^2 continuous spline interpolation
const fragmentShaderBody = `
    // 🌟 C^2 Continuous Cubic B-Spline Filter
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

function createPrecipPaletteTexture(gl, paletteHexArray) {
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

export function createPrecipShaderLayer(mapInstance) {
    return {
        id: 'weather-gpu-shader',
        type: 'custom',
        chunkTextures: {},
        activeTex: null,
        paletteTex: null,
        texResolution: [2880.0, 1442.0],
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
            this.activeTex = null;
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
            this.paletteTex = createPrecipPaletteTexture(this.gl, hexArray);
            mapInstance.triggerRepaint();
        },
        
        onAdd: function (map, gl) {
            this.gl = gl;

            // 🌟 Subdivided grid across [-1, 2] (3 world copies)
            const gridData = createSubdividedGrid(-1.0, 2.0, 96, 48);
            this.vertexCount = gridData.length / 2;

            this.vertexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.STATIC_DRAW);

            const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
            const initialPalette = paletteFunc(stateManager.activeParam || 'tp');
            this.paletteTex = createPrecipPaletteTexture(gl, initialPalette);
        },

        // 🌟 Compiles and caches shaders per projection variant ('mercator', 'globe', or legacy fallback)
        getProgram: function(gl, shaderData) {
            const variant = shaderData?.variantName || 'default';
            if (this.programs[variant]) {
                return this.programs[variant];
            }

            let vsSource, fsSource;

            if (shaderData && shaderData.vertexShaderPrelude) {
                // MapLibre v5 dynamic projection shader (handles 2D Mercator, 3D Globe, and transition)
                vsSource = `#version 300 es
                ${shaderData.vertexShaderPrelude}
                ${shaderData.define || ''}
                in vec2 a_pos;
                out vec2 v_texcoord;

                void main() {
                    v_texcoord = a_pos;
                    gl_Position = projectTile(a_pos);
                }
                `;

                fsSource = `#version 300 es
                precision highp float;

                in vec2 v_texcoord;
                out vec4 fragColor;

                uniform sampler2D u_dataTexture;
                uniform sampler2D u_paletteTexture;
                uniform float u_opacity;
                uniform vec2 u_texResolution;

                ${fragmentShaderBody}

                void main() {
                    float mercY = (0.5 - v_texcoord.y) * 6.28318530718;
                    float latRad = 2.0 * atan(exp(mercY)) - 1.57079632679;
                    float normY = clamp(0.5 - (latRad / 3.14159265359), 0.0, 1.0);

                    vec2 uv = vec2(fract(v_texcoord.x), normY);
                    float rawVal = sampleSmoothSpline(u_dataTexture, uv, u_texResolution);

                    if (rawVal < 0.00001) {
                        discard;
                    }

                    float palIndex = clamp(rawVal * 255.0, 0.0, 255.0);
                    float palU = (palIndex + 0.5) / 256.0;
                    vec4 color = texture(u_paletteTexture, vec2(palU, 0.5));
                    
                    if (color.a == 0.0) {
                        discard;
                    }

                    fragColor = vec4(color.rgb, color.a * u_opacity);
                }
                `;
            } else {
                // Fallback standard shader
                vsSource = `
                attribute vec2 a_pos;
                varying vec2 v_texcoord;
                uniform mat4 u_matrix;

                void main() {
                    v_texcoord = a_pos;
                    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
                }
                `;

                fsSource = `
                precision highp float;
                varying vec2 v_texcoord;
                uniform sampler2D u_dataTexture;
                uniform sampler2D u_paletteTexture;
                uniform float u_opacity;
                uniform vec2 u_texResolution;

                ${fragmentShaderBody.replace(/texture\(/g, 'texture2D(')}

                void main() {
                    float mercY = (0.5 - v_texcoord.y) * 6.28318530718;
                    float latRad = 2.0 * atan(exp(mercY)) - 1.57079632679;
                    float normY = clamp(0.5 - (latRad / 3.14159265359), 0.0, 1.0);

                    vec2 uv = vec2(fract(v_texcoord.x), normY);
                    float rawVal = sampleSmoothSpline(u_dataTexture, uv, u_texResolution);

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

            const uploadSingle = (img) => {
                const tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

                gl.texImage2D(
                    gl.TEXTURE_2D, 0, gl.RGBA, 
                    gl.RGBA, gl.UNSIGNED_BYTE, img
                );
                
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
                source.frames.forEach((frameBmp, fIdx) => {
                    const key = `${chunkIndex}_${fIdx}`;
                    if (!this.chunkTextures[key] && frameBmp) {
                        this.chunkTextures[key] = uploadSingle(frameBmp);
                    }
                });
            } else {
                const key = `${chunkIndex}_0`;
                if (!this.chunkTextures[key]) {
                    this.chunkTextures[key] = uploadSingle(source);
                }
                this.chunkTextures[chunkIndex] = this.chunkTextures[key];
            }
        },

        updateFrame: function (frameState) {
            if (!this.gl || !frameState) return;
            const cIdx = frameState.chunkIndex;
            const fIdx = frameState.frameIndex !== undefined ? frameState.frameIndex : (frameState.col || 0);
            
            this.activeTex = this.chunkTextures[`${cIdx}_${fIdx}`] || this.chunkTextures[cIdx];
            mapInstance.triggerRepaint();
        },

        render: function (gl, matrixOrArgs) {
            if (!this.activeTex) return;

            // Handle both MapLibre v5 CustomRenderMethodInput and v4 matrix arguments
            const isV5 = Boolean(matrixOrArgs && (matrixOrArgs.defaultProjectionData || matrixOrArgs.shaderData));
            const shaderData = isV5 ? matrixOrArgs.shaderData : null;
            const projData = isV5 ? matrixOrArgs.defaultProjectionData : null;
            const matrix = isV5 
                ? (matrixOrArgs.modelViewProjectionMatrix || projData?.mainMatrix) 
                : matrixOrArgs;

            const program = this.getProgram(gl, shaderData);
            if (!program) return;

            gl.useProgram(program);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.activeTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_dataTexture'), 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
            gl.uniform1i(gl.getUniformLocation(program, 'u_paletteTexture'), 1);

            // 🌟 Feed MapLibre v5 projection uniforms (handles globe curvature, transition, and clipping)
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

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            const aPos = gl.getAttribLocation(program, 'a_pos');
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
        }
    };
}
