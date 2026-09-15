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

// Raymarching Vertex Shader
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

// Raymarching Fragment Shader (GLSL 3.0 ES)
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
    uniform vec3 u_lightDir;

    // Ray-AABB Bounding Box Intersection
    vec2 intersectAABB(vec3 rayOrigin, vec3 rayDir, vec3 boxMin, vec3 boxMax) {
        vec3 invR = 1.0 / rayDir;
        vec3 tbot = invR * (boxMin - rayOrigin);
        vec3 ttop = invR * (boxMax - rayOrigin);
        vec3 tmin = min(ttop, tbot);
        vec3 tmax = max(ttop, tbot);
        float t0 = max(max(tmin.x, tmin.y), tmin.z);
        float t1 = min(min(tmax.x, tmax.y), tmax.z);
        return vec2(t0, t1);
    }

    // Gradient Normal Estimation for Sunlit Cloud Billows
    vec3 estimateNormal(vec3 uvw, float stepSize) {
        float dX = texture(u_volumeTex, uvw + vec3(stepSize, 0.0, 0.0)).r - 
                   texture(u_volumeTex, uvw - vec3(stepSize, 0.0, 0.0)).r;
        float dY = texture(u_volumeTex, uvw + vec3(0.0, stepSize, 0.0)).r - 
                   texture(u_volumeTex, uvw - vec3(0.0, stepSize, 0.0)).r;
        float dZ = texture(u_volumeTex, uvw + vec3(0.0, 0.0, stepSize)).r - 
                   texture(u_volumeTex, uvw - vec3(0.0, 0.0, stepSize)).r;
        return normalize(-vec3(dX, dY, dZ));
    }

    void main() {
        // Ray origin & direction in object space
        vec3 rayOrigin = u_cameraPos;
        vec3 rayDir = normalize(v_worldPos - rayOrigin);

        vec3 halfSize = u_boxSize * 0.5;
        vec2 hit = intersectAABB(rayOrigin, rayDir, -halfSize, halfSize);

        if (hit.x > hit.y || hit.y < 0.0) {
            discard;
        }

        float tStart = max(hit.x, 0.0);
        float tEnd = hit.y;

        // Raymarching loop settings (Bounded step count for 60 FPS laptop performance)
        const int MAX_STEPS = 84;
        float tStep = (tEnd - tStart) / float(MAX_STEPS);
        vec3 stepVec = rayDir * tStep;
        vec3 currentPos = rayOrigin + rayDir * tStart;

        vec4 accumulatedColor = vec4(0.0);

        for (int i = 0; i < MAX_STEPS; i++) {
            // Map physical coordinates [-halfSize, halfSize] to Texture UVW [0, 1]
            vec3 uvw = (currentPos + halfSize) / u_boxSize;

            if (all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0)))) {
                // Hardware Trilinear Sampling (Smooth vapor)
                float rawVal = texture(u_volumeTex, uvw).r;

                if (rawVal > 0.05) {
                    // Sample color & optical density from palette transfer function
                    vec4 sampleCol = texture(u_paletteTex, vec2(rawVal, 0.5));

                    if (sampleCol.a > 0.001) {
                        // Directional Sunlight & Shading
                        vec3 normal = estimateNormal(uvw, 0.015);
                        float diffuse = clamp(dot(normal, u_lightDir), 0.0, 1.0);
                        vec3 litRgb = sampleCol.rgb * (0.45 + 0.55 * diffuse);

                        // Front-to-back optical absorption (Beer-Lambert model)
                        float alpha = sampleCol.a * 0.25;
                        accumulatedColor.rgb += (1.0 - accumulatedColor.a) * litRgb * alpha;
                        accumulatedColor.a += (1.0 - accumulatedColor.a) * alpha;

                        // Early Ray Termination (Stops once opaque core is hit)
                        if (accumulatedColor.a >= 0.98) {
                            break;
                        }
                    }
                }
            }

            currentPos += stepVec;
        }

        if (accumulatedColor.a < 0.01) {
            discard;
        }

        fragColor = accumulatedColor;
    }
`;

/**
 * 🌟 Constructs the Optical Density Transfer Function Texture
 */
function createTransferFunctionTexture(palette256 = WXTOOLS_PALETTE_256) {
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

        // Optical Density Alpha Curve
        if (i < 65) {
            // < 12 dBZ: Transparent clear-air
            imgData.data[idx + 3] = 0;
        } else if (i < 100) {
            // 12-25 dBZ: Faint, wispy cloud vapor (2% to 8% opacity)
            const t = (i - 65) / 35.0;
            imgData.data[idx + 3] = Math.round(5 + t * 15);
        } else if (i < 160) {
            // 25-45 dBZ: Rain core (20% to 55% opacity)
            const t = (i - 100) / 60.0;
            imgData.data[idx + 3] = Math.round(20 + t * 120);
        } else {
            // 50+ dBZ: Dense, solid hail core & updraft (80% to 100% opacity)
            const t = (i - 160) / 95.0;
            imgData.data[idx + 3] = Math.round(180 + t * 75);
        }
    }

    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
}

/**
 * 🌟 Initializes the Three.js Volumetric Viewer
 */
export function initStormVolumeViewer() {
    containerEl = document.getElementById('storm-volume-container');
    canvasContainerEl = document.getElementById('storm-volume-canvas-container');
    const closeBtn = document.getElementById('btn-close-storm-3d');

    if (!containerEl || !canvasContainerEl) return;

    if (closeBtn) {
        closeBtn.onclick = () => {
            hideStormVolume();
        };
    }

    if (renderer) return; // Already initialized

    // Scene & Camera
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100.0);
    camera.position.set(0.0, -1.8, 1.2);

    // Hardware WebGL2 Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Clamped for laptop performance
    canvasContainerEl.appendChild(renderer.domElement);

    // Orbit Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.8;
    controls.maxDistance = 5.0;
    controls.maxPolarAngle = Math.PI * 0.52; // Prevent flipping below ground
    controls.target.set(0.0, 0.0, 0.0);

    // Palette Transfer Function
    paletteTexture2D = createTransferFunctionTexture();

    // Volume Mesh (Unit Cube Base)
    const boxGeometry = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const volumeMaterial = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: vsVolume,
        fragmentShader: fsVolume,
        uniforms: {
            u_cameraPos: { value: new THREE.Vector3() },
            u_volumeTex: { value: null },
            u_paletteTex: { value: paletteTexture2D },
            u_boxSize: { value: new THREE.Vector3(1.0, 1.0, 0.5) },
            u_lightDir: { value: new THREE.Vector3(0.5, 0.8, 0.6).normalize() }
        },
        transparent: true,
        side: THREE.BackSide // Renders from inside-out for robust intersection
    });

    stormBoxMesh = new THREE.Mesh(boxGeometry, volumeMaterial);
    scene.add(stormBoxMesh);

    // Reference Ground Grid & Wireframe Box
    wireframeHelper = new THREE.BoxHelper(stormBoxMesh, 0x38bdf8);
    wireframeHelper.material.opacity = 0.35;
    wireframeHelper.material.transparent = true;
    scene.add(wireframeHelper);

    groundGridHelper = new THREE.GridHelper(1.0, 8, 0x38bdf8, 0x1e293b);
    groundGridHelper.rotation.x = Math.PI * 0.5;
    groundGridHelper.position.z = -0.25;
    scene.add(groundGridHelper);

    // Resize Observer
    const resizeObserver = new ResizeObserver(() => {
        handleResize();
    });
    resizeObserver.observe(canvasContainerEl);
}

function handleResize() {
    if (!renderer || !camera || !canvasContainerEl) return;
    const w = canvasContainerEl.clientWidth;
    const h = canvasContainerEl.clientHeight;
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
        // Update camera position uniform in object space
        stormBoxMesh.material.uniforms.u_cameraPos.value.copy(camera.position);
    }

    renderer.render(scene, camera);
}

/**
 * 🌟 Ingests the 1 MB Voxel Array from level2Worker and renders the storm cell
 */
export function updateStormVolume(voxelBuffer, bounds) {
    initStormVolumeViewer();
    if (!scene || !voxelBuffer) return;

    const [minLng, minLat, maxLng, maxLat] = bounds;

    // Calculate real-world spatial aspect ratio (Width km x Depth km x 20 km Height)
    const midLat = (minLat + maxLat) * 0.5;
    const widthKm = Math.abs(maxLng - minLng) * 111.32 * Math.cos(midLat * (Math.PI / 180.0));
    const depthKm = Math.abs(maxLat - minLat) * 111.32;
    const heightKm = 20.0; // 20 km standard storm cap

    const maxHoriz = Math.max(widthKm, depthKm, 10.0);
    const aspectX = widthKm / maxHoriz;
    const aspectY = depthKm / maxHoriz;
    const aspectZ = (heightKm / maxHoriz) * 0.7; // Vertical scale factor

    // Update geometry dimensions
    stormBoxMesh.scale.set(aspectX, aspectY, aspectZ);
    stormBoxMesh.material.uniforms.u_boxSize.value.set(aspectX, aspectY, aspectZ);

    wireframeHelper.update();
    groundGridHelper.scale.set(aspectX, aspectY, 1.0);
    groundGridHelper.position.z = -aspectZ * 0.5;

    // 🌟 Upload 1 MB (128 x 128 x 64) 3D Texture with Linear Filtering (Hardware Trilinear Smoothing)
    if (volumeTexture3D) {
        volumeTexture3D.dispose();
    }

    volumeTexture3D = new THREE.DataTexture3D(voxelBuffer, 128, 128, 64);
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

    showStormVolume();
}

export function showStormVolume() {
    if (!containerEl) containerEl = document.getElementById('storm-volume-container');
    if (containerEl) containerEl.style.display = 'flex';

    isViewerActive = true;
    stateManager.is3DVolumeActive = true;

    handleResize();

    if (!animationFrameId) {
        animate();
    }
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
