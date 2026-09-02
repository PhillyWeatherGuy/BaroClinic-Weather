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

    // 🌟 2D Cubic Spline Evaluation on Radar Grid
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
        // 1. Convert Mercator UV to Geographic Coordinates (Lng/Lat)
        float lng = fract(v_texcoord.x) * 360.0 - 180.0;
        float mercY = clamp((0.5 - v_texcoord.y) * 6.28318530718, -12.0, 12.0);
        float latRad = 2.0 * atan(exp(mercY)) - 1.57079632679;
        float lat = latRad * 57.29577951308232; // In degrees

        // 2. CONUS Radar Bounding Box: West -126.0, East -66.0, South 24.0, North 50.0
        if (lng < -126.0 || lng > -66.0 || lat < 24.0 || lat > 50.0) {
            discard;
        }

        // 3. Map geographic coordinates into CONUS raster UV space
        float u = (lng - (-126.0)) / ((-66.0) - (-126.0));
        float v = (50.0 - lat) / (50.0 - 24.0);
        vec2 radarUV = vec2(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0));

        // 4. Sample smooth spline reflectivity value
        float rawVal = sampleSmoothSpline(u_dataTexture, radarUV, u_texResolution);

        // 5. Discard zero/clear air echoes (< 5 dBZ)
        if (rawVal < 0.005) {
            discard;
        }

        // 6. Map dBZ value to dynamic Custom 1D Palette Texture
        float palIndex = clamp(rawVal * 255.0, 0.0, 255.0);
        float palU = (palIndex + 0.5) / 256.0;
        vec4 color = texture2D(u_paletteTexture, vec2(palU, 0.5));

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
        texResolution: [2000.0, 1000.0],

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

            // 🌟 Disable depth test so radar paints over ocean and land
            gl.disable(gl.DEPTH_TEST);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, 30);
        }
    };
}
