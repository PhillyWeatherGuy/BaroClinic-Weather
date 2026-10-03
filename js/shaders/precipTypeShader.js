// js/shaders/precipTypeShader.js
// Dedicated precipitation-type layer. It currently shares the mature rate
// renderer while keeping the ptype path isolated for future experiments.
import { createPrecipShaderLayer } from './precipShader.js';

export function createPrecipTypeShaderLayer(mapInstance) {
    return createPrecipShaderLayer(mapInstance);
}
