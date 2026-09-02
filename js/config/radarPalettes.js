// js/config/radarPalettes.js

/**
 * 🛰️ Raw WxTools / Gibson Ridge Color Table String (from your screenshot)
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

/**
 * 🌟 Dynamic WxTools / GRLevelX / Gibson Ridge .pal Text Parser
 * Converts raw WxTools palette strings into an array of { dbz, r, g, b, a } stops
 */
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
                // Gradient band from (r1, g1, b1) to (r2, g2, b2)
                stops.push({ dbz: parts[0], r: parts[1], g: parts[2], b: parts[3], a: 255 });
                stops.push({ dbz: parts[0] + 4.9, r: parts[4], g: parts[5], b: parts[6], a: 255 });
            }
        }
    }

    stops.sort((a, b) => a.dbz - b.dbz);
    return stops;
}

/**
 * 🌟 256-Entry WebGL Palette Builder
 * Maps physical dBZ values (-30 dBZ to +95 dBZ) into a 256-pixel RGBA array
 */
export function generate256RadarPalette(stops) {
    const palette = [];
    const minDbz = -30.0;
    const maxDbz = 95.0;

    for (let i = 0; i < 256; i++) {
        if (i === 0) {
            palette.push({ r: 0, g: 0, b: 0, a: 0 }); // Byte 0 is always transparent
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

        // Linear interpolation between bounding stops
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

/**
 * 🌈 Parsed WxTools Custom Scale (Default)
 */
export const WXTOOLS_STOPS = parseGrLevelxPalette(WXTOOLS_RAW_PALETTE_STRING);
export const WXTOOLS_PALETTE_256 = generate256RadarPalette(WXTOOLS_STOPS);

/**
 * ⚡ Preset 2: RadarScope Pro / High-Contrast
 */
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

/**
 * 🌦️ Preset 3: NWS Classic Operational Scale
 */
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
 * 🌟 Create a WebGL 1D Texture from a 256-Entry Palette
 */
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
