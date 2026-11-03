// js/shaders/ensembleShader.js
import { getPaletteForParameter as getLightPalette } from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

function createSubdividedGrid(minX = -1.0, maxX = 2.0, cols = 96, rows = 48) {
    const vertices = [];
    const dx = (maxX - minX) / cols;
    const dy = 1.0 / rows;

    function mercatorYToV(y) {
        const mercY = (0.5 - y) * 6.28318530718;
        const latRad = 2.0 * Math.atan(Math.exp(mercY)) - 1.57079632679;
        return 0.5 - (latRad / 3.14159265359);
    }

    const vTopEdge = mercatorYToV(0.0);
    const vBottomEdge = mercatorYToV(1.0);

    for (let c = 0; c < cols; c++) {
        const x0 = minX + c * dx;
        const x1 = minX + (c + 1) * dx;
        const xMid = (x0 + x1) * 0.5;
        vertices.push(x0, 0.0, x0, vTopEdge, x1, 0.0, x1, vTopEdge, xMid, -10.0, xMid, 0.0);
    }

    for (let r = 0; r < rows; r++) {
        const y0 = r * dy;
        const y1 = (r + 1) * dy;
        const v0 = mercatorYToV(y0);
        const v1 = mercatorYToV(y1);

        for (let c = 0; c < cols; c++) {
            const x0 = minX + c * dx;
            const x1 = minX + (c + 1) * dx;
            vertices.push(
                x0, y0, x0, v0, x1, y0, x1, v0, x0, y1, x0, v1,
                x0, y1, x0, v1, x1, y0, x1, v0, x1, y1, x1, v1
            );
        }
    }

    for (let c = 0; c < cols; c++) {
        const x0 = minX + c * dx;
        const x1 = minX + (c + 1) * dx;
        const xMid = (x0 + x1) * 0.5;
        vertices.push(x0, 1.0, x0, vBottomEdge, xMid, 10.0, xMid, 1.0, x1, 1.0, x1, vBottomEdge);
    }

    return new Float32Array(vertices);
}

const fragmentShaderBody = `
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
            float rowVal = wx.x * texture(tex, vec2(x0, yCoord)).r +
                           wx.y * texture(tex, vec2(x1, yCoord)).r +
                           wx.z * texture(tex, vec2(x2, yCoord)).r +
                           wx.w * texture(tex, vec2(x3, yCoord)).r;

            float w_y = (y == -1) ? wy.x : ((y == 0) ? wy.y : ((y == 1) ? wy.z : wy.w));
            total += w_y * rowVal;
        }
        return clamp(total, 0.0, 1.0);
    }
`;

function createPaletteTexture(gl, paletteHexArray) {
    const paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    const paletteData = new Uint8Array(paletteHexArray.length * 4);
    
    paletteHexArray.forEach((hex, i) => {
        if (hex === 'transparent' || !hex || i === 0) {
            paletteData[i * 4]     = 0;
            paletteData[i * 4 + 1] = 0;
            paletteData[i * 4 + 2] = 0;
            paletteData[i * 4 + 3] = 0;
        } else {
            const num = parseInt(hex.replace('#', ''), 16);
            paletteData[i * 4]     = (num >> 16) & 255;
            paletteData[i * 4 + 1] = (num >> 8) & 255;
            paletteData[i * 4 + 2] = num & 255;
            paletteData[i * 4 + 3] = 255;
        }
    });

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, paletteHexArray.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return paletteTex;
}

// 🌟 THE FIX: Scale the entire row, not just the diagonal
function cropMatrix(m, sx, sy) {
    const out = new Float32Array(m);
    for (const i of [0, 4, 8, 12]) out[i] *= sx;
    for (const i of [1, 5, 9, 13]) out[i] *= sy;
    return out;
}

export function createEnsembleOverlayShader(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false });
    if (!gl) return null;

    const gridData = createSubdividedGrid(-1.0, 2.0, 96, 48);
    const vertexCount = gridData.length / 4;
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.STATIC_DRAW);

    const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
    let paletteTex = createPaletteTexture(gl, paletteFunc(stateManager.activeParam || 'tp'));

    const chunkTextures = {};
    let activeTextures = null;
    let texResolution = [2880.0, 1442.0];

    // Compile Shader
    const vsSource = `
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    uniform mat4 u_matrix;
    void main() {
        v_uv = a_uv;
        if (a_pos.y < -5.0 || a_pos.y > 5.0) {
            gl_Position = vec4(0.0, 0.0, -2.0, 0.0);
        } else {
            gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
        }
    }`;
    const fsSource = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_dataTexture;
    uniform sampler2D u_paletteTexture;
    uniform vec2 u_texResolution;
    ${fragmentShaderBody.replace(/texture\(/g, 'texture2D(')}
    void main() {
        vec2 uv = vec2(fract(v_uv.x), clamp(v_uv.y, 0.0, 1.0));
        float rawVal = sampleSmoothSpline(u_dataTexture, uv, u_texResolution);
        if (rawVal < 0.00001) discard;
        float palU = (clamp(rawVal * 255.0, 0.0, 255.0) + 0.5) / 256.0;
        vec4 color = texture2D(u_paletteTexture, vec2(palU, 0.5));
        if (color.a == 0.0) discard;
        gl_FragColor = vec4(color.rgb, color.a);
    }`;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    const aPos = gl.getAttribLocation(program, 'a_pos');
    const aUv = gl.getAttribLocation(program, 'a_uv');
    const uMatrix = gl.getUniformLocation(program, 'u_matrix');
    const uDataTexture = gl.getUniformLocation(program, 'u_dataTexture');
    const uPaletteTexture = gl.getUniformLocation(program, 'u_paletteTexture');
    const uTexResolution = gl.getUniformLocation(program, 'u_texResolution');

    return {
        updatePalette: function(paramIdOrHexArray) {
            let hexArray;
            if (Array.isArray(paramIdOrHexArray)) {
                hexArray = paramIdOrHexArray;
            } else {
                const paletteFn = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
                hexArray = paletteFn(paramIdOrHexArray || stateManager.activeParam || 'tp');
            }
            if (paletteTex) gl.deleteTexture(paletteTex);
            paletteTex = createPaletteTexture(gl, hexArray);
        },

        clearTextures: function() {
            for (const key in chunkTextures) {
                if (Array.isArray(chunkTextures[key])) {
                    chunkTextures[key].forEach(tex => gl.deleteTexture(tex));
                }
            }
            Object.keys(chunkTextures).forEach(k => delete chunkTextures[k]);
            activeTextures = null;
        },

        preloadChunkTexture: function(chunkIndex, source) {
            if (!source) return;
            const uploadSingle = (img) => {
                const tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                return tex;
            };

            if (source.frames && Array.isArray(source.frames)) {
                if (source.width && source.height) texResolution = [source.width, source.height];
                source.frames.forEach((memberBitmaps, fIdx) => {
                    const key = `${chunkIndex}_${fIdx}`;
                    if (memberBitmaps && Array.isArray(memberBitmaps) && !chunkTextures[key]) {
                        chunkTextures[key] = memberBitmaps.map(bmp => uploadSingle(bmp));
                    }
                });
            }
        },

        updateFrame: function (frameState) {
            if (!frameState) return;
            const cIdx = frameState.chunkIndex;
            const fIdx = frameState.frameIndex !== undefined ? frameState.frameIndex : (frameState.col || 0);
            activeTextures = chunkTextures[`${cIdx}_${fIdx}`];
        },

        render: function (matrix) {
            // Handle resize
            const dpr = window.devicePixelRatio || 1;
            const w = window.innerWidth;
            const h = window.innerHeight;
            if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
                canvas.width = w * dpr;
                canvas.height = h * dpr;
            }

            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            if (!activeTextures || activeTextures.length !== 10 || !matrix) return;

            gl.useProgram(program);
            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

            gl.uniform2f(uTexResolution, texResolution[0], texResolution[1]);
            
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, paletteTex);
            gl.uniform1i(uPaletteTexture, 1);

            gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
            if (aUv !== -1) {
                gl.enableVertexAttribArray(aUv);
                gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
            }

            const cards = document.querySelectorAll('.map-card');
            
            if (cards.length === 10) {
                cards.forEach((card, index) => {
                    const rect = card.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) return;

                    const x = rect.left * dpr;
                    const y = (canvas.height - rect.bottom * dpr);
                    const cw = rect.width * dpr;
                    const ch = rect.height * dpr;

                    gl.viewport(x, y, cw, ch);

                    const dstAspect = cw / ch;
                    const srcAspect = canvas.width / canvas.height;
                    let scaleX = 1.0, scaleY = 1.0;

                    if (srcAspect > dstAspect) {
                        scaleX = srcAspect / dstAspect;
                    } else {
                        scaleY = dstAspect / srcAspect;
                    }

                    const scaledMatrix = cropMatrix(matrix, scaleX, scaleY);
                    gl.uniformMatrix4fv(uMatrix, false, scaledMatrix);

                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, activeTextures[index]);
                    gl.uniform1i(uDataTexture, 0);

                    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
                });
            }
        }
    };
}
