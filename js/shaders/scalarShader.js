// js/shaders/scalarShader.js
export const HEX_PALETTE = [
    "#E4E3E7", "#B3B1B7", "#ADACB5", "#A8A6B2", "#9E9DAC", "#9D9CAF", "#9897AE", "#9693AF",
    "#908BAB", "#8E89AC", "#8E85AC", "#887BA6", "#806D9E", "#8169A0", "#8367A2", "#8467A3",
    "#81659F", "#8164A0", "#795B9D", "#72539A", "#73539E", "#664393", "#5E378C", "#5B308B",
    "#5D3090", "#5C288E", "#5E2891", "#5E2690", "#5A1E8B", "#5C1C8B", "#591587", "#5A1286",
    "#580D82", "#570D82", "#570D82", "#570D82", "#570D82", "#570D81", "#570D81", "#570D81",
    "#570D81", "#5E0C7F", "#6D1485", "#701280", "#761581", "#78157F", "#821A81", "#85177B",
    "#921E80", "#941C7D", "#991F7E", "#9B1F7C", "#9C1E7C", "#9E1D7B", "#A3217D", "#A4217B",
    "#AE247B", "#B2247A", "#B6267B", "#B82579", "#BF287A", "#C22778", "#C7297A", "#CA2B79",
    "#D12D7A", "#D22C7A", "#D12B79", "#D5307E", "#D53280", "#D1317E", "#DF418E", "#E54B97",
    "#E44D98", "#E34F99", "#E859A1", "#E75FA5", "#EA68AC", "#E669AC", "#EA71B2", "#DE77B1",
    "#EB8FC5", "#E58EC2", "#E48FC3", "#E391C4", "#E193C4", "#DF97C6", "#DA98C5", "#D59AC4",
    "#D6A3C9", "#CDA6C6", "#C8AEC9", "#C2B2CA", "#BEB5CC", "#BDB8CF", "#C3BFD6", "#C3C0D8",
    "#C7C7DE", "#BEC3D9", "#C6D1E5", "#C1D2E5", "#BBD4E4", "#B9D9E8", "#B5DBE6", "#B8DFE9",
    "#B9E1EA", "#BCE4ED", "#BCE5EC", "#BDE7ED", "#BEE8EE", "#BCE5EB", "#B9E5EE", "#ABD9E4",
    "#A9D8E7", "#9DCDE0", "#94C3DA", "#8AB8D1", "#89B6CF", "#7DAAC1", "#699DAC", "#60939B",
    "#629392", "#608A85", "#648882", "#668683", "#678686", "#678686", "#678584", "#678685",
    "#688586", "#6D8789", "#6F868A", "#788B91", "#84949B", "#9EA1A8", "#A2A1A7", "#AFAFB4",
    "#AFAEB2", "#B3B1B4", "#B6B3B6", "#C2BFC3", "#C1BAC8", "#715197", "#562986", "#59228B",
    "#5C248A", "#551F80", "#552283", "#542182", "#572280", "#57237B", "#511C72", "#5B2374",
    "#622671", "#642668", "#662560", "#67255A", "#672558", "#672557", "#672557", "#672557",
    "#682555", "#6A254E", "#6B2544", "#6D253D", "#752635", "#782531", "#7A252C", "#802728",
    "#852822", "#89271B", "#8E2919", "#9A3520", "#9A381E", "#41442A", "#A0482F", "#A04D38",
    "#9D513D", "#9E5745", "#9E5C4C", "#A56753", "#A76951", "#B5765D", "#B77760", "#B97A67",
    "#B47767", "#C58D80", "#B88477", "#C79591", "#D19F9E", "#D19F9D", "#D2A19D", "#D6A9A3",
    "#D6AFA6", "#DDBCB0", "#DCBFB1", "#DBBFB4", "#E1C9BE", "#E5D1C7", "#ECDAD2", "#E9DAD3",
    "#ECDEDA", "#F6E7E5", "#F7E7E6", "#F5E6E7", "#F3E7E7", "#EFE7E7", "#EBE8E8", "#E68E88",
    "#E3E9E9", "#E1EAEA", "#DDEBEC", "#D9EAEC", "#D6EAEC", "#D3EBEE", "#D0ECEE", "#CCEDEE",
    "#C8ECEE", "#C4EAEC", "#B2DDE7", "#AFDCEA", "#A4D2E4", "#9CCCE3", "#8EBEDD", "#8CBCE1",
    "#81B1DA", "#7BAAD6", "#719FCD", "#739FCD", "#6A94C2", "#6D92C2", "#6889B9", "#6684B6",
    "#607CAD", "#6079AB", "#5A71A2", "#586D9F", "#526395", "#535F93", "#4F578C", "#50548B",
    "#53558C", "#54558D", "#61619A", "#60619B", "#6C6CA8", "#7271AE", "#7E7DB7", "#7F7FB4",
    "#8988B8", "#8F8DB0", "#9D9A9B", "#A1A0AC", "#AEADAD", "#AFAFA4", "#BDBDA8", "#BEBF9F",
    "#CDCDA4", "#CFCE9A", "#DADA9E", "#E1E097", "#EFEF97", "#F5F490", "#FEFD91", "#FFFE8C",
    "#FAF27E", "#FCF07C", "#F8E874", "#FCF774", "#F7DD6A", "#F9DA68", "#F4D05E", "#F3CD5B",
    "#F0C654", "#F2C352", "#EFBB4B", "#EFB748", "#EBAF42", "#EFAF43", "#ECA63D", "#EDA13C",
    "#F19C3B", "#EF9838", "#EE9336", "#F09137", "#EC8A33", "#EC8632", "#EC8431", "#EC8232",
    "#E87B2F", "#E8772E", "#E8722E", "#E66C2C", "#E76B2C", "#E5682C", "#E4672B", "#E5652A",
    "#E5642C", "#E1612C", "#D45725", "#CD5124", "#C64B22", "#C44A24", "#B8401B", "#B13A1C",
    "#AA3319", "#A02A14", "#9C2816", "#962717", "#8A1F12", "#7E190F", "#73140B", "#70170F",
    "#6A160F", "#671A11", "#651B10", "#652011", "#622210", "#602515", "#5C2B1A", "#572E1D",
    "#523020", "#4F3526", "#4F3A2A", "#52412F", "#52452F", "#595039", "#5D5142", "#65574A",
    "#6A594D", "#736156", "#766359", "#7C675E", "#836E65", "#8D7771", "#8D7774", "#947E79",
    "#907C75", "#9D8980", "#A18D82", "#A68F85", "#AD8780", "#AB847E", "#A87F7A", "#A47976",
    "#A27574", "#A17272", "#9F6E6F", "#9F6C6E", "#9E6A6C", "#9B6569", "#996166", "#985E63",
    "#975B61", "#95575E", "#93545C", "#92515B", "#914E59", "#8F4A57", "#8D4755", "#8C4555",
    "#8C4356", "#873F52", "#833C50", "#803A4E", "#7E394D", "#7A374B", "#763449", "#733348",
    "#713246", "#6E3145", "#6B3144", "#663344", "#633644", "#5F3844", "#5C3B44", "#583D44",
    "#614C4E", "#5C5150", "#53504D", "#52544E", "#53544C", "#58594E", "#565B4E", "#5C6555",
    "#5A6452", "#5D6854", "#5F6D57", "#63755D", "#60765F", "#607B64", "#5F7C65", "#64856D",
    "#64856D", "#64856D", "#64856F", "#648562", "#668576", "#69867C", "#728982", "#7A8A86",
    "#909896"
];

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
        // 🌟 Mercator UV coordinate transform for Equirectangular input images
        float mercY = (0.5 - v_texcoord.y) * 6.28318530718;
        float latRad = 2.0 * atan(exp(mercY)) - 1.57079632679;
        float normY = clamp(0.5 - (latRad / 3.14159265359), 0.0, 1.0);

        vec2 wrapped_uv = vec2(fract(v_texcoord.x), normY);
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

export function createScalarShaderLayer(mapInstance) {
    return {
        id: 'weather-gpu-shader',
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
            gl.drawArrays(gl.TRIANGLES, 0, 30);
        }
    };
}