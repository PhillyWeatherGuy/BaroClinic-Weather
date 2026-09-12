// js/shaders/singleSiteRadarShader.js
import { createRadarPaletteTexture, WXTOOLS_PALETTE_256 } from '../config/radarPalettes.js';

const vsSingleSite = `
    attribute vec2 a_pos;
    varying vec2 v_mercPos;
    uniform mat4 u_matrix;

    void main() {
        v_mercPos = a_pos;
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
    }
`;

const fsSingleSite = `
    precision highp float;

    varying vec2 v_mercPos;
    uniform vec2 u_centerLngLat;
    uniform float u_maxRangeMeters;
    uniform sampler2D u_radarTexture;
    uniform sampler2D u_paletteTexture;
    uniform float u_opacity;

    const float PI = 3.14159265358979323846;
    const float TWO_PI = 6.28318530717958647692;
    const float EARTH_RADIUS = 6371000.0; // Mean Earth radius in meters

    void main() {
        // 1. Convert MapLibre Mercator coordinates (0..1) to Longitude & Latitude
        float lng = v_mercPos.x * 360.0 - 180.0;
        float mercY = (0.5 - v_mercPos.y) * TWO_PI;
        float latRad = 2.0 * atan(exp(mercY)) - (PI * 0.5);
        float lat = latRad * (180.0 / PI);

        // 2. Geodesic distance components (dx: East, dy: North) in meters
        float dLngRad = radians(lng - u_centerLngLat.x);
        float dLatRad = radians(lat - u_centerLngLat.y);
        float avgLatRad = radians((lat + u_centerLngLat.y) * 0.5);

        float dx = dLngRad * EARTH_RADIUS * cos(avgLatRad);
        float dy = dLatRad * EARTH_RADIUS;
        float r = sqrt(dx * dx + dy * dy);

        // Discard beyond maximum radar range
        if (r > u_maxRangeMeters || r < 1000.0) {
            discard;
        }

        // 3. True Meteorological Azimuth (clockwise from North: 0° = North, 90° = East)
        float azimuthRad = atan(dx, dy);
        if (azimuthRad < 0.0) {
            azimuthRad += TWO_PI;
        }

        float normAzimuth = azimuthRad / TWO_PI;        // 0.0 to 1.0 (Texture Y: 720 radials)
        float normRange = r / u_maxRangeMeters;         // 0.0 to 1.0 (Texture X: Range bins)

        // 4. Sample the raw radial data texture
        float rawByte = texture2D(u_radarTexture, vec2(normRange, normAzimuth)).r;

        // Byte 0 = Below threshold / no signal (clear air)
        if (rawByte < 0.0039) {
            discard;
        }

        // 5. Sample the 256-color palette from radarPalettes.js
        float palU = (rawByte * 255.0 + 0.5) / 256.0;
        vec4 color = texture2D(u_paletteTexture, vec2(palU, 0.5));

        if (color.a < 0.01) {
            discard;
        }

        gl_FragColor = vec4(color.rgb, color.a * u_opacity);
    }
`;

export function createSingleSiteRadarLayer(mapInstance) {
    return {
        id: 'single-site-radar-gpu',
        type: 'custom',
        gl: null,
        program: null,
        vertexBuffer: null,
        radarTexture: null,
        paletteTexture: null,
        activePalette: WXTOOLS_PALETTE_256,

        // Station origin and coverage limits
        centerLngLat: [-74.4111, 39.9469],
        maxRangeMeters: 460000.0,
        opacity: 0.95,
        isVisible: false,

        /**
         * 🌟 Updates the color scale on the fly using any palette from radarPalettes.js
         */
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

        /**
         * 🌟 Updates the sweep data from the level3Decoder output
         */
        setSweepData: function (sweep) {
            if (!this.gl || !sweep || !sweep.data) return;
            const gl = this.gl;

            this.centerLngLat = [sweep.lon, sweep.lat];
            this.maxRangeMeters = sweep.maxRangeMeters || 460000.0;
            this.updateBoundingQuad(this.centerLngLat, this.maxRangeMeters);

            // Upload 720 radials x numBins 8-bit texture
            if (!this.radarTexture) {
                this.radarTexture = gl.createTexture();
            }

            gl.bindTexture(gl.TEXTURE_2D, this.radarTexture);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

            // Width = Range bins (e.g. 1840), Height = Radials (720)
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

            // NEAREST prevents gates from bleeding together, maintaining the crisp super-res look
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); // Range
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);        // Azimuth wraps 360° -> 0°

            this.isVisible = true;
            mapInstance.triggerRepaint();
        },

        /**
         * 🌟 Constructs the MapLibre Mercator bounding box around the radar coverage circle
         */
        updateBoundingQuad: function (centerLngLat, maxRangeMeters) {
            if (!this.gl || !window.maplibregl) return;
            const gl = this.gl;

            const centerMerc = window.maplibregl.MercatorCoordinate.fromLngLat(centerLngLat);
            const rMerc = maxRangeMeters * centerMerc.meterInMercatorCoordinateUnits() * 1.05;

            const x0 = centerMerc.x - rMerc;
            const x1 = centerMerc.x + rMerc;
            const y0 = centerMerc.y - rMerc;
            const y1 = centerMerc.y + rMerc;

            const quadVerts = new Float32Array([
                x0, y0,
                x1, y0,
                x0, y1,
                x0, y1,
                x1, y0,
                x1, y1
            ]);

            if (!this.vertexBuffer) {
                this.vertexBuffer = gl.createBuffer();
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.DYNAMIC_DRAW);
        },

        onAdd: function (map, gl) {
            this.gl = gl;

            const vs = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vs, vsSingleSite);
            gl.compileShader(vs);

            const fs = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fs, fsSingleSite);
            gl.compileShader(fs);

            this.program = gl.createProgram();
            gl.attachShader(this.program, vs);
            gl.attachShader(this.program, fs);
            gl.linkProgram(this.program);

            this.aPos = gl.getAttribLocation(this.program, 'a_pos');
            this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix');
            this.uCenterLngLat = gl.getUniformLocation(this.program, 'u_centerLngLat');
            this.uMaxRangeMeters = gl.getUniformLocation(this.program, 'u_maxRangeMeters');
            this.uRadarTexture = gl.getUniformLocation(this.program, 'u_radarTexture');
            this.uPaletteTexture = gl.getUniformLocation(this.program, 'u_paletteTexture');
            this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');

            this.updatePalette(this.activePalette);
            this.updateBoundingQuad(this.centerLngLat, this.maxRangeMeters);
        },

        render: function (gl, matrix) {
            if (!this.isVisible || !this.program || !this.radarTexture || !this.paletteTexture) return;

            gl.useProgram(this.program);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.radarTexture);
            gl.uniform1i(this.uRadarTexture, 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
            gl.uniform1i(this.uPaletteTexture, 1);

            gl.uniformMatrix4fv(this.uMatrix, false, matrix);
            gl.uniform2f(this.uCenterLngLat, this.centerLngLat[0], this.centerLngLat[1]);
            gl.uniform1f(this.uMaxRangeMeters, this.maxRangeMeters);
            gl.uniform1f(this.uOpacity, this.opacity);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.enableVertexAttribArray(this.aPos);
            gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
        },

        onRemove: function (map, gl) {
            this.isVisible = false;
            if (this.radarTexture) gl.deleteTexture(this.radarTexture);
            if (this.paletteTexture) gl.deleteTexture(this.paletteTexture);
            if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
            if (this.program) gl.deleteProgram(this.program);
            this.radarTexture = null;
            this.paletteTexture = null;
            this.vertexBuffer = null;
            this.program = null;
        }
    };
}
