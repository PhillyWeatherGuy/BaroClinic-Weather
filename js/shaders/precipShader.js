// js/shaders/precipShader.js
import { PRECIP_PALETTE } from '../config/palettes.js';

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
    // Keeping highp just in case the iPhone needs it to hold the 2880 pixel width
    precision highp float;
    
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

        // MapLibre multi-world wrap
        vec2 wrapped_uv = vec2(fract(v_texcoord.x), normY);
        
        // 🌟 THE FIX: Add a microscopic epsilon (0.0001) to push the coordinate 
        // into the dead-center of the texel. This absolutely prevents GL_NEAREST 
        // from rounding 0.2 down to 0.1999, which stops the "every 2 frames" grid shift!
        vec2 sprite_uv = u_uvOffset + wrapped_uv * u_uvScale + vec2(0.0001);

        // Fetch raw un-interpolated data point
        float rawVal = texture2D(u_dataTexture, sprite_uv).r;

        // Masking: Discard dry land (< 0.01" rain) completely
        if (rawVal < 0.002) {
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

function createPrecipPaletteTexture(gl, paletteHexArray = PRECIP_PALETTE) {
    const paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    const paletteData = new Uint8Array(paletteHexArray.length * 4);
    
    paletteHexArray.forEach((hex, i) => {
        const num = parseInt(hex.replace('#', ''), 16);
        paletteData[i * 4]     = (num >> 16) & 255;
        paletteData[i * 4 + 1] = (num >> 8) & 255;
        paletteData[i * 4 + 2] = num & 255;
        paletteData[i * 4 + 3] = (i === 0) ? 0 : 255;
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

        updatePalette: function(paletteHexArray = PRECIP_PALETTE) {
            if (!this.gl) return;
            if (this.paletteTex) {
                this.gl.deleteTexture(this.paletteTex);
            }
            // Fallback applied here to prevent string errors when selecting the parameter
            const hexArray = Array.isArray(paletteHexArray) ? paletteHexArray : PRECIP_PALETTE;
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

            this.paletteTex = createPrecipPaletteTexture(gl, PRECIP_PALETTE);
        },
        
        preloadChunkTexture: function(chunkIndex, imageBitmap) {
            if (!this.gl || this.chunkTextures[chunkIndex]) return;
            const gl = this.gl;
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, imageBitmap);
            
            // 🌟 STRICTLY NEAREST FILTERING FOR RAW DATA TESTING
            // This will show exactly what the backend Python script output.
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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
            gl.uniform1f(this.uOpacity, 0.85); 
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