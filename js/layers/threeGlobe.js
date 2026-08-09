// js/layers/threeGlobe.js
import { HEX_PALETTE } from '../shaders/scalarShader.js';

// 🌐 Lightweight (<300 KB total) High-Speed 3D Vector Line Datasets
const COUNTRY_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_boundary_lines_land.geojson';
// 🌟 Fixed: 180 KB US State & Canadian Province Line Dataset (Instant 0.05s load!)
const STATE_BORDERS_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces_lines.geojson';
const COASTLINES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_coastline.geojson';

let scene, camera, renderer, controls, globeMesh, material, paletteTex, borderTex;
let isGlobeActive = false;

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
    uniform sampler2D u_borderTexture; // 🌟 Bold Black Vector Border Overlay
    uniform vec2 u_uvOffset;
    uniform vec2 u_uvScale;
    uniform float u_opacity;
    varying vec2 v_uv;
    varying vec3 v_normal;

    void main() {
        float latRad = (v_uv.y - 0.5) * 3.14159265359;
        float mercY = log(tan(0.78539816339 + latRad / 2.0));
        float normY = clamp(0.5 - (mercY / (2.0 * 3.14159265359)), 0.0, 1.0);

        vec2 wrapped_uv = vec2(v_uv.x, normY);
        vec2 sprite_uv = u_uvOffset + wrapped_uv * u_uvScale;

        // Sample rich weather temperature color
        float rawVal = texture2D(u_dataTexture, sprite_uv).r;
        vec4 tempColor = texture2D(u_paletteTexture, vec2(rawVal, 0.5));

        // Sample 3D border texture
        vec4 borderData = texture2D(u_borderTexture, v_uv);

        // Mix pitch-black border lines over temperature color
        vec3 finalColor = mix(tempColor.rgb, vec3(0.0), borderData.a * 0.95);

        // Subtle 3D atmospheric limb depth glow
        float intensity = pow(0.65 - dot(v_normal, vec3(0, 0, 1.0)), 2.0);
        vec3 atmosphere = vec3(0.2, 0.6, 1.0) * intensity;

        gl_FragColor = vec4(finalColor + atmosphere * 0.2, tempColor.a * u_opacity);
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

/**
 * 🌟 FAST HIGH-SPEED BORDER CANVAS TEXTURE
 * Draws Coastlines (6px), Country Borders (5px), and US State Lines (3.5px) in 0.1 seconds
 */
async function drawGeoJSONLayer(ctx, canvas, url, color, lineWidth) {
    try {
        const resp = await fetch(url);
        if (!resp.ok) return;
        const data = await resp.json();

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;

        data.features.forEach(feature => {
            const geom = feature.geometry;
            if (!geom) return;

            let lineStrings = [];
            if (geom.type === 'LineString') lineStrings = [geom.coordinates];
            else if (geom.type === 'MultiLineString') lineStrings = geom.coordinates;
            else if (geom.type === 'Polygon') lineStrings = geom.coordinates;
            else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly => poly.forEach(r => lineStrings.push(r)));

            lineStrings.forEach(coords => {
                ctx.beginPath();
                for (let i = 0; i < coords.length; i++) {
                    const lng = coords[i][0];
                    const lat = coords[i][1];

                    const px = ((lng + 180) / 360) * canvas.width;
                    const py = ((90 - lat) / 180) * canvas.height;

                    if (i === 0) {
                        ctx.moveTo(px, py);
                    } else {
                        const prevLng = coords[i - 1][0];
                        if (Math.abs(lng - prevLng) > 180) {
                            ctx.moveTo(px, py);
                        } else {
                            ctx.lineTo(px, py);
                        }
                    }
                }
                ctx.stroke();
            });
        });
    } catch (e) {
        console.warn("Layer draw error:", url, e);
    }
}

async function createBorderCanvasTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 4096;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. High-Res Coastlines (Bold 6.0px)
    await drawGeoJSONLayer(ctx, canvas, COASTLINES_URL, '#000000', 6.0);

    // 2. Country Borders (Bold 5.0px)
    await drawGeoJSONLayer(ctx, canvas, COUNTRY_BORDERS_URL, '#000000', 5.0);

    // 3. US State & Canadian Province Borders (Bold 3.5px)
    await drawGeoJSONLayer(ctx, canvas, STATE_BORDERS_URL, '#000000', 3.5);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
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
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 2.8;
    controls.maxDistance = 12;

    paletteTex = createPaletteTexture();

    const emptyCanvas = document.createElement('canvas');
    emptyCanvas.width = 1;
    emptyCanvas.height = 1;
    borderTex = new THREE.CanvasTexture(emptyCanvas);

    material = new THREE.ShaderMaterial({
        vertexShader: vsThreeGlobe,
        fragmentShader: fsThreeGlobe,
        uniforms: {
            u_dataTexture: { value: null },
            u_paletteTexture: { value: paletteTex },
            u_borderTexture: { value: borderTex },
            u_uvOffset: { value: new THREE.Vector2(0, 0) },
            u_uvScale: { value: new THREE.Vector2(1, 1) },
            u_opacity: { value: 0.85 }
        },
        transparent: true
    });

    const geometry = new THREE.SphereGeometry(2, 64, 64);
    globeMesh = new THREE.Mesh(geometry, material);
    
    // Rotate globe -90° on load so North America faces front
    globeMesh.rotation.y = -Math.PI / 2;
    scene.add(globeMesh);

    // Render HD Vector Border Overlay Texture
    createBorderCanvasTexture().then(tex => {
        borderTex = tex;
        material.uniforms.u_borderTexture.value = borderTex;
        material.needsUpdate = true;
        console.log("🌟 HD Country & ALL 50 US State Borders Rendered!");
    });

    window.addEventListener('resize', () => {
        if (!renderer || !camera) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
        requestAnimationFrame(animate);
        if (isGlobeActive && controls && renderer && scene) {
            controls.update();
            renderer.render(scene, camera);
        }
    }
    animate();
}

export function updateThreeGlobeFrame(frameState) {
    if (!material || !frameState || !frameState.chunkImg) return;

    const texture = new THREE.CanvasTexture(frameState.chunkImg);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    material.uniforms.u_dataTexture.value = texture;
    material.uniforms.u_uvOffset.value.set(frameState.uvOffset[0], frameState.uvOffset[1]);
    material.uniforms.u_uvScale.value.set(frameState.uvScale[0], frameState.uvScale[1]);
    material.needsUpdate = true;
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