// js/shaders/radarShader.js
import { createRadarPaletteTexture, WXTOOLS_PALETTE_256 } from '../config/radarPalettes.js';

const vsRadar = `
    attribute vec2 a_pos;
    varying vec2 v_texcoord;
    uniform mat4 u_matrix;
    void main() {
        v_texcoord = a_pos;
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
    }
`;

const fsRadar = `
    precision highp float;
    varying vec2 v_texcoord;
    uniform sampler2D u_dataTexture;
    uniform sampler2D u_paletteTexture;
    uniform float u_opacity;
    uniform vec2 u_texResolution;

    void main() {
        // 1. Convert Mercator UV to Geographic Coordinates (Lng/Lat)
        float lng = fract(v_texcoord.x) * 360.0 - 180.0;
        float mercY = clamp((0.5 - v_texcoord.y) * 6.28318530718, -12.0, 12.0);
        float latRad = 2.0 * atan(exp(mercY)) - 1.57079632679;
        float lat = latRad * 57.29577951308232;

        // 2. CONUS Radar Bounding Box: West -126.0, East -66.0, South 24.0, North 50.0
        if (lng < -126.0 || lng > -66.0 || lat < 24.0 || lat > 50.0) {
            discard;
        }

        // 3. Map geographic coordinates into CONUS raster UV space
        float u = (lng - (-126.0)) / ((-66.0) - (-126.0));
        float v = (50.0 - lat) / (50.0 - 24.0);
        vec2 radarUV = vec2(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0));

        // 4. Sample raw input texel
        vec4 src = texture2D(u_dataTexture, radarUV);

        // 5. Discard transparent / clear air pixels
        if (src.a < 0.05 || (src.r < 0.02 && src.g < 0.02 && src.b < 0.02)) {
            discard;
        }

        float r = src.r * 255.0;
        float g = src.g * 255.0;
        float b = src.b * 255.0;
        float dbzNorm = 0.0;

        // 🌟 6. Parallel GPU dBZ Scalar Decoder
        if (r > 200.0 && g > 200.0 && b > 200.0) {
            dbzNorm = 0.95; // 75+ dBZ (White / Giant Hail)
        } else if (r > 140.0 && b > 140.0 && g < 120.0) {
            dbzNorm = 0.80 + (r / 255.0) * 0.12; // 60-70 dBZ (Purple / Magenta)
        } else if (r > 160.0 && g < 90.0 && b < 90.0) {
            dbzNorm = 0.65 + (r / 255.0) * 0.13; // 50-60 dBZ (Red)
        } else if (r > 190.0 && g > 80.0 && b < 60.0) {
            dbzNorm = 0.52 + (g / 255.0) * 0.10; // 40-50 dBZ (Orange)
        } else if (r > 190.0 && g > 190.0 && b < 60.0) {
            dbzNorm = 0.42 + (g / 255.0) * 0.08; // 35-40 dBZ (Yellow)
        } else if (g > 80.0 && r < 120.0 && b < 120.0) {
            dbzNorm = 0.22 + (g / 255.0) * 0.18; // 20-35 dBZ (Green)
        } else if (b > 80.0 && r < 140.0) {
            dbzNorm = 0.06 + (b / 255.0) * 0.14; // 5-20 dBZ (Teal / Cyan)
        } else {
            dbzNorm = max(r, max(g, b)) / 255.0;
        }

        // 7. Map to your custom WxTools 1D Palette
        vec4 color = texture2D(u_paletteTexture, vec2(clamp(dbzNorm, 0.0, 1.0), 0.5));

        if (color.a < 0.01) {
            discard;
        }

        gl_FragColor = vec4(color.rgb, color.a * u_opacity);
    }
`;

export function createRadarShaderLayer(mapInstance) {
    return {
        id: 'radar-gpu-shader',
        type: 'custom',
        frameTextures: {},
        activeTex: null,
        paletteTex: null,
        texResolution: [6000.0, 2600.0],

        clearTextures: function () {
            if (!this.gl) return;
            for (const key in this.frameTextures) {
                if (this.frameTextures[key]) {
                    this.gl.deleteTexture(this.frameTextures[key]);
                }
            }
            this.frameTextures = {};
            this.activeTex = null;
        },

        updatePalette: function (palette256 = WXTOOLS_PALETTE_256) {
            if (!this.gl) return;
            if (this.paletteTex) {
                this.gl.deleteTexture(this.paletteTex);
            }
            this.paletteTex = createRadarPaletteTexture(this.gl, palette256);
            mapInstance.triggerRepaint();
        },

        onAdd: function (map, gl) {
            this.gl = gl;
            const vs = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vs, vsRadar);
            gl.compileShader(vs);

            const fs = gl.createShader(gl.FRAGMENT_SHADER);
            // 🌟 Fixed: compile fsRadar directly
            gl.shaderSource(fs, fsRadar);
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

            this.paletteTex = createRadarPaletteTexture(gl, WXTOOLS_PALETTE_256);
        },

        preloadRadarTexture: function (frameIndex, img) {
            if (!this.gl || !img) return;
            const gl = this.gl;

            if (img.width && img.height) {
                this.texResolution = [img.width, img.height];
            }

            if (!this.frameTextures[frameIndex]) {
                const tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

                gl.texImage2D(
                    gl.TEXTURE_2D, 0, gl.RGBA,
                    gl.RGBA, gl.UNSIGNED_BYTE, img
                );

                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

                this.frameTextures[frameIndex] = tex;
            }
        },

        updateFrame: function (frameIndex) {
            if (!this.gl) return;
            this.activeTex = this.frameTextures[frameIndex];
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
            gl.uniform1f(this.uOpacity, 1.0);
            gl.uniform2f(this.uTexResolution, this.texResolution[0], this.texResolution[1]);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.enableVertexAttribArray(this.aPos);
            gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

            gl.disable(gl.DEPTH_TEST);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, 30);
        }
    };
}
