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
let currentPole = 'north'; // 'north' | 'south'
let rawGeoJsonFeatures = [];

// Central meridians (North: -80°W puts North America upright; South: 0° standard)
const NORTH_CENTRAL_LON = -80.0 * (Math.PI / 180.0);
const SOUTH_CENTRAL_LON = 0.0 * (Math.PI / 180.0);

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
    .polar-pole-switcher {
        position: absolute;
        top: 62px;
        right: 16px;
        z-index: 28;
        display: flex;
        align-items: center;
        background: rgba(11, 15, 25, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        padding: 3px;
        gap: 3px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    }
    .pole-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-family: 'Rajdhani', sans-serif;
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 0.5px;
        padding: 5px 12px;
        border-radius: 16px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    .pole-btn:hover {
        color: #ffffff;
    }
    .pole-btn.active {
        background: rgba(56, 189, 248, 0.25);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.6);
        box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
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
    uniform float u_poleSign; // +1.0 for North, -1.0 for South
    varying vec2 v_pos;

    const float PI = 3.141592653589793;

    void main() {
        float r = length(v_pos);
        
        // Discard anything outside the Equator boundary ring
        if (r > 1.0) {
            discard;
        }

        // Exact Inverse Polar Stereographic Conformal Mapping
        float c = 2.0 * atan(r);
        float lat = u_poleSign * ((PI * 0.5) - c);
        
        float lon;
        if (u_poleSign > 0.0) {
            lon = u_centralLon + atan(v_pos.x, -v_pos.y);
        } else {
            lon = u_centralLon - atan(v_pos.x, v_pos.y);
        }

        // Normalize longitude into [-PI, PI]
        lon = mod(lon + PI, 2.0 * PI) - PI;

        float u = (lon + PI) / (2.0 * PI);
        float v = (PI * 0.5 - lat) / PI;

        vec2 sprite_uv = u_uvOffset + vec2(fract(u), clamp(v, 0.0, 1.0)) * u_uvScale;

        float rawVal = texture2D(u_dataTexture, sprite_uv).r;
        vec4 color = texture2D(u_paletteTexture, vec2(rawVal, 0.5));

        if (color.a == 0.0) {
            discard;
        }

        // Crisp outer circular border ring
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

function lngLatToPolarPlanar(lng, lat, isNorth = true) {
    if (isNorth && lat < 0.0) return null;
    if (!isNorth && lat > 0.0) return null;

    const phi = Math.abs(lat) * (Math.PI / 180.0);
    const lambda = lng * (Math.PI / 180.0);

    const c = (Math.PI * 0.5) - phi;
    const r = Math.tan(c * 0.5);

    let x, y;
    if (isNorth) {
        const deltaLambda = lambda - NORTH_CENTRAL_LON;
        x = r * Math.sin(deltaLambda);
        y = -r * Math.cos(deltaLambda);
    } else {
        const deltaLambda = lambda - SOUTH_CENTRAL_LON;
        x = -r * Math.sin(deltaLambda);
        y = -r * Math.cos(deltaLambda);
    }

    return new THREE.Vector3(x, y, 0.002);
}

function rebuildPolarGraticule(parentMesh) {
    if (graticuleMesh) {
        parentMesh.remove(graticuleMesh);
        if (graticuleMesh.geometry) graticuleMesh.geometry.dispose();
    }

    const lines = [];
    const isNorth = (currentPole === 'north');

    const latRings = [80, 60, 40, 20];
    latRings.forEach(latVal => {
        const c = (90 - latVal) * (Math.PI / 180.0);
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

    for (let deg = 0; deg < 360; deg += 30) {
        const pStart = lngLatToPolarPlanar(deg, isNorth ? 85 : -85, isNorth);
        const pEnd = lngLatToPolarPlanar(deg, 0, isNorth);
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

function rebuildVectorBorders(parentMesh) {
    if (vectorLinesMesh) {
        parentMesh.remove(vectorLinesMesh);
        if (vectorLinesMesh.geometry) vectorLinesMesh.geometry.dispose();
    }

    const linePoints = [];
    const isNorth = (currentPole === 'north');

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

                if (isNorth && (p1Base[1] < 0 || p2Base[1] < 0)) continue;
                if (!isNorth && (p1Base[1] > 0 || p2Base[1] > 0)) continue;
                if (Math.abs(p1Base[0] - p2Base[0]) > 180) continue;

                const pt1 = lngLatToPolarPlanar(p1Base[0], p1Base[1], isNorth);
                const pt2 = lngLatToPolarPlanar(p2Base[0], p2Base[1], isNorth);

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
            opacity: isDark ? 0.9 : 0.8,
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

function initPoleSwitcherUI(container) {
    let switcher = container.querySelector('.polar-pole-switcher');
    if (switcher) return;

    switcher = document.createElement('div');
    switcher.className = 'polar-pole-switcher';
    switcher.innerHTML = `
        <button class="pole-btn active" data-pole="north">❄️ North</button>
        <button class="pole-btn" data-pole="south">🧊 South</button>
    `;

    const buttons = switcher.querySelectorAll('.pole-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetPole = btn.getAttribute('data-pole');
            setHemisphere(targetPole);
        });
    });

    container.appendChild(switcher);
}

export function setHemisphere(pole) {
    currentPole = pole;
    const isNorth = (pole === 'north');

    if (material) {
        material.uniforms.u_poleSign.value = isNorth ? 1.0 : -1.0;
        material.uniforms.u_centralLon.value = isNorth ? NORTH_CENTRAL_LON : SOUTH_CENTRAL_LON;
        material.needsUpdate = true;
    }

    if (polarMesh) {
        rebuildPolarGraticule(polarMesh);
        rebuildVectorBorders(polarMesh);
    }

    console.log(`❄️ [Polar Map] Switched to ${isNorth ? 'North Pole (Arctic)' : 'South Pole (Antarctic)'}`);
}

/**
 * 🌟 TROPICAL TIDBITS AUTO-FIT SCREEN FRAMING
 * Calculates exact orthographic bounds to make the polar map fill the viewport
 */
export function fitCameraToScreen() {
    if (!camera || !renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;

    // Framed target size: fills mobile height/width edge-to-edge
    const targetSize = (w < 768) ? 2.05 : 2.12;
    
    let halfW, halfH;
    if (aspect >= 1.0) {
        halfH = targetSize / 2;
        halfW = halfH * aspect;
    } else {
        halfW = targetSize / 2;
        halfH = halfW / aspect;
    }

    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();

    // Center between top nav (50px) and bottom timeline (80px)
    const yOffset = ((50 - 75) / h) * halfH;
    camera.position.set(0, yOffset, 10);
    if (controls) {
        controls.target.set(0, yOffset, 0);
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

    initPoleSwitcherUI(container);

    if (scene) return;

    scene = new THREE.Scene();
    
    // 🌟 2D Orthographic Camera for Tropical Tidbits Style Screen-Fitting
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    
    // Free 2D Pan, Zoom & Screen-Space Rotation
    controls.enableRotate = true;
    controls.rotateSpeed = 0.7;
    controls.enablePan = true;
    controls.panSpeed = 1.0;
    controls.screenSpacePanning = true;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.9;
    controls.minZoom = 0.7;
    controls.maxZoom = 8.0;

    if (THREE.TOUCH) {
        controls.touches = {
            ONE: THREE.TOUCH.PAN,
            TWO: THREE.TOUCH.DOLLY_ROTATE
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
            u_centralLon: { value: NORTH_CENTRAL_LON },
            u_poleSign: { value: 1.0 }
        },
        transparent: true
    });

    const geometry = new THREE.PlaneGeometry(2.0, 2.0, 1, 1);
    polarMesh = new THREE.Mesh(geometry, material);
    scene.add(polarMesh);

    rebuildPolarGraticule(polarMesh);
    loadPolarVectorData(polarMesh);

    fitCameraToScreen();

    window.addEventListener('resize', () => {
        if (!renderer || !camera) return;
        renderer.setSize(window.innerWidth, window.innerHeight);
        fitCameraToScreen();
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
    fitCameraToScreen();
}

export function hidePolarMap() {
    const container = document.getElementById('polar-container');
    if (container) container.style.display = 'none';
    isPolarActive = false;
}
