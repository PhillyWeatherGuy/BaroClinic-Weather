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
let rawGeoJsonFeatures = [];

// 🌟 Central meridian (-95°W aligns North America straight up like Tropical Tidbits)
const CENTRAL_LON_RAD = -95.0 * (Math.PI / 180.0);

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
        background: #121212;
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
        // Position relative to North Pole at (0.0, 0.0)
        float r = length(v_pos);

        // Discard far deep into Southern Hemisphere where projection diverges
        if (r > 1.8) {
            discard;
        }

        // 🌟 Exact Conformal Inverse Polar Stereographic Formula
        float c = 2.0 * atan(r); // Angular distance from North Pole
        float lat = (PI * 0.5) - c;
        float lon = u_centralLon + atan(v_pos.x, -v_pos.y);

        // Normalize longitude into [-PI, PI]
        lon = mod(lon + PI, 2.0 * PI) - PI;

        float u = (lon + PI) / (2.0 * PI);
        float v = c / PI; // 0.0 at 90N (Pole), 0.5 at 0N (Equator)

        vec2 sprite_uv = u_uvOffset + vec2(fract(u), clamp(v, 0.0, 1.0)) * u_uvScale;

        float rawVal = texture2D(u_dataTexture, sprite_uv).r;
        vec4 color = texture2D(u_paletteTexture, vec2(rawVal, 0.5));

        if (color.a == 0.0) {
            discard;
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
    if (lat < -15.0) return null; // Cover down past the equator

    const phi = lat * (Math.PI / 180.0);
    const lambda = lng * (Math.PI / 180.0);

    const c = (Math.PI * 0.5) - phi;
    const r = Math.tan(c * 0.5); // Conformal stereographic radius

    const deltaLambda = lambda - CENTRAL_LON_RAD;
    const x = r * Math.sin(deltaLambda);
    const y = -r * Math.cos(deltaLambda);

    return new THREE.Vector3(x, y, 0.002);
}

/**
 * 🌟 Synoptic Graticule (Curved Latitude Arcs & Converging Meridians)
 */
function buildSynopticGraticule(parentMesh) {
    if (graticuleMesh) {
        parentMesh.remove(graticuleMesh);
        if (graticuleMesh.geometry) graticuleMesh.geometry.dispose();
    }

    const lines = [];

    // 1. Concentric Latitude Arcs (10°N to 80°N every 10°)
    for (let lat = 10; lat <= 80; lat += 10) {
        const c = (90 - lat) * (Math.PI / 180.0);
        const r = Math.tan(c * 0.5);
        const segments = 256;
        for (let i = 0; i < segments; i++) {
            const theta1 = (i / segments) * Math.PI * 2;
            const theta2 = ((i + 1) / segments) * Math.PI * 2;
            lines.push(
                r * Math.cos(theta1), r * Math.sin(theta1), 0.003,
                r * Math.cos(theta2), r * Math.sin(theta2), 0.003
            );
        }
    }

    // 2. Converging Longitude Lines (every 20°)
    for (let deg = 0; deg < 360; deg += 20) {
        const pStart = lngLatToPolarPlanar(deg, 85);
        const pEnd = lngLatToPolarPlanar(deg, 5);
        if (pStart && pEnd) {
            lines.push(pStart.x, pStart.y, 0.003, pEnd.x, pEnd.y, 0.003);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));

    const material = new THREE.LineBasicMaterial({
        color: 0x475569,
        opacity: 0.45,
        transparent: true
    });

    graticuleMesh = new THREE.LineSegments(geometry, material);
    parentMesh.add(graticuleMesh);
}

function rebuildVectorBorders(parentMesh) {
    if (vectorLinesMesh) {
        parentMesh.remove(vectorLinesMesh);
        if (vectorLinesMesh.geometry) vectorLinesMesh.geometry.dispose();
    }

    const linePoints = [];

    rawGeoJsonFeatures.forEach(feature => {
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

                if (p1Base[1] < -10 || p2Base[1] < -10) continue;
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

    if (linePoints.length > 0) {
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));

        const isDark = (stateManager.currentTheme === 'dark');
        const lineMaterial = new THREE.LineBasicMaterial({
            color: isDark ? 0xffffff : 0x000000,
            opacity: isDark ? 0.95 : 0.85,
            transparent: true
        });

        vectorLinesMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
        parentMesh.add(vectorLinesMesh);
    }
}

async function loadPolarVectorData(parentMesh) {
    const urls = [COUNTRY_BORDERS_URL, STATE_BORDERS_URL, COASTLINES_URL];
    rawGeoJsonFeatures = [];

    for (const url of urls) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const data = await resp.json();
            if (data && data.features) {
                rawGeoJsonFeatures.push(...data.features);
            }
        } catch (err) {
            console.warn("Polar vector line load error:", err);
        }
    }

    rebuildVectorBorders(parentMesh);
}

/**
 * 🌟 TROPICAL TIDBITS SECTOR FRAMING (CONUS & North American Synoptic View)
 */
export function fitSynopticSector() {
    if (!camera || !renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;

    // Synoptic Sector Bounds: North America centered with Pole toward top
    const sectorHeight = 1.35;
    const sectorWidth = sectorHeight * aspect;

    camera.left = -sectorWidth / 2;
    camera.right = sectorWidth / 2;
    camera.top = sectorHeight / 2;
    camera.bottom = -sectorHeight / 2;
    camera.updateProjectionMatrix();

    // Center on North America (y ~ -0.45 places CONUS in the middle)
    const targetY = -0.45;
    camera.position.set(0, targetY, 10);
    if (controls) {
        controls.target.set(0, targetY, 0);
        controls.update();
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
    
    // 🌟 Flat 2D Orthographic Camera
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, -0.45, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    
    // Free 2D Pan & Zoom (No 3D tilt, exactly like Tropical Tidbits)
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.panSpeed = 1.0;
    controls.screenSpacePanning = true;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.9;
    controls.minZoom = 0.5;
    controls.maxZoom = 6.0;

    if (THREE.TOUCH) {
        controls.touches = {
            ONE: THREE.TOUCH.PAN,
            TWO: THREE.TOUCH.DOLLY_PAN
        };
    }

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

    // Full 4x4 Plane Quad covering the entire synoptic hemisphere
    const geometry = new THREE.PlaneGeometry(4.0, 4.0, 1, 1);
    polarMesh = new THREE.Mesh(geometry, material);
    scene.add(polarMesh);

    buildSynopticGraticule(polarMesh);
    loadPolarVectorData(polarMesh);

    fitSynopticSector();

    window.addEventListener('resize', () => {
        if (!renderer || !camera) return;
        renderer.setSize(window.innerWidth, window.innerHeight);
        fitSynopticSector();
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

    if (polarMesh) {
        rebuildVectorBorders(polarMesh);
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
    fitSynopticSector();
}

export function hidePolarMap() {
    const container = document.getElementById('polar-container');
    if (container) container.style.display = 'none';
    isPolarActive = false;
}
