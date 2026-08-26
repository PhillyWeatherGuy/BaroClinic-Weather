// js/config/darkPalettes.js

/**
 * 🌡️ Exact 2m Temperature Palette extracted from provided_colors[::-1]
 */
export const TEMP_PALETTE = [
"#E4E3E7", "#B3B1B7", "#ADACB5", "#A8A6B2", "#9E9DAC", "#9D9CAF", "#9897AE", "#9693AF",
"#908BAB", "#8E89AC", "#8E85AC", "#887BA6", "#806D9E", "#8169A0", "#8367A2", "#8467A3",
"#81659F", "#8164A0", "#795B9D", "#72539A", "#73539E", "#664393", "#5E378C", "#5B308B",
"#5D3090", "#5C288E", "#5E2891", "#5E2690", "#5A1E8B", "#5C1C8B", "#591587", "#5A1286",
"#570D81", "#570D81", "#570D81", "#570D81", "#5E0C7F", "#6D1485", "#701280", "#761581",
"#78157F", "#821A81", "#85177B", "#921E80", "#941C7D", "#991F7E", "#9B1F7C", "#9C1E7C",
"#9E1D7B", "#A3217D", "#A4217B", "#AE247B", "#B2247A", "#B6267B", "#B82579", "#BF287A",
"#C22778", "#C7297A", "#CA2B79", "#D12D7A", "#D22C7A", "#D12B79", "#D5307E", "#D53280",
"#D1317E", "#DF418E", "#E54B97", "#E44D98", "#E34F99", "#E859A1", "#E75FA5", "#EA68AC",
"#E669AC", "#EA71B2", "#DE77B1", "#EB8FC5", "#E58EC2", "#E48FC3", "#E391C4", "#E193C4",
"#DF97C6", "#DA98C5", "#D59AC4", "#D6A3C9", "#CDA6C6", "#C8AEC9", "#C2B2CA", "#BEB5CC",
"#BDB8CF", "#C3BFD6", "#C3C0D8", "#C7C7DE", "#BEC3D9", "#C6D1E5", "#C1D2E5", "#BBD4E4",
"#B9D9E8", "#B5DBE6", "#B8DFE9", "#B9E1EA", "#BCE4ED", "#BCE5EC", "#BDE7ED", "#BEE8EE",
"#BCE5EB", "#B9E5EE", "#ABD9E4", "#A9D8E7", "#9DCDE0", "#94C3DA", "#8AB8D1", "#89B6CF",
"#7DAAC1", "#699DAC", "#60939B", "#629392", "#608A85", "#648882", "#668683", "#678686",
"#678686", "#678584", "#678685", "#688586", "#6D8789", "#6F868A",
"#678584", "#678685",
"#9EA1A8", "#A2A1A7", "#AFAFB4", "#AFAEB2", "#B3B1B4", "#551F80", "#552283", "#542182",
"#572280", "#57237B", "#511C72", "#5B2374", "#622671", "#642668", "#662560", "#67255A",
"#672558", "#672557", "#672557", "#672557", "#682555", "#6A254E", "#6B2544", "#6D253D",
"#752635", "#782531", "#7A252C", "#802728", "#852822", "#89271B", "#8E2919", "#9A3520",
"#9A381E", "#A1442A", "#A0482F", "#A04D38", "#9D513D", "#9E5745", "#9E5C4C", "#A56753",
"#A76951", "#B5765D", "#B77760", "#B97A67", "#B47767", "#C58D80", "#B88477", "#C79591",
"#D19F9E", "#D19F9D", "#D2A19D", "#D6A9A3", "#D6AFA6", "#DDBCB0", "#DCBFB1", "#DBBFB4",
"#E1C9BE", "#E5D1C7", "#ECDAD2", "#E9DAD3", "#ECDEDA", "#F6E7E5", "#F7E7E6", "#F5E6E7",
"#F3E7E7", "#EFE7E7", "#EBE8E8", "#E7E9E9", "#E3E9E9", "#E1EAEA", "#DDEBEC", "#D9EAEC",
"#D6EAEC", "#D3EBEE", "#D0ECEE", "#CCEDEE", "#C8ECEE", "#C4EAEC", "#B2DDE7", "#AFDCEA",
"#A4D2E4", "#9CCCE3", "#8EBEDD", "#8CBCE1", "#81B1DA", "#7BAAD6", "#719FCD", "#739FCD",
"#6A94C2", "#6D92C2", "#6889B9", "#6684B6", "#607CAD", "#6079AB", "#5A71A2", "#586D9F",
"#526395", "#535F93", "#4F578C", "#50548B", "#53558C", "#54558D", "#61619A", "#60619B",
"#6C6CA8", "#7271AE", "#7E7DB7", "#7F7FB4", "#8988B8", "#8F8DB0", "#9D9AB3", "#A1A0AC",
"#AEADAD", "#AFAFA4", "#BDBDA8", "#BEBF9F", "#CDCDA4", "#CFCE9A", "#DADA9E", "#E1E097",
"#EFEF97", "#F5F490", "#FEFD91", "#FFFE8C", "#FAF27E", "#FCF07C", "#F8E874", "#FCE774",
"#F7DD6A", "#F9DA68", "#F4D05E", "#F3CD5B", "#F0C654", "#F2C352", "#EFBB4B", "#EFB748",
"#EBAF42", "#EFAF43", "#ECA63D", "#EDA13C", "#F19C3B", "#EF9838", "#EE9336", "#F09137",
"#EC8A33", "#EC8632", "#EC8431", "#EC8232", "#E87B2F", "#E8772E", "#E8722E", "#E66C2C",
"#E76B2C", "#E5682C", "#E4672B", "#E5652A", "#E5642C", "#E1612C", "#D45725", "#CD5124",
"#C64B22", "#C44A24", "#B8401B", "#B13A1C", "#AA3319", "#A02A14", "#9C2816", "#962717",
"#8A1F12", "#7E190F", "#73140B", "#70170F", "#6A160F", "#671A11", "#651B10", "#652011",
"#622210", "#602515", "#5C2B1A", "#572E1D", "#523020", "#4F3526", "#4F3A2A", "#52412F",
"#52452F", "#595039", "#5D5142", "#65574A", "#6A594D", "#736156", "#766359", "#7C675E",
"#836E65", "#8D7771", "#8E7674", "#947E79", "#907C75", "#9D8980", "#A18D82", "#A68F85",
"#AD8780", "#AB847E", "#A87F7A", "#A47976", "#A27574", "#A17272", "#9F6E6F", "#9F6C6E",
"#9E6A6C", "#9B6569", "#996166", "#985E63", "#975B61", "#95575E", "#93545C", "#92515B",
"#914E59", "#8F4A57", "#8D4755", "#8C4555", "#8C4356", "#873F52", "#833C50", "#803A4E",
"#7E394D", "#7A374B", "#763449", "#733348", "#713246", "#6E3145", "#6B3144", "#663344",
"#633644", "#5F3844", "#583D44", "#614C4E", "#5C5150", "#53504D", "#52544E", "#53544C",
"#58594E", "#565B4E", "#5C6555", "#5A6452", "#5D6854", "#5F6D57", "#63755D", "#60765F",
"#607B64", "#5F7C65", "#64856D", "#64856D", "#64856D", "#64856F", "#648572", "#668576",
"#69867C", "#728982", "#7A8A86", "#909896"
];

// 🌧️ Dark Mode Precip Levels (Inches)
const DARK_PRECIP_LEVELS = [
    0.01, 0.02, 0.05, 0.08, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50,
    0.60, 0.70, 0.80, 0.90, 1.00, 1.20, 1.40, 1.60, 1.80, 2.00, 2.50, 3.00,
    3.50, 4.00, 4.50, 5.00, 5.50, 6.00, 6.50, 7.00, 7.50, 8.00, 8.50, 9.00,
    9.50, 10.00, 12.00, 14.00, 16.00, 20.00, 24.00, 30.00, 100.00
];

// 🌧️ Dark Mode Precip Hex Colors
const DARK_PRECIP_HEX = [
    '#1A1A1A', '#2D3139', '#474F5D', '#646F81', '#808CA1', '#9BA8BC', '#194734', '#125C3F',
    '#0C6945', '#008855', '#009A69', '#00B087', '#00B59C', '#00BAB0', '#00CDD4', '#00B8DE',
    '#0094F0', '#0070FA', '#1C6CF8', '#3764F9', '#5752FA', '#7949FA', '#A241FA', '#C238FA',
    '#E52DFA', '#FA2AE3', '#FF3C00', '#FF6A00', '#FF9100', '#FFB300', '#FFCC11', '#FFE522',
    '#FFEE55', '#FFFBBA', '#FFFFFF',
    // ---- Fixed Top End: Continuous bright, crisp ice colors that never darken ----
    '#E6FAFF', '#CDf5FF', '#B3F0FF', '#99EAFF', '#80E5FF', '#66E0FF', '#4DDBFF', '#33D6FF', '#1AD1FF'
];

// 💧 Dark Mode PWAT Levels (Inches)
const DARK_PWAT_LEVELS = [
    0.00, 0.05, 0.11, 0.16, 0.21, 0.26, 0.31, 0.37, 0.42, 0.47,
    0.55, 0.59, 0.63, 0.66, 0.70, 0.74, 0.78, 0.81, 0.85, 0.89,
    0.93, 0.96, 1.00, 1.04, 1.08, 1.11, 1.15, 1.19, 1.23, 1.26,
    1.30, 1.34, 1.38, 1.41, 1.45, 1.49, 1.53, 1.56, 1.60, 1.64,
    1.68, 1.71, 1.75, 1.79, 1.83, 1.86, 1.90, 1.94, 1.98, 2.01,
    2.05, 2.10, 2.15, 2.20, 2.25, 2.30, 2.35, 2.40, 2.45, 2.50,
    2.56, 2.62, 2.68, 2.75, 2.88, 3.00, 3.12, 3.25, 3.38, 3.50,
    6.00
];

// 💧 Dark Mode PWAT Hex Colors
const DARK_PWAT_HEX = [
    "#1c1a18", "#1e1b19", "#211d1a", "#24201c", "#26221d", "#29241f", "#2c2620", "#2f2a23", "#342e25", "#393328",
    "#194734", "#174b36", "#154e38", "#13533b", "#125c3f", "#0f6242", "#0c6945", "#097249", "#008855", "#008e5c",
    "#009462", "#009a69", "#00b087", "#00b59c", "#00bab0", "#00bfc3", "#00cdd4", "#00c2d9", "#00b8de", "#00ade2",
    "#0094f0", "#008ef3", "#0085f6", "#007cf8", "#0070fa", "#1c6cf8", "#3764f9", "#525df9", "#5752fa", "#684efa",
    "#7949fa", "#8a44fa", "#9246fa", "#a241fa", "#b23dfa", "#c238fa", "#cc33fa", "#d830fa", "#e52dfa", "#f129f1",
    "#fa2ae3", "#ff3c00", "#ff5500", "#ff6a00", "#ff7d00", "#ff9100", "#ffb300", "#ffcc11", "#ffe522", "#ffee55",
    "#fff377", "#fff799", "#fffbba", "#ffffff", "#eaccff", "#cb94ff", "#ab5cff", "#8624ff", "#5e00e0", "#3c00aa"
];

/**
 * 🌟 WebGL Dynamic Breakpoint Step Interpolator
 * Replicates arbitrary breakpoint curves into a 256-color GPU lookup texture
 */
function createNonLinearPrecipPalette(levels, colors, valPoints = [0.0, 1.0, 30.0], bytePoints = [0, 100, 255], numEntries = 256) {
    const palette = [];
    for (let i = 0; i < numEntries; i++) {
        // 🌟 Piecewise segment interpolation matching parameters.json
        let physicalVal = valPoints[0];
        for (let j = 0; j < bytePoints.length - 1; j++) {
            if (i >= bytePoints[j] && i <= bytePoints[j + 1]) {
                const t = (i - bytePoints[j]) / (bytePoints[j + 1] - bytePoints[j]);
                physicalVal = valPoints[j] + t * (valPoints[j + 1] - valPoints[j]);
                break;
            }
        }
        
        let colorIdx = 0;
        for (let k = 0; k < levels.length - 1; k++) {
            if (physicalVal >= levels[k] && physicalVal < levels[k + 1]) {
                colorIdx = k;
                break;
            }
            if (physicalVal >= levels[levels.length - 1]) {
                colorIdx = colors.length - 1;
            }
        }
        palette.push(colors[colorIdx] || colors[colors.length - 1]);
    }
    return palette;
}

export const PRECIP_PALETTE = createNonLinearPrecipPalette(
    DARK_PRECIP_LEVELS, 
    DARK_PRECIP_HEX, 
    [0.0, 1.0, 10.0, 30.0], 
    [0, 100, 200, 255], 
    256
);

// 💧 Dark Mode PWAT Palette (0.0" -> 4.0" piecewise mapped matching parameters.json)
export const PWAT_PALETTE = createNonLinearPrecipPalette(
    DARK_PWAT_LEVELS,
    DARK_PWAT_HEX,
    [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
    [0, 32, 64, 96, 128, 160, 192, 255],
    256
);

/**
 * 🌟 Dynamic Palette Selector
 */
export function getPaletteForParameter(paramId) {
    const id = (paramId || '').toLowerCase();
    if (id === 'tp' || id === 'precip' || id.includes('precip')) {
        return PRECIP_PALETTE;
    }
    if (id === 'pwat' || id.includes('pwat') || id === 'tcwv') {
        return PWAT_PALETTE;
    }
    return TEMP_PALETTE;
}
