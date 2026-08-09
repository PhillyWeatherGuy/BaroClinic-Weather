// js/layers/threeGlobe.js
import { HEX_PALETTE } from '../shaders/scalarShader.js';

let scene, camera, renderer, controls, globeMesh, material, paletteTex;
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
    uniform vec2 u_uvOffset;
    uniform vec2 u_uvScale;
    uniform float u_opacity;
    varying vec2 v_uv;
    varying vec3 v_normal;

    void main() {
        // 🌟 Maps 3D Sphere UV coordinates (lng, lat) to Mercator V coordinate
        float latRad = (v_uv.y - 0.5) * 3.14159265359;
        float mercY = log(tan(0.78539816339 + latRad / 2.0));
        float normY = clamp(0.5 - (mercY / (2.0 * 3.14159265359)), 0.0, 1.0);

        // 🌟 Right-Side-Up Vertical Orientation
        vec2 wrapped_uv = vec2(v_uv.x, normY);
        vec2 sprite_uv = u_uvOffset + wrapped_uv * u_uvScale;

        float rawVal = texture2D(u_dataTexture, sprite_uv).r;
        vec4 color = texture2D(u_paletteTexture, vec2(rawVal, 0.5));

        // 🌟 3D atmospheric limb depth glow
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

export function initThreeGlobe() {
    const container = document.getElementById('globe-container');
    if (!container || scene) return;

    // 1. Three.js Scene, Camera, Renderer
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 6);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // 2. 360° Orbit Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 2.8;
    controls.maxDistance = 12;

    // 3. Palette Texture
    paletteTex = createPaletteTexture();

    // 4. Custom Shader Material
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

    // 5. 3D Earth Sphere Geometry
    const geometry = new THREE.SphereGeometry(2, 64, 64);
    globeMesh = new THREE.Mesh(geometry, material);
    
    // 🌟 Rotate globe -90° on load so North America faces front!
    globeMesh.rotation.y = -Math.PI / 2;
    scene.add(globeMesh);

    window.addEventListener('resize', () => {
        if (!renderer || !camera) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Render Loop
    function animate() {
        requestAnimationFrame(animate);
        if (isGlobeActive && controls && renderer && scene) {
            controls.update();
            renderer.render(scene, camera);
        }
    }
    animate();
}

/**
 * 🌟 Updates 3D Globe texture frame when timeline slider scrubs
 */
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