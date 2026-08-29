// js/layers/threeGlobe.js
import { getPaletteForParameter as getLightPalette, TEMP_PALETTE, PRECIP_PALETTE, PWAT_PALETTE } from '../config/palettes.js';
import { getPaletteForParameter as getDarkPalette } from '../config/darkPalettes.js';
import { stateManager } from '../core/stateManager.js';

// 🌐 High-Definition Vector Datasets
const LAND_POLYGONS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_land.geojson';
const LAKES_POLYGONS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_lakes.geojson';
const COUNTRY_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_boundary_lines_land.geojson';
const STATE_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces_lines.geojson';
const COASTLINES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_coastline.geojson';
const COUNTY_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_admin_2_counties.geojson';

let scene, camera, renderer, controls, globeGroup, globeMesh, baseGlobeMesh, landGlobeMesh, lakesGlobeMesh, material, paletteTex;
let linesMesh = null, countyMesh = null;
let globeChunkTextures = {};
let isGlobeActive = false;

// 🌟 Custom Color Matrix Matching 2D MapLibre & Polar Map 1:1
const THEME_COLORS = {
    dark: {
        ocean: 0x21242C,  // #21242C
        land: 0x443E47,   // #443E47
        lakes: 0x21242C,  // #21242C
        borders: 0xffffff,
        counties: 0x64748b
    },
    light: {
        ocean: 0xE7F1F4,  // #E7F1F4
        land: 0xE2DBCF,   // #E2DBCF
        lakes: 0xE7F1F4,  // #E7F1F4
        borders: 0x2b2d31,
        counties: 0x94a3b8
    }
};

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
        // 🌟 100% Pure 1:1 Equirectangular UV Mapping
        vec2 wrapped_uv = vec2(v_uv.x, 1.0 - v_uv.y);
        vec2 sprite_uv = u_uvOffset + wrapped_uv * u_uvScale;

        float rawVal = texture2D(u_dataTexture, sprite_uv).r;
        vec4 color = texture2D(u_paletteTexture, vec2(rawVal, 0.5));

        // 🌟 Discard transparent pixels (e.g. dry land for precip)
        if (color.a == 0.0) {
            discard;
        }

        // Subtle 3D atmospheric limb depth glow
        float intensity = pow(0.65 - dot(v_normal, vec3(0, 0, 1.0)), 2.0);
        vec3 atmosphere = vec3(0.2, 0.6, 1.0) * intensity;

        gl_FragColor = vec4(color.rgb + atmosphere * 0.2, color.a * u_opacity);
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

function lngLatToVector3(lng, lat, radius = 2.003) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);

    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = (radius * Math.sin(phi) * Math.sin(theta));
    const y = (radius * Math.cos(phi));

    return new THREE.Vector3(x, y, z);
}

/**
 * 🌟 Triangulate Land & Lake GeoJSON Polygons directly onto the 3D Sphere
 */
function triangulateGeoJsonToSphere(features, radius) {
    const vertices = [];

    features.forEach(feat => {
        const geom = feat.geometry;
        if (!geom) return;

        let polygonList = [];
        if (geom.type === 'Polygon') {
            polygonList = [geom.coordinates];
        } else if (geom.type === 'MultiPolygon') {
            polygonList = geom.coordinates;
        }

        polygonList.forEach(polyCoords => {
            if (!polyCoords || polyCoords.length === 0) return;

            const outerRing = polyCoords[0].map(c => new THREE.Vector2(c[0], c[1]));
            if (outerRing.length < 3) return;

            const holes = [];
            for (let h = 1; h < polyCoords.length; h++) {
                const holeRing = polyCoords[h].map(c => new THREE.Vector2(c[0], c[1]));
                if (holeRing.length >= 3) holes.push(holeRing);
            }

            try {
                if (THREE.ShapeUtils.area(outerRing) < 0) outerRing.reverse();
                holes.forEach(hRing => {
                    if (THREE.ShapeUtils.area(hRing) > 0) hRing.reverse();
                });

                const faces = THREE.ShapeUtils.triangulateShape(outerRing, holes);
                const all2DPoints = outerRing.concat(...holes);

                for (let f = 0; f < faces.length; f++) {
                    const idxs = faces[f];
                    const pA2D = all2DPoints[idxs[0]];
                    const pB2D = all2DPoints[idxs[1]];
                    const pC2D = all2DPoints[idxs[2]];

                    if (pA2D && pB2D && pC2D) {
                        const vA = lngLatToVector3(pA2D.x, pA2D.y, radius);
                        const vB = lngLatToVector3(pB2D.x, pB2D.y, radius);
                        const vC = lngLatToVector3(pC2D.x, pC2D.y, radius);

                        vertices.push(vA.x, vA.y, vA.z);
                        vertices.push(vB.x, vB.y, vB.z);
                        vertices.push(vC.x, vC.y, vC.z);
                    }
                }
            } catch (e) {}
        });
    });

    const geometry = new THREE.BufferGeometry();
    if (vertices.length > 0) {
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    }
    return geometry;
}

async function load3DBasemapFills(parentGroup) {
    try {
        const [landResp, lakesResp] = await Promise.all([
            fetch(LAND_POLYGONS_URL).catch(() => null),
            fetch(LAKES_POLYGONS_URL).catch(() => null)
        ]);

        const themeKey = (stateManager.currentTheme === 'dark') ? 'dark' : 'light';
        const cfg = THEME_COLORS[themeKey];

        if (landResp && landResp.ok) {
            const data = await landResp.json();
            if (data && data.features) {
                const landGeom = triangulateGeoJsonToSphere(data.features, 1.998);
                const landMat = new THREE.MeshBasicMaterial({ color: cfg.land, side: THREE.DoubleSide });
                landGlobeMesh = new THREE.Mesh(landGeom, landMat);
                parentGroup.add(landGlobeMesh);
            }
        }

        if (lakesResp && lakesResp.ok) {
            const data = await lakesResp.json();
            if (data && data.features) {
                const lakesGeom = triangulateGeoJsonToSphere(data.features, 1.999);
                const lakesMat = new THREE.MeshBasicMaterial({ color: cfg.lakes, side: THREE.DoubleSide });
                lakesGlobeMesh = new THREE.Mesh(lakesGeom, lakesMat);
                parentGroup.add(lakesGlobeMesh);
            }
        }
    } catch (err) {
        console.warn("3D land fill load error:", err);
    }
}

async function load3DVectorBorders(parentMesh) {
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
                        const p2Base = coords[i+1];

                        if (Math.abs(p1Base[0] - p2Base[0]) > 180) continue;

                        const p1 = lngLatToVector3(p1Base[0], p1Base[1], 2.003);
                        const p2 = lngLatToVector3(p2Base[0], p2Base[1], 2.003);

                        linePoints.push(p1.x, p1.y, p1.z);
                        linePoints.push(p2.x, p2.y, p2.z);
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

        const themeKey = (stateManager.currentTheme === 'dark') ? 'dark' : 'light';
        const lineMaterial = new THREE.LineBasicMaterial({
            color: THEME_COLORS[themeKey].borders,
            opacity: 0.95,
            transparent: true
        });

        linesMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
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

            const themeKey = (stateManager.currentTheme === 'dark') ? 'dark' : 'light';
            const lineMaterial = new THREE.LineBasicMaterial({
                color: THEME_COLORS[themeKey].counties,
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

    const themeKey = (stateManager.currentTheme === 'dark') ? 'dark' : 'light';
    const cfg = THEME_COLORS[themeKey];

    globeGroup = new THREE.Group();
    globeGroup.rotation.y = -Math.PI / 2;
    scene.add(globeGroup);

    // 🌟 Layer 0: Styled Ocean Base Underlay Sphere (Radius 1.996)
    const baseGeometry = new THREE.SphereGeometry(1.996, 64, 64);
    const baseMaterial = new THREE.MeshBasicMaterial({ color: cfg.ocean });
    baseGlobeMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    globeGroup.add(baseGlobeMesh);

    // 🌟 Layer 1: Styled Continents & Lakes (Radius 1.998)
    load3DBasemapFills(globeGroup);

    // 🌟 Layer 2: Weather Heatmap Sphere (Radius 2.000, Opacity 0.85)
    const paletteFunc = (stateManager.currentTheme === 'dark') ? getDarkPalette : getLightPalette;
    const initialPalette = paletteFunc(stateManager.activeParam || '2t');
    paletteTex = createPaletteTexture(initialPalette);

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
        transparent: true,
        depthWrite: false
    });

    const geometry = new THREE.SphereGeometry(2.0, 64, 64);
    globeMesh = new THREE.Mesh(geometry, material);
    globeGroup.add(globeMesh);

    // 🌟 Layer 3: Vector Coastlines & Admin Borders (Radius 2.003)
    load3DVectorBorders(globeGroup);

    window.addEventListener('resize', () => {
        if (!renderer || !camera) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
        requestAnimationFrame(animate);
        if (isGlobeActive && controls && renderer && scene && globeGroup) {
            const dist = camera.position.distanceTo(globeGroup.position);

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
 * 🌟 DYNAMIC PALETTE & THEME SWAP FOR 3D GLOBE
 */
export function updateThreeGlobePalette(paramIdOrHexArray) {
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

    // Update Basemap Theme Colors
    const themeKey = (stateManager.currentTheme === 'dark') ? 'dark' : 'light';
    const cfg = THEME_COLORS[themeKey];

    if (baseGlobeMesh && baseGlobeMesh.material) {
        baseGlobeMesh.material.color.setHex(cfg.ocean);
    }
    if (landGlobeMesh && landGlobeMesh.material) {
        landGlobeMesh.material.color.setHex(cfg.land);
    }
    if (lakesGlobeMesh && lakesGlobeMesh.material) {
        lakesGlobeMesh.material.color.setHex(cfg.lakes);
    }
    if (linesMesh && linesMesh.material) {
        linesMesh.material.color.setHex(cfg.borders);
    }
    if (countyMesh && countyMesh.material) {
        countyMesh.material.color.setHex(cfg.counties);
    }
}

export function updateThreeGlobeFrame(frameState) {
    if (!material || !frameState || !frameState.chunkImg) return;

    const chunkIdx = frameState.chunkIndex;
    const source = frameState.chunkImg;

    if (!globeChunkTextures[chunkIdx]) {
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
        globeChunkTextures[chunkIdx] = texture;
    }

    material.uniforms.u_dataTexture.value = globeChunkTextures[chunkIdx];
    material.uniforms.u_uvOffset.value.set(frameState.uvOffset[0], frameState.uvOffset[1]);
    material.uniforms.u_uvScale.value.set(frameState.uvScale[0], frameState.uvScale[1]);
    material.needsUpdate = true;
}

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
    const polarContainer = document.getElementById('polar-container');
    const mapDiv = document.getElementById('map');

    if (container) container.style.display = 'block';
    if (polarContainer) polarContainer.style.display = 'none';
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
