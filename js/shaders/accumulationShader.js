// js/shaders/accumulationShader.js
import { PRECIP_PALETTE, getPaletteForParameter } from '../config/palettes.js';
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
    precision mediump float;
    varying vec2 v_texcoord;
    uniform sampler2D u_dataTexture;
    uniform sampler2D u_paletteTexture;
    uniform float u_opacity;
    uniform vec2 u_uvOffset;
    uniform vec2 u_uvScale;
    uniform vec2 u_texSize;

    void main() {
        // Mercator UV coordinate transform for Equirectangular input images
        float mercY = (0.5 - v_texcoord.y) * 6.28318530718;
        float latRad = 2.0 * atan(exp(mercY)) - 1.57079632679;
        float normY = clamp(0.5 - (latRad / 3.14159265359), 0.0, 1.0);

        // Map North Pole to Top of PNG
        vec2 wrapped_uv = vec2(fract(v_texcoord.x), normY);
        vec2 sprite_uv = vec2(
            u_uvOffset.x + wrapped_uv.x * u_uvScale.x,
            u_uvOffset.y + (1.0 - wrapped_uv.y) * u_uvScale.y
        );

        // 🌟 GPU CUBIC SMOOTHSTEP INTERPOLATION USING EXACT SHEET DIMENSIONS
        vec2 samplePos = sprite_uv * u_texSize - 0.5;
        vec2 f = fract(samplePos);
        vec2 smoothF = f * f * (3.0 - 2.0 * f);
        vec2 smoothUv = (floor(samplePos) + 0.5 + smoothF) / u_texSize;

        float rawVal = texture2D(u_dataTexture, smoothUv).r;

        // Discard dry pixels (< 0.01 inches)
        if (rawVal < 0.0003) {
            discard;
        }

        float paletteU = (rawVal * 255.0 + 0.5) / 256.0;
        vec4 color = texture2D(u_paletteTexture, vec2(paletteU, 0.5));
        
        gl_FragColor = vec4(color.rgb, color.a * u_opacity);
    }
`;

function createPaletteTexture(gl, paletteArray = PRECIP_PALETTE) {
    const paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    const paletteData = new Uint8Array(paletteArray.length * 4);
    paletteArray.forEach((colorVal, i) => {
        let r = 0, g = 0, b = 0, a = 255;
        if (typeof colorVal === 'string' && colorVal.startsWith('#')) {
            const num = parseInt(colorVal.replace('#', ''), 16);
            r = (num >> 16) & 255;
            g = (num >> 8) & 255;
            b = num & 255;
        } else if (typeof colorVal === 'string' && colorVal.startsWith('rgba')) {
            const parts = colorVal.match(/[\d.]+/g);
            if (parts && parts.length >= 4) {
                r = parseInt(parts[0], 10);
                g = parseInt(parts[1], 10);
                b = parseInt(parts[2], 10);
                a = Math.round(parseFloat(parts[3]) * 255);
            }
        }
        paletteData[i * 4]     = r;
        paletteData[i * 4 + 1] = g;
        paletteData[i * 4 + 2] = b;
        paletteData[i * 4 + 3] = a;
    });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, paletteArray.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteData);
    
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return paletteTex;
}

export function createAccumulationShaderLayer(mapInstance) {
    return {
        id: 'weather-gpu-shader',
        type: 'custom',
        chunkTextures: {},
        activeTex: null,
        paletteTex: null,
        uvOffset: [0, 0],
        uvScale: [1, 1],

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
            const hexArray = Array.isArray(paramIdOrHexArray) 
                ? paramIdOrHexArray 
                : getPaletteForParameter(paramIdOrHexArray);
            
            if (this.paletteTex) {
                this.gl.deleteTexture(this.paletteTex);
            }
            this.paletteTex = createPaletteTexture(this.gl, hexArray);
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
            this.uUvOffset = gl.getUniformLocation(this.program, 'u_uvOffset');
            this.uUvScale = gl.getUniformLocation(this.program, 'u_uvScale');
            this.uTexSize = gl.getUniformLocation(this.program, 'u_texSize');

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

            this.paletteTex = createPaletteTexture(gl, PRECIP_PALETTE);
        },
        
        preloadChunkTexture: function(chunkIndex, imageBitmap) {
            if (!this.gl || this.chunkTextures[chunkIndex]) return;
            const gl = this.gl;
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, imageBitmap);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this.chunkTextures[chunkIndex] = tex;
        },

        updateFrame: function (frameState) {
            if (!this.gl) return;
            this.uvOffset = frameState.uvOffset;
            this.uvScale = frameState.uvScale;
            this.activeTex = this.chunkTextures[frameState.chunkIndex];
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
            gl.uniform1f(this.uOpacity, 1.00);
            gl.uniform2f(this.uUvOffset, this.uvOffset[0], this.uvOffset[1]);
            gl.uniform2f(this.uUvScale, this.uvScale[0], this.uvScale[1]);

            // 🌟 PASS REAL IMAGE DIMENSIONS (e.g. 2880.0, 3605.0) TO GPU
            const chunkIdx = stateManager.activeFrameState ? stateManager.activeFrameState.chunkIndex : 0;
            const chunkInfo = stateManager.manifest && stateManager.manifest.chunks ? stateManager.manifest.chunks[chunkIdx] : null;
            const sheetW = chunkInfo && chunkInfo.sheet_width ? float(chunkInfo.sheet_width) : 2880.0;
            const sheetH = chunkInfo && chunkInfo.sheet_height ? float(chunkInfo.sheet_height) : 3605.0;

            gl.uniform2f(this.uTexSize, sheetW, sheetH);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.enableVertexAttribArray(this.aPos);
            gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, 30);
        }
    };
}