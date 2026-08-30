// js/config/palettes.js

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

// 🌧️ Matplotlib Light Mode Precip Levels (Inches)
const LIGHT_PRECIP_LEVELS = [
    0.01, 0.02, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0,
    1.2, 1.4, 1.6, 1.8, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5,
    9.0, 9.5, 10.0, 12.0, 14.0, 16.0, 20.0, 24.0, 50.0
];

// 🌧️ Matplotlib Light Mode Precip Hex Colors
const LIGHT_PRECIP_HEX = [
"#D0D0D0", "#A8A8A8", "#8A8A8A", "#787878", "#8C9987", "#B1CFA4", "#91CB7F", "#5DAD4E", "#4F9C3C", "#448D31",
"#37725C", "#3361B6", "#5687C3", "#7BA6CA", "#A1BCCF", "#C5D0C8", "#D3CFAA", "#CFC37C", "#CBAC58", "#C88931",
"#C67B30", "#C35523", "#B02D1C", "#9A2015", "#881C14", "#771811", "#5F1A15", "#634841", "#8B7069", "#9D827B",
"#B19E97", "#BEB5B4", "#A69EB5", "#877E9D", "#756A92", "#635785", "#594176", "#66136B", "#A223AA", "#B627BF",
"#C038CA", "#C45BCD", "#C574CD"
];

// 💧 Light Mode PWAT Levels (Inches)
const LIGHT_PWAT_LEVELS = [
    0.00, 0.02, 0.04, 0.06, 0.08, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45,
    0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10,
    1.15, 1.20, 1.30, 1.40, 1.50, 1.60, 1.70, 1.80, 1.90, 2.00, 2.10, 2.15, 2.20,
    2.25, 2.30, 2.40, 2.45, 2.50, 2.60, 2.70, 2.75, 2.80, 2.90, 3.00, 3.10, 3.20,
    3.30, 3.50, 6.00
];

// 💧 Light Mode PWAT Hex Colors
const LIGHT_PWAT_HEX = [
    "#d3d3d3", "#c3c3c5", "#b0b0b0", "#a0a19a", "#78797b", "#656567", "#515151", "#3b3e3d",
    "#574222", "#725633", "#856741", "#9a7c4a", "#b1895b", "#c99e6c", "#d7a977", "#b5b6fe",
    "#a7a7ec", "#8788c5", "#8688c8", "#6d6eab", "#575b94", "#4a4683", "#006668", "#166e5c",
    "#277a4f", "#3c8645", "#589835", "#70a624", "#70a624", "#9f9d51", "#adac46", "#c5c431",
    "#d8d81b", "#eeee0c", "#e5705a", "#c85343", "#af3d37", "#95282a", "#87111b", "#77000e",
    "#760177", "#880588", "#b200b1", "#d807db", "#a301da", "#7b00d8", "#6401da", "#3c00db",
    "#2600dc", "#0027da", "#004ddb", "#0673de", "#009bd5"
];

// 🌀 500mb PVA / Vorticity Levels (10⁻⁵ s⁻¹)
const LIGHT_PVA_LEVELS = [
    0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0,
    10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 25.0, 30.0, 35.0,
    40.0, 45.0, 50.0, 55.0, 60.0, 80.0
];

// 🌀 500mb PVA / Vorticity Hex Colors
const LIGHT_PVA_HEX = [
    "#ffffff", "#bebebe", "#959595", "#828282", "#636363", "#0afeff",
    "#01e6cb", "#11cc7c", "#02b302", "#7ecb05", "#cde60a", "#fdff00",
    "#fccc00", "#fe9a00", "#fd6600", "#ff0000", "#a10202", "#8b0000",
    "#770201", "#7b0066", "#92009d", "#a201bc", "#fe01e6", "#ffc8ef"
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
    LIGHT_PRECIP_LEVELS, 
    LIGHT_PRECIP_HEX, 
    [0.0, 1.0, 10.0, 30.0], 
    [0, 100, 200, 255], 
    256
);

// 💧 Light Mode PWAT Palette (0.0" -> 4.0" piecewise mapped matching parameters.json)
export const PWAT_PALETTE = createNonLinearPrecipPalette(
    LIGHT_PWAT_LEVELS,
    LIGHT_PWAT_HEX,
    [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
    [0, 32, 64, 96, 128, 160, 192, 255],
    256
);

// 🌀 Light Mode 500mb PVA Palette (0 -> 80 piecewise mapped matching parameters.json)
export const PVA_PALETTE = createNonLinearPrecipPalette(
    LIGHT_PVA_LEVELS,
    LIGHT_PVA_HEX,
    [0.0, 3.0, 80.0],
    [0, 30, 107],
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
    if (id === 'pva' || id.includes('pva') || id === 'vo' || id.includes('vort')) {
        return PVA_PALETTE;
    }
    return TEMP_PALETTE;
}
