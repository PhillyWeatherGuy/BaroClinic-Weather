// js/layers/polarMap.js
import { getPaletteForParameter as getLightPalette, TEMP_PALETTE, PRECIP_PALETTE } from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

// 🌐 Natural Earth Vector Datasets
const COUNTRY_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_boundary_lines_land.geojson';
const STATE_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces_lines.geojson';
const COASTLINES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_coastline.geojson';

let scene, camera, renderer, polarMesh, material, paletteTex;
let polarChunkTextures = {};
let isPolarActive = false;
let vectorLinesMesh = null;
let graticuleMesh = null;
let rawGeoJsonFeatures = [];

// Map State
let currentPole = 'north'; // 'north' | 'south'
let mapRotation = 0.0;     // Radians (around Pole at 0,0)
let mapTargetY = -0.45;
let mapTargetX = 0.0;
let mapZoom = 1.0;

// Central meridians
const NORTH_CENTRAL_LON = -95.0 * (Math.PI / 180.0);
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
        background: #121212;
    }
    #polar-container canvas {
        display: block;
        width: 100% !important;
        height: 100% !important;
        touch-action: none !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        cursor: grab;
    }
    #polar-container canvas:active {
        cursor: grabbing;
    }
    .polar-top-controls {
        position: absolute;
        top: 62px;
        right: 16px;
        z-index: 28;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: nowrap;
    }
    .polar-compass-btn {
        background: rgba(11, 15, 25, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #38bdf8;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        transition: all 0.2s ease;
        flex-shrink: 0;
    }
    .polar-compass-btn svg {
        transition: transform 0.1s linear;
    }
    /* Hidden on Mobile by default */
    .polar-rot-capsule {
        display: none;
        align-items: center;
        background: rgba(11, 15, 25, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        padding: 4px 8px;
        gap: 6px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    }
    @media (min-width: 1024px) {
        .polar-rot-capsule {
            display: flex;
        }
    }
    .rot-nudge-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 13px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.15s ease;
    }
    .rot-nudge-btn:hover {
        color: #38bdf8;
    }
    #polar-rot-slider {
        width: 70px;
        accent-color: #38bdf8;
        cursor: pointer;
        height: 4px;
        appearance: none;
        -webkit-appearance: none;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 2px;
        outline: none;
    }
    #polar-rot-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #38bdf8;
        cursor: pointer;
        box-shadow: 0 0 6px rgba(56, 189, 248, 0.8);
    }
    .polar-pole-switcher {
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
        flex-shrink: 0;
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
    uniform float u_poleSign;
    varying vec2 v_pos;

    const float PI = 3.141592653589793;

    void main() {
        float r = length(v_pos);

        if (r > 1.8) {
            discard;
        }

        // Exact Inverse Polar Stereographic Conformal Formula
        float c = 2.0 * atan(r);
        float lat = u_poleSign * ((PI * 0.5) - c);
        
        float lon;
        if (u_poleSign > 0.0) {
            lon = u_centralLon + atan(v_pos.x, -v_pos.y);
        } else {
            lon = u_centralLon - atan(v_pos.x, v_pos.y);
        }

        lon = mod(lon + PI, 2.0 * PI) - PI;

        float u = (lon + PI) / (2.0 * PI);
        float v = (PI * 0.5 - lat) / PI;

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

function lngLatToPolarPlanar(lng, lat, isNorth = true) {
    if (isNorth && lat < -15.0) return null;
    if (!isNorth && lat > 15.0) return null;

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

    for (let deg = 0; deg < 360; deg += 20) {
        const pStart = lngLatToPolarPlanar(deg, isNorth ? 85 : -85, isNorth);
        const pEnd = lngLatToPolarPlanar(deg, isNorth ? 5 : -5, isNorth);
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

                if (isNorth && (p1Base[1] < -10 || p2Base[1] < -10)) continue;
                if (!isNorth && (p1Base[1] > 10 || p2Base[1] > 10)) continue;
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

function initPolarUI(container) {
    let topControls = container.querySelector('.polar-top-controls');
    if (topControls) return;

    topControls = document.createElement('div');
    topControls.className = 'polar-top-controls';
    topControls.innerHTML = `
        <button id="btn-polar-compass" class="polar-compass-btn" title="Reset Orientation (North Up)">
            <svg id="polar-compass-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12 2 15 11 12 9 9 11 12 2" fill="#ef4444"/>
                <polygon points="12 22 15 13 12 15 9 13 12 22" fill="#94a3b8"/>
            </svg>
        </button>

        <!-- 🌟 Desktop Rotation Capsule -->
        <div class="polar-rot-capsule" title="Rotate Map Around Pole">
            <button class="rot-nudge-btn" id="btn-rot-left" title="Rotate Left">⟲</button>
            <input id="polar-rot-slider" type="range" min="0" max="360" value="0" step="1">
            <button class="rot-nudge-btn" id="btn-rot-right" title="Rotate Right">⟳</button>
        </div>

        <div class="polar-pole-switcher">
            <button class="pole-btn active" data-pole="north">❄️ North</button>
            <button class="pole-btn" data-pole="south">🧊 South</button>
        </div>
    `;

    const compassBtn = topControls.querySelector('#btn-polar-compass');
    if (compassBtn) {
        compassBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            resetRotation();
        });
    }

    const rotSlider = topControls.querySelector('#polar-rot-slider');
    if (rotSlider) {
        rotSlider.addEventListener('input', (e) => {
            setRotationDegrees(parseFloat(e.target.value));
        });
    }

    const btnRotLeft = topControls.querySelector('#btn-rot-left');
    if (btnRotLeft) {
        btnRotLeft.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentDeg = (THREE.MathUtils.radToDeg(mapRotation) % 360 + 360) % 360;
            setRotationDegrees(currentDeg - 15);
        });
    }

    const btnRotRight = topControls.querySelector('#btn-rot-right');
    if (btnRotRight) {
        btnRotRight.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentDeg = (THREE.MathUtils.radToDeg(mapRotation) % 360 + 360) % 360;
            setRotationDegrees(currentDeg + 15);
        });
    }

    const poleButtons = topControls.querySelectorAll('.pole-btn');
    poleButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            poleButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetPole = btn.getAttribute('data-pole');
            setHemisphere(targetPole);
        });
    });

    container.appendChild(topControls);
}

function updateCompassUI() {
    const icon = document.getElementById('polar-compass-icon');
    if (icon) {
        icon.style.transform = `rotate(${-mapRotation}rad)`;
    }

    const slider = document.getElementById('polar-rot-slider');
    if (slider) {
        const deg = (THREE.MathUtils.radToDeg(mapRotation) % 360 + 360) % 360;
        slider.value = Math.round(deg);
    }
}

export function setRotationDegrees(deg) {
    const normalizedDeg = (deg % 360 + 360) % 360;
    mapRotation = THREE.MathUtils.degToRad(normalizedDeg);
    if (polarMesh) {
        polarMesh.rotation.z = mapRotation;
    }
    updateCompassUI();
}

export function resetRotation() {
    setRotationDegrees(0);
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

    fitSynopticSector();
}

export function fitSynopticSector() {
    if (!camera || !renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;

    const sectorHeight = (w < 768) ? 1.45 : 1.35;
    const sectorWidth = sectorHeight * aspect;

    camera.left = -sectorWidth / 2;
    camera.right = sectorWidth / 2;
    camera.top = sectorHeight / 2;
    camera.bottom = -sectorHeight / 2;
    camera.zoom = 1.0;
    mapZoom = 1.0;

    mapTargetX = 0.0;
    mapTargetY = (currentPole === 'north') ? -0.45 : -0.20;
    mapRotation = 0.0;

    if (polarMesh) polarMesh.rotation.z = 0.0;

    camera.position.set(0.0, mapTargetY, 10);
    camera.rotation.z = 0;
    camera.updateProjectionMatrix();
    updateCompassUI();
}

/**
 * 🌟 UNIFIED 2D PLANAR GESTURE CONTROLLER (Desktop & Mobile: Horizontal Drag = Rotate, Vertical Drag = North/South)
 */
function init2DMapControls(canvas) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialTouchDist = 0;

    // Desktop Mouse Handlers
    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;

        const h = window.innerHeight;
        const visibleHeight = (camera.top - camera.bottom) / camera.zoom;
        const unitsPerPixel = visibleHeight / h;

        // 🌟 1. Horizontal Drag (dx) strictly ROTATES around the Pole (0, 0)
        mapRotation += dx * 0.004;
        if (polarMesh) {
            polarMesh.rotation.z = mapRotation;
        }
        updateCompassUI();

        // 🌟 2. Vertical Drag (dy) strictly PANS North / South
        mapTargetY += dy * unitsPerPixel * 0.9;
        mapTargetY = Math.max(-1.5, Math.min(0.6, mapTargetY));

        mapTargetX = 0.0; // Locked horizontal translation on desktop as well

        camera.position.x = 0.0;
        camera.position.y = mapTargetY;
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Desktop Mouse Wheel Zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomSensitivity = 0.0012;
        const factor = Math.exp(-e.deltaY * zoomSensitivity);
        const clampedFactor = Math.max(0.93, Math.min(1.07, factor));

        const newZoom = Math.max(0.4, Math.min(6.0, camera.zoom * clampedFactor));
        camera.zoom = newZoom;
        camera.updateProjectionMatrix();
    }, { passive: false });

    // Mobile Touch Handlers
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isDragging = true;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            isDragging = false;
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            initialTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            mapZoom = camera.zoom;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();

        if (e.touches.length === 1 && isDragging) {
            const clientX = e.touches[0].clientX;
            const clientY = e.touches[0].clientY;

            const dx = clientX - startX;
            const dy = clientY - startY;
            startX = clientX;
            startY = clientY;

            const h = window.innerHeight;
            const visibleHeight = (camera.top - camera.bottom) / camera.zoom;
            const unitsPerPixel = visibleHeight / h;

            // 🌟 1. Horizontal Motion (dx) ROTATES around the Pole (Natural direction matching drag)
            mapRotation += dx * 0.005;
            if (polarMesh) {
                polarMesh.rotation.z = mapRotation;
            }
            updateCompassUI();

            // 🌟 2. Vertical Motion (dy) strictly PANS North / South
            mapTargetY += dy * unitsPerPixel * 0.9;
            mapTargetY = Math.max(-1.5, Math.min(0.6, mapTargetY));

            mapTargetX = 0.0; // Locked horizontal translation on mobile

            camera.position.x = 0.0;
            camera.position.y = mapTargetY;
        } else if (e.touches.length === 2 && initialTouchDist > 0) {
            // Pinch-to-zoom
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const pinchRatio = currentDist / initialTouchDist;
            camera.zoom = Math.max(0.4, Math.min(6.0, mapZoom * pinchRatio));
            camera.updateProjectionMatrix();
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length === 1) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isDragging = true;
        } else {
            isDragging = false;
        }
    });
}

export function initPolarMap() {
    let container = document.getElementById('polar-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'polar-container';
        container.style.display = 'none';
        document.body.appendChild(container);
    }

    initPolarUI(container);

    if (scene) return;

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    init2DMapControls(renderer.domElement);

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

    const geometry = new THREE.PlaneGeometry(4.0, 4.0, 1, 1);
    polarMesh = new THREE.Mesh(geometry, material);
    scene.add(polarMesh);

    rebuildPolarGraticule(polarMesh);
    loadPolarVectorData(polarMesh);

    fitSynopticSector();

    window.addEventListener('resize', () => {
        if (!renderer || !camera) return;
        renderer.setSize(window.innerWidth, window.innerHeight);
        fitSynopticSector();
    });

    function animate() {
        requestAnimationFrame(animate);
        if (isPolarActive && renderer && scene && camera) {
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
