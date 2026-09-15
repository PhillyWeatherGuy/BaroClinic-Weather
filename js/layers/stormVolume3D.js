// js/layers/stormVolume3D.js
import { WXTOOLS_PALETTE_256 } from '../config/radarPalettes.js';
import { stateManager } from '../core/stateManager.js';

let scene, camera, renderer, controls;
let containerEl, canvasContainerEl;
let stormBoxMesh, wireframeHelper, groundGridHelper;
let volumeTexture3D = null;
let paletteTexture2D = null;
let isViewerActive = false;
let isFullscreen = false;
let animationFrameId = null;

function ensureControlStyles() {
    if (document.getElementById('storm-cutoff-slider-styles')) return;
    const style = document.createElement('style');
    style.id = 'storm-cutoff-slider-styles';
    style.textContent = `
        #storm-volume-container.fullscreen {
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-width: 100vw !important;
            max-height: 100vh !important;
            border-radius: 0 !important;
            border: none !important;
            z-index: 99999 !important;
        }
        .storm-header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .expand-btn {
            padding: 4px 8px;
            font-size: 13px;
            border-radius: 6px;
            cursor: pointer;
            line-height: 1;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #94a3b8;
            transition: all 0.15s ease;
        }
        .expand-btn:hover {
            color: #38bdf8;
            background: rgba(56, 189, 248, 0.2);
            border-color: rgba(56, 189, 248, 0.5);
        }
        .storm-cutoff-pill {
            position: absolute;
            bottom: 14px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 10px;
            background: rgba(11, 15, 25, 0.88);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: 1px solid rgba(56, 189, 248, 0.35);
            border-radius: 20px;
            padding: 6px 14px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
            z-index: 20;
            font-family: 'Rajdhani', sans-serif;
            user-select: none;
            -webkit-user-select: none;
        }
        .storm-cutoff-label {
            font-size: 12px;
            font-weight: 700;
            color: #38bdf8;
            letter-spacing: 0.5px;
            white-space: nowrap;
            min-width: 95px;
        }
        .storm-cutoff-range {
            width: 110px;
            accent-color: #38bdf8;
            cursor: pointer;
            height: 4px;
            appearance: none;
            -webkit-appearance: none;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 2px;
            outline: none;
        }
        .storm-cutoff-range::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #38bdf8;
            cursor: pointer;
            box-shadow: 0 0 8px rgba(56, 189, 248, 0.8);
        }
    `;
    document.head.appendChild(style);
}

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

// Fragment Shader: Glowing Convective Cloud Raymarcher
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

    // Fast Screen-Space Blue Noise Dither
    float ditherHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    // Safe 360° Ray-AABB Intersection
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

    float sampleVolume(vec3 texCoord) {
        if (any(lessThan(texCoord, u_cutoffMin.xyz)) || any(greaterThan(texCoord, u_cutoffMax.xyz))) {
            return 0.0;
        }
        // Fade out ground noise to keep floor see-through
        float groundFade = smoothstep(0.0, 0.025, texCoord.y);
        vec3 sampleCoord = vec3(texCoord.x, texCoord.y, 1.0 - texCoord.z);
        return texture(u_volumeTex, sampleCoord).r * groundFade;
    }

    vec3 estimateNormal(vec3 p, float eps) {
        float dX = sampleVolume(p + vec3(eps, 0.0, 0.0)) - sampleVolume(p - vec3(eps, 0.0, 0.0));
        float dY = sampleVolume(p + vec3(0.0, eps, 0.0)) - sampleVolume(p - vec3(0.0, eps, 0.0));
        float dZ = sampleVolume(p + vec3(0.0, 0.0, eps)) - sampleVolume(p - vec3(0.0, 0.0, eps));
        return normalize(-vec3(dX, dY, dZ));
    }

    #define MAX_STEPS 96
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

        vec3 frontPos = rayOrigin + rayDir * tStart;
        vec3 backPos = rayOrigin + rayDir * tEnd;

        vec3 uvwStart = (frontPos + halfSize) / u_boxSize;
        vec3 uvwEnd = (backPos + halfSize) / u_boxSize;
        vec3 uvwStep = (uvwEnd - uvwStart) / u_steps;

        float dither = ditherHash(gl_FragCoord.xy);
        vec3 currentPosition = uvwStart + uvwStep * dither;

        vec3 accumulatedLight = vec3(0.0);
        float transmittance = 1.0;
        vec3 sunDir = normalize(vec3(0.35, 0.90, 0.25));

        for (int i = 0; i < MAX_STEPS; i++) {
            float rawVal = sampleVolume(currentPosition);

            if (rawVal > u_cutoffMin.w && rawVal < u_cutoffMax.w) {
                // Pure vibrant radar palette color
                vec4 palCol = texture(u_paletteTex, vec2(rawVal, 0.5));

                // Continuous Optical Density Curve (Low dBZ = wispy mist, High dBZ = dense core)
                float normDbz = clamp((rawVal - u_cutoffMin.w) / (1.0 - u_cutoffMin.w), 0.0, 1.0);
                float density = pow(normDbz, 1.35) * 5.8;

                // Beer-Lambert Exponential Step Absorption
                float stepAlpha = 1.0 - exp(-density * (64.0 / u_steps) * 0.55);

                if (stepAlpha > 0.001) {
                    // Soft atmospheric sunlight + sky bounce
                    vec3 normal = estimateNormal(currentPosition, 0.015);
                    float sun = clamp(dot(normal, sunDir), 0.0, 1.0);
                    float sky = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
                    vec3 illumination = vec3(0.55) + vec3(0.45) * sun + vec3(0.12, 0.15, 0.20) * sky;

                    vec3 litColor = palCol.rgb * illumination;

                    // Front-to-back volumetric accumulation
                    accumulatedLight += transmittance * litColor * stepAlpha * 1.35;
                    transmittance *= (1.0 - stepAlpha);

                    if (transmittance < 0.02) {
                        break;
                    }
                }
            }

            currentPosition += uvwStep;
        }

        float finalAlpha = (1.0 - transmittance) * u_opacity;
        if (finalAlpha < 0.01) {
            discard;
        }

        // 🌟 Un-premultiply so Three.js canvas blending renders at 100% full brightness
        fragColor = vec4(accumulatedLight / max(finalAlpha, 0.001), finalAlpha);
    }
`;

/**
 * 🌟 Creates 256x1 Palette Texture
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
    const headerEl = containerEl ? containerEl.querySelector('.storm-volume-header') : null;
    const closeBtn = document.getElementById('btn-close-storm-3d');

    if (!containerEl || !canvasContainerEl) return;
    ensureControlStyles();

    // Fullscreen Action Button
    if (headerEl && !document.getElementById('btn-fullscreen-storm-3d')) {
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'storm-header-actions';

        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.id = 'btn-fullscreen-storm-3d';
        fullscreenBtn.className = 'expand-btn';
        fullscreenBtn.title = 'Toggle Fullscreen';
        fullscreenBtn.textContent = '⛶';

        fullscreenBtn.onclick = () => {
            toggleStormFullscreen();
        };

        if (closeBtn) {
            headerEl.removeChild(closeBtn);
            actionsContainer.appendChild(fullscreenBtn);
            actionsContainer.appendChild(closeBtn);
            headerEl.appendChild(actionsContainer);
        }
    }

    if (closeBtn) {
        closeBtn.onclick = () => hideStormVolume();
    }

    // Interactive dBZ Cut-Off Slider
    let cutoffControl = containerEl.querySelector('.storm-cutoff-pill');
    if (!cutoffControl) {
        cutoffControl = document.createElement('div');
        cutoffControl.className = 'storm-cutoff-pill';
        cutoffControl.innerHTML = `
            <span class="storm-cutoff-label" id="storm-cutoff-label">Cut-off: 10 dBZ</span>
            <input class="storm-cutoff-range" id="storm-cutoff-slider" type="range" min="5" max="55" value="10" step="1">
        `;
        containerEl.appendChild(cutoffControl);

        const slider = cutoffControl.querySelector('#storm-cutoff-slider');
        const label = cutoffControl.querySelector('#storm-cutoff-label');

        slider.oninput = (e) => {
            const dbz = parseFloat(e.target.value);
            label.textContent = `Cut-off: ${Math.round(dbz)} dBZ`;
            const normVal = Math.max(0.01, ((dbz + 32.0) * 2.0) / 255.0);
            if (stormBoxMesh && stormBoxMesh.material) {
                stormBoxMesh.material.uniforms.u_cutoffMin.value.w = normVal;
            }
        };
    }

    if (renderer) return;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100.0);
    camera.position.set(0.0, 1.1, 1.9);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    canvasContainerEl.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.3;
    controls.maxDistance = 6.0;
    controls.minPolarAngle = 0.0;
    controls.maxPolarAngle = Math.PI;
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
            // Initial cutoff: 10 dBZ (~0.329)
            u_cutoffMin: { value: new THREE.Vector4(0.0, 0.0, 0.0, 0.329) },
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

    groundGridHelper = new THREE.GridHelper(1.0, 8, 0x38bdf8, 0x38bdf8);
    groundGridHelper.material.transparent = true;
    groundGridHelper.material.opacity = 0.35;
    groundGridHelper.position.y = -0.4;
    scene.add(groundGridHelper);

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(canvasContainerEl);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isFullscreen) {
            toggleStormFullscreen(false);
        }
    });
}

export function toggleStormFullscreen(forceState = null) {
    if (!containerEl) containerEl = document.getElementById('storm-volume-container');
    const fullscreenBtn = document.getElementById('btn-fullscreen-storm-3d');
    if (!containerEl) return;

    isFullscreen = (forceState !== null) ? forceState : !isFullscreen;

    if (isFullscreen) {
        containerEl.classList.add('fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.textContent = '🗗';
            fullscreenBtn.title = 'Exit Fullscreen (Esc)';
        }
    } else {
        containerEl.classList.remove('fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.textContent = '⛶';
            fullscreenBtn.title = 'Toggle Fullscreen';
        }
    }

    setTimeout(() => {
        handleResize();
    }, 50);
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

    // Ingest 256 x 96 x 256 High-Definition 3D Volume
    volumeTexture3D = new Texture3DClass(voxelBuffer, 256, 96, 256);
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
    if (containerEl) {
        containerEl.style.display = 'none';
        toggleStormFullscreen(false);
    }
    isViewerActive = false;
    stateManager.is3DVolumeActive = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}
