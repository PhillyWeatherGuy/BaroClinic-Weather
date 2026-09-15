// js/layers/stormVolume3D.js
import { WXTOOLS_PALETTE_256 } from '../config/radarPalettes.js';
import { stateManager } from '../core/stateManager.js';

let scene, camera, renderer, controls;
let containerEl, canvasContainerEl;
let stackedPlanesGroup, wireframeHelper, groundGridHelper;
let paletteTexture2D = null;
let isViewerActive = false;
let animationFrameId = null;

// Vertex Shader for 3D Stacked Tilt Planes
const vsSlicePlane = `
    varying vec2 v_uv;
    void main() {
        v_uv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

// Fragment Shader with 100% Raw Pixel Nearest Mapping (Zero Smoothing)
const fsSlicePlane = `
    precision highp float;
    uniform sampler2D u_dataTex;
    uniform sampler2D u_paletteTex;
    varying vec2 v_uv;

    void main() {
        // v_uv.y inverted so North aligns with -Z (Top of map)
        vec2 sampleUv = vec2(v_uv.x, 1.0 - v_uv.y);
        float rawVal = texture2D(u_dataTex, sampleUv).r;

        // Discard clear-air noise (< 10 dBZ / byte 65)
        if (rawVal < (65.0 / 255.0)) {
            discard;
        }

        // Discrete 256-color palette lookup (Zero color blending)
        vec4 color = texture2D(u_paletteTex, vec2(rawVal, 0.5));

        if (color.a < 0.01) {
            discard;
        }

        // 100% solid, crisp radar pixel
        gl_FragColor = vec4(color.rgb, 1.0);
    }
`;

/**
 * 🌟 Creates 256x1 Raw Discrete Palette Texture
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

        // Byte < 65 is clear air (0 opacity), everything else is 100% solid
        imgData.data[idx + 3] = (i < 65) ? 0 : 255;
    }

    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
}

/**
 * 🌟 Initializes the Three.js 3D Viewer
 */
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
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100.0);
    camera.position.set(0.0, 1.3, 1.9);

    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    canvasContainerEl.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.4;
    controls.maxDistance = 5.0;
    controls.maxPolarAngle = Math.PI * 0.49; // Stay above ground plane
    controls.target.set(0.0, 0.0, 0.0);

    paletteTexture2D = createRadarPaletteTexture();

    stackedPlanesGroup = new THREE.Group();
    scene.add(stackedPlanesGroup);

    // Bounding Box Helper (Wireframe)
    const boxGeometry = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const boxMaterial = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, opacity: 0.35, transparent: true });
    wireframeHelper = new THREE.Mesh(boxGeometry, boxMaterial);
    scene.add(wireframeHelper);

    // Ground Grid Helper
    groundGridHelper = new THREE.GridHelper(1.0, 8, 0x38bdf8, 0x1e293b);
    groundGridHelper.position.y = -0.5;
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
    renderer.render(scene, camera);
}

/**
 * 🌟 Renders the Stacked Tilt Planes with 100% Raw Pixel Fidelity
 */
export function updateStormVolume(slicesOrBuffer, bounds) {
    initStormVolumeViewer();
    if (!scene) return;

    const minLng = Math.min(bounds[0], bounds[2]);
    const maxLng = Math.max(bounds[0], bounds[2]);
    const minLat = Math.min(bounds[1], bounds[3]);
    const maxLat = Math.max(bounds[1], bounds[3]);

    const midLat = (minLat + maxLat) * 0.5;
    const widthKm = Math.abs(maxLng - minLng) * 111.32 * Math.cos(midLat * (Math.PI / 180.0));
    const depthKm = Math.abs(maxLat - minLat) * 111.32;
    const heightKm = 20.0;

    const maxHoriz = Math.max(widthKm, depthKm, 10.0);
    const aspectX = widthKm / maxHoriz;
    const aspectY = (heightKm / maxHoriz) * 0.9;
    const aspectZ = depthKm / maxHoriz;

    wireframeHelper.scale.set(aspectX, aspectY, aspectZ);
    groundGridHelper.scale.set(aspectX, 1.0, aspectZ);
    groundGridHelper.position.y = -aspectY * 0.5;

    // Clear previous plane meshes and textures
    while (stackedPlanesGroup.children.length > 0) {
        const mesh = stackedPlanesGroup.children[0];
        if (mesh.material) {
            if (mesh.material.uniforms?.u_dataTex?.value) {
                mesh.material.uniforms.u_dataTex.value.dispose();
            }
            mesh.material.dispose();
        }
        if (mesh.geometry) mesh.geometry.dispose();
        stackedPlanesGroup.remove(mesh);
    }

    const slices = Array.isArray(slicesOrBuffer) ? slicesOrBuffer : [];
    const planeGeom = new THREE.PlaneGeometry(aspectX, aspectZ);

    slices.forEach((slice) => {
        if (!slice.data) return;

        const size = Math.round(Math.sqrt(slice.data.length)) || 128;

        // 🌟 Raw Pixel Nearest-Filtering (No smoothing, 100% raw data)
        const dataTex = new THREE.DataTexture(
            slice.data,
            size,
            size,
            THREE.LuminanceFormat || THREE.RedFormat,
            THREE.UnsignedByteType
        );
        dataTex.minFilter = THREE.NearestFilter;
        dataTex.magFilter = THREE.NearestFilter;
        dataTex.generateMipmaps = false;
        dataTex.unpackAlignment = 1;
        dataTex.needsUpdate = true;

        const sliceMat = new THREE.ShaderMaterial({
            vertexShader: vsSlicePlane,
            fragmentShader: fsSlicePlane,
            uniforms: {
                u_dataTex: { value: dataTex },
                u_paletteTex: { value: paletteTexture2D }
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const planeMesh = new THREE.Mesh(planeGeom, sliceMat);
        planeMesh.rotation.x = -Math.PI * 0.5; // Lie flat in horizontal X-Z plane

        // Map physical altitude (0 to 20,000 meters) to vertical Y axis
        const altNorm = Math.min(1.0, Math.max(0.0, slice.altitudeMeters / 20000.0));
        const yPos = (altNorm * aspectY) - (aspectY * 0.5);
        planeMesh.position.set(0.0, yPos, 0.0);

        stackedPlanesGroup.add(planeMesh);
    });

    console.log(`⚡ [3D Viewer] Mounted ${slices.length} raw pixel radar tilts in 3D space.`);

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
