// js/shaders/globeShader.js
import { HEX_PALETTE } from './scalarShader.js';

const vsGlobeSource = `
    attribute vec2 a_pos;
    varying vec2 v_texcoord;
    uniform mat4 u_matrix;
    void main() {
        v_texcoord = a_pos;
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
    }
`;

const fsGlobeSource = `
    precision mediump float;
    varying vec2 v_texcoord;
    uniform sampler2D u_dataTexture;
    uniform sampler2D u_paletteTexture;
    uniform float u_opacity;
    uniform vec2 u_uvOffset;
    uniform vec2 u_uvScale;

    void main() {
        vec2 wrapped_uv = vec2(fract(v_texcoord.x), v_texcoord.y);
        vec2 sprite_uv = u_uvOffset + wrapped_uv * u_uvScale;
        float rawVal = texture2D(u_dataTexture, sprite_uv).r;
        vec4 color = texture2D(u_paletteTexture, vec2(rawVal, 0.5));
        gl_FragColor = vec4(color.rgb, color.a * u_opacity);
    }
`;

function createPaletteTexture(gl) {
    const paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    const paletteData = new Uint8Array(HEX_PALETTE.length * 4);
    HEX_PALETTE.forEach((hex, i) => {
        const num = parseInt(hex.replace('#', ''), 16);
        paletteData[i * 4]     = (num >> 16) & 255;
        paletteData[i * 4 + 1] = (num >> 8) & 255;
        paletteData[i * 4 + 2] = num & 255;
        paletteData[i * 4 + 3] = 255;
    });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, HEX_PALETTE.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return paletteTex;
}

function generateSubdividedGlobeGrid(cols = 128, rows = 64) {
    const vertices = [];
    const xMin = -2.0;
    const xMax = 3.0;
    const yMin = 0.0;
    const yMax = 1.0;

    const dx = (xMax - xMin) / cols;
    const dy = (yMax - yMin) / rows;

    for (let r = 0; r < rows; r++) {
        const y1 = yMin + r * dy;
        const y2 = y1 + dy;
        for (let c = 0; c < cols; c++) {
            const x1 = xMin + c * dx;
            const x2 = x1 + dx;

            vertices.push(x1, y1,  x2, y1,  x1, y2);
            vertices.push(x1, y2,  x2, y1,  x2, y2);
        }
    }
    return new Float32Array(vertices);
}

export function createGlobeShaderLayer(mapInstance) {
    const gridCols = 128;
    const gridRows = 64;
    const totalVertices = gridCols * gridRows * 6;

    return {
        id: 'weather-globe-shader',
        type: 'custom',
        chunkTextures: {},
        activeTex: null,
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
        
        onAdd: function (map, gl) {
            this.gl = gl;
            const vs = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vs, vsGlobeSource);
            gl.compileShader(vs);

            const fs = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fs, fsGlobeSource);
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

            const quadVertices = generateSubdividedGlobeGrid(gridCols, gridRows);

            this.vertexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

            this.paletteTex = createPaletteTexture(gl);
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
            gl.uniform1f(this.uOpacity, 0.65);
            gl.uniform2f(this.uUvOffset, this.uvOffset[0], this.uvOffset[1]);
            gl.uniform2f(this.uUvScale, this.uvScale[0], this.uvScale[1]);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.enableVertexAttribArray(this.aPos);
            gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, totalVertices);
        }
    };
}