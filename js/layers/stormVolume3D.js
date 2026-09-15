// js/layers/stormVolume3D.js
import { WXTOOLS_PALETTE_256 } from '../config/radarPalettes.js';
import { stateManager } from '../core/stateManager.js';

let scene, camera, renderer, controls;
let containerEl, canvasContainerEl;
let stormBoxMesh, wireframeHelper;
let volumeTexture3D = null;
let paletteTexture2D = null;
let isViewerActive = false;
let isFullscreen = false;
let renderMode = 'cloud'; // 'cloud' | 'pixels'
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
        .storm-controls-bar {
            position: absolute;
            bottom: 14px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 12px;
            background: rgba(11, 15, 25, 0.90);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(56, 189, 248, 0.4);
            border-radius: 24px;
            padding: 5px 12px;
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.8);
            z-index: 20;
            font-family: 'Rajdhani', sans-serif;
            user-select: none;
            -webkit-user-select: none;
        }
        .storm-mode-pill {
            display: flex;
            background: rgba(255, 255, 255, 0.06);
            border-radius: 16px;
            padding: 2px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            gap: 2px;
        }
        .storm-mode-btn {
            background: transparent;
            border: none;
            color: #94a3b8;
            font-family: 'Rajdhani', sans-serif;
            font-weight: 700;
            font-size: 11px;
            letter-spacing: 0.5px;
            padding: 3px 8px;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .storm-mode-btn:hover {
            color: #fff;
        }
        .storm-mode-btn.active {
            background: rgba(56, 189, 248, 0.3) !important;
            color: #38bdf8 !important;
            box-shadow: 0 0 8px rgba(56, 189, 248, 0.4);
        }
        .storm-cutoff-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .storm-cutoff-label {
            font-size: 12px;
            font-weight: 700;
            color: #38bdf8;
            letter-spacing: 0.5px;
            white-space: nowrap;
            min-width: 90px;
        }
        .storm-cutoff-range {
            width: 100px;
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

// Dual-Mode Fragment Shader: Atmospheric Cloud ↔ Crisp Super-Res Pixels
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
    uniform float u_renderMode; // 0.0 = Smooth Cloud, 1.0 = Crisp Raw Pixels
    uniform vec4 u_cutoffMin;
    uniform vec4 u_cutoffMax;

    // Fast Dither Hash to remove ray-slice banding
    float ditherHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

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
        float groundFade = smoothstep(0.0, 0.035, texCoord.y);

        // 🌟 Lift the bottom-to-middle storm core into natural proportion
        float expandedY = pow(clamp(texCoord.y, 0.0, 1.0), 1.40);

        vec3 sampleCoord = vec3(texCoord.x, expandedY, 1.0 - texCoord.z);
        return texture(u_volumeTex, sampleCoord).r * groundFade;
    }

    // Henyey-Greenstein forward phase function for atmospheric cloud edge radiance
    float phaseHG(float cosTheta, float g) {
        float g2 = g * g;
        return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
    }

    #define MAX_STEPS 128
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
        vec3 currentPosition = uvwStart + (u_renderMode > 0.5 ? vec3(0.0) : uvwStep * dither);

        vec3 accumulatedColor = vec3(0.0);
        float transmittance = 1.0;

        // High-angled solar directional light
        vec3 sunDir = normalize(vec3(0.35, 0.85, 0.40));
        float cosTheta = dot(rayDir, sunDir);
        float forwardScatter = phaseHG(cosTheta, 0.40);

        for (int i = 0; i < MAX_STEPS; i++) {
            float sampleValue = sampleVolume(currentPosition);

            if (sampleValue > u_cutoffMin.w) {
                vec4 palColor = texture(u_paletteTex, vec2(sampleValue, 0.5));

                if (u_renderMode > 0.5) {
                    // --- MODE 1: CRISP RAW SUPER-RES PIXELS ---
                    float stepDensity = 0.70;
                    float stepTransmittance = exp(-stepDensity);
                    accumulatedColor += transmittance * palColor.rgb * (1.0 - stepTransmittance);
                    transmittance *= stepTransmittance;
                } else {
                    // --- MODE 0: REALISTIC ATMOSPHERIC CLOUD ---
                    // 1. Continuous physical density curve
                    float normDbz = (sampleValue - u_cutoffMin.w) / max(1.0 - u_cutoffMin.w, 0.001);
                    float density = pow(normDbz, 1.45) * 3.6;

                    // 2. Dual-hemisphere ambient skylight
                    float heightFactor = clamp(currentPosition.y, 0.0, 1.0);
                    vec3 skyLight = mix(vec3(0.35, 0.38, 0.46), vec3(0.58, 0.68, 0.82), heightFactor);

                    // 3. Sunlight penetration & forward cloud-rim radiance
                    float sunPenetration = exp(-density * 0.45);
                    vec3 directSun = vec3(1.15, 1.10, 1.00) * (sunPenetration * 0.75 + forwardScatter * 0.40);

                    vec3 litColor = palColor.rgb * (skyLight + directSun);

                    // 4. Physical Beer-Lambert optical depth accumulation
                    float stepOpticalDepth = density * (48.0 / u_steps) * 1.35;
                    float stepTransmittance = exp(-stepOpticalDepth);

                    accumulatedColor += transmittance * litColor * (1.0 - stepTransmittance);
                    transmittance *= stepTransmittance;
                }

                if (transmittance < 0.015) {
                    break;
                }
            }

            currentPosition += uvwStep;
        }

        float finalAlpha = (1.0 - transmittance) * u_opacity;
        if (finalAlpha < 0.01) {
            discard;
        }

        fragColor = vec4(accumulatedColor, finalAlpha);
    }
`;

/**
 * 🌟 Creates 256x1 Palette
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

    // 🌟 Dual-Mode Controls Bar (Cloud vs Pixels + Cutoff Slider)
    let controlsBar = containerEl.querySelector('.storm-controls-bar');
    if (!controlsBar) {
        controlsBar = document.createElement('div');
        controlsBar.className = 'storm-controls-bar';
        controlsBar.innerHTML = `
            <div class="storm-mode-pill">
                <button class="storm-mode-btn active" id="btn-mode-cloud">☁ Cloud</button>
                <button class="storm-mode-btn" id="btn-mode-pixels">Pixels</button>
            </div>
            <div class="storm-cutoff-group">
                <span class="storm-cutoff-label" id="storm-cutoff-label">Cut-off: 15 dBZ</span>
                <input class="storm-cutoff-range" id="storm-cutoff-slider" type="range" min="5" max="55" value="15" step="1">
            </div>
        `;
        containerEl.appendChild(controlsBar);

        const btnCloud = controlsBar.querySelector('#btn-mode-cloud');
        const btnPixels = controlsBar.querySelector('#btn-mode-pixels');
        const slider = controlsBar.querySelector('#storm-cutoff-slider');
        const label = controlsBar.querySelector('#storm-cutoff-label');

        btnCloud.onclick = () => setStormRenderMode('cloud');
        btnPixels.onclick = () => setStormRenderMode('pixels');

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
    camera.position.set(0.0, 0.85, 2.15);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    canvasContainerEl.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.3;
    controls.maxDistance = 8.0;
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
            u_steps: { value: 128.0 },
            u_opacity: { value: 1.0 },
            u_renderMode: { value: 0.0 }, // 0.0 = Cloud, 1.0 = Pixels
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

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(canvasContainerEl);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isFullscreen) {
            toggleStormFullscreen(false);
        }
    });
}

/**
 * 🌟 Seamless 0ms Switch between Smooth Cloud and Raw Super-Res Pixels
 */
export function setStormRenderMode(mode) {
    renderMode = mode;
    const btnCloud = document.getElementById('btn-mode-cloud');
    const btnPixels = document.getElementById('btn-mode-pixels');

    if (btnCloud && btnPixels) {
        btnCloud.classList.toggle('active', mode === 'cloud');
        btnPixels.classList.toggle('active', mode === 'pixels');
    }

    if (stormBoxMesh && stormBoxMesh.material) {
        stormBoxMesh.material.uniforms.u_renderMode.value = (mode === 'pixels') ? 1.0 : 0.0;
    }

    if (volumeTexture3D) {
        const filterType = (mode === 'pixels') ? THREE.NearestFilter : THREE.LinearFilter;
        volumeTexture3D.minFilter = filterType;
        volumeTexture3D.magFilter = filterType;
        volumeTexture3D.needsUpdate = true;
    }
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
    const heightKm = 18.0;

    // Balanced panoramic aspect ratio
    const maxHoriz = Math.max(widthKm, depthKm, 12.0);
    const HORIZONTAL_SPREAD = 1.35;
    const VERTICAL_RELIEF = 1.35; // Tuned for higher lower-to-middle presence

    const aspectX = (widthKm / maxHoriz) * HORIZONTAL_SPREAD;
    const aspectZ = (depthKm / maxHoriz) * HORIZONTAL_SPREAD;
    const aspectY = (heightKm / maxHoriz) * VERTICAL_RELIEF;

    stormBoxMesh.scale.set(aspectX, aspectY, aspectZ);
    stormBoxMesh.material.uniforms.u_boxSize.value.set(aspectX, aspectY, aspectZ);

    wireframeHelper.update();

    const Texture3DClass = THREE.DataTexture3D || THREE.Data3DTexture;
    if (volumeTexture3D) volumeTexture3D.dispose();

    // 🌟 Uploads Ultra-HD 384 x 96 x 384 3D Volume Texture
    volumeTexture3D = new Texture3DClass(voxelBuffer, 384, 96, 384);
    volumeTexture3D.format = THREE.RedFormat;
    volumeTexture3D.type = THREE.UnsignedByteType;
    
    const filterType = (renderMode === 'pixels') ? THREE.NearestFilter : THREE.LinearFilter;
    volumeTexture3D.minFilter = filterType;
    volumeTexture3D.magFilter = filterType;
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
