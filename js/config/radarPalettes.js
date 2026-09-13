// js/config/radarPalettes.js

/**
 * ============================================================================
 * 1. REFLECTIVITY PALETTES (dBZ)
 * ============================================================================
 */

export const WXTOOLS_RAW_PALETTE_STRING = `
product: BR
units: dBZ
step: 5

color4: -15 0 0 0 0
color: 5 29 37 60
color: 17.5 89 155 171
color: 22.5 33 186 72
color: 32.5 5 101 1
color: 37.5 251 252 0 199 176 0
color: 42.5 253 149 2 172 92 2
color: 50 253 38 0 135 43 22
color: 60 193 148 179 200 23 119
color: 70 165 2 215 64 0 146
color: 75 135 255 253 54 120 142
color: 80 173 99 64
color: 85 105 0 4
color: 95 0 0 0
`;

export function parseGrLevelxPalette(text) {
    const lines = text.trim().split('\n');
    const stops = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('product') || trimmed.startsWith('units') || trimmed.startsWith('step')) {
            continue;
        }

        if (trimmed.startsWith('color4:')) {
            const parts = trimmed.replace('color4:', '').trim().split(/\s+/).map(Number);
            if (parts.length >= 5) {
                stops.push({ dbz: parts[0], r: parts[1], g: parts[2], b: parts[3], a: parts[4] });
            }
        } else if (trimmed.startsWith('color:')) {
            const parts = trimmed.replace('color:', '').trim().split(/\s+/).map(Number);
            if (parts.length === 4) {
                stops.push({ dbz: parts[0], r: parts[1], g: parts[2], b: parts[3], a: 255 });
            } else if (parts.length >= 7) {
                stops.push({ dbz: parts[0], r: parts[1], g: parts[2], b: parts[3], a: 255 });
                stops.push({ dbz: parts[0] + 4.9, r: parts[4], g: parts[5], b: parts[6], a: 255 });
            }
        }
    }

    stops.sort((a, b) => a.dbz - b.dbz);
    return stops;
}

export function generate256RadarPalette(stops) {
    const palette = [];
    const minDbz = -30.0;
    const maxDbz = 95.0;

    for (let i = 0; i < 256; i++) {
        if (i === 0) {
            palette.push({ r: 0, g: 0, b: 0, a: 0 }); // Byte 0 transparent
            continue;
        }

        const dbz = minDbz + ((i - 1) / 254.0) * (maxDbz - minDbz);

        if (dbz <= stops[0].dbz) {
            const s = stops[0];
            palette.push({ r: s.r, g: s.g, b: s.b, a: s.a ?? 255 });
            continue;
        }

        if (dbz >= stops[stops.length - 1].dbz) {
            const s = stops[stops.length - 1];
            palette.push({ r: s.r, g: s.g, b: s.b, a: s.a ?? 255 });
            continue;
        }

        let left = stops[0];
        let right = stops[stops.length - 1];

        for (let j = 0; j < stops.length - 1; j++) {
            if (dbz >= stops[j].dbz && dbz <= stops[j + 1].dbz) {
                left = stops[j];
                right = stops[j + 1];
                break;
            }
        }

        const span = right.dbz - left.dbz;
        const t = span > 0 ? (dbz - left.dbz) / span : 0;

        const r = Math.round(left.r + t * (right.r - left.r));
        const g = Math.round(left.g + t * (right.g - left.g));
        const b = Math.round(left.b + t * (right.b - left.b));
        const a = Math.round((left.a ?? 255) + t * ((right.a ?? 255) - (left.a ?? 255)));

        palette.push({ r, g, b, a });
    }

    return palette;
}

export const WXTOOLS_STOPS = parseGrLevelxPalette(WXTOOLS_RAW_PALETTE_STRING);
export const WXTOOLS_PALETTE_256 = generate256RadarPalette(WXTOOLS_STOPS);

export const RADARSCOPE_PRO_STOPS = [
    { dbz: -15, r: 0, g: 0, b: 0, a: 0 },
    { dbz: 5,   r: 0, g: 240, b: 255, a: 255 },
    { dbz: 15,  r: 0, g: 85,  b: 255, a: 255 },
    { dbz: 25,  r: 0, g: 230, b: 118, a: 255 },
    { dbz: 35,  r: 100, g: 221, b: 23, a: 255 },
    { dbz: 45,  r: 255, g: 214, b: 0, a: 255 },
    { dbz: 55,  r: 255, g: 23,  b: 68, a: 255 },
    { dbz: 65,  r: 224, g: 64,  b: 251, a: 255 },
    { dbz: 75,  r: 255, g: 255, b: 255, a: 255 }
];
export const RADARSCOPE_PRO_PALETTE_256 = generate256RadarPalette(RADARSCOPE_PRO_STOPS);

export const NWS_CLASSIC_STOPS = [
    { dbz: -15, r: 0, g: 0, b: 0, a: 0 },
    { dbz: 5,   r: 4, g: 233, b: 231, a: 255 },
    { dbz: 15,  r: 3, g: 0,   b: 244, a: 255 },
    { dbz: 25,  r: 2, g: 253, b: 2,   a: 255 },
    { dbz: 35,  r: 0, g: 142, b: 0,   a: 255 },
    { dbz: 45,  r: 253, g: 248, b: 2, a: 255 },
    { dbz: 55,  r: 253, g: 0,   b: 0, a: 255 },
    { dbz: 65,  r: 248, g: 0,   b: 253, a: 255 },
    { dbz: 75,  r: 255, g: 255, b: 255, a: 255 }
];
export const NWS_CLASSIC_PALETTE_256 = generate256RadarPalette(NWS_CLASSIC_STOPS);

/**
 * ============================================================================
 * 2. SUPER-RES VELOCITY PALETTE (MPH)
 * ============================================================================
 */

export const VELOCITY_RAW_PALETTE_STRING = `
units: MPH
step: 10
product: BV
Scale:   2.23694 
color: 0 130 106 120 122 48 57
color: 10 105 0 0 242 1 6 
color: 40 249 58 84 255 142 212
color: 55 255 157 206 255 221 176
color: 60 255 230 169 255 151 86
color: 80 254 137 80 
color: 120 97 6 2 
color: 140 60 0 0
color: 200 45 0 0
color: -10 72 112 71 106 125 105
color: -40 10 248 35 15 99 20
color: -50 180 240 243 33 253 50
color: -70  55 226 229  172 239 242
color: -90 25 1 142 47 215 225
color: -100 105 2 142 32 1 141 
color: -120 250 4 130 114 3 141
color: -140 255 20 180
color: -200 255 220 220
RF: 123 0 200
`;

/**
 * 🌟 Symmetrical Velocity Color Stops (Calibrated in MPH)
 */
export const VELOCITY_STOPS = [
    // Extreme Inbound (-200 to -140 MPH: Tornado Core)
    { val: -200.0, r: 255, g: 220, b: 220 },
    { val: -140.0, r: 255, g: 20,  b: 180 },

    // Violent Inbound (-140 to -120 MPH: Hot Pink to Magenta)
    { val: -139.9, r: 114, g: 3,   b: 141 },
    { val: -120.0, r: 250, g: 4,   b: 130 },

    // Severe Inbound (-120 to -100 MPH: Deep Purple)
    { val: -119.9, r: 32,  g: 1,   b: 141 },
    { val: -100.0, r: 105, g: 2,   b: 142 },

    // Intense Inbound (-100 to -90 MPH: Indigo to Blue)
    { val: -99.9,  r: 47,  g: 215, b: 225 },
    { val: -90.0,  r: 25,  g: 1,   b: 142 },

    // High Inbound (-90 to -70 MPH: Deep Blue to Ice Blue/Cyan)
    { val: -89.9,  r: 172, g: 239, b: 242 },
    { val: -70.0,  r: 55,  g: 226, b: 229 },

    // Strong Inbound (-70 to -50 MPH: Electric Cyan to Neon Lime)
    { val: -69.9,  r: 172, g: 239, b: 242 },
    { val: -50.0,  r: 180, g: 240, b: 243 },

    // Moderate/Strong Inbound (-50 to -40 MPH: Neon Lime to Vivid Green)
    { val: -49.9,  r: 33,  g: 253, b: 50  },
    { val: -40.0,  r: 10,  g: 248, b: 35  },

    // 🌟 Standard Inbound Storm Winds (-40 to -10 MPH: Rich Vivid Doppler Green!)
    { val: -39.9,  r: 10,  g: 248, b: 35  },
    { val: -10.0,  r: 15,  g: 99,  b: 20  },

    // 🌟 Calm / Dead-Zone Inbound (-10 to 0 MPH: Neutral Gray-Green near 0)
    { val: -9.9,   r: 106, g: 125, b: 105 },
    { val: -0.1,   r: 72,  g: 112, b: 71  },

    // 🌟 Zero Velocity Line (0 MPH: Neutral Gray)
    { val: 0.0,    r: 130, g: 106, b: 120 },

    // 🌟 Calm / Dead-Zone Outbound (0 to +10 MPH: Neutral Gray to Faint Brown/Red)
    { val: 0.1,    r: 130, g: 106, b: 120 },
    { val: 9.9,    r: 122, g: 48,  b: 57  },

    // 🌟 Standard Outbound Storm Winds (+10 to +40 MPH: Dark Red to Crimson Red)
    { val: 10.0,   r: 105, g: 0,   b: 0   },
    { val: 39.9,   r: 242, g: 1,   b: 6   },

    // Strong Outbound (+40 to +55 MPH: Crimson to Salmon/Pink)
    { val: 40.0,   r: 249, g: 58,  b: 84  },
    { val: 54.9,   r: 255, g: 142, b: 212 },

    // Severe Outbound (+55 to +60 MPH: Pink to Cream/Orange)
    { val: 55.0,   r: 255, g: 157, b: 206 },
    { val: 59.9,   r: 255, g: 221, b: 176 },

    // Intense Outbound (+60 to +80 MPH: Yellow to Orange)
    { val: 60.0,   r: 255, g: 230, b: 169 },
    { val: 79.9,   r: 255, g: 151, b: 86  },

    // High Outbound (+80 to +120 MPH: Orange to Maroon)
    { val: 80.0,   r: 254, g: 137, b: 80  },
    { val: 119.9,  r: 97,  g: 6,   b: 2   },

    // Violent Outbound (+120 to +140 MPH: Maroon to Deep Red)
    { val: 120.0,  r: 97,  g: 6,   b: 2   },
    { val: 139.9,  r: 60,  g: 0,   b: 0   },

    // Catastrophic Outbound (+140 to +200 MPH: Deep Red to Dark)
    { val: 140.0,  r: 60,  g: 0,   b: 0   },
    { val: 200.0,  r: 45,  g: 0,   b: 0   }
];

export const VELOCITY_RF_COLOR = { r: 123, g: 0, b: 200, a: 255 };

export function generate256VelocityPalette(stops = VELOCITY_STOPS, rfColor = VELOCITY_RF_COLOR) {
    const palette = [];

    // Byte 0: Transparent (Clear air)
    palette.push({ r: 0, g: 0, b: 0, a: 0 });

    // Byte 1: Range Folded (RF Purple: 123, 0, 200)
    palette.push(rfColor);

    // Bytes 2..255: 0.5 m/s per count converted to MPH (1 m/s = 2.23694 MPH)
    for (let i = 2; i < 256; i++) {
        const mph = (i - 129) * 1.11847;

        if (mph <= stops[0].val) {
            palette.push({ r: stops[0].r, g: stops[0].g, b: stops[0].b, a: 255 });
            continue;
        }

        if (mph >= stops[stops.length - 1].val) {
            const last = stops[stops.length - 1];
            palette.push({ r: last.r, g: last.g, b: last.b, a: 255 });
            continue;
        }

        let left = stops[0];
        let right = stops[stops.length - 1];

        for (let j = 0; j < stops.length - 1; j++) {
            if (mph >= stops[j].val && mph <= stops[j + 1].val) {
                left = stops[j];
                right = stops[j + 1];
                break;
            }
        }

        const span = right.val - left.val;
        const t = span > 0 ? (mph - left.val) / span : 0;

        palette.push({
            r: Math.round(left.r + t * (right.r - left.r)),
            g: Math.round(left.g + t * (right.g - left.g)),
            b: Math.round(left.b + t * (right.b - left.b)),
            a: 255
        });
    }

    return palette;
}

export const VELOCITY_PALETTE_256 = generate256VelocityPalette();

/**
 * ============================================================================
 * 3. PRECIPITATION ACCUMULATION PALETTES (1-Hour, 3-Hour, Storm Total)
 * ============================================================================
 */

export const ACCUM_HEX_COLORS = [
    "#D0D0D0", "#A8A8A8", "#8A8A8A", "#787878", "#8C9987", "#B1CFA4", "#91CB7F", "#5DAD4E", "#4F9C3C", "#448D31",
    "#37725C", "#3361B6", "#5687C3", "#7BA6CA", "#A1BCCF", "#C5D0C8", "#D3CFAA", "#CFC37C", "#CBAC58", "#C88931",
    "#C67B30", "#C35523", "#B02D1C", "#9A2015", "#881C14", "#771811", "#5F1A15", "#634841", "#8B7069", "#9D827B",
    "#B19E97", "#BEB5B4", "#A69EB5", "#877E9D", "#756A92", "#635785", "#594176", "#66136B", "#A223AA", "#B627BF",
    "#C038CA", "#C45BCD", "#C574CD"
]; // Exactly 43 colors

// Exactly 43 steps from 0.01 to 10.00 inches
export const ACCUM_1H_3H_LEVELS = [
    0.01, 0.02, 0.05, 0.08, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35,
    0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00, 1.15, 1.30, 1.45,
    1.60, 1.80, 2.00, 2.25, 2.50, 2.75, 3.00, 3.25, 3.50, 3.75,
    4.00, 4.50, 5.00, 5.50, 6.00, 6.50, 7.00, 7.50, 8.00, 8.50,
    9.00, 9.50, 10.00
];

// Exactly 43 steps from 0.01 to 18.00 inches
export const ACCUM_STORM_TOTAL_LEVELS = [
    0.01, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60, 0.75,
    1.00, 1.25, 1.50, 1.75, 2.00, 2.25, 2.50, 2.75, 3.00, 3.50,
    4.00, 4.50, 5.00, 5.50, 6.00, 6.50, 7.00, 7.50, 8.00, 8.50,
    9.00, 9.50, 10.00, 11.00, 12.00, 13.00, 14.00, 15.00, 16.00, 16.50,
    17.00, 17.50, 18.00
];

function generate256AccumPalette(levels, hexColors, maxInches) {
    const palette = [];
    palette.push({ r: 0, g: 0, b: 0, a: 0 }); // Byte 0 = transparent

    for (let i = 1; i < 256; i++) {
        const val = ((i - 1) / 254.0) * maxInches;

        let colorHex = hexColors[0];
        for (let k = 0; k < levels.length; k++) {
            if (val >= levels[k]) {
                colorHex = hexColors[k];
            }
        }

        const num = parseInt(colorHex.replace('#', ''), 16);
        palette.push({
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255,
            a: 255
        });
    }

    return palette;
}

export const ACCUM_1H_3H_PALETTE_256 = generate256AccumPalette(ACCUM_1H_3H_LEVELS, ACCUM_HEX_COLORS, 10.0);
export const ACCUM_STORM_TOTAL_PALETTE_256 = generate256AccumPalette(ACCUM_STORM_TOTAL_LEVELS, ACCUM_HEX_COLORS, 18.0);

/**
 * ============================================================================
 * 4. DYNAMIC PALETTE SELECTOR BY PRODUCT CODE
 * ============================================================================
 */
export function getRadarPalette(productCode) {
    const p = (productCode || '').toUpperCase();

    if (p === 'N0U' || p === 'N0G' || p === 'VEL' || p.includes('VEL')) {
        return VELOCITY_PALETTE_256;
    }

    if (p === 'DAA' || p === 'N1P' || p === 'OHA' || p === '1HR' || p === 'N3P' || p === 'DU3' || p === '3HR') {
        return ACCUM_1H_3H_PALETTE_256;
    }

    if (p === 'DTA' || p === 'DSP' || p === 'NTP' || p === 'STA' || p === 'TOTAL') {
        return ACCUM_STORM_TOTAL_PALETTE_256;
    }

    return WXTOOLS_PALETTE_256;
}

export function createRadarPaletteTexture(gl, palette256 = WXTOOLS_PALETTE_256) {
    const paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    const data = new Uint8Array(256 * 4);

    for (let i = 0; i < 256; i++) {
        const c = palette256[i] || { r: 0, g: 0, b: 0, a: 0 };
        data[i * 4]     = c.r;
        data[i * 4 + 1] = c.g;
        data[i * 4 + 2] = c.b;
        data[i * 4 + 3] = c.a;
    }

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return paletteTex;
}
