// Stage: Renderer, procedural studio environment, lights, floor, post-processing.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const FLOOR_Y = -1.2;
const LIGHT_DIST = 22;
const SHADOW_EXTENT = 9;
const TRANSITION_SECONDS = 0.9;

// ---------------------------------------------------------------------------
// Quality tiers. Each tier really changes cost: shadow map, pixel ratio, post chain, reflection.
// ---------------------------------------------------------------------------
const QUALITY = {
  high: {
    shadowSize: 4096, shadowRadius: 3.2, bias: -0.00022, normalBias: 0.022,
    pixelRatioCap: 2, post: true, msaa: 4, gtao: true, bloom: true, smaa: true,
    reflection: 0.5, pmrem: 256
  },
  medium: {
    shadowSize: 2048, shadowRadius: 2.0, bias: -0.00035, normalBias: 0.03,
    pixelRatioCap: 1.5, post: true, msaa: 0, gtao: false, bloom: true, smaa: true,
    reflection: 0.3, pmrem: 256
  },
  low: {
    shadowSize: 1024, shadowRadius: 1.4, bias: -0.0006, normalBias: 0.05,
    pixelRatioCap: 1, post: false, msaa: 0, gtao: false, bloom: false, smaa: false,
    reflection: 0, pmrem: 128
  }
};

// ---------------------------------------------------------------------------
// Lighting presets. Everything animatable lives in this plain-data shape.
// Colors are sRGB hex strings, positions are light directions (normalised later).
// Env panels, in order: top, key, fill, rim, stripL, stripR, bounce.
// The key and rim panels always sit along the key and rim light directions.
// ---------------------------------------------------------------------------
const PRESET_DEFS = {
  Studio: {
    key:  { color: '#fff0de', intensity: 3.6, dir: [-7, 13, 7] },
    fill: { color: '#b5cbff', intensity: 0.85, dir: [10, 6, 6] },
    rim:  { color: '#dde8ff', intensity: 1.8, dir: [3, 7, -12] },
    env: {
      intensity: 0.85,
      dome: { top: '#4a5062', horizon: '#242832', bottom: '#08080a' },
      panels: [
        { c: '#ffffff', i: 3.6 }, { c: '#fff0dd', i: 6.5 }, { c: '#c4d6ff', i: 3.0 },
        { c: '#e6eeff', i: 5.0 }, { c: '#ffffff', i: 3.4 }, { c: '#d8e4ff', i: 2.2 }, { c: '#ffe6cc', i: 0.3 }
      ]
    },
    bg: { top: '#14171e', bottom: '#08090c', glow: '#30343f', glowAmount: 1.0 },
    exposure: 1.0, bloom: 0.16, vignette: 0.42, tint: '#ffffff',
    shadowOpacity: 0.62, floorColor: '#16181d', reflection: 1.1
  },
  Gallery: {
    key:  { color: '#ffffff', intensity: 2.5, dir: [-3, 16, 5] },
    fill: { color: '#eaf0ff', intensity: 1.2, dir: [9, 8, 7] },
    rim:  { color: '#ffffff', intensity: 0.9, dir: [-2, 8, -12] },
    env: {
      intensity: 1.15,
      dome: { top: '#8c919c', horizon: '#50545c', bottom: '#15161a' },
      panels: [
        { c: '#ffffff', i: 8.0 }, { c: '#ffffff', i: 4.0 }, { c: '#f2f5ff', i: 3.0 },
        { c: '#ffffff', i: 3.0 }, { c: '#ffffff', i: 2.5 }, { c: '#ffffff', i: 2.5 }, { c: '#e8e8e8', i: 0.6 }
      ]
    },
    bg: { top: '#2a2c31', bottom: '#111216', glow: '#4e5057', glowAmount: 1.0 },
    exposure: 1.05, bloom: 0.1, vignette: 0.34, tint: '#fffdfa',
    shadowOpacity: 0.45, floorColor: '#16171b', reflection: 0.45
  },
  Sunset: {
    key:  { color: '#ff9b55', intensity: 4.2, dir: [-11, 7, 5] },
    fill: { color: '#8a92cc', intensity: 0.8, dir: [10, 5, 5] },
    rim:  { color: '#ff8a70', intensity: 1.7, dir: [6, 6, -12] },
    env: {
      intensity: 0.75,
      dome: { top: '#3a3050', horizon: '#6a3a30', bottom: '#190e0c' },
      panels: [
        { c: '#ffb070', i: 2.0 }, { c: '#ff8a3c', i: 12.0 }, { c: '#7b7fff', i: 3.0 },
        { c: '#ff7a68', i: 6.0 }, { c: '#ffd0a0', i: 3.0 }, { c: '#6a5cff', i: 3.0 }, { c: '#ff9060', i: 0.5 }
      ]
    },
    bg: { top: '#1e1724', bottom: '#0a0809', glow: '#4e2d22', glowAmount: 1.0 },
    exposure: 1.2, bloom: 0.22, vignette: 0.5, tint: '#fff2e8',
    shadowOpacity: 0.66, floorColor: '#141011', reflection: 0.9
  },
  Night: {
    key:  { color: '#b4c8ff', intensity: 1.6, dir: [-6, 14, 6] },
    fill: { color: '#3c52a0', intensity: 0.3, dir: [10, 5, 6] },
    rim:  { color: '#9ab0ff', intensity: 0.8, dir: [3, 7, -12] },
    env: {
      intensity: 0.45,
      dome: { top: '#0e1528', horizon: '#080c18', bottom: '#020305' },
      panels: [
        { c: '#8fa8ff', i: 0.9 }, { c: '#9fb8ff', i: 2.6 }, { c: '#3a4c90', i: 1.2 },
        { c: '#8aa4ff', i: 2.2 }, { c: '#ffb060', i: 2.6 }, { c: '#4060c0', i: 1.2 }, { c: '#223055', i: 0.05 }
      ]
    },
    bg: { top: '#080b14', bottom: '#030305', glow: '#111b2c', glowAmount: 1.0 },
    exposure: 1.05, bloom: 0.3, vignette: 0.55, tint: '#eef2ff',
    shadowOpacity: 0.7, floorColor: '#0a0b10', reflection: 0.9
  }
};

const PANEL_LAYOUT = [
  // name, position (unit-ish direction, scaled by 19), width, height
  { name: 'top',    pos: [0, 1, 0],          w: 16, h: 16 },
  { name: 'key',    pos: null,               w: 14, h: 9 },
  { name: 'fill',   pos: [0.85, 0.3, 0.3],   w: 10, h: 12 },
  { name: 'rim',    pos: null,               w: 24, h: 3 },
  { name: 'stripL', pos: [-0.95, 0.2, -0.3], w: 2,  h: 14 },
  { name: 'stripR', pos: [0.95, 0.2, -0.4],  w: 2,  h: 14 },
  { name: 'bounce', pos: [0, -1, 0],         w: 30, h: 30 }
];

const GAIN = { key: 0.9, fill: 0.6, rim: 0.7, env: 0.42 }; // global level trim so whites stay below clipping

// Convert a preset definition into a runtime state made of numbers, Colors and Vector3s.
function makeState(def) {
  const c = (h) => new THREE.Color(h);
  const dir = (a) => new THREE.Vector3(a[0], a[1], a[2]).normalize();
  return {
    key:  { color: c(def.key.color),  intensity: def.key.intensity * GAIN.key,   dir: dir(def.key.dir) },
    fill: { color: c(def.fill.color), intensity: def.fill.intensity * GAIN.fill, dir: dir(def.fill.dir) },
    rim:  { color: c(def.rim.color),  intensity: def.rim.intensity * GAIN.rim,   dir: dir(def.rim.dir) },
    env: {
      intensity: def.env.intensity * GAIN.env,
      dome: { top: c(def.env.dome.top), horizon: c(def.env.dome.horizon), bottom: c(def.env.dome.bottom) },
      panels: def.env.panels.map((p) => ({ c: c(p.c), i: p.i }))
    },
    bg: { top: c(def.bg.top), bottom: c(def.bg.bottom), glow: c(def.bg.glow), glowAmount: def.bg.glowAmount },
    exposure: def.exposure, bloom: def.bloom, vignette: def.vignette, tint: c(def.tint),
    shadowOpacity: def.shadowOpacity, floorColor: c(def.floorColor), reflection: def.reflection
  };
}

function cloneState(s) {
  if (typeof s === 'number') return s;
  if (s && (s.isColor || s.isVector3)) return s.clone();
  if (Array.isArray(s)) return s.map(cloneState);
  const o = {};
  for (const k in s) o[k] = cloneState(s[k]);
  return o;
}

// out = lerp(a, b, k), recursively. Directions are re-normalised by the consumer.
function blendState(out, a, b, k) {
  for (const key in out) {
    const va = a[key], vb = b[key];
    if (typeof va === 'number') out[key] = va + (vb - va) * k;
    else if (va.isColor) out[key].copy(va).lerp(vb, k);
    else if (va.isVector3) out[key].copy(va).lerp(vb, k);
    else blendState(out[key], va, vb, k);
  }
}

const smooth = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// Procedural studio environment scene (rendered into a PMREM).
// ---------------------------------------------------------------------------
function createEnvScene() {
  const scene = new THREE.Scene();

  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      bottom: { value: new THREE.Color() }
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon, bottom, pow(-y, 0.5));
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), domeMat);
  scene.add(dome);

  const panels = PANEL_LAYOUT.map((p) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat);
    mesh.userData.layout = p;
    scene.add(mesh);
    return mesh;
  });

  const tmp = new THREE.Vector3();
  function update(state) {
    domeMat.uniforms.top.value.copy(state.env.dome.top);
    domeMat.uniforms.horizon.value.copy(state.env.dome.horizon);
    domeMat.uniforms.bottom.value.copy(state.env.dome.bottom);
    panels.forEach((mesh, idx) => {
      const p = mesh.userData.layout;
      const s = state.env.panels[idx];
      mesh.material.color.copy(s.c).multiplyScalar(s.i);
      if (p.name === 'key') tmp.copy(state.key.dir).normalize();
      else if (p.name === 'rim') tmp.copy(state.rim.dir).normalize();
      else tmp.set(p.pos[0], p.pos[1], p.pos[2]).normalize();
      mesh.position.copy(tmp).multiplyScalar(19);
      mesh.lookAt(0, 0, 0);
    });
  }
  function dispose() {
    scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
  return { scene, update, dispose };
}

// ---------------------------------------------------------------------------
// Vignette + grade + dither, applied after tone mapping in display space.
// ---------------------------------------------------------------------------
const GradeShader = {
  name: 'StageGrade',
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.4 },
    tint: { value: new THREE.Color(1, 1, 1) },
    aspect: { value: 1.5 },
    time: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; uniform vec3 tint; uniform float aspect; uniform float time;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = (vUv - 0.5) * vec2(mix(1.0, aspect, 0.55), 1.0);
      float d = length(q);
      float v = smoothstep(0.32, 0.92, d);
      c.rgb *= 1.0 - vignette * v * v * (3.0 - 2.0 * v);
      c.rgb *= tint;
      // gentle contrast S-curve in display space
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.12);
      // triangular dither to kill banding in dark gradients
      vec2 fc = gl_FragCoord.xy;
      float n = hash(fc + fract(time * 7.13) * 91.7) + hash(fc * 1.37 + 17.0 + fract(time * 3.71) * 53.1) - 1.0;
      c.rgb += n / 255.0;
      gl_FragColor = vec4(c.rgb, 1.0);
    }`
};

// ---------------------------------------------------------------------------
export function createStage(canvas, opts = {}) {
  let quality = Object.hasOwn(QUALITY, opts.quality) ? opts.quality : 'high';
  let cfg = QUALITY[quality];

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is deprecated since r186 and aliases this
  renderer.shadowMap.autoUpdate = false;        // updated once per frame, shared with reflection + AO passes
  renderer.setClearColor(0x050608, 1);

  let width = canvas.clientWidth || canvas.width || window.innerWidth || 1280;
  let height = canvas.clientHeight || canvas.height || window.innerHeight || 720;
  let pixelRatio = 1;
  const applyPixelRatio = () => {
    pixelRatio = Math.min(window.devicePixelRatio || 1, cfg.pixelRatioCap);
    renderer.setPixelRatio(pixelRatio);
  };
  applyPixelRatio();
  renderer.setSize(width, height);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 200);
  camera.position.set(0, 9, 11);
  camera.lookAt(0, 0, 0);

  // ---- state / presets ----
  const lightingPresets = Object.keys(PRESET_DEFS);
  const presetStates = {};
  for (const name of lightingPresets) presetStates[name] = makeState(PRESET_DEFS[name]);
  let currentName = lightingPresets[0];
  const cur = cloneState(presetStates[currentName]);
  let from = cloneState(cur);
  let to = presetStates[currentName];
  let transT = 1; // 0..1
  let time = 0;

  // ---- background (screen space gradient with soft glow behind the board) ----
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 256; bgCanvas.height = 256;
  const bgCtx = bgCanvas.getContext('2d');
  const bgTexture = new THREE.CanvasTexture(bgCanvas);
  bgTexture.colorSpace = THREE.SRGBColorSpace;
  bgTexture.minFilter = THREE.LinearFilter;
  bgTexture.generateMipmaps = false;
  scene.background = bgTexture;
  function paintBackdrop(s) {
    const W = bgCanvas.width, H = bgCanvas.height;
    const g = bgCtx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, s.bg.top.getStyle());
    g.addColorStop(1, s.bg.bottom.getStyle());
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, W, H);
    const cx = W * 0.5, cy = H * 0.56;
    const a = Math.min(1, 0.55 * s.bg.glowAmount);
    const css = s.bg.glow.getStyle(); // rgb(r,g,b)
    const rgb = css.slice(css.indexOf('(') + 1, css.indexOf(')'));
    const rg2 = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.62);
    rg2.addColorStop(0, `rgba(${rgb},${a})`);
    rg2.addColorStop(0.55, `rgba(${rgb},${a * 0.28})`);
    rg2.addColorStop(1, `rgba(${rgb},0)`);
    bgCtx.fillStyle = rg2;
    bgCtx.fillRect(0, 0, W, H);
    bgTexture.needsUpdate = true;
  }

  // ---- lights ----
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.castShadow = true;
  key.shadow.camera.left = -SHADOW_EXTENT;
  key.shadow.camera.right = SHADOW_EXTENT;
  key.shadow.camera.top = SHADOW_EXTENT;
  key.shadow.camera.bottom = -SHADOW_EXTENT;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 50;
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.DirectionalLight(0xb5cbff, 0.8);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xdde8ff, 1.8);
  scene.add(rim);

  function applyShadowQuality() {
    const sh = key.shadow;
    sh.mapSize.set(cfg.shadowSize, cfg.shadowSize);
    if (sh.map) { sh.map.dispose(); sh.map = null; }
    sh.radius = cfg.shadowRadius;
    sh.bias = cfg.bias;
    sh.normalBias = cfg.normalBias;
  }
  applyShadowQuality();

  // ---- environment (PMREM from a procedural softbox scene) ----
  const envScene = createEnvScene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;
  function rebuildEnvironment(size) {
    envScene.update(cur);
    const t = pmrem.fromScene(envScene.scene, 0, 0.1, 100, { size });
    scene.environment = t.texture;
    if (envTarget) envTarget.dispose();
    envTarget = t;
  }

  // ---- floor ----
  const floorUniforms = {
    tRefl: { value: null },
    reflMatrix: { value: new THREE.Matrix4() },
    reflStrength: { value: 0 },
    fadeInner: { value: 9.0 },
    fadeOuter: { value: 34.0 }
  };
  const floorMat = new THREE.MeshPhysicalMaterial({
    color: 0x0d0e12, roughness: 0.5, metalness: 0.0, specularIntensity: 0.3,
    clearcoat: 0.0, envMapIntensity: 0.25,
    transparent: true, opacity: 1
  });
  floorMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, floorUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform sampler2D tRefl; uniform mat4 reflMatrix; uniform float reflStrength;
        uniform float fadeInner; uniform float fadeOuter;`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        float floorR = length(vWPos.xz);
        diffuseColor.a *= 1.0 - smoothstep(fadeInner, fadeOuter, floorR);`)
      .replace('#include <opaque_fragment>', `
        if (reflStrength > 0.001) {
          vec4 rc = reflMatrix * vec4(vWPos, 1.0);
          vec2 ruv = rc.xy / rc.w;
          vec3 V = normalize(cameraPosition - vWPos);
          float cosT = clamp(V.y, 0.0, 1.0);
          float fres = mix(0.22, 1.0, pow(1.0 - cosT, 3.0));
          float ang = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
          vec3 refl = vec3(0.0);
          for (int i = 0; i < 10; i++) {
            float fi = float(i);
            float r = sqrt((fi + 0.5) / 10.0);
            float th = fi * 2.39996323 + ang;
            vec2 o = vec2(cos(th), sin(th)) * r * 0.0035;
            refl += texture2D(tRefl, ruv + o, 0.3).rgb;
          }
          refl *= 0.1;
          float near = 1.0 - smoothstep(3.0, 16.0, floorR);
          outgoingLight += refl * fres * reflStrength * (0.35 + 0.65 * near);
        }
        #include <opaque_fragment>`);
  };
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 96), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  floor.castShadow = false;
  floor.renderOrder = 0;
  floor.name = 'stage-floor';
  scene.add(floor);

  const shadowMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.6, transparent: true, depthWrite: false });
  shadowMat.polygonOffset = true; shadowMat.polygonOffsetFactor = -2; shadowMat.polygonOffsetUnits = -2;
  const shadowLayer = new THREE.Mesh(new THREE.CircleGeometry(14, 64), shadowMat);
  shadowLayer.rotation.x = -Math.PI / 2;
  shadowLayer.position.y = FLOOR_Y + 0.004;
  shadowLayer.receiveShadow = true;
  shadowLayer.renderOrder = 1;
  scene.add(shadowLayer);

  // soft contact-AO decal under the board so it sits on the floor instead of floating
  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = aoCanvas.height = 256;
  {
    const g = aoCanvas.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    g.shadowColor = '#fff'; g.shadowBlur = 38; g.shadowOffsetX = 1000;
    g.fillStyle = '#fff'; g.fillRect(-1000 + 62, 62, 132, 132);
  }
  const aoTex = new THREE.CanvasTexture(aoCanvas);
  const aoMat = new THREE.MeshBasicMaterial({
    color: 0x000000, alphaMap: aoTex, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false
  });
  const aoDecal = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), aoMat);
  aoDecal.rotation.x = -Math.PI / 2;
  aoDecal.position.y = FLOOR_Y + 0.002;
  aoDecal.renderOrder = 0.5;
  scene.add(aoDecal);

  let floorVisibility = 1;
  function applyFloorVisibility() {
    const t = floorVisibility;
    floor.visible = t > 0.003;
    shadowLayer.visible = t > 0.003;
    aoDecal.visible = t > 0.003;
    aoMat.opacity = 0.62 * t;
    floorMat.opacity = t;
    shadowMat.opacity = cur.shadowOpacity * t;
  }

  // ---- planar reflection (Reflector technique with a half-resolution, mip-blurred target) ----
  let reflTarget = null;
  const reflCam = new THREE.PerspectiveCamera();
  const reflMatrix = floorUniforms.reflMatrix.value;
  const _camPos = new THREE.Vector3(), _view = new THREE.Vector3(), _target = new THREE.Vector3();
  const _look = new THREE.Vector3(), _rot = new THREE.Matrix4();
  const _normal = new THREE.Vector3(0, 1, 0), _planePt = new THREE.Vector3(0, FLOOR_Y, 0);
  function setupReflectionTarget() {
    if (reflTarget) { reflTarget.dispose(); reflTarget = null; }
    if (cfg.reflection <= 0) { floorUniforms.tRefl.value = null; return; }
    const w = Math.max(2, Math.floor(width * pixelRatio * cfg.reflection));
    const h = Math.max(2, Math.floor(height * pixelRatio * cfg.reflection));
    reflTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true
    });
    floorUniforms.tRefl.value = reflTarget.texture;
  }
  function renderReflection() {
    camera.updateMatrixWorld();
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    if (_camPos.y <= FLOOR_Y + 0.05) { floorUniforms.reflStrength.value = 0; return; }
    _view.subVectors(_planePt, _camPos).reflect(_normal).negate().add(_planePt);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    _target.subVectors(_planePt, _look).reflect(_normal).negate().add(_planePt);
    reflCam.position.copy(_view);
    reflCam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_normal);
    reflCam.lookAt(_target);
    reflCam.near = camera.near; reflCam.far = camera.far;
    reflCam.updateMatrixWorld();
    reflCam.projectionMatrix.copy(camera.projectionMatrix);
    reflMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    reflMatrix.multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);

    const prevTarget = renderer.getRenderTarget();
    const prevBg = scene.background;
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    floor.visible = false; shadowLayer.visible = false; aoDecal.visible = false;
    scene.background = null;
    const cc = new THREE.Color(); renderer.getClearColor(cc);
    const ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(reflTarget);
    renderer.clear();
    renderer.render(scene, reflCam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(cc, ca);
    scene.background = prevBg;
    renderer.xr.enabled = prevXr;
    floor.visible = floorVisibility > 0.003; shadowLayer.visible = floor.visible; aoDecal.visible = floor.visible;
  }

  // ---- post-processing ----
  let composer = null;
  let gtaoPass = null, bloomPass = null, gradePass = null, smaaPass = null;
  function buildPipeline() {
    if (composer) {
      composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
      [gtaoPass, bloomPass, smaaPass].forEach((p) => p && p.dispose && p.dispose());
      composer = gtaoPass = bloomPass = gradePass = smaaPass = null;
    }
    if (!cfg.post) return;
    let rt;
    if (cfg.msaa > 0) {
      rt = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
        type: THREE.HalfFloatType, samples: cfg.msaa
      });
    }
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));
    if (cfg.gtao) {
      gtaoPass = new GTAOPass(scene, camera, width * pixelRatio, height * pixelRatio);
      gtaoPass.output = GTAOPass.OUTPUT.Default;
      gtaoPass.blendIntensity = 0.85;
      gtaoPass.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false });
      gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
      composer.addPass(gtaoPass);
    }
    if (cfg.bloom) {
      bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.07, 0.35, 3.2);
      composer.addPass(bloomPass);
    }
    composer.addPass(new OutputPass());
    gradePass = new ShaderPass(GradeShader);
    composer.addPass(gradePass);
    if (cfg.smaa) {
      smaaPass = new SMAAPass();
      composer.addPass(smaaPass);
      smaaPass.setSize(width * pixelRatio, height * pixelRatio);
    }
    syncPostUniforms();
  }
  function syncPostUniforms() {
    if (bloomPass) bloomPass.strength = cur.bloom;
    if (gradePass) {
      gradePass.uniforms.vignette.value = cur.vignette;
      gradePass.uniforms.tint.value.copy(cur.tint);
      gradePass.uniforms.aspect.value = width / height;
    }
  }

  // ---- applying animated state ----
  const _v = new THREE.Vector3();
  function applyState() {
    _v.copy(cur.key.dir).normalize().multiplyScalar(LIGHT_DIST);
    key.position.copy(_v); key.color.copy(cur.key.color); key.intensity = cur.key.intensity;
    _v.copy(cur.fill.dir).normalize().multiplyScalar(LIGHT_DIST);
    fill.position.copy(_v); fill.color.copy(cur.fill.color); fill.intensity = cur.fill.intensity;
    _v.copy(cur.rim.dir).normalize().multiplyScalar(LIGHT_DIST);
    rim.position.copy(_v); rim.color.copy(cur.rim.color); rim.intensity = cur.rim.intensity;
    scene.environmentIntensity = cur.env.intensity;
    renderer.toneMappingExposure = cur.exposure;
    floorMat.color.copy(cur.floorColor);
    floorUniforms.reflStrength.value = cfg.reflection > 0 ? cur.reflection * floorVisibility : 0;
    shadowMat.opacity = cur.shadowOpacity * floorVisibility;
    syncPostUniforms();
    paintBackdrop(cur);
  }

  applyState();
  rebuildEnvironment(cfg.pmrem);
  applyFloorVisibility();
  setupReflectionTarget();
  buildPipeline();

  let envFrame = 0;
  function updateTransition(dt) {
    if (transT >= 1) return;
    transT = Math.min(1, transT + dt / TRANSITION_SECONDS);
    blendState(cur, from, to, smooth(transT));
    applyState();
    envFrame++;
    if (transT >= 1) rebuildEnvironment(cfg.pmrem);
    else if (envFrame % 2 === 0) rebuildEnvironment(Math.min(128, cfg.pmrem));
  }

  // ---- public API ----
  function setLightingPreset(name) {
    if (!Object.prototype.hasOwnProperty.call(presetStates, name)) return;
    currentName = name;
    from = cloneState(cur);
    to = presetStates[name];
    transT = 0;
    envFrame = 0;
  }

  function setFloorVisibility(t) {
    floorVisibility = Math.min(1, Math.max(0, t));
    applyFloorVisibility();
    floorUniforms.reflStrength.value = cfg.reflection > 0 ? cur.reflection * floorVisibility : 0;
  }

  function setQuality(q) {
    if (!Object.hasOwn(QUALITY, q) || q === quality) return;
    quality = q; cfg = QUALITY[q];
    applyPixelRatio();
    renderer.setSize(width, height);
    applyShadowQuality();
    setupReflectionTarget();
    buildPipeline();
    rebuildEnvironment(cfg.pmrem);
  }

  function resize(w, h) {
    width = Math.max(1, Math.floor(w)); height = Math.max(1, Math.floor(h));
    applyPixelRatio();
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (composer) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      if (gtaoPass) gtaoPass.setSize(width * pixelRatio, height * pixelRatio);
      if (smaaPass) smaaPass.setSize(width * pixelRatio, height * pixelRatio);
    }
    setupReflectionTarget();
    syncPostUniforms();
  }

  function render(dt = 1 / 60) {
    dt = Math.min(Math.max(dt, 0), 1);
    time += dt;
    updateTransition(dt);
    renderer.shadowMap.needsUpdate = true;
    if (reflTarget && floorVisibility > 0.02) renderReflection();
    if (gradePass) gradePass.uniforms.time.value = time;
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
  }

  function dispose() {
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
    [gtaoPass, bloomPass, smaaPass].forEach((p) => p && p.dispose && p.dispose());
    if (reflTarget) reflTarget.dispose();
    if (envTarget) envTarget.dispose();
    pmrem.dispose();
    envScene.dispose();
    bgTexture.dispose();
    floor.geometry.dispose(); floorMat.dispose();
    shadowLayer.geometry.dispose(); shadowMat.dispose(); aoDecal.geometry.dispose(); aoMat.dispose(); aoTex.dispose();
    if (key.shadow.map) key.shadow.map.dispose();
    renderer.dispose();
  }

  return {
    renderer, scene, camera, floor,
    lights: { key, fill, rim },
    lightingPresets,
    setLightingPreset, setFloorVisibility, setQuality, resize, render, dispose,
    // extras (beyond the contract, harmless)
    get quality() { return quality; },
    get lightingPreset() { return currentName; },
    get composer() { return composer; }
  };
}
