// js/config/palettes.js

/**
 * 🌡️ Exact 2m Temperature Palette extracted from provided_colors[::-1]
 */
export const TEMP_PALETTE = // WeatherBELL temp scale, -100 to 130, 1 color per degree (231 total)
// 75-89° revised: replaced the dark maroon dip with a gentle fade from
// the existing light orange (74°) into the original brown at 90°
[
  "#3F1E83", "#411E84", "#4B1286", "#570D86", "#570D86", "#590D86", "#611086", "#721486", "#721484", "#721484",
  "#7B1483", "#891A81", "#891A80", "#8A1981", "#891A80", "#891A80", "#9F1E80", "#BD277D", "#BD287C", "#BD287C",
  "#BD287C", "#BD287C", "#C72B7E", "#DC3180", "#DC317F", "#DD317F", "#DC317F", "#DD317F", "#DD3683", "#E44C99",
  "#E34C99", "#E34C99", "#E34C99", "#E4529D", "#EB6BAE", "#E96CAE", "#EA6EAF", "#EC7AB8", "#EB7FBA", "#EA8DC2",
  "#EA8DC2", "#EA8DC2", "#E88FC2", "#DE9ECB", "#DE9FCA", "#DDA0CA", "#DDA0CA", "#DE9FCA", "#D9ACD3", "#C8BBD7",
  "#C8BBD7", "#C8BBD7", "#C8BBD7", "#C8BBD7", "#C6BCD5", "#C0C7D7", "#C0C7D7", "#C0C9D9", "#C4DDE0", "#C1DEDF",
  "#B6DCE4", "#ADDDE7", "#B0E2ED", "#B1EAF1", "#B1EAF1", "#B1EAF1", "#B1EAF1", "#B1EAF1", "#B3EAF1", "#ACE9EE",
  "#A1DCE2", "#96CCD7", "#93C8D6", "#77AAC0", "#77A9BE", "#6F9BA7", "#6C94A0", "#608090", "#4E7075", "#4E6F74",
  "#476F6A", "#2F644D", "#2E5D4C", "#283D42", "#284042", "#375F50", "#3B5951", "#3D5957", "#4F6F74", "#526F74",
  "#697D8B", "#778691", "#8A9295", "#919B9C", "#989DA1", "#9FA2A9", "#ABB3B5", "#BFBFC2", "#CCC5CC", "#C9C5D2",
  "#381C8D", "#3A1B8E", "#411D86", "#431D84", "#4D2075", "#56216C", "#5D2263", "#62225D", "#6A2358", "#70244E",
  "#772649", "#802840", "#862A39", "#8A2B30", "#922E30", "#A5413F", "#A84B49", "#AE5754", "#B66461", "#BC6F6C",
  "#C37C7A", "#CA8889", "#CF9596", "#D5A2A1", "#DDADAD", "#E2B9B9", "#E8C3C3", "#F0CFD0", "#F7DDDD", "#FAE7E7",
  "#F3E7E8", "#ECE8E7", "#E7E8EA", "#E0EAEC", "#D9EBED", "#D2EDEE", "#CCEEEF", "#C2EBEF", "#ABDAE7", "#9CCBE0",
  "#86BADC", "#77A8D6", "#719CCD", "#6C92C2", "#6584B6", "#5D79AA", "#57699E", "#535E95", "#4E538B", "#54538D",
  "#6767A3", "#7575B3", "#8483BB", "#9695B5", "#A6A5AC", "#B3B3A8", "#C3C3A4", "#CFCDA3", "#DFDF9D", "#EFEF95",
  "#FEFA8C", "#FDF27F", "#FAE975", "#F8DD67", "#F6D15C", "#F2C050", "#F1B847", "#EEAB40", "#EDA13C", "#F09837",
  "#EE9235", "#EC8A34", "#EB7F30", "#E9782E", "#E86F2D", "#E86F2D", "#E86F2D", "#E76F2D", "#E66E2D", "#E46E2D",
  "#E06D2D", "#DC6B2D", "#D6692D", "#CE672D", "#C5642D", "#B9602E", "#AB5C2E", "#9A562E", "#87502E", "#71492F",
  "#57412F", "#573A3B", "#624648", "#745954", "#786362", "#826A6A", "#8C7474", "#93817F", "#A68A8B", "#B3898A",
  "#B28A8A", "#B18989", "#A3797A", "#A3797A", "#A2777A", "#99606D", "#905F63", "#8E6062", "#8E6062", "#8E5E62",
  "#7A4652", "#7A4652", "#7A3C52", "#712748", "#6E2945", "#6B2D44", "#58383D", "#56393B", "#563B3E", "#504647",
  "#444643", "#454745", "#405751", "#3D5851", "#3B5950", "#32624D", "#2E644C", "#2E644C", "#2E644C", "#2E644C",
  "#2E614B"
];

export function getPaletteForParameter(paramId) {
    return TEMP_PALETTE;
}