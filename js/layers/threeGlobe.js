// js/layers/threeGlobe.js
import { HEX_PALETTE } from '../shaders/scalarShader.js';

// 🌐 Lightweight (<400 KB total) 10m/50m Vector Line Datasets
const COUNTRY_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_boundary_lines_land.geojson';
const STATE_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces_lines.geojson';
const COASTLINES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_coastline.geojson';
const COUNTY_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_admin_2_counties.geojson';

let scene, camera, renderer, controls, globeMesh, material, paletteTex;
let globeChunkTextures = {}; // 🌟 Texture cache per chunk
let countyMesh = null;
let isGlobeActive = false;

const style = document.createElement('style');
style.textContent = `
    #globe-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2;
        touch-action: none !important;
        user-select: none !important;
        -webkit-user-select: none !important;
    }
    #globe-container canvas {
        display: block;
        width: 100% !important;
        height: 100% !important;
        touch-action: none !important;
        user-select: none !important;
        -webkit-user-select: none !important;
    }
`;
document.head.appendChild(style);

const vsThreeGlobe = `
    varying vec2 v_uv;
    varying vec3 v_normal;
    void main() {
        v_uv = uv;
        v_normal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fsThreeGlobe = `
    uniform sampler2D u_dataTexture;
    uniform sampler2D u_paletteTexture;
    uniform vec2 u_uvOffset;
    uniform vec2 u_uvScale;
    uniform float u_opacity;
    varying vec2 v_uv;
    varying vec3 v_normal;

    void main() {
        float latRad = (v_uv.y - 0.5) * 3.14159265359;

        // Clamps latitude bounds to ±85.0511° to fill polar cap smoothly
        float clampedLat = clamp(latRad, -1.4844, 1.4844);
        float mercY = log(tan(0.78539816339 + clampedLat / 2.0));
        float normY = clamp(0.5 - (mercY / (2.0 * 3.14159265359)), 0.0, 1.0);

        vec2 wrapped_uv = vec2(v_uv.x, normY);
        vec2 sprite_uv = u_uvOffset + wrapped_uv * u_uvScale;

        float rawVal = texture2D(u_dataTexture, sprite_uv).r;
        vec4 color = texture2D(u_paletteTexture, vec2(rawVal, 0.5));

        float intensity = pow(0.65 - dot(v_normal, vec3(0, 0, 1.0)), 2.0);
        vec3 atmosphere = vec3(0.2, 0.6, 1.0) * intensity;

        gl_FragColor = vec4(color.rgb + atmosphere * 0.2, color.a * u_opacity);
    }
`;

function createPaletteTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = HEX_PALETTE.length;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    HEX_PALETTE.forEach((hex, i) => {
        ctx.fillStyle = hex;
        ctx.fillRect(i, 0, 1, 1);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

function lngLatToVector3(lng, lat, radius = 2.003) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);

    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = (radius * Math.sin(phi) * Math.sin(theta));
    const y = (radius * Math.cos(phi));

    return new THREE.Vector3(x, y, z);
}

async function load3DVectorBorders(parentMesh) {
    const linePoints = [];
    const urls = [COUNTRY_BORDERS_URL, STATE_BORDERS_URL, COASTLINES_URL];

    const lineOffsets = [
        [0, 0],
        [0.005, 0],
        [-0.005, 0],
        [0, 0.005],
        [0, -0.005]
    ];

    for (const url of urls) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const data = await resp.json();

            data.features.forEach(feature => {
                const geom = feature.geometry;
                if (!geom) return;

                let lineStrings = [];
                if (geom.type === 'LineString') lineStrings = [geom.coordinates];
                else if (geom.type === 'MultiLineString') lineStrings = geom.coordinates;
                else if (geom.type === 'Polygon') lineStrings = geom.coordinates;
                else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly => poly.forEach(r => lineStrings.push(r)));

                lineStrings.forEach(coords => {
                    for (let i = 0; i < coords.length - 1; i++) {
                        const p1Base = coords[i];
                        const p2Base = coords[i+1];

                        if (Math.abs(p1Base[0] - p2Base[0]) > 180) continue;

                        lineOffsets.forEach(([dLng, dLat]) => {
                            const p1 = lngLatToVector3(p1Base[0] + dLng, p1Base[1] + dLat, 2.003);
                            const p2 = lngLatToVector3(p2Base[0] + dLng, p2Base[1] + dLat, 2.003);

                            linePoints.push(p1.x, p1.y, p1.z);
                            linePoints.push(p2.x, p2.y, p2.z);
                        });
                    }
                });
            });
        } catch (err) {
            console.warn("3D vector line load error:", err);
        }
    }

    if (linePoints.length > 0) {
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));

        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x000000,
            opacity: 0.95,
            transparent: true
        });

        const linesMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
        parentMesh.add(linesMesh);
    }

    load3DCountyBorders(parentMesh);
}

async function load3DCountyBorders(parentMesh) {
    try {
        const resp = await fetch(COUNTY_BORDERS_URL);
        if (!resp.ok) return;
        const data = await resp.json();

        const linePoints = [];

        data.features.forEach(feature => {
            const geom = feature.geometry;
            if (!geom) return;

            let lineStrings = [];
            if (geom.type === 'LineString') lineStrings = [geom.coordinates];
            else if (geom.type === 'MultiLineString') lineStrings = geom.coordinates;
            else if (geom.type === 'Polygon') lineStrings = geom.coordinates;
            else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly => poly.forEach(r => lineStrings.push(r)));

            lineStrings.forEach(coords => {
                for (let i = 0; i < coords.length - 1; i++) {
                    const p1Base = coords[i];
                    const p2Base = coords[i+1];

                    if (Math.abs(p1Base[0] - p2Base[0]) > 180) continue;

                    const p1 = lngLatToVector3(p1Base[0], p1Base[1], 2.004);
                    const p2 = lngLatToVector3(p2Base[0], p2Base[1], 2.004);

                    linePoints.push(p1.x, p1.y, p1.z);
                    linePoints.push(p2.x, p2.y, p2.z);
                }
            });
        });

        if (linePoints.length > 0) {
            const lineGeometry = new THREE.BufferGeometry();
            lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));

            const lineMaterial = new THREE.LineBasicMaterial({
                color: 0x000000,
                opacity: 0.55,
                transparent: true
            });

            countyMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
            countyMesh.visible = false;
            parentMesh.add(countyMesh);
        }
    } catch (err) {
        console.warn("County border load error:", err);
    }
}

export function initThreeGlobe() {
    const container = document.getElementById('globe-container');
    if (!container || scene) return;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 6);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.04;
    controls.zoomSpeed = 0.7;
    controls.minDistance = 2.8;
    controls.maxDistance = 12;

    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.08;
    controls.maxPolarAngle = Math.PI * 0.92;

    if (THREE.TOUCH) {
        controls.touches = {
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN
        };
    }

    paletteTex = createPaletteTexture();

    material = new THREE.ShaderMaterial({
        vertexShader: vsThreeGlobe,
        fragmentShader: fsThreeGlobe,
        uniforms: {
            u_dataTexture: { value: null },
            u_paletteTexture: { value: paletteTex },
            u_uvOffset: { value: new THREE.Vector2(0, 0) },
            u_uvScale: { value: new THREE.Vector2(1, 1) },
            u_opacity: { value: 0.85 }
        },
        transparent: true
    });

    const geometry = new THREE.SphereGeometry(2, 64, 64);
    globeMesh = new THREE.Mesh(geometry, material);
    
    globeMesh.rotation.y = -Math.PI / 2;
    scene.add(globeMesh);

    load3DVectorBorders(globeMesh);

    window.addEventListener('resize', () => {
        if (!renderer || !camera) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
        requestAnimationFrame(animate);
        if (isGlobeActive && controls && renderer && scene && globeMesh) {
            const dist = camera.position.distanceTo(globeMesh.position);

            const zoomRatio = Math.max(0, Math.min(1, (dist - controls.minDistance) / (controls.maxDistance - controls.minDistance)));
            controls.rotateSpeed = 0.12 + zoomRatio * 0.53;

            controls.update();

            if (countyMesh) {
                countyMesh.visible = (dist < 4.2);
            }

            renderer.render(scene, camera);
        }
    }
    animate();
}

/**
 * 🌟 0-LEAK TEXTURE CACHING: Reuses textures per chunk during fast scrubbing
 */
export function updateThreeGlobeFrame(frameState) {
    if (!material || !frameState || !frameState.chunkImg) return;

    const chunkIdx = frameState.chunkIndex;

    if (!globeChunkTextures[chunkIdx]) {
        const texture = new THREE.CanvasTexture(frameState.chunkImg);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        globeChunkTextures[chunkIdx] = texture;
    }

    material.uniforms.u_dataTexture.value = globeChunkTextures[chunkIdx];
    material.uniforms.u_uvOffset.value.set(frameState.uvOffset[0], frameState.uvOffset[1]);
    material.uniforms.u_uvScale.value.set(frameState.uvScale[0], frameState.uvScale[1]);
    material.needsUpdate = true;
}

/**
 * 🌟 Clears Three.js GPU VRAM textures when switching model runs
 */
export function clearThreeGlobeTextures() {
    for (const key in globeChunkTextures) {
        if (globeChunkTextures[key]) {
            globeChunkTextures[key].dispose();
        }
    }
    globeChunkTextures = {};
}

export function showThreeGlobe() {
    const container = document.getElementById('globe-container');
    const mapDiv = document.getElementById('map');
    if (container) container.style.display = 'block';
    if (mapDiv) mapDiv.style.display = 'none';
    isGlobeActive = true;
}

export function hideThreeGlobe() {
    const container = document.getElementById('globe-container');
    const mapDiv = document.getElementById('map');
    if (container) container.style.display = 'none';
    if (mapDiv) mapDiv.style.display = 'block';
    isGlobeActive = false;
}