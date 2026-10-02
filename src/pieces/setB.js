// Bishop, queen and king builders (Staunton, high resolution lathe bodies).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PI = Math.PI;
const SEG = 192; // radial segments of the main turned bodies

/* ------------------------------------------------------------------ */
/* Profile builder: a polyline in (r, y), densely sampled.             */
/* A repeated point marks a hard crease (vertices are split there).    */
/* ------------------------------------------------------------------ */
class Prof {
  constructor(r = 0, y = 0, k = 1.7) { this.p = [[r, y]]; this.k = k; }
  get last() { return this.p[this.p.length - 1]; }
  to(r, y, step = 0.02) {
    const [r0, y0] = this.last;
    const n = Math.max(1, Math.ceil(Math.hypot(r - r0, y - y0) / (step * this.k)));
    for (let k = 1; k <= n; k++) this.p.push([r0 + (r - r0) * k / n, y0 + (y - y0) * k / n]);
    return this;
  }
  spline(pts, step = 0.016) {
    const v = [new THREE.Vector3(this.last[0], this.last[1], 0), ...pts.map(q => new THREE.Vector3(q[0], q[1], 0))];
    const c = new THREE.CatmullRomCurve3(v, false, 'centripetal');
    const n = Math.max(2, Math.ceil(c.getLength() / (step * this.k)));
    const s = c.getSpacedPoints(n);
    for (let k = 1; k < s.length; k++) this.p.push([s[k].x, s[k].y]);
    return this;
  }
  arc(cx, cy, rad, a0, a1, deg = 8) {
    const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) / (deg * this.k * PI / 180)));
    for (let k = 0; k <= n; k++) {
      const a = a0 + (a1 - a0) * k / n;
      const q = [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
      if (k === 0 && Math.hypot(q[0] - this.last[0], q[1] - this.last[1]) < 1e-7) continue;
      this.p.push(q);
    }
    return this;
  }
  corner() { this.p.push([...this.last]); return this; }
}

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Lathe a profile into an indexed, smooth-shaded geometry with analytic normals.
 *  opts.displace(x, y, z, r, theta) -> inward radial offset (>= 0); affected normals are
 *  recomputed from the displaced grid. opts.closed: profile is a closed loop (ring). */
function lathe(prof, seg = SEG, opts = {}) {
  const P = prof.p, n = P.length, cols = seg + 1;
  const pos = new Float32Array(n * cols * 3), nor = new Float32Array(n * cols * 3), uv = new Float32Array(n * cols * 2);
  const arc = new Float32Array(n);
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const total = arc[n - 1] || 1;
  const pn = [];
  for (let i = 0; i < n; i++) {
    const a = i > 0 && !same(P[i - 1], P[i]) ? i - 1 : i;
    const b = i < n - 1 && !same(P[i], P[i + 1]) ? i + 1 : i;
    let tr = P[b][0] - P[a][0], ty = P[b][1] - P[a][1];
    const l = Math.hypot(tr, ty) || 1; tr /= l; ty /= l;
    pn.push([ty, -tr]);
  }
  const disp = opts.displace;
  const dmask = disp ? new Uint8Array(n * cols) : null;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < cols; j++) {
      const th = (j % seg) / seg * 2 * PI, c = Math.cos(th), s = Math.sin(th);
      const k = i * cols + j;
      let r = P[i][0];
      if (disp) {
        const d = disp(r * c, P[i][1], r * s, r, th);
        if (d > 1e-6) { r -= d; dmask[k] = 1; }
      }
      pos[k * 3] = r * c; pos[k * 3 + 1] = P[i][1]; pos[k * 3 + 2] = r * s;
      nor[k * 3] = pn[i][0] * c; nor[k * 3 + 1] = pn[i][1]; nor[k * 3 + 2] = pn[i][0] * s;
      uv[k * 2] = j / seg; uv[k * 2 + 1] = arc[i] / total;
    }
  }
  if (disp) {
    // dilate mask by one cell, then recompute those normals from the displaced grid
    const m2 = new Uint8Array(dmask);
    for (let i = 0; i < n; i++) for (let j = 0; j < cols; j++) {
      if (!dmask[i * cols + j]) continue;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const ii = i + di; if (ii < 0 || ii >= n) continue;
        m2[ii * cols + ((j + dj + seg) % seg)] = 1; m2[ii * cols + (((j + dj + seg) % seg) === 0 ? seg : ((j + dj + seg) % seg))] = 1;
      }
    }
    const at = (i, j) => (i * cols + ((j % seg) + seg) % seg) * 3;
    for (let i = 1; i < n - 1; i++) for (let j = 0; j < seg; j++) {
      if (!m2[i * cols + j]) continue;
      const a = at(i + 1, j), b = at(i - 1, j), c = at(i, j + 1), d = at(i, j - 1);
      const ei = [pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]];
      const ej = [pos[c] - pos[d], pos[c + 1] - pos[d + 1], pos[c + 2] - pos[d + 2]];
      let nx = ei[1] * ej[2] - ei[2] * ej[1], ny = ei[2] * ej[0] - ei[0] * ej[2], nz = ei[0] * ej[1] - ei[1] * ej[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      for (const jj of (j === 0 ? [0, seg] : [j])) {
        const k = (i * cols + jj) * 3;
        nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l;
      }
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    if (same(P[i], P[i + 1])) continue;
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = (i + 1) * cols + j, c = a + 1, d = b + 1;
      if (opts.flipFront && Math.sin(((j + 0.5) / seg) * 2 * PI) < 0) idx.push(a, b, d, a, d, c);
      else idx.push(a, b, c, c, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Closed torus-like ring lathed from a circle (used for gold bands). */
function ring(major, minor, y, seg = 160, tube = 14) {
  const p = new Prof(major, y - minor, 1);
  p.arc(major, y, minor, -PI / 2, 1.5 * PI, 360 / tube);
  return lathe(p, seg);
}

/** Ring of small spheres (pearls). */
function pearls(count, radius, y, rad, phase = 0) {
  const parts = [];
  const base = new THREE.SphereGeometry(rad, 14, 9);
  for (let k = 0; k < count; k++) {
    const a = phase + (k / count) * 2 * PI;
    const g = base.clone();
    g.translate(radius * Math.cos(a), y, radius * Math.sin(a));
    parts.push(g);
  }
  return mergeGeometries(parts);
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ */
/* Shared Staunton foot: plinth, bead and concave cove into the stem   */
/* ------------------------------------------------------------------ */
function foot(p, R, rs, yEnd = 0.44) {
  p.to(R - 0.022, 0, 0.05);
  p.arc(R - 0.022, 0.022, 0.022, -PI / 2, 0);                     // rounded bottom edge
  p.to(R, 0.046, 0.012);
  p.arc(R - 0.018, 0.046, 0.018, 0, PI / 2);                      // rounded plinth top
  // shelf inward to where the bead meets it
  const br = 0.028, cr = R - 0.06, cy = 0.085;
  const a0 = Math.asin((0.064 - cy) / br);
  p.to(cr + br * Math.cos(a0), 0.064, 0.012).corner();
  p.arc(cr, cy, br, a0, 1.0, 7);                                  // torus bead
  const [r0, y0] = p.last;
  const pts = [];
  for (let k = 1; k <= 10; k++) {
    const u = k / 10;
    pts.push([rs + (r0 - rs) * Math.pow(1 - u, 3.0), y0 + (yEnd - y0) * u]);
  }
  p.spline(pts, 0.022);                                           // concave cove
}

/** Collar disc with a bead edge. Returns nothing; leaves profile on the shelf inner end. */
function collar(p, rIn, rOut, y, bead) {
  p.spline([[rIn + (rOut - rIn) * 0.35, y - bead * 0.75], [rOut - bead * 0.1, y - bead]], 0.01);
  p.arc(rOut, y, bead, -PI / 2, PI / 2, 12);
}

function indexed(g) {
  if (!g.index) {
    const n = g.attributes.position.count, a = new Uint32Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    g.setIndex(new THREE.BufferAttribute(a, 1));
  }
  return g;
}

function pieceFrom(mat, bodyGeoms, accentGeoms, name) {
  const g = new THREE.Group();
  g.name = name;
  const add = (geoms, material, tag) => {
    if (!geoms.length) return;
    geoms.forEach(indexed);
    const geo = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms);
    geoms.forEach(x => { if (x !== geo) x.dispose(); });
    const m = new THREE.Mesh(geo, material);
    m.name = `${name}-${tag}`;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  };
  add(bodyGeoms, mat.body, 'body');
  add(accentGeoms, mat.accent, 'accent');
  return g;
}

/* ------------------------------------------------------------------ */
/* BISHOP  (height 1.35, base diameter 0.62)                           */
/* ------------------------------------------------------------------ */
export function buildBishop(mat) {
  const R = 0.31;
  // --- turned lower body: foot, stem, collar, neck
  const p = new Prof(0, 0);
  foot(p, R, 0.105);
  p.spline([[0.099, 0.54], [0.094, 0.6], [0.098, 0.64]], 0.02);
  collar(p, 0.104, 0.15, 0.678, 0.0155);
  p.spline([[0.13, 0.706], [0.113, 0.726], [0.106, 0.75], [0.105, 0.77]], 0.014);
  const lower = lathe(p, SEG);
  // hidden plug covering any seam between the 192 and 240 segment bodies
  const plug = new THREE.CylinderGeometry(0.097, 0.097, 0.08, 48, 1);
  plug.translate(0, 0.77, 0);

  // --- mitre (ogive) with diagonal slit, built as real displaced geometry, plus finial
  const m = new Prof(0.105, 0.77, 1.0);
  m.spline([[0.108, 0.795], [0.121, 0.83], [0.143, 0.875], [0.163, 0.93], [0.173, 0.995],
    [0.168, 1.06], [0.148, 1.12], [0.116, 1.172], [0.08, 1.212], [0.05, 1.235], [0.036, 1.244]], 0.0066);
  m.to(0.028, 1.252, 0.01);
  m.to(0.028, 1.263, 0.01).corner();
  m.arc(0, 1.302, 0.048, -Math.acos(0.028 / 0.048), PI / 2, 9);   // finial ball
  const alpha = 0.62, yc = 1.0, sa = Math.sin(alpha), ca = Math.cos(alpha);
  const W = 0.0235, D = 0.05;
  const mitre = lathe(m, 224, {
    flipFront: true,
    displace: (x, y, z, r) => {
      if (y < 0.88 || y > 1.14 || r < 0.05) return 0;
      const dist = Math.abs(-x * sa + (y - yc) * ca);
      if (dist > W) return 0;
      const g = sstep(0.2, 0.7, Math.abs(z) / r);                  // slit on both faces (-z and +z)
      if (g <= 0) return 0;
      const s = 1 - sstep(0.3 * W, W, dist);
      return D * g * s * (r / 0.17);
    },
  });
  const accent = [ring(0.04, 0.0135, 1.248, 128, 14)];
  return pieceFrom(mat, [lower, plug, mitre], accent, 'bishop');
}

/* ------------------------------------------------------------------ */
/* QUEEN  (height 1.60, base diameter 0.66)                            */
/* ------------------------------------------------------------------ */
export function buildQueen(mat) {
  const R = 0.33;
  const p = new Prof(0, 0);
  foot(p, R, 0.111);
  p.spline([[0.103, 0.52], [0.098, 0.6], [0.1, 0.655]], 0.02);
  collar(p, 0.104, 0.162, 0.697, 0.014);
  p.to(0.11, 0.711, 0.01);                                        // shelf that carries the pearls
  p.spline([[0.1, 0.735], [0.098, 0.77], [0.108, 0.83], [0.128, 0.9], [0.152, 0.98],
    [0.174, 1.06], [0.192, 1.14], [0.205, 1.22], [0.212, 1.3]], 0.02);
  // crown bowl
  p.spline([[0.23, 1.318], [0.252, 1.342], [0.26, 1.368]], 0.01);
  p.arc(0.248, 1.372, 0.012, 0, PI / 2, 10);
  p.spline([[0.205, 1.4], [0.15, 1.42], [0.1, 1.443], [0.06, 1.462], [0.045, 1.48], [0.038, 1.498]], 0.012).corner();
  const bc = 1.542, br = 0.058;
  p.arc(0, bc, br, -Math.acos(0.038 / br), PI / 2, 7);             // large ball
  const body = [lathe(p, SEG)];

  // coronet: 14 tapered tines with sphere tips, built once, then placed around the crown
  const N = 12, tineR = 0.222, tineY = 1.39;
  const tp = new Prof(0, -0.02);
  tp.to(0.056, -0.02, 0.02);
  const tpts = [];
  for (let k = 1; k <= 12; k++) { const u = k / 12; tpts.push([0.0085 + 0.046 * Math.pow(1 - u, 2.0), -0.02 + 0.17 * u]); }
  tp.spline(tpts, 0.012);
  tp.to(0, 0.15, 0.01);
  const tine = lathe(tp, 20);
  const lean = 0.14, bend = 0.45;
  const bendX = y => Math.max(0, y) * lean + bend * Math.max(0, y) * Math.max(0, y);
  const tv = tine.attributes.position;
  for (let i = 0; i < tv.count; i++) tv.setX(i, tv.getX(i) + bendX(tv.getY(i)));
  // bend breaks analytic normals: rebuild from the grid (20 cols, no creases)
  tine.computeVertexNormals();
  {
    const nn = tine.attributes.normal, cols = 21, rows = nn.count / cols;
    for (let i = 0; i < rows; i++) {
      const a = i * cols, b = a + 20;
      const x = nn.getX(a) + nn.getX(b), y = nn.getY(a) + nn.getY(b), z = nn.getZ(a) + nn.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      nn.setXYZ(a, x / l, y / l, z / l); nn.setXYZ(b, x / l, y / l, z / l);
    }
  }
  const cap = new THREE.SphereGeometry(0.0225, 18, 12);
  cap.translate(bendX(0.151), 0.151 + 0.009, 0);
  const tineFull = mergeGeometries([tine, cap]);
  const tines = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * 2 * PI;
    const g = tineFull.clone();
    g.translate(tineR, tineY, 0);
    g.rotateY(-a);
    tines.push(g);
  }
  body.push(...tines);
  const accent = [
    ring(0.2145, 0.0125, 1.296, 160, 14),
    pearls(30, 0.1305, 0.7275, 0.0112),
  ];
  return pieceFrom(mat, body, accent, 'queen');
}

/* ------------------------------------------------------------------ */
/* KING  (height 1.85, base diameter 0.72)                             */
/* ------------------------------------------------------------------ */
export function buildKing(mat) {
  const R = 0.36;
  const p = new Prof(0, 0);
  foot(p, R, 0.121);
  p.spline([[0.112, 0.54], [0.107, 0.62], [0.109, 0.672]], 0.02);
  collar(p, 0.114, 0.178, 0.714, 0.0155);
  p.to(0.118, 0.7295, 0.01);
  p.spline([[0.11, 0.752], [0.107, 0.79], [0.106, 0.822]], 0.012);
  // small moulding bead above the collar
  p.arc(0.104, 0.838, 0.016, -PI / 2, PI / 2, 12);
  p.spline([[0.108, 0.88], [0.122, 0.95], [0.145, 1.03], [0.172, 1.11], [0.2, 1.19],
    [0.222, 1.27], [0.235, 1.34]], 0.02);
  // broad crown
  p.spline([[0.246, 1.362], [0.257, 1.388], [0.258, 1.41]], 0.01);
  p.arc(0.246, 1.414, 0.012, 0, PI / 2, 10);
  p.spline([[0.21, 1.45], [0.16, 1.475], [0.11, 1.497], [0.07, 1.512], [0.05, 1.522], [0.034, 1.536], [0.032, 1.55]], 0.012).corner();
  const oc = 1.59, orr = 0.05;
  p.arc(0, oc, orr, -Math.acos(0.032 / orr), PI / 2, 7);           // orb
  const body = [lathe(p, SEG)];

  // sculpted cross: rounded-edge bars with smooth bevels
  const vbar = new RoundedBoxGeometry(0.06, 0.23, 0.054, 8, 0.021);
  vbar.translate(0, 1.62 + 0.115, 0);
  const hbar = new RoundedBoxGeometry(0.17, 0.058, 0.054, 8, 0.021);
  hbar.translate(0, 1.77, 0);
  body.push(vbar, hbar);

  const accent = [
    ring(0.2375, 0.0135, 1.3485, 160, 14),
    ring(0.205, 0.0085, 1.4585, 128, 12),
    pearls(32, 0.1475, 0.7475, 0.0118),
    pearls(40, 0.232, 1.445, 0.0088, 0.05),
  ];
  return pieceFrom(mat, body, accent, 'king');
}
