// js/config/darkPalettes.js
import { PRATE_PALETTE as LIGHT_PRATE_PALETTE } from './palettes.js';

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
    '#FFEE55', '#FFFBBA', '#FFFFFF', '#E6FAFF', '#CDf5FF', '#B3F0FF', '#99EAFF', '#80E5FF',
    '#66E0FF', '#4DDBFF', '#33D6FF', '#1AD1FF'
];

// ❄️ Dark Mode Total Snowfall (10:1) Levels (Inches)
const DARK_ASNOW_LEVELS = [
    0.1, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0,
    6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
    31, 32, 35, 38, 41, 44, 47, 48
];

// ❄️ Dark Mode 1h / 3h Snowfall Levels (Inches)
const DARK_ASNOW1HR3_LEVELS = [
    0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.09, 0.11, 0.14, 0.17, 0.2, 0.24, 0.27, 0.31, 0.35, 0.4, 0.44, 0.49, 0.54, 0.59, 0.71, 0.82, 0.95, 1.09, 1.23, 1.38, 1.54, 1.71, 1.89, 2.07, 2.26, 2.46, 2.66, 2.87, 3.09, 3.32, 3.55, 3.79, 4.55, 4.82, 5.66, 6.57, 7.53, 8.55, 9.63, 10
];

// ❄️ Dark Mode Total Snowfall (10:1) Radar Glow Colors
const SNOW_RADAR_GLOW = [
  "#596571", "#64707d", "#6f7c89", "#7b8895",
  // blues: 2 - 6 (0.5 steps)
  "#add7f9", "#90bff7", "#70acf1", "#5f9fed", "#4b8bec", "#3d79e3", "#336ed0", "#2c62c3",
  // purples to magenta: 6 - 10 (0.5 steps)
  "#3f0792", "#4d0a94", "#5c0e90", "#691290", "#82188c", "#9d208b", "#be2888", "#df3185",
  // magenta to pink to lavender to cyan: 10 - 28 (1 inch steps)
  "#e0358d", "#e654a3", "#e972b3", "#ee80bd", "#ed94c8", "#e89cca", "#e3a3cf", "#e0a9d1",
  "#d5b7d7", "#d2bddb", "#cbcce2", "#c2dbe9", "#bfe4ef", "#b8eef3", "#b3f8f9", "#b2f3f3",
  "#a1dfe0", "#92c3c8",
  // teal-gray to lavender: 28 - 48 (wider bins)
  "#97bed3",  // 28 - 31
  "#94b4d6",  // 31 - 32
  "#a2b3d9",  // 32 - 35
  "#a9addc",  // 35 - 38
  "#afa9e0",  // 38 - 41
  "#b9a0e7",  // 41 - 44
  "#c49bed",  // 44 - 47
  "#cb95f2"   // 47 - 48
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

// 📊 Dark Mode 500mb Height Anomaly Levels (Meters)
const DARK_ANOM_LEVELS = [
  -360, -330, -300, -270, -240, -210, -180, -150, -120, -90, -60, -30,
   30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360
];

// 📊 Dark Mode 500mb Height Anomaly Colors
const DARK_ANOM_COLORS = [
  "#081652",            // below -360
  "#062f60",            // -360 to -330
  "#0e437b",            // -330 to -300
  "#185695",            // -300 to -270
  "#2268ad",            // -270 to -240
  "#317ab6",            // -240 to -210
  "#3c8abe",            // -210 to -180
  "#4f9ac7",            // -180 to -150
  "#6faed2",            // -150 to -120
  "#8bc0db",            // -120 to -90
  "#a2cde2",            // -90 to -60
  "#bad9e9",            // -60 to -30
  "#FFFFFF",      
  "#fddbc6",            // 30 to 60
  "#f9c7ae",            // 60 to 90
  "#f6b293",            // 90 to 120
  "#f19e7c",            // 120 to 150
  "#e6856a",            // 150 to 180
  "#da6a55",            // 180 to 210
  "#cf5146",            // 210 to 240
  "#c2383b",            // 240 to 270
  "#b41c2c",            // 270 to 300
  "#9c1027",            // 300 to 330
  "#810822",            // 330 to 360
  "#790678"
];

const DARK_ANOM_BELOW = "#081652";
const DARK_ANOM_ABOVE = "#790678";

// 💨 Dark Mode 250mb Wind Speed Levels (kts)
const DARK_W250_LEVELS = [
    20.0, 23.5, 27.0, 30.5, 34.0, 37.5, 41.0, 44.5,
    48.0, 51.5, 55.0, 58.5, 62.0, 65.5, 69.0, 72.5,
    76.0, 79.5, 83.0, 86.5, 90.0, 93.5, 97.0, 100.5,
    104.0, 107.5, 111.0, 114.5, 118.0, 121.5, 125.0, 128.5,
    132.0, 135.5, 139.0, 142.5, 146.0, 150.0, 154.0, 158.0,
    162.0, 166.0, 170.0, 174.0, 178.0, 182.0, 186.0, 190.0,
    194.0, 198.0, 202.0, 206.0, 210.0, 214.0, 218.0, 222.0,
    226.0, 230.0, 234.0, 238.0, 242.0, 246.0, 250.0, 254.0
];

// 💨 Dark Mode 250mb Wind Speed Hex Colors
const DARK_W250_COLORS = [
    "#0d0d0d", "#111928", "#162543", "#1a315e",
    "#1f3d79", "#234994", "#2755af", "#2c62ca",
    "#4074d1", "#5486d8", "#6999de", "#7dace5",
    "#91beeb", "#a6d1f2", "#bae4f8", "#bdd1f5",
    "#bebcf2", "#c0a6ee", "#c191ea", "#c27be6",
    "#c366e2", "#c450de", "#c442d4", "#c13dc3",
    "#be38b1", "#bb33a0", "#b82e8e", "#bc297f",
    "#c0246f", "#c41f5f", "#c81a50", "#cd1d49",
    "#d42449", "#da2c48", "#e13347", "#e73d42",
    "#eb4d32", "#ef5d22", "#f36d12", "#f67c03",
    "#f88d0f", "#f99d22", "#fbad34", "#fcbd47",
    "#fcc344", "#fcc83f", "#fdcc39", "#fdd134",
    "#fdd52e", "#feda29", "#fede23", "#fee31e",
    "#fee718", "#ffec13", "#fff00d", "#fff312",
    "#fff425", "#fff537", "#fff64a", "#fff75c",
    "#fff86f", "#fff982", "#fffa94", "#fffba7"
];

// ⚡ Dark Mode Surface-Based CAPE Levels (J/kg)
const DARK_CAPE_LEVELS = [
    0, 25, 65, 120, 180, 245, 315, 390, 470, 555, 645, 740, 800, 935, 1035, 1140, 1245, 1355, 1475, 1590, 1705, 1825, 1950, 2115, 2200, 2335, 2465, 2595, 2730, 2870, 3005, 3145, 3295, 3440, 3585, 3735, 3880, 4030, 4185, 4345, 4505, 4660, 4820, 4980, 5140, 5305, 5475, 5585, 5645, 5810, 5980, 6080, 6150, 6320, 6495, 6680, 6855, 7030, 7210, 7385, 7570, 7750, 7945, 8130, 8315, 8500
];

// ⚡ Dark Mode Surface-Based CAPE Hex Colors
const DARK_CAPE_COLORS = [
    "#0a0b10", "#101424", "#141d3a", "#162752", "#17326b", "#153e85", "#114ba0", "#0759bc", "#0069d9", "#267eed", "#4fa2fa", "#73beff", "#99d5ff", "#89b3f7", "#7b92f0", "#7270ea", "#704ee3", "#7126dc", "#7c00d6", "#8f00cf", "#a300c7", "#b800be", "#cd00b2", "#e100a4", "#eb1297", "#f3288a", "#f93d7c", "#fd516f", "#ff6561", "#ff7854", "#ff8b46", "#ff9d37", "#ffa32d", "#ffa922", "#ffae14", "#ffb400", "#ffbe00", "#ffc700", "#ffd100", "#ffda00", "#ffe400", "#ffed00", "#fff600", "#ffff26", "#ffff54", "#ffff7a", "#ffff9e", "#ffffc2", "#ffffe0", "#f3fff0", "#e1ffe6", "#ccffdd", "#b3ffd5", "#99ffce", "#7fffca", "#5cffc9", "#2effcb", "#00ffd1", "#00f5cb", "#00ecc6", "#00e2bf", "#00d9b9", "#00cfb2", "#00c6ac", "#00bda6", "#00b39f"
];

// 💨 Dark Mode 500mb Wind Speed Levels (kts)
const DARK_W500_LEVELS = [
    16.0, 17.5, 19.0, 20.5, 22.0, 23.5, 25.0, 26.5, 28.0, 29.5, 31.0, 32.5, 34.0, 35.5, 37.0, 38.5, 40.0, 41.5, 43.0, 44.5, 46.0, 47.5, 49.0, 50.5, 52.0, 53.5, 55.0, 56.5, 58.0, 59.5, 61.0, 62.5, 64.0, 65.5, 67.0, 68.5, 70.0, 72.0, 74.0, 76.0, 78.0, 80.0, 82.0, 84.0, 86.0, 88.0, 90.0, 92.0, 94.0, 96.0, 98.0, 100.0, 102.0, 104.0, 106.0, 108.0, 110.0, 113.0, 116.0, 119.0, 122.0, 125.0, 128.0, 131.0, 134.0, 137.0, 140.0, 143.0, 146.0, 149.0, 152.0, 155.0, 158.0, 161.0, 164.0, 167.0, 170.0, 173.0, 176.0, 180.0
];

// 💨 Dark Mode 500mb Wind Speed Colors
const DARK_W500_COLORS = [
    "#0d0d0d", "#111928", "#162543", "#1a315e", "#1f3d79", "#234994", "#2755af", "#2c62ca", "#4074d1", "#5486d8", "#6999de", "#7dace5", "#91beeb", "#a6d1f2", "#bae4f8", "#bdd1f5", "#bebcf2", "#c0a6ee", "#c191ea", "#c27be6", "#c366e2", "#c450de", "#c442d4", "#c13dc3", "#be38b1", "#bb33a0", "#b82e8e", "#bc297f", "#c0246f", "#c41f5f", "#c81a50", "#cd1d49", "#d42449", "#da2c48", "#e13347", "#e73d42", "#eb4d32", "#ef5d22", "#f36d12", "#f67c03", "#f88d0f", "#f99d22", "#fbad34", "#fcbd47", "#fcc344", "#fcc83f", "#fdcc39", "#fdd134", "#fdd52e", "#feda29", "#fede23", "#fee31e", "#fee718", "#ffec13", "#fff00d", "#fff312", "#fff425", "#fff537", "#fff64a", "#fff75c", "#fff86f", "#fff982", "#fffa94", "#fffba7", "#fffcb9", "#fffccc", "#fffdde", "#fffef1", "#fefafa", "#fae3e3", "#f6cdcd", "#f1b7b7", "#eda1a1", "#e98b8b", "#e57474", "#e05e5e", "#dc4848", "#d83232", "#d12626", "#c82222"
];

// 💨 Dark Mode 700mb / 850mb Wind Speed Levels (kts)
const DARK_W700_850_LEVELS = [
    5.0, 7.5, 10.0, 12.5, 15.0, 17.5, 20.0, 23.0, 26.0, 29.0, 32.0, 35.0, 38.0, 41.0, 44.0, 47.0, 50.0, 53.0, 56.0, 59.0, 62.0, 65.0, 68.0, 71.0, 74.0, 77.0, 80.0, 83.0, 86.0, 89.0, 92.0, 95.0, 98.0, 101.0, 104.0, 107.0, 110.0, 113.0, 116.0, 119.0, 122.0, 125.0
];

const DARK_W700_850_COLORS = [
    "#0d0d0d", "#111928", "#162543", "#1a315e", "#1f3d79", "#234994", "#2755af", "#2c62ca", "#4074d1", "#6999de", "#bebcf2", "#c0a6ee", "#c191ea", "#c27be6", "#c366e2", "#c450de", "#c442d4", "#c13dc3", "#be38b1", "#bb33a0", "#b82e8e", "#bc297f", "#c0246f", "#c41f5f", "#c81a50", "#cd1d49", "#e13347", "#e73d42", "#eb4d32", "#ef5d22", "#f36d12", "#f67c03", "#f88d0f", "#f99d22", "#fbad34", "#fcbd47", "#fdcc39", "#fdd134", "#fdd52e", "#feda29", "#fede23", "#fee31e"
];

// 💨 Dark Mode 925mb Wind Speed Levels (kts)
const DARK_W925_LEVELS = [
    1.0, 3.0, 5.0, 7.5, 10.0, 12.5, 15.0, 17.5, 18.5, 19.5, 20.0, 23.0, 26.0, 29.0, 32.0, 35.0, 38.0, 41.0, 44.0, 47.0, 50.0, 53.0, 56.0, 59.0, 62.0, 65.0, 68.0, 71.0, 74.0, 77.0, 80.0, 83.0, 86.0, 89.0, 92.0, 95.0, 98.0, 101.0, 104.0, 107.0, 110.0, 115.0
];

const DARK_W925_COLORS = [
    "#0d0d0d", "#111928", "#162543", "#1a315e", "#1f3d79", "#234994", "#2755af", "#2c62ca", "#4074d1", "#6999de", "#bebcf2", "#c0a6ee", "#c191ea", "#c27be6", "#c366e2", "#c450de", "#c442d4", "#c13dc3", "#be38b1", "#bb33a0", "#b82e8e", "#bc297f", "#c0246f", "#c41f5f", "#c81a50", "#cd1d49", "#e13347", "#e73d42", "#eb4d32", "#ef5d22", "#f36d12", "#f67c03", "#f88d0f", "#f99d22", "#fbad34", "#fcbd47", "#fdcc39", "#fdd134", "#fdd52e", "#feda29", "#fede23", "#fee31e"
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
        
        let colorIdx = -1;
        for (let k = 0; k < levels.length - 1; k++) {
            if (physicalVal >= levels[k] && physicalVal < levels[k + 1]) {
                colorIdx = k;
                break;
            }
            if (physicalVal >= levels[levels.length - 1]) {
                colorIdx = colors.length - 1;
            }
        }
        if (colorIdx === -1) {
            palette.push("transparent");
        } else {
            palette.push(colors[colorIdx] || colors[colors.length - 1]);
        }
    }
    return palette;
}

/**
 * 🌟 Linear Diverging Palette Interpolator for Height Anomalies (-350m to +350m)
 */
function createAnomalyPalette(levels, colors, belowColor, aboveColor, minVal = -450.0, maxVal = 450.0, numEntries = 256) {
    const palette = [];
    for (let i = 0; i < numEntries; i++) {
        const physicalVal = minVal + (i / (numEntries - 1)) * (maxVal - minVal);

        if (physicalVal < levels[0]) {
            palette.push(belowColor);
            continue;
        }
        if (physicalVal >= levels[levels.length - 1]) {
            palette.push(aboveColor);
            continue;
        }

        let colorIdx = 0;
        for (let k = 0; k < levels.length - 1; k++) {
            if (physicalVal >= levels[k] && physicalVal < levels[k + 1]) {
                colorIdx = k;
                break;
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

export const ASNOW1HR3_PALETTE = createNonLinearPrecipPalette(
    DARK_ASNOW1HR3_LEVELS,
    SNOW_RADAR_GLOW,
    [0.0, 0.1, 0.5, 1.0, 3.0, 10.0],
    [0, 50, 110, 160, 210, 255],
    256
);

export const ASNOW_PALETTE = createNonLinearPrecipPalette(
    DARK_ASNOW_LEVELS,
    SNOW_RADAR_GLOW,
    [0.0, 1.0, 10.0, 50.0],
    [0, 100, 200, 255], 
    256
);

export const CAPE_PALETTE = createNonLinearPrecipPalette(
    DARK_CAPE_LEVELS,
    DARK_CAPE_COLORS,
    [0.0, 10000.0],
    [0, 255],
    256
);

export const Z500_ANOM_PALETTE = createAnomalyPalette(
    DARK_ANOM_LEVELS,
    DARK_ANOM_COLORS,
    DARK_ANOM_BELOW,
    DARK_ANOM_ABOVE,
    -450.0,
    450.0,
    256
);

export const PRATE_PALETTE = LIGHT_PRATE_PALETTE;

// 💧 Dark Mode PWAT Palette (0.0" -> 4.0" piecewise mapped matching parameters.json)
export const PWAT_PALETTE = createNonLinearPrecipPalette(
    DARK_PWAT_LEVELS,
    DARK_PWAT_HEX,
    [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
    [0, 32, 64, 96, 128, 160, 192, 255],
    256
);

// 💨 Dark Mode 250mb & 300mb Wind Speed Palette
export const W250_PALETTE = createNonLinearPrecipPalette(
    DARK_W250_LEVELS,
    DARK_W250_COLORS,
    [0.0, 50.0, 75.0, 100.0, 125.0, 150.0, 175.0, 200.0, 250.0],
    [0, 40, 75, 110, 145, 180, 210, 235, 255],
    256
);

// 💨 Dark Mode 500mb Wind Speed Palette
export const W500_PALETTE = createNonLinearPrecipPalette(
    DARK_W500_LEVELS,
    DARK_W500_COLORS,
    [0.0, 50.0, 75.0, 100.0, 125.0, 150.0, 175.0, 200.0, 250.0],
    [0, 40, 75, 110, 145, 180, 210, 235, 255],
    256
);

// 💨 Dark Mode 700mb & 850mb Wind Speed Palette
export const W700_850_PALETTE = createNonLinearPrecipPalette(
    DARK_W700_850_LEVELS,
    DARK_W700_850_COLORS,
    [0.0, 50.0, 75.0, 100.0, 125.0, 150.0, 175.0, 200.0, 250.0],
    [0, 40, 75, 110, 145, 180, 210, 235, 255],
    256
);

// 💨 Dark Mode 925mb Wind Speed Palette
export const W925_PALETTE = createNonLinearPrecipPalette(
    DARK_W925_LEVELS,
    DARK_W925_COLORS,
    [0.0, 50.0, 75.0, 100.0, 125.0, 150.0, 175.0, 200.0, 250.0],
    [0, 40, 75, 110, 145, 180, 210, 235, 255],
    256
);

/**
 * 🌟 Dynamic Palette Selector
 */
export function getPaletteForParameter(paramId) {
    const id = (paramId || '').toLowerCase();
    if (id === 'prate') {
        return PRATE_PALETTE;
    }
    if (id === 'asnow_1h' || id === 'asnow_3h' || id === 'asnow1hr3') {
        return ASNOW1HR3_PALETTE;
    }
    if (id === 'asnow' || id.startsWith('asnow') || id.includes('snow') || id === 'sf') {
        return ASNOW_PALETTE;
    }
    if (id === 'z500_anom' || id.includes('anom')) {
        return Z500_ANOM_PALETTE;
    }
    if (id === 'tp' || id.startsWith('tp_') || id === 'precip' || id.includes('precip')) {
        return PRECIP_PALETTE;
    }
    if (id === 'pwat' || id.includes('pwat') || id === 'tcwv') {
        return PWAT_PALETTE;
    }
    if (id === 'pva' || id.includes('pva') || id === 'vo' || id.includes('vort')) {
        return PVA_PALETTE;
    }
    if (id === 'w250' || id === 'w300') {
        return W250_PALETTE;
    }
    if (id === 'w500') {
        return W500_PALETTE;
    }
    if (id === 'w700' || id === 'w850') {
        return W700_850_PALETTE;
    }
    if (id === 'cape') {
        return CAPE_PALETTE;
    }
    if (id === 'w925') {
        return W925_PALETTE;
    }
    if (id.includes('wind')) {
        return W850_PALETTE;
    }
    return TEMP_PALETTE;
}
