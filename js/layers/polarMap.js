// js/layers/polarMap.js
import { getPaletteForParameter as getLightPalette, TEMP_PALETTE, PRECIP_PALETTE } from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

// 🌐 Natural Earth Vector Datasets
const COUNTRY_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_boundary_lines_land.geojson';
const STATE_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces_lines.geojson';
const COASTLINES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_coastline.geojson';

let scene, camera, renderer, controls, polarMesh, material, paletteTex;
let polarChunkTextures = {};
let isPolarActive = false;
let vectorLinesMesh = null;
let graticuleMesh = null;

// Central meridian (standard -80°W puts North America upright)
const CENTRAL_LON_RAD = -80.0 * (Math.PI / 180.0);

const style = document.createElement('style');
style.textContent = `
    #polar-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2;
        touch-action: none !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        background: #050a15;
    }
    #polar-container canvas {
        display: block;
        width: 100% !important;
        height: 100% !important;
        touch-action: none !important;
        user-select: none !important;
        -webkit-user-select: none !important;
    }
`;
document.head.appendChild(style);

const vsPolar = `
    varying vec2 v_pos;
    void main() {
        v_pos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fsPolar = `
    precision highp float;
    uniform sampler2D u_dataTexture;
    uniform sampler2D u_paletteTexture;
    uniform vec2 u_uvOffset;
    uniform vec2 u_uvScale;
    uniform float u_opacity;
    uniform float u_centralLon;
    varying vec2 v_pos;

    const float PI = 3.141592653589793;

    void main() {
        float r = length(v_pos);
        
        // Discard anything outside the Equator boundary ring
        if (r > 1.0) {
            discard;
        }

        // Exact Inverse Polar Stereographic Conformal Mapping
        float c = 2.0 * atan(r); // Angular distance from North Pole
        float lat = (PI * 0.5) - c;
        float lon = u_centralLon + atan(v_pos.x, -v_pos.y);

        // Normalize longitude into [-PI, PI]
        lon = mod(lon + PI, 2.0 * PI) - PI;

        float u = (lon + PI) / (2.0 * PI);
        float v = c / PI; // 0.0 at North Pole (90N), 0.5 at Equator (0N)

        vec2 sprite_uv = u_uvOffset + vec2(fract(u), clamp(v, 0.0, 1.0)) * u_uvScale;

        float rawVal = texture2D(u_dataTexture, sprite_uv).r;
        vec4 color = texture2D(u_paletteTexture, vec2(rawVal, 0.5));

        // Discard transparent values (e.g. 0.00" dry land in precip)
        if (color.a == 0.0) {
            discard;
        }

        // Luminous outer boundary border ring
        if (r > 0.993) {
            gl_FragColor = vec4(0.22, 0.74, 0.97, 0.95);
            return;
        }

        gl_FragColor = vec4(color.rgb, color.a * u_opacity);
    }
`;

function createPaletteTexture(paletteHexArray = TEMP_PALETTE) {
    const canvas = document.createElement('canvas');
    canvas.width = paletteHexArray.length;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const isPrecip = (stateManager.activeParam === 'tp' || stateManager.activeShader === 'precip');

    paletteHexArray.forEach((hex, i) => {
        if (isPrecip && i === 0) {
            ctx.clearRect(i, 0, 1, 1);
        } else {
            ctx.fillStyle = hex;
            ctx.fillRect(i, 0, 1, 1);
        }
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

/**
 * 🌟 Forward Polar Stereographic Coordinate Projection
 */
function lngLatToPolarPlanar(lng, lat) {
    if (lat < 0.0) return null; // Northern Hemisphere only
    const phi = lat * (Math.PI / 180.0);
    const lambda = lng * (Math.PI / 180.0);

    const c = (Math.PI * 0.5) - phi;
    const r = Math.tan(c * 0.5); // Conformal stereographic radial formula
    const deltaLambda = lambda - CENTRAL_LON_RAD;

    const x = r * Math.sin(deltaLambda);
    const y = -r * Math.cos(deltaLambda);

    return new THREE.Vector3(x, y, 0.002); // Slightly above data plane
}

/**
 * 🌟 Polar Graticule (Concentric Latitude Rings & Radial Meridian Spokes)
 */
function createPolarGraticule(parentMesh) {
    const lines = [];

    // 1. Concentric Latitude Rings (80°N, 60°N, 40°N, 20°N)
    const latRings = [80, 60, 40, 20];
    latRings.forEach(lat => {
        const c = (90 - lat) * (Math.PI / 180.0);
        const r = Math.tan(c * 0.5);
        const segments = 128;
        for (let i = 0; i < segments; i++) {
            const theta1 = (i / segments) * Math.PI * 2;
            const theta2 = ((i + 1) / segments) * Math.PI * 2;
            lines.push(
                r * Math.cos(theta1), r * Math.sin(theta1), 0.003,
                r * Math.cos(theta2), r * Math.sin(theta2), 0.003
            );
        }
    });

    // 2. Radial Longitude Spokes (every 30°)
    for (let deg = 0; deg < 360; deg += 30) {
        const pStart = lngLatToPolarPlanar(deg, 85);
        const pEnd = lngLatToPolarPlanar(deg, 0);
        if (pStart && pEnd) {
            lines.push(pStart.x, pStart.y, 0.003, pEnd.x, pEnd.y, 0.003);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));

    const material = new THREE.LineBasicMaterial({
        color: 0x64748b,
        opacity: 0.35,
        transparent: true
    });

    graticuleMesh = new THREE.LineSegments(geometry, material);
    parentMesh.add(graticuleMesh);
}

async function loadPolarVectorBorders(parentMesh) {
    const linePoints = [];
    const urls = [COUNTRY_BORDERS_URL, STATE_BORDERS_URL, COASTLINES_URL];

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
                        const p2Base = coords[i + 1];

                        // Skip Southern Hemisphere points
                        if (p1Base[1] < 0 || p2Base[1] < 0) continue;
                        if (Math.abs(p1Base[0] - p2Base[0]) > 180) continue;

                        const pt1 = lngLatToPolarPlanar(p1Base[0], p1Base[1]);
                        const pt2 = lngLatToPolarPlanar(p2Base[0], p2Base[1]);

                        if (pt1 && pt2) {
                            linePoints.push(pt1.x, pt1.y, pt1.z);
                            linePoints.push(pt2.x, pt2.y, pt2.z);
                        }
                    }
                });
            });
        } catch (err) {
            console.warn("Polar vector line load error:", err);
        }
    }

    if (linePoints.length > 0) {
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));

        const isDark = (stateManager.currentTheme === 'dark');
        const lineMaterial = new THREE.LineBasicMaterial({
            color: isDark ? 0xffffff : 0x000000,
            opacity: isDark ? 0.9 : 0.8,
            transparent: true
        });

        vectorLinesMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
        parentMesh.add(vectorLinesMesh);
    }
}

export function initPolarMap() {
    let container = document.getElementById('polar-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'polar-container';
        container.style.display = 'none';
        document.body.appendChild(container);
    }
    if (scene) return;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 3.2);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    
    // 🌟 Pure 2D Planar Navigation (No 3D tilting)
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.panSpeed = 1.0;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 0.8;
    controls.maxDistance = 5.5;

    // Theme-aware initial palette
    const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
    const initialPalette = paletteFunc(stateManager.activeParam || '2t');
    paletteTex = createPaletteTexture(initialPalette);

    material = new THREE.ShaderMaterial({
        vertexShader: vsPolar,
        fragmentShader: fsPolar,
        uniforms: {
            u_dataTexture: { value: null },
            u_paletteTexture: { value: paletteTex },
            u_uvOffset: { value: new THREE.Vector2(0, 0) },
            u_uvScale: { value: new THREE.Vector2(1, 1) },
            u_opacity: { value: 0.88 },
            u_centralLon: { value: CENTRAL_LON_RAD }
        },
        transparent: true
    });

    // Planar 2D Quad representing the Polar Stereographic disk
    const geometry = new THREE.PlaneGeometry(2.0, 2.0, 1, 1);
    polarMesh = new THREE.Mesh(geometry, material);
    scene.add(polarMesh);

    createPolarGraticule(polarMesh);
    loadPolarVectorBorders(polarMesh);

    window.addEventListener('resize', () => {
        if (!renderer || !camera) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
        requestAnimationFrame(animate);
        if (isPolarActive && controls && renderer && scene) {
            controls.update();
            renderer.render(scene, camera);
        }
    }
    animate();
}

/**
 * 🌟 Dynamic Palette Swap for Polar Map
 */
export function updatePolarPalette(paramIdOrHexArray) {
    if (!material) return;
    let hexArray;
    if (Array.isArray(paramIdOrHexArray)) {
        hexArray = paramIdOrHexArray;
    } else {
        const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
        hexArray = paletteFunc(paramIdOrHexArray || stateManager.activeParam);
    }

    if (paletteTex) {
        paletteTex.dispose();
    }
    paletteTex = createPaletteTexture(hexArray);
    material.uniforms.u_paletteTexture.value = paletteTex;
    material.needsUpdate = true;

    // Update vector borders line color
    if (vectorLinesMesh && vectorLinesMesh.material) {
        const isDark = (stateManager.currentTheme === 'dark');
        vectorLinesMesh.material.color.setHex(isDark ? 0xffffff : 0x000000);
    }
}

export function updatePolarFrame(frameState) {
    if (!material || !frameState || !frameState.chunkImg) return;

    const chunkIdx = frameState.chunkIndex;
    const source = frameState.chunkImg;

    if (!polarChunkTextures[chunkIdx]) {
        let texture;
        if (source.data && source.width && source.height) {
            texture = new THREE.DataTexture(
                source.data,
                source.width,
                source.height,
                THREE.LuminanceFormat,
                THREE.UnsignedByteType
            );
            texture.needsUpdate = true;
        } else {
            texture = new THREE.CanvasTexture(source);
        }
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        polarChunkTextures[chunkIdx] = texture;
    }

    material.uniforms.u_dataTexture.value = polarChunkTextures[chunkIdx];
    material.uniforms.u_uvOffset.value.set(frameState.uvOffset[0], frameState.uvOffset[1]);
    material.uniforms.u_uvScale.value.set(frameState.uvScale[0], frameState.uvScale[1]);
    material.needsUpdate = true;
}

export function clearPolarTextures() {
    for (const key in polarChunkTextures) {
        if (polarChunkTextures[key]) {
            polarChunkTextures[key].dispose();
        }
    }
    polarChunkTextures = {};
}

export function showPolarMap() {
    const container = document.getElementById('polar-container');
    const globeContainer = document.getElementById('globe-container');
    const mapDiv = document.getElementById('map');

    if (container) container.style.display = 'block';
    if (globeContainer) globeContainer.style.display = 'none';
    if (mapDiv) mapDiv.style.display = 'none';

    isPolarActive = true;
    if (controls) {
        controls.target.set(0, 0, 0);
        camera.position.set(0, 0, 3.2);
        controls.update();
    }
}

export function hidePolarMap() {
    const container = document.getElementById('polar-container');
    if (container) container.style.display = 'none';
    isPolarActive = false;
}
