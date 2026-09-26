// js/shaders/singleSiteRadarShader.js
import { createRadarPaletteTexture, WXTOOLS_PALETTE_256, getRadarPalette } from '../config/radarPalettes.js';

// 🌟 Generates a subdivided quad grid so the ~460km radar sweep curves with the Earth's sphere
function createSubdividedRadarQuad(x0, x1, y0, y1, steps = 16) {
    const verts = [];
    const dx = (x1 - x0) / steps;
    const dy = (y1 - y0) / steps;

    for (let r = 0; r < steps; r++) {
        const py0 = y0 + r * dy;
        const py1 = y0 + (r + 1) * dy;
        for (let c = 0; c < steps; c++) {
            const px0 = x0 + c * dx;
            const px1 = x0 + (c + 1) * dx;

            verts.push(
                px0, py0,
                px1, py0,
                px0, py1,
                px0, py1,
                px1, py0,
                px1, py1
            );
        }
    }
    return new Float32Array(verts);
}

const fsSourceLogic = `
    const float PI = 3.14159265358979323846;
    const float TWO_PI = 6.28318530717958647692;
    const float EARTH_RADIUS = 6371000.0;

    vec4 sampleRadar(vec2 mercPos, sampler2D radarTex, sampler2D palTex, vec2 centerLngLat, float maxRange, float opacity) {
        float lng = mercPos.x * 360.0 - 180.0;
        float mercY = (0.5 - mercPos.y) * TWO_PI;
        float latRad = 2.0 * atan(exp(mercY)) - (PI * 0.5);
        float lat = latRad * (180.0 / PI);

        float dLngRad = radians(lng - centerLngLat.x);
        float dLatRad = radians(lat - centerLngLat.y);
        float avgLatRad = radians((lat + centerLngLat.y) * 0.5);

        float dx = dLngRad * EARTH_RADIUS * cos(avgLatRad);
        float dy = dLatRad * EARTH_RADIUS;
        float r = sqrt(dx * dx + dy * dy);

        if (r > maxRange || r < 1000.0) {
            return vec4(0.0);
        }

        float azimuthRad = atan(dx, dy);
        if (azimuthRad < 0.0) {
            azimuthRad += TWO_PI;
        }

        float normAzimuth = azimuthRad / TWO_PI;
        float normRange = r / maxRange;

        float rawByte = texture(radarTex, vec2(normRange, normAzimuth)).r;

        if (rawByte < 0.001) {
            return vec4(0.0);
        }

        float palU = (rawByte * 255.0 + 0.5) / 256.0;
        vec4 color = texture(palTex, vec2(palU, 0.5));

        if (color.a < 0.01) {
            return vec4(0.0);
        }

        return vec4(color.rgb, color.a * opacity);
    }
`;

export function createSingleSiteRadarLayer(mapInstance) {
    return {
        id: 'single-site-radar-gpu',
        type: 'custom',
        gl: null,
        programs: {},
        vertexBuffer: null,
        vertexCount: 0,
        radarTexture: null,
        paletteTexture: null,
        activePalette: WXTOOLS_PALETTE_256,

        // Station origin and coverage limits
        centerLngLat: [-74.4111, 39.9469],
        maxRangeMeters: 460000.0,
        opacity: 0.95,
        isVisible: false,

        updatePalette: function (palette256) {
            this.activePalette = palette256 || WXTOOLS_PALETTE_256;
            if (this.gl) {
                if (this.paletteTexture) {
                    this.gl.deleteTexture(this.paletteTexture);
                }
                this.paletteTexture = createRadarPaletteTexture(this.gl, this.activePalette);
                mapInstance.triggerRepaint();
            }
        },

        setSweepData: function (sweep) {
            if (!this.gl || !sweep || !sweep.data) return;
            const gl = this.gl;

            if (sweep.product) {
                const targetPal = getRadarPalette(sweep.product);
                if (targetPal !== this.activePalette) {
                    this.updatePalette(targetPal);
                }
            }

            this.centerLngLat = [sweep.lon, sweep.lat];
            this.maxRangeMeters = sweep.maxRangeMeters || 460000.0;
            this.updateBoundingQuad(this.centerLngLat, this.maxRangeMeters);

            if (!this.radarTexture) {
                this.radarTexture = gl.createTexture();
            }

            gl.bindTexture(gl.TEXTURE_2D, this.radarTexture);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.LUMINANCE,
                sweep.numBins,
                sweep.numRadials,
                0,
                gl.LUMINANCE,
                gl.UNSIGNED_BYTE,
                sweep.data
            );

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

            this.isVisible = true;
            mapInstance.triggerRepaint();
        },

        updateBoundingQuad: function (centerLngLat, maxRangeMeters) {
            if (!this.gl || !window.maplibregl) return;
            const gl = this.gl;

            const centerMerc = window.maplibregl.MercatorCoordinate.fromLngLat(centerLngLat);
            const rMerc = maxRangeMeters * centerMerc.meterInMercatorCoordinateUnits() * 1.05;

            const x0 = centerMerc.x - rMerc;
            const x1 = centerMerc.x + rMerc;
            const y0 = centerMerc.y - rMerc;
            const y1 = centerMerc.y + rMerc;

            const quadVerts = createSubdividedRadarQuad(x0, x1, y0, y1, 16);
            this.vertexCount = quadVerts.length / 2;

            if (!this.vertexBuffer) {
                this.vertexBuffer = gl.createBuffer();
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.DYNAMIC_DRAW);
        },

        getProgram: function(gl, shaderData) {
            const variant = shaderData?.variantName || 'default';
            if (this.programs[variant]) {
                return this.programs[variant];
            }

            let vsSource, fsSource;

            if (shaderData && shaderData.vertexShaderPrelude) {
                vsSource = `#version 300 es
                ${shaderData.vertexShaderPrelude}
                ${shaderData.define || ''}
                in vec2 a_pos;
                out vec2 v_mercPos;

                void main() {
                    v_mercPos = a_pos;
                    gl_Position = projectTile(a_pos);
                }
                `;

                fsSource = `#version 300 es
                precision highp float;

                in vec2 v_mercPos;
                out vec4 fragColor;

                uniform vec2 u_centerLngLat;
                uniform float u_maxRangeMeters;
                uniform sampler2D u_radarTexture;
                uniform sampler2D u_paletteTexture;
                uniform float u_opacity;

                ${fsSourceLogic}

                void main() {
                    vec4 res = sampleRadar(v_mercPos, u_radarTexture, u_paletteTexture, u_centerLngLat, u_maxRangeMeters, u_opacity);
                    if (res.a < 0.01) {
                        discard;
                    }
                    fragColor = res;
                }
                `;
            } else {
                vsSource = `
                attribute vec2 a_pos;
                varying vec2 v_mercPos;
                uniform mat4 u_matrix;

                void main() {
                    v_mercPos = a_pos;
                    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
                }
                `;

                fsSource = `
                precision highp float;
                varying vec2 v_mercPos;
                uniform vec2 u_centerLngLat;
                uniform float u_maxRangeMeters;
                uniform sampler2D u_radarTexture;
                uniform sampler2D u_paletteTexture;
                uniform float u_opacity;

                ${fsSourceLogic.replace(/texture\(/g, 'texture2D(')}

                void main() {
                    vec4 res = sampleRadar(v_mercPos, u_radarTexture, u_paletteTexture, u_centerLngLat, u_maxRangeMeters, u_opacity);
                    if (res.a < 0.01) {
                        discard;
                    }
                    gl_FragColor = res;
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

        onAdd: function (map, gl) {
            this.gl = gl;
            this.updatePalette(this.activePalette);
            this.updateBoundingQuad(this.centerLngLat, this.maxRangeMeters);
        },

        render: function (gl, matrixOrArgs) {
            if (!this.isVisible || !this.radarTexture || !this.paletteTexture || !this.vertexBuffer) return;

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
            gl.bindTexture(gl.TEXTURE_2D, this.radarTexture);
            gl.uniform1i(gl.getUniformLocation(program, 'u_radarTexture'), 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
            gl.uniform1i(gl.getUniformLocation(program, 'u_paletteTexture'), 1);

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

            gl.uniform2f(gl.getUniformLocation(program, 'u_centerLngLat'), this.centerLngLat[0], this.centerLngLat[1]);
            gl.uniform1f(gl.getUniformLocation(program, 'u_maxRangeMeters'), this.maxRangeMeters);
            gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), this.opacity);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            const aPos = gl.getAttribLocation(program, 'a_pos');
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

            gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
        },

        onRemove: function (map, gl) {
            this.isVisible = false;
            if (this.radarTexture) gl.deleteTexture(this.radarTexture);
            if (this.paletteTexture) gl.deleteTexture(this.paletteTexture);
            if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
            for (const key in this.programs) {
                if (this.programs[key]) gl.deleteProgram(this.programs[key]);
            }
            this.programs = {};
            this.radarTexture = null;
            this.paletteTexture = null;
            this.vertexBuffer = null;
        }
    };
}
