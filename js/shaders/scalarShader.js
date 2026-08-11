// js/shaders/scalarShader.js
// COME BACK TO THIS IF SOMETHING BREAKS
import { getPaletteForParameter, TEMP_PALETTE } from '../config/palettes.js';

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

    void main() {
        // Mercator UV coordinate transform for Equirectangular input images
        float mercY = (0.5 - v_texcoord.y) * 6.28318530718;
        float latRad = 2.0 * atan(exp(mercY)) - 1.57079632679;
        float normY = clamp(0.5 - (latRad / 3.14159265359), 0.0, 1.0);

        // 🌟 Fixed: normY aligns North Pole to Top of 2D Map
        vec2 wrapped_uv = vec2(fract(v_texcoord.x), normY);
        vec2 sprite_uv = u_uvOffset + wrapped_uv * u_uvScale;

        float rawVal = texture2D(u_dataTexture, sprite_uv).r;
        vec4 color = texture2D(u_paletteTexture, vec2(rawVal, 0.5));
        gl_FragColor = vec4(color.rgb, color.a * u_opacity);
    }
`;

function createPaletteTexture(gl, paletteHexArray = TEMP_PALETTE) {
    const paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    const paletteData = new Uint8Array(paletteHexArray.length * 4);
    paletteHexArray.forEach((hex, i) => {
        const num = parseInt(hex.replace('#', ''), 16);
        paletteData[i * 4]     = (num >> 16) & 255;
        paletteData[i * 4 + 1] = (num >> 8) & 255;
        paletteData[i * 4 + 2] = num & 255;
        paletteData[i * 4 + 3] = 255;
    });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, paletteHexArray.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return paletteTex;
}

export function createScalarShaderLayer(mapInstance) {
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

        /**
         * 🌟 DYNAMIC PALETTE SWAP: Swaps GPU palette texture when picking a new parameter
         */
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

            this.paletteTex = createPaletteTexture(gl, TEMP_PALETTE);
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

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.enableVertexAttribArray(this.aPos);
            gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, 30);
        }
    };
}