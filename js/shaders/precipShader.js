// js/shaders/precipShader.js
import { getPaletteForParameter as getLightPalette } from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

const vsSource = `
    attribute vec2 a_pos;
    varying vec2 v_texcoord;
    uniform mat4 u_matrix;
    void main() {
        v_texcoord = a_pos;
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
    }
`;

const fsSource = `
    precision highp float;
    
    varying vec2 v_texcoord;
    uniform sampler2D u_dataTexture;
    uniform sampler2D u_paletteTexture;
    uniform float u_opacity;
    uniform vec2 u_texResolution;

    // 🌟 Catmull-Rom Cubic Spline 4-point Weights
    vec4 catmullRom(float f) {
        float f2 = f * f;
        float f3 = f2 * f;
        return vec4(
            -0.5 * f3 + f2 - 0.5 * f,
             1.5 * f3 - 2.5 * f2 + 1.0,
            -1.5 * f3 + 2.0 * f2 + 0.5 * f,
             0.5 * f3 - 0.5 * f2
        );
    }

    // 🌟 2D Catmull-Rom Bicubic Evaluation on 2880x1442 Grid
    float sampleCatmullRom(sampler2D tex, vec2 uv, vec2 texRes) {
        vec2 pos = uv * texRes - 0.5;
        vec2 f = fract(pos);
        vec2 i = floor(pos);

        vec4 wx = catmullRom(f.x);
        vec4 wy = catmullRom(f.y);

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
        // 1. Mercator UV coordinate transform
        float mercY = (0.5 - v_texcoord.y) * 6.28318530718;
        float latRad = 2.0 * atan(exp(mercY)) - 1.57079632679;
        float normY = clamp(0.5 - (latRad / 3.14159265359), 0.0, 1.0);

        vec2 uv = vec2(fract(v_texcoord.x), normY);

        // 2. 🌟 GPU Catmull-Rom Bicubic Spline Evaluation
        float rawVal = sampleCatmullRom(u_dataTexture, uv, u_texResolution);

        // Mask dry land
        if (rawVal < 0.00001) {
            discard;
        }

        // Discrete step palette lookup
        float palIndex = clamp(rawVal * 255.0, 0.0, 255.0);
        float palU = (palIndex + 0.5) / 256.0;
        vec4 color = texture2D(u_paletteTexture, vec2(palU, 0.5));
        
        if (color.a == 0.0) {
            discard;
        }

        gl_FragColor = vec4(color.rgb, color.a * u_opacity);
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
            const vs = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vs, vsSource);
            gl.compileShader(vs);

            const fs = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fs, fsSource);
            gl.compileShader(fs);

            this.program = gl.createProgram();
            gl.attachShader(this.program, vs);
            gl.attachShader(this.program, fs);
            gl.linkProgram(this.program);

            this.aPos = gl.getAttribLocation(this.program, 'a_pos');
            this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix');
            this.uDataTexture = gl.getUniformLocation(this.program, 'u_dataTexture');
            this.uPaletteTexture = gl.getUniformLocation(this.program, 'u_paletteTexture');
            this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');
            this.uTexResolution = gl.getUniformLocation(this.program, 'u_texResolution');

            const quadVertices = new Float32Array([
                -2,0,  -1,0,  -2,1,   -2,1,  -1,0,  -1,1,
                -1,0,   0,0,  -1,1,   -1,1,   0,0,   0,1,
                 0,0,   1,0,   0,1,    0,1,   1,0,   1,1,
                 1,0,   2,0,   1,1,    1,1,   2,0,   2,1,
                 2,0,   3,0,   2,1,    2,1,   3,0,   3,1
            ]);

            this.vertexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

            const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
            const initialPalette = paletteFunc(stateManager.activeParam || 'tp');
            this.paletteTex = createPrecipPaletteTexture(gl, initialPalette);
        },
        
        preloadChunkTexture: function(chunkIndex, source) {
            if (!this.gl || !source) return;
            const gl = this.gl;

            const uploadSingle = (img) => {
                const tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

                // 🌟 Correct RGBA upload matching the 2x ImageBitmap / Canvas
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

        render: function (gl, matrix) {
            if (!this.program || !this.activeTex) return;

            gl.useProgram(this.program);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.activeTex);
            gl.uniform1i(this.uDataTexture, 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
            gl.uniform1i(this.uPaletteTexture, 1);

            gl.uniformMatrix4fv(this.uMatrix, false, matrix);
            gl.uniform1f(this.uOpacity, 0.85);
            gl.uniform2f(this.uTexResolution, this.texResolution[0], this.texResolution[1]);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.enableVertexAttribArray(this.aPos);
            gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, 30);
        }
    };
}
