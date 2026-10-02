// chessboard (marble squares, walnut frame, gold inlay, labels, plinth, highlights).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { marbleWhite, marbleBlack, walnut, maple, brass, felt } from './textures.js';

const RAD = Math.PI / 180;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ geometry builder
class Builder {
  constructor(withColor = false) { this.pos = []; this.nor = []; this.uv = []; this.col = withColor ? [] : null; this.idx = []; this.n = 0; }
  vert(x, y, z, nx, ny, nz, u, v, c) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v);
    if (this.col) this.col.push(c[0], c[1], c[2]);
    return this.n++;
  }
  /** Adds a triangle, flipping winding so that its geometric normal agrees with (nx,ny,nz). */
  tri(a, b, c, nx, ny, nz) {
    const p = this.pos;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const gx = e1y * e2z - e1z * e2y, gy = e1z * e2x - e1x * e2z, gz = e1x * e2y - e1y * e2x;
    if (gx * nx + gy * ny + gz * nz >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// Profile DSL: points { d: offset from board centre (half size), y, nd, ny: normal in the (d, y) plane }
function Profile() {
  const P = [];
  P.pt = (d, y, nd, ny) => { P.push({ d, y, nd, ny }); return P; };
  P.arc = (cd, cy, r, a0, a1, n) => {
    for (let i = 0; i <= n; i++) {
      const a = (a0 + (a1 - a0) * (i / n)) * RAD;
      P.push({ d: cd + r * Math.cos(a), y: cy + r * Math.sin(a), nd: Math.cos(a), ny: Math.sin(a) });
    }
    return P;
  };
  return P;
}

const SIDES = [
  { o: [0, 0, 1], t: [1, 0, 0] },
  { o: [1, 0, 0], t: [0, 0, -1] },
  { o: [0, 0, -1], t: [-1, 0, 0] },
  { o: [-1, 0, 0], t: [0, 0, 1] },
];

/**
 * Sweeps a profile around a square with mitred corners (four strips, so each side can carry its own uv).
 * uvFn(side, along, d, s, y) -> [u, v]; along is the signed distance along the side.
 */
function addSweep(B, prof, cx, cz, uvFn, color) {
  const s = [0];
  for (let i = 1; i < prof.length; i++) s[i] = s[i - 1] + Math.hypot(prof[i].d - prof[i - 1].d, prof[i].y - prof[i - 1].y);
  for (let si = 0; si < 4; si++) {
    const { o, t } = SIDES[si];
    const rows = [];
    for (let i = 0; i < prof.length; i++) {
      const p = prof[i];
      const nx = o[0] * p.nd, ny = p.ny, nz = o[2] * p.nd;
      const ids = [];
      for (const tt of [-1, 1]) {
        const x = o[0] * p.d + t[0] * tt * p.d, z = o[2] * p.d + t[2] * tt * p.d;
        const along = (t[0] * x + t[2] * z);
        const uv = uvFn(si, along, p.d, s[i], p.y, x, z);
        ids.push(B.vert(x + cx, p.y, z + cz, nx, ny, nz, uv[0], uv[1], color));
      }
      rows.push(ids);
    }
    for (let i = 0; i < prof.length - 1; i++) {
      if (s[i + 1] - s[i] < 1e-7) continue;
      const a = rows[i][0], b = rows[i][1], c = rows[i + 1][1], e = rows[i + 1][0];
      const nx = (prof[i].nd + prof[i + 1].nd) * 0.5 * o[0], ny = (prof[i].ny + prof[i + 1].ny) * 0.5, nz = (prof[i].nd + prof[i + 1].nd) * 0.5 * o[2];
      B.tri(a, b, c, nx, ny, nz); B.tri(a, c, e, nx, ny, nz);
    }
  }
}

function addQuadUp(B, x0, z0, x1, z1, y, uvFn, color, down = false) {
  const ny = down ? -1 : 1;
  const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => {
    const uv = uvFn(x, z);
    return B.vert(x, y, z, 0, ny, 0, uv[0], uv[1], color);
  });
  B.tri(c[0], c[1], c[2], 0, ny, 0); B.tri(c[0], c[2], c[3], 0, ny, 0);
}

// ------------------------------------------------------------------ labels
function makeLabelAtlas() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 92px "Times New Roman", Times, "Liberation Serif", serif';
  const glyphs = ['abcdefgh', '12345678'];
  for (let r = 0; r < 2; r++) for (let i = 0; i < 8; i++) {
    const cx = i * 128 + 64, cy = r * 128 + 68;
    const grad = g.createLinearGradient(0, cy - 40, 0, cy + 40);
    grad.addColorStop(0, '#fff0b8'); grad.addColorStop(0.5, '#e6b64e'); grad.addColorStop(1, '#a3711f');
    g.lineWidth = 3; g.strokeStyle = 'rgba(70,40,5,0.85)'; g.strokeText(glyphs[r][i], cx, cy);
    g.fillStyle = grad; g.fillText(glyphs[r][i], cx, cy);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  return t;
}

// ------------------------------------------------------------------ highlights
const HL_KINDS = { last: 0, check: 1, move: 2, capture: 3, select: 4 };

const HL_VERT = /* glsl */`
attribute vec3 aInst;
attribute float aSeed;
varying vec2 vUv;
varying float vKind;
varying float vSeed;
void main() {
  vUv = uv; vKind = aInst.z; vSeed = aSeed;
  vec3 p = position; p.x += aInst.x; p.z += aInst.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const HL_FRAG = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying float vKind;
varying float vSeed;
float band(float x, float c, float w, float soft) { return 1.0 - smoothstep(w - soft, w + soft, abs(x - c)); }
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float d = max(abs(p.x), abs(p.y));
  float t = uTime + vSeed * 6.283;
  vec3 col = vec3(0.0);
  float a = 0.0;
  int kind = int(vKind + 0.5);
  if (kind == 4) {            // select: amber-gold glow with a bright crisp rim
    float pulse = 0.92 + 0.08 * sin(t * 2.4);
    float fill = (0.42 + 0.30 * smoothstep(0.6, 0.0, r)) * pulse;
    float edge = band(d, 0.455, 0.020, 0.016) * 0.9;
    float rim = exp(-pow((d - 0.47) / 0.06, 2.0)) * 0.35;
    a = clamp(fill + edge + rim, 0.0, 0.95) * smoothstep(0.5, 0.488, d);
    col = mix(lin(vec3(1.0, 0.66, 0.06)), lin(vec3(1.0, 0.93, 0.55)), clamp(edge + 0.35 * smoothstep(0.35, 0.0, r), 0.0, 1.0));
  } else if (kind == 2) {     // move: emerald ring with soft halo and centre dot
    float r0 = 0.285 + 0.012 * sin(t * 3.0);
    float ring = band(r, r0, 0.030, 0.024);
    float halo = exp(-pow((r - r0) / 0.085, 2.0)) * 0.40;
    float dotc = exp(-pow(r / 0.065, 2.0)) * (0.55 + 0.15 * sin(t * 3.0));
    float inner = smoothstep(r0, 0.0, r) * 0.10;
    a = clamp(ring * 0.95 + halo + dotc + inner, 0.0, 0.95);
    col = mix(lin(vec3(0.05, 0.72, 0.42)), lin(vec3(0.60, 1.0, 0.78)), clamp(dotc + ring * 0.30, 0.0, 1.0));
  } else if (kind == 3) {     // capture: red ring hugging the square, with a faint red wash
    float r0 = 0.39 + 0.010 * sin(t * 4.0);
    float ring = band(r, r0, 0.040, 0.030);
    float halo = exp(-pow((r - r0) / 0.10, 2.0)) * 0.45;
    float wash = smoothstep(0.18, 0.52, r) * 0.30 * (0.85 + 0.15 * sin(t * 4.0));
    a = clamp(ring * 0.95 + halo + wash, 0.0, 0.95) * smoothstep(0.5, 0.47, d);
    col = mix(lin(vec3(0.92, 0.06, 0.05)), lin(vec3(1.0, 0.40, 0.25)), ring * 0.45);
  } else if (kind == 1) {     // check: pulsing red-orange radial glow
    float pulse = 0.5 + 0.5 * sin(t * 5.0);
    float glow = pow(smoothstep(0.62, 0.0, r), 1.4);
    a = clamp((0.42 + 0.45 * pulse) * glow + band(d, 0.46, 0.02, 0.018) * (0.4 + 0.5 * pulse), 0.0, 0.95);
    col = mix(lin(vec3(1.0, 0.10, 0.02)), lin(vec3(1.0, 0.50, 0.12)), glow * glow * (0.4 + 0.6 * pulse));
  } else {                    // last move: subtle amber wash
    float wash = 0.26 + 0.10 * smoothstep(0.5, 0.25, d);
    float edge = band(d, 0.47, 0.012, 0.016) * 0.3;
    a = (wash + edge) * smoothstep(0.5, 0.48, d);
    col = lin(vec3(0.95, 0.50, 0.04));
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function createHighlights() {
  const CAP = 192;
  const plane = new THREE.PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  plane.translate(0, 0.0045, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  const seed = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
  inst.setUsage(THREE.DynamicDrawUsage); seed.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aInst', inst); geo.setAttribute('aSeed', seed);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: HL_VERT, fragmentShader: HL_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.castShadow = false; mesh.receiveShadow = false; // transparent overlay must not cast a square shadow
  mesh.raycast = () => {};
  mesh.name = 'highlights';

  function set(list) {
    const items = (list || []).filter((h) => h && h.kind in HL_KINDS).sort((a, b) => HL_KINDS[a.kind] - HL_KINDS[b.kind]).slice(0, CAP);
    items.forEach((h, i) => {
      inst.setXYZ(i, h.file - 3.5, 3.5 - h.rank, HL_KINDS[h.kind]);
      seed.setX(i, ((h.file * 7 + h.rank * 13) % 11) / 11);
    });
    geo.instanceCount = items.length;
    inst.needsUpdate = true; seed.needsUpdate = true;
    mesh.visible = items.length > 0;
  }
  mesh.visible = false;
  return { mesh, set, mat };
}

// ------------------------------------------------------------------ board
export function createBoard() {
  const group = new THREE.Group();
  group.name = 'board';

  const tw = marbleWhite(), tb = marbleBlack(), twn = walnut(), tm = maple(), tbr = brass(), tf = felt();

  const maxAniso = 16;
  for (const t of [tw, tb, twn, tm, tbr, tf]) for (const k of Object.keys(t)) t[k].anisotropy = maxAniso;

  // ---- materials
  const lightMat = new THREE.MeshPhysicalMaterial({
    name: 'marble-white', map: tw.map, normalMap: tw.normalMap, normalScale: new THREE.Vector2(0.15, 0.15),
    roughnessMap: tw.roughnessMap, roughness: 1, metalness: 0, vertexColors: true,
    clearcoat: 0.55, clearcoatRoughness: 0.06, specularIntensity: 0.9, envMapIntensity: 1.0,
  });
  const darkMat = new THREE.MeshPhysicalMaterial({
    name: 'marble-black', map: tb.map, normalMap: tb.normalMap, normalScale: new THREE.Vector2(0.15, 0.15),
    roughnessMap: tb.roughnessMap, metalnessMap: tb.metalnessMap, roughness: 1, metalness: 1, vertexColors: true,
    clearcoat: 0.6, clearcoatRoughness: 0.05, envMapIntensity: 1.1,
  });
  const walnutMat = new THREE.MeshPhysicalMaterial({
    name: 'walnut', map: twn.map, normalMap: twn.normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: twn.roughnessMap, roughness: 1, metalness: 0,
    clearcoat: 0.45, clearcoatRoughness: 0.22, envMapIntensity: 1.0,
  });
  const plinthMat = walnutMat.clone();
  plinthMat.name = 'plinth'; plinthMat.color = new THREE.Color(0.42, 0.40, 0.40); plinthMat.clearcoat = 0.2;
  const mapleMat = new THREE.MeshPhysicalMaterial({
    name: 'maple', map: tm.map, normalMap: tm.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: tm.roughnessMap, roughness: 1, metalness: 0,
    clearcoat: 0.45, clearcoatRoughness: 0.2, envMapIntensity: 1.0,
  });
  const goldMat = new THREE.MeshPhysicalMaterial({
    name: 'brass', map: tbr.map, normalMap: tbr.normalMap, normalScale: new THREE.Vector2(0.4, 0.4),
    roughnessMap: tbr.roughnessMap, roughness: 1, metalness: 1, envMapIntensity: 1.25,
  });
  const feltMat = new THREE.MeshStandardMaterial({
    name: 'felt', map: tf.map, normalMap: tf.normalMap, roughnessMap: tf.roughnessMap, roughness: 1, metalness: 0,
  });

  // ---- squares (two merged meshes, one per colour) + invisible pick planes
  const HALF = 0.49, BEV = 0.014;
  const sqProf = Profile().arc(HALF - BEV, 0 - BEV, BEV, 90, 0, 4).pt(HALF, -0.05, 1, 0);
  const rnd = mulberry32(20260930);
  const BL = new Builder(true), BD = new Builder(true);
  const squareCenterXZ = (f, r) => [f - 3.5, 3.5 - r];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const dark = (f + r) % 2 === 0;
    const B = dark ? BD : BL;
    const [cx, cz] = squareCenterXZ(f, r);
    const ang = rnd() * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
    const k = 0.40 + rnd() * 0.12, ou = rnd(), ov = rnd(), mir = rnd() < 0.5 ? -1 : 1;
    const uvAt = (lx, lz) => [ou + k * (ca * lx * mir - sa * lz), ov + k * (sa * lx * mir + ca * lz)];
    // tone variation, slight warm/cool drift
    const h = rnd() * 2 - 1;
    const L = dark ? 0.82 + rnd() * 0.40 : 0.91 + rnd() * 0.12;
    const tint = dark ? [L * (1 + h * 0.03), L, L * (1 - h * 0.03)] : [L * (1 + h * 0.018), L, L * (1 - h * 0.018)];
    addSweep(B, sqProf, cx, cz, (si, along, d, s, y, x, z) => uvAt(x, z), tint);
    addQuadUp(B, cx - (HALF - BEV), cz - (HALF - BEV), cx + (HALF - BEV), cz + (HALF - BEV), 0,
      (x, z) => uvAt(x - cx, z - cz), tint);
  }
  const lightMesh = new THREE.Mesh(BL.build(), lightMat); lightMesh.name = 'squares-light';
  const darkMesh = new THREE.Mesh(BD.build(), darkMat); darkMesh.name = 'squares-dark';

  const pickGeo = new THREE.PlaneGeometry(1, 1); pickGeo.rotateX(-Math.PI / 2);
  const pickMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  const squareMeshes = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const m = new THREE.Mesh(pickGeo, pickMat);
    const [cx, cz] = squareCenterXZ(f, r);
    m.position.set(cx, 0, cz);
    m.userData.square = { file: f, rank: r };
    m.name = 'sq-' + 'abcdefgh'[f] + (r + 1);
    m.castShadow = true; m.receiveShadow = true;
    squareMeshes.push(m);
  }

  // ---- frame, inlays, plinth
  const uvWood = (scaleAlong, scaleAcross) => (si, along, d, s) => [along / scaleAlong + si * 0.31, s / scaleAcross + si * 0.17];
  const BW = new Builder(), BM = new Builder(), BG = new Builder(), BP = new Builder();
  const framePro = Profile()
    .pt(4.04, -0.10, -1, 0).pt(4.04, 0.04, -1, 0).arc(4.06, 0.04, 0.02, 180, 90, 4)
    .pt(4.50, 0.06, 0, 1)
    .pt(4.50, 0.06, 1, 0).pt(4.50, 0.03, 1, 0)
    .pt(4.50, 0.03, 0, 1).pt(4.56, 0.03, 0, 1)
    .pt(4.56, 0.03, -1, 0).pt(4.56, 0.06, -1, 0)
    .pt(4.56, 0.06, 0, 1).pt(4.58, 0.06, 0, 1)
    .arc(4.58, -0.01, 0.07, 90, 0, 10)
    .pt(4.65, -0.30, 1, 0)
    .arc(4.63, -0.30, 0.02, 0, -90, 4)
    .pt(4.56, -0.32, 0, -1);
  addSweep(BW, framePro, 0, 0, uvWood(5.5, 2.4));
  const plinthPro = Profile().pt(4.56, -0.32, 1, 0).pt(4.56, -0.48, 1, 0).arc(4.52, -0.48, 0.04, 0, -90, 5).pt(4.30, -0.52, 0, -1);
  addSweep(BP, plinthPro, 0, 0, uvWood(5.5, 2.4));
  // maple strip + gold lines
  addSweep(BM, Profile().pt(4.50, 0.06, 0, 1).pt(4.535, 0.06, 0, 1), 0, 0, (si, along, d, s) => [along / 2.0 + si * 0.23, s / 0.12 + si * 0.4]);
  const goldUv = (si, along, d, s) => [along / 3.0 + si * 0.2, s / 0.5];
  addSweep(BG, Profile().pt(4.535, 0.06, 0, 1).pt(4.56, 0.06, 0, 1), 0, 0, goldUv);
  // gold underlay visible as the lines between squares and the border line
  addQuadUp(BG, -4.04, -4.04, 4.04, 4.04, -0.008, () => [0.37, 0.61]);

  // feet: four brass bun feet
  const footProfile = [[0, -0.6], [0.16, -0.6], [0.205, -0.594], [0.232, -0.575], [0.245, -0.548], [0.25, -0.52], [0, -0.52]].map(([r, y]) => new THREE.Vector2(r, y));
  const footGeo = new THREE.LatheGeometry(footProfile, 48);
  const goldGeos = [BG.build()];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = footGeo.clone(); g.translate(sx * 3.75, 0, sz * 3.75); goldGeos.push(g);
  }
  const goldMesh = new THREE.Mesh(mergeGeometries(goldGeos), goldMat);
  goldMesh.name = 'gold-inlay';

  const frameMesh = new THREE.Mesh(BW.build(), walnutMat); frameMesh.name = 'frame';
  const mapleMesh = new THREE.Mesh(BM.build(), mapleMat); mapleMesh.name = 'maple-inlay';
  const plinthGeo = BP.build();
  const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat); plinthMesh.name = 'plinth';
  // bottom cap uses felt so the underside reads as a finished base
  const feltBuilder = new Builder();
  addQuadUp(feltBuilder, -4.30, -4.30, 4.30, 4.30, -0.5205, (x, z) => [x * 0.5, z * 0.5], undefined, true);
  const feltMesh = new THREE.Mesh(feltBuilder.build(), feltMat); feltMesh.name = 'felt';

  // ---- labels
  const atlas = makeLabelAtlas();
  const LH = 0.15, LY = 0.0615, LR = 4.29;
  const addLabel = (lb, cx, cz, right, up, col, row) => {
    const u0 = col / 8 + 0.004, u1 = (col + 1) / 8 - 0.004, v1 = 1 - row * 0.5 - 0.004, v0 = 1 - (row + 1) * 0.5 + 0.004;
    const corner = (sr, su) => [cx + right[0] * LH * sr + up[0] * LH * su, LY, cz + right[2] * LH * sr + up[2] * LH * su];
    const q = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]].map(([sr, su, u, v]) => {
      const p = corner(sr, su);
      return lb.vert(p[0], p[1], p[2], 0, 1, 0, u, v);
    });
    lb.tri(q[0], q[1], q[2], 0, 1, 0); lb.tri(q[0], q[2], q[3], 0, 1, 0);
  };
  // Two complete label sets on all four edges: one reads upright for a viewer on White's side (camera at +z),
  // the other for a viewer on Black's side. orientLabels() shows the one matching the current screen-up direction,
  // so every label reads upright in the White, Top down and Black views alike.
  const W_R = [1, 0, 0], W_U = [0, 0, -1];
  const B_R = [-1, 0, 0], B_U = [0, 0, 1];
  const buildLabels = (right, up) => {
    const lb = new Builder();
    for (let i = 0; i < 8; i++) {
      addLabel(lb, i - 3.5, LR, right, up, i, 0);    // files, near edge
      addLabel(lb, i - 3.5, -LR, right, up, i, 0);   // files, far edge
      addLabel(lb, -LR, 3.5 - i, right, up, i, 1);   // ranks, left edge
      addLabel(lb, LR, 3.5 - i, right, up, i, 1);    // ranks, right edge
    }
    return lb.build();
  };
  const labelMat = new THREE.MeshPhysicalMaterial({
    map: atlas, transparent: true, alphaTest: 0.02, depthWrite: false, roughness: 0.32, metalness: 0.85,
    envMapIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const labelsW = new THREE.Mesh(buildLabels(W_R, W_U), labelMat); labelsW.name = 'labels-w'; labelsW.renderOrder = 1;
  const labelsB = new THREE.Mesh(buildLabels(B_R, B_U), labelMat); labelsB.name = 'labels-b'; labelsB.renderOrder = 1;
  labelsB.visible = false;

  // ---- highlights
  const hl = createHighlights();

  const all = [lightMesh, darkMesh, frameMesh, mapleMesh, goldMesh, plinthMesh, feltMesh, labelsW, labelsB];
  for (const m of all) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  labelsW.castShadow = false; labelsB.castShadow = false;
  for (const m of squareMeshes) group.add(m);
  group.add(hl.mesh);

  let time = 0;
  return {
    group,
    squareMeshes,
    squareCenter(file, rank) { return new THREE.Vector3(file - 3.5, 0, 3.5 - rank); },
    setHighlights(list) { hl.set(list); },
    clearHighlights() { hl.set([]); },
    /** upLocal: the screen-up direction expressed in board space. Picks the label set that reads upright. */
    orientLabels(upLocal) {
      if (upLocal.z < -0.05) { labelsW.visible = true; labelsB.visible = false; }
      else if (upLocal.z > 0.05) { labelsW.visible = false; labelsB.visible = true; }
    },
    update(dt, t) {
      time = (typeof t === 'number') ? t : time + (dt || 0);
      hl.mat.uniforms.uTime.value = time;
    },
  };
}
