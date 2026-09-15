// js/layers/stormVolume3D.js
import { WXTOOLS_PALETTE_256 } from '../config/radarPalettes.js';
import { stateManager } from '../core/stateManager.js';

let scene, camera, renderer, controls;
let containerEl, canvasContainerEl;
let stormBoxMesh, wireframeHelper, groundGridHelper;
let volumeTexture3D = null;
let paletteTexture2D = null;
let isViewerActive = false;
let animationFrameId = null;

// Vertex Shader
const vsVolume = `
    out vec3 v_worldPos;
    out vec3 v_localPos;

    void main() {
        v_localPos = position;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        v_worldPos = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

// Fragment Shader: 360° Omnidirectional Cloud Raymarcher with Soft Billow Puffiness
const fsVolume = `
    precision highp float;
    precision highp sampler3D;

    in vec3 v_worldPos;
    in vec3 v_localPos;
    out vec4 fragColor;

    uniform vec3 u_cameraPos;
    uniform sampler3D u_volumeTex;
    uniform sampler2D u_paletteTex;
    uniform vec3 u_boxSize;
    uniform float u_steps;
    uniform float u_opacity;
    uniform vec4 u_cutoffMin;
    uniform vec4 u_cutoffMax;

    // Smooth 3D Value Noise for Organic Cauliflower Puffiness
    float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise3D(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);

        return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }

    // Multi-Scale Cloud Billows (Smooth macro dome + soft turbulent puffs)
    float cloudTurbulence(vec3 p) {
        float f = noise3D(p * 5.0) * 0.65;
        f += noise3D(p * 11.0) * 0.35;
        return f;
    }

    // 🌟 Safe 360° Ray-AABB Intersection (Zero division by zero)
    vec2 intersectAABB(vec3 rayOrigin, vec3 rayDir, vec3 boxMin, vec3 boxMax) {
        vec3 safeDir = rayDir + sign(rayDir) * 1e-6;
        vec3 invR = 1.0 / safeDir;
        vec3 tbot = invR * (boxMin - rayOrigin);
        vec3 ttop = invR * (boxMax - rayOrigin);
        vec3 tmin = min(ttop, tbot);
        vec3 tmax = max(ttop, tbot);
        float t0 = max(max(tmin.x, tmin.y), tmin.z);
        float t1 = min(min(tmax.x, tmax.y), tmax.z);
        return vec2(t0, t1);
    }

    // Base Macro Density (Smooth for clean normal estimation)
    float sampleBaseDensity(vec3 texCoord) {
        if (any(lessThan(texCoord, u_cutoffMin.xyz)) || any(greaterThan(texCoord, u_cutoffMax.xyz))) {
            return 0.0;
        }
        vec3 sampleCoord = vec3(texCoord.x, texCoord.y, 1.0 - texCoord.z);
        return texture(u_volumeTex, sampleCoord).r;
    }

    // Puffy Cloud Density (Combines smooth base volume with soft billow displacement)
    float samplePuffyDensity(vec3 texCoord) {
        float base = sampleBaseDensity(texCoord);
        if (base <= u_cutoffMin.w) return 0.0;

        // Apply billow noise strictly to the outer cloud envelope to scallop the edges
        vec3 sampleCoord = vec3(texCoord.x, texCoord.y, 1.0 - texCoord.z);
        float billow = cloudTurbulence(sampleCoord);
        
        // Gentle displacement that dissolves flat hulls into puffy cumulus clouds
        float puffMod = (billow - 0.5) * 0.04 * (1.0 - smoothstep(0.25, 0.70, base));
        return clamp(base + puffMod, 0.0, 1.0);
    }

    // Smooth Macro Surface Normals (Zero vertical comb/whisker artifacts)
    vec3 estimateSmoothNormal(vec3 p, float eps) {
        float dX = sampleBaseDensity(p + vec3(eps, 0.0, 0.0)) - sampleBaseDensity(p - vec3(eps, 0.0, 0.0));
        float dY = sampleBaseDensity(p + vec3(0.0, eps, 0.0)) - sampleBaseDensity(p - vec3(0.0, eps, 0.0));
        float dZ = sampleBaseDensity(p + vec3(0.0, 0.0, eps)) - sampleBaseDensity(p - vec3(0.0, 0.0, eps));
        vec3 n = -vec3(dX, dY, dZ);
        float len = length(n);
        return len > 0.0001 ? n / len : vec3(0.0, 1.0, 0.0);
    }

    // 🌟 Natural Cloud Transfer Function (Creamy White Anvil -> Emerald Rain -> Fiery Core)
    vec4 colorizeCloud(float value) {
        if (value <= u_cutoffMin.w || value >= u_cutoffMax.w) {
            return vec4(0.0);
        }

        vec4 paletteColor = texture(u_paletteTex, vec2(value, 0.5));
        vec3 cloudColor = paletteColor.rgb;

        // Outer cloud vapor (12-24 dBZ): Soft, natural cloud-white mist
        if (value < 0.44) {
            float whiteMix = 1.0 - smoothstep(u_cutoffMin.w, 0.44, value);
            vec3 softWhite = vec3(0.94, 0.96, 0.98);
            cloudColor = mix(cloudColor, softWhite, whiteMix * 0.85);
        }

        // Smooth non-linear density curve (Translucent outer mist -> Dense hail core)
        float alpha = 0.0;
        if (value < 0.40) {
            // 12-22 dBZ: 2% to 6% opacity
            float t = (value - u_cutoffMin.w) / max(0.40 - u_cutoffMin.w, 0.001);
            alpha = mix(0.02, 0.06, t);
        } else if (value < 0.58) {
            // 22-38 dBZ (Rain Shield): 10% to 32% opacity
            float t = (value - 0.40) / 0.18;
            alpha = mix(0.07, 0.32, t);
        } else if (value < 0.74) {
            // 38-50 dBZ (Convective Core): 45% to 80% opacity
            float t = (value - 0.58) / 0.16;
            alpha = mix(0.38, 0.80, t);
        } else {
            // 50+ dBZ (Hail Core): 95% to 100% solid opacity
            float t = (value - 0.74) / 0.26;
            alpha = mix(0.85, 1.00, t);
        }

        return vec4(cloudColor, alpha);
    }

    #define MAX_STEPS 96
    void march(vec3 currentPosition, vec3 dir, float rayLength) {
        float stepSize = rayLength / u_steps;
        vec3 step = normalize(dir) * stepSize;
        vec3 accumulatedColor = vec3(0.0);
        float transmittance = 1.0;
        float accumulatedLength = 0.0;

        // Dynamic overhead sun angle
        vec3 sunDir = normalize(vec3(0.35, 0.90, 0.25));

        for (int i = 0; i < MAX_STEPS; i++) {
            float sampleValue = samplePuffyDensity(currentPosition);

            if (sampleValue > u_cutoffMin.w) {
                vec4 sampleColor = colorizeCloud(sampleValue);

                if (sampleColor.a > 0.001) {
                    // Smooth normal on base volume eliminates comb fibers
                    vec3 normal = estimateSmoothNormal(currentPosition, 0.025);
                    
                    // Atmospheric Sunlight + Sky Bounce Illumination
                    float sunLight = clamp(dot(normal, sunDir), 0.0, 1.0);
                    float skyLight = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
                    vec3 illumination = vec3(0.42) + vec3(0.58) * sunLight + vec3(0.14, 0.18, 0.24) * skyLight;

                    vec3 litColor = sampleColor.rgb * illumination;

                    // Beer-Lambert Optical Transmittance (Glowing internal core)
                    float stepDensity = sampleColor.a * (48.0 / u_steps) * 1.35;
                    float stepTransmittance = exp(-stepDensity);

                    accumulatedColor += transmittance * litColor * (1.0 - stepTransmittance) * 1.4;
                    transmittance *= stepTransmittance;

                    if (transmittance < 0.02) {
                        break;
                    }
                }
            }

            currentPosition += step;
            accumulatedLength += stepSize;

            if (accumulatedLength >= rayLength) {
                break;
            }
        }

        float finalAlpha = (1.0 - transmittance) * u_opacity;
        if (finalAlpha < 0.01) {
            discard;
        }

        fragColor = vec4(accumulatedColor, finalAlpha);
    }

    void main() {
        vec3 rayOrigin = u_cameraPos;
        vec3 rayDir = normalize(v_worldPos - rayOrigin);

        vec3 halfSize = u_boxSize * 0.5;
        vec2 hit = intersectAABB(rayOrigin, rayDir, -halfSize, halfSize);

        if (hit.x > hit.y || hit.y < 0.0) {
            discard;
        }

        float tStart = max(hit.x, 0.0);
        float tEnd = hit.y;
        float rayLength = tEnd - tStart;

        vec3 frontPos = rayOrigin + rayDir * tStart;
        vec3 currentPosition = (frontPos + halfSize) / u_boxSize;
        vec3 unitDir = rayDir / u_boxSize;

        march(currentPosition, unitDir, rayLength);
    }
`;

/**
 * 🌟 Creates 256x1 Palette with Clean 12 dBZ Cutoff
 */
function createRadarPaletteTexture(palette256 = WXTOOLS_PALETTE_256) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(256, 1);

    for (let i = 0; i < 256; i++) {
        const c = palette256[i] || { r: 0, g: 0, b: 0, a: 0 };
        const idx = i * 4;

        imgData.data[idx] = c.r;
        imgData.data[idx + 1] = c.g;
        imgData.data[idx + 2] = c.b;
        imgData.data[idx + 3] = (i < 65) ? 0 : 255;
    }

    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
}

export function initStormVolumeViewer() {
    containerEl = document.getElementById('storm-volume-container');
    canvasContainerEl = document.getElementById('storm-volume-canvas-container');
    const closeBtn = document.getElementById('btn-close-storm-3d');

    if (!containerEl || !canvasContainerEl) return;

    if (closeBtn) {
        closeBtn.onclick = () => hideStormVolume();
    }

    if (renderer) return;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100.0); // 0.01 near plane prevents camera clipping
    camera.position.set(0.0, 1.1, 1.9);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    canvasContainerEl.appendChild(renderer.domElement);

    // 🌟 Full 360° Omnidirectional Orbital Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.3;
    controls.maxDistance = 6.0;
    controls.minPolarAngle = Math.PI * 0.05; // Full pitch capability
    controls.maxPolarAngle = Math.PI * 0.95; // Allows looking from below horizon
    controls.target.set(0.0, 0.0, 0.0);

    paletteTexture2D = createRadarPaletteTexture();

    const boxGeometry = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const volumeMaterial = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: vsVolume,
        fragmentShader: fsVolume,
        uniforms: {
            u_cameraPos: { value: new THREE.Vector3() },
            u_volumeTex: { value: null },
            u_paletteTex: { value: paletteTexture2D },
            u_boxSize: { value: new THREE.Vector3(1.0, 0.8, 1.0) },
            u_steps: { value: 72.0 },
            u_opacity: { value: 1.0 },
            u_cutoffMin: { value: new THREE.Vector4(0.0, 0.0, 0.0, 0.25) },
            u_cutoffMax: { value: new THREE.Vector4(1.0, 1.0, 1.0, 1.00) }
        },
        transparent: true,
        side: THREE.BackSide
    });

    stormBoxMesh = new THREE.Mesh(boxGeometry, volumeMaterial);
    scene.add(stormBoxMesh);

    wireframeHelper = new THREE.BoxHelper(stormBoxMesh, 0x38bdf8);
    wireframeHelper.material.opacity = 0.35;
    wireframeHelper.material.transparent = true;
    scene.add(wireframeHelper);

    groundGridHelper = new THREE.GridHelper(1.0, 8, 0x38bdf8, 0x1e293b);
    groundGridHelper.position.y = -0.4;
    scene.add(groundGridHelper);

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(canvasContainerEl);
}

function handleResize() {
    if (!renderer || !camera || !canvasContainerEl) return;
    const w = canvasContainerEl.clientWidth, h = canvasContainerEl.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

function animate() {
    if (!isViewerActive) return;
    animationFrameId = requestAnimationFrame(animate);

    if (controls) controls.update();
    if (stormBoxMesh && stormBoxMesh.material) {
        stormBoxMesh.material.uniforms.u_cameraPos.value.copy(camera.position);
    }
    renderer.render(scene, camera);
}

export function updateStormVolume(voxelBuffer, bounds) {
    initStormVolumeViewer();
    if (!scene || !voxelBuffer) return;

    const minLng = Math.min(bounds[0], bounds[2]);
    const maxLng = Math.max(bounds[0], bounds[2]);
    const minLat = Math.min(bounds[1], bounds[3]);
    const maxLat = Math.max(bounds[1], bounds[3]);

    const midLat = (minLat + maxLat) * 0.5;
    const widthKm = Math.abs(maxLng - minLng) * 111.32 * Math.cos(midLat * (Math.PI / 180.0));
    const depthKm = Math.abs(maxLat - minLat) * 111.32;
    const heightKm = 14.0;

    const maxHoriz = Math.max(widthKm, depthKm, 10.0);
    const aspectX = widthKm / maxHoriz;
    const aspectY = (heightKm / maxHoriz) * 1.9; // 1.9x vertical exaggeration
    const aspectZ = depthKm / maxHoriz;

    stormBoxMesh.scale.set(aspectX, aspectY, aspectZ);
    stormBoxMesh.material.uniforms.u_boxSize.value.set(aspectX, aspectY, aspectZ);

    wireframeHelper.update();
    groundGridHelper.scale.set(aspectX, 1.0, aspectZ);
    groundGridHelper.position.y = -aspectY * 0.5;

    const Texture3DClass = THREE.DataTexture3D || THREE.Data3DTexture;
    if (volumeTexture3D) volumeTexture3D.dispose();

    volumeTexture3D = new Texture3DClass(voxelBuffer, 128, 64, 128);
    volumeTexture3D.format = THREE.RedFormat;
    volumeTexture3D.type = THREE.UnsignedByteType;
    volumeTexture3D.minFilter = THREE.LinearFilter;
    volumeTexture3D.magFilter = THREE.LinearFilter;
    volumeTexture3D.wrapS = THREE.ClampToEdgeWrapping;
    volumeTexture3D.wrapT = THREE.ClampToEdgeWrapping;
    volumeTexture3D.wrapR = THREE.ClampToEdgeWrapping;
    volumeTexture3D.unpackAlignment = 1;
    volumeTexture3D.needsUpdate = true;

    stormBoxMesh.material.uniforms.u_volumeTex.value = volumeTexture3D;
    stormBoxMesh.material.needsUpdate = true;

    showStormVolume();
}

export function showStormVolume() {
    if (!containerEl) containerEl = document.getElementById('storm-volume-container');
    if (containerEl) containerEl.style.display = 'flex';
    isViewerActive = true;
    stateManager.is3DVolumeActive = true;
    handleResize();
    if (!animationFrameId) animate();
}

export function hideStormVolume() {
    if (!containerEl) containerEl = document.getElementById('storm-volume-container');
    if (containerEl) containerEl.style.display = 'none';
    isViewerActive = false;
    stateManager.is3DVolumeActive = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}
