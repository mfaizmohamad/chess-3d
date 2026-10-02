// Staunton set A (pawn, rook, knight).
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const RADIAL = 192;

/* ================================================================== */
/* Shared helpers                                                      */
/* ================================================================== */

function mesh(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

let darkMat = null;
function getDarkMaterial() {
  if (!darkMat) {
    darkMat = new THREE.MeshPhysicalMaterial({
      color: 0x050506, roughness: 0.12, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.04,
    });
  }
  return darkMat;
}

/**
 * Catmull-Rom (centripetal) spline through [r, y] knots, resampled with a density
 * that follows curvature so tight fillets get many points and flats get few.
 * Returns Vector2[] ready for LatheGeometry (first and last point on the axis).
 */
function smoothProfile(knots, count, turnWeight = 0.07) {
  const curve = new THREE.CatmullRomCurve3(knots.map(([r, y]) => V(r, y, 0)), false, 'centripetal');
  const fine = curve.getPoints(knots.length * 240);
  const w = [0];
  for (let i = 1; i < fine.length; i++) {
    const d = fine[i].distanceTo(fine[i - 1]);
    let turn = 0;
    if (i >= 2) {
      const a = fine[i].clone().sub(fine[i - 1]).normalize();
      const b = fine[i - 1].clone().sub(fine[i - 2]).normalize();
      turn = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
    }
    w.push(w[i - 1] + d + turnWeight * turn);
  }
  const total = w[w.length - 1];
  const pts = [];
  let k = 0;
  for (let s = 0; s < count; s++) {
    const target = (s / (count - 1)) * total;
    while (k < w.length - 2 && w[k + 1] < target) k++;
    const f = (target - w[k]) / Math.max(1e-9, w[k + 1] - w[k]);
    const p = fine[k].clone().lerp(fine[k + 1], Math.min(1, Math.max(0, f)));
    pts.push(new THREE.Vector2(Math.max(0, p.x), p.y));
  }
  pts[0].x = 0;
  pts[pts.length - 1].x = 0;
  return pts;
}

function latheFrom(knots, count) {
  const g = new THREE.LatheGeometry(smoothProfile(knots, count), RADIAL);
  return g;
}

/** Moulded round foot shared by all three pieces. Ends at y ~ 0.165 heading inward. */
function footKnots(R) {
  return [
    [0, 0], [R * 0.5, 0], [R * 0.9, 0], [R * 0.978, 0.007], [R, 0.03], [R * 0.988, 0.053],
    [R * 0.945, 0.068], [R * 0.875, 0.077],
    [R * 0.81, 0.090], [R * 0.76, 0.105], [R * 0.75, 0.115], [R * 0.76, 0.125], [R * 0.81, 0.138],
    [R * 0.855, 0.152], [R * 0.85, 0.167],
  ];
}

function accentRing(R, y, tube, major = R) {
  const g = new THREE.TorusGeometry(major, tube, 20, RADIAL);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

function triCount(g) {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}

/* ================================================================== */
/* Grid (loft) geometry utilities: rings[i][j] are Vector3               */
/* ================================================================== */

function gridNormals(rings, poleEnd) {
  const S = rings.length, N = rings[0].length;
  const nrm = rings.map((r) => r.map(() => V()));
  const e1 = V(), e2 = V(), c = V();
  const acc = (pa, pb, pc, na, nb, nc) => {
    e1.subVectors(pb, pa);
    e2.subVectors(pc, pa);
    c.crossVectors(e1, e2);
    na.add(c); nb.add(c); nc.add(c);
  };
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j1 = (j + 1) % N;
      acc(rings[i][j], rings[i][j1], rings[i + 1][j1], nrm[i][j], nrm[i][j1], nrm[i + 1][j1]);
      acc(rings[i][j], rings[i + 1][j1], rings[i + 1][j], nrm[i][j], nrm[i + 1][j1], nrm[i + 1][j]);
    }
  }
  const centroid = V();
  let cnt = 0;
  for (const r of rings) for (const p of r) { centroid.add(p); cnt++; }
  centroid.multiplyScalar(1 / cnt);
  let score = 0;
  for (let i = 0; i < S; i++) for (let j = 0; j < N; j++) {
    const n = nrm[i][j].clone().normalize();
    score += n.dot(rings[i][j].clone().sub(centroid));
  }
  const flip = score < 0;
  for (const r of nrm) for (const n of r) { n.normalize(); if (flip) n.negate(); }
  if (poleEnd) {
    const avg = V();
    for (const n of nrm[S - 1]) avg.add(n);
    avg.normalize();
    for (const n of nrm[S - 1]) n.copy(avg);
  }
  return { nrm, flip };
}

function gridToGeometry(rings, poleEnd = false, vScale = 1.5, normalsOverride = null) {
  const S = rings.length, N = rings[0].length, C = N + 1;
  const { nrm, flip } = normalsOverride || gridNormals(rings, poleEnd);
  const pos = new Float32Array(S * C * 3);
  const nor = new Float32Array(S * C * 3);
  const uv = new Float32Array(S * C * 2);
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < C; j++) {
      const jj = j % N;
      const o = i * C + j;
      const p = rings[i][jj], n = nrm[i][jj];
      pos[o * 3] = p.x; pos[o * 3 + 1] = p.y; pos[o * 3 + 2] = p.z;
      nor[o * 3] = n.x; nor[o * 3 + 1] = n.y; nor[o * 3 + 2] = n.z;
      uv[o * 2] = j / N; uv[o * 2 + 1] = (i / (S - 1)) * vScale;
    }
  }
  const idx = new Uint32Array((S - 1) * N * 6);
  let q = 0;
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * C + j, b = a + 1, c = (i + 1) * C + j, d = c + 1;
      if (!flip) { idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = a; idx[q++] = d; idx[q++] = c; }
      else { idx[q++] = a; idx[q++] = d; idx[q++] = b; idx[q++] = a; idx[q++] = c; idx[q++] = d; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Taubin smoothing on a ring grid (low-pass without shrinking). */
function smoothGrid(rings, iterations, fixedRings, poleEnd, lambda = 0.5, mu = -0.53) {
  const S = rings.length, N = rings[0].length;
  const last = poleEnd ? S - 2 : S - 1;
  const tmp = rings.map((r) => r.map((p) => p.clone()));
  const avg = V();
  for (let it = 0; it < iterations; it++) {
    for (const f of [lambda, mu]) {
      for (let i = fixedRings; i <= last; i++) {
        for (let j = 0; j < N; j++) {
          const p = rings[i][j];
          avg.set(0, 0, 0);
          let n = 0;
          avg.add(rings[i][(j + N - 1) % N]); avg.add(rings[i][(j + 1) % N]); n += 2;
          if (i > 0) { avg.add(rings[i - 1][j]); n++; }
          if (i < S - 1) { avg.add(rings[i + 1][j]); n++; }
          avg.multiplyScalar(1 / n).sub(p);
          tmp[i][j].copy(p).addScaledVector(avg, f);
        }
      }
      for (let i = fixedRings; i <= last; i++) for (let j = 0; j < N; j++) rings[i][j].copy(tmp[i][j]);
    }
  }
}

/**
 * Tube-like loft along a path. shape(u, phi) returns [x, y] in the local frame
 * (e1 = broad axis, e2 = thin axis). Last ring collapses to a point.
 */
function loftAlong(path, broad, steps, ringN, shape, poleEnd = true, frontFn = null) {
  const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');
  const rings = [];
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1);
    const P = curve.getPoint(u);
    const tan = curve.getTangent(u).normalize();
    const e1 = broad.clone().addScaledVector(tan, -broad.dot(tan)).normalize();
    const e2 = V().crossVectors(tan, e1).normalize();
    const ring = [];
    for (let j = 0; j < ringN; j++) {
      const phi = (j / ringN) * TAU;
      const [x, y] = shape(u, phi, e2);
      ring.push(P.clone().addScaledVector(e1, x).addScaledVector(e2, y));
    }
    rings.push(ring);
  }
  if (poleEnd) {
    const tip = rings[steps - 1][0].clone();
    for (const p of rings[steps - 1]) p.copy(tip);
  }
  return rings;
}

/* ================================================================== */
/* PAWN                                                                */
/* ================================================================== */

export function buildPawn(mat) {
  const R = 0.285;
  const cy = 0.74, hr = 0.16; // head sphere
  const knots = [
    ...footKnots(R),
    [0.215, 0.185], [0.160, 0.235], [0.122, 0.30], [0.098, 0.385], [0.086, 0.46], [0.084, 0.505],
    // collar: a thin flared disc with a rolled edge
    [0.098, 0.530], [0.145, 0.548], [0.172, 0.560], [0.176, 0.572], [0.165, 0.585], [0.13, 0.595], [0.094, 0.608],
    [0.088, 0.625],
  ];
  for (let a = -38; a <= 90; a += 12) {
    const t = (a * Math.PI) / 180;
    knots.push([hr * Math.cos(t), cy + hr * Math.sin(t)]);
  }
  knots[knots.length - 1][0] = 0;
  const body = latheFrom(knots, 112);
  const ring = accentRing(R * 0.765, 0.115, 0.0125);
  const collarRing = accentRing(0.128, 0.5995, 0.0075);

  const g = new THREE.Group();
  g.name = 'pawn';
  g.add(mesh(body, mat.body));
  g.add(mesh(mergeGeometries([ring, collarRing]), mat.accent));
  return g;
}

/* ================================================================== */
/* ROOK                                                                */
/* ================================================================== */

export function buildRook(mat) {
  const R = 0.31;
  const Ro = 0.268, Ri = 0.196;
  const ringY = 0.878;
  const knots = [
    ...footKnots(R),
    [0.225, 0.185], [0.19, 0.25], [0.168, 0.34], [0.158, 0.46], [0.160, 0.56], [0.172, 0.64],
    [0.19, 0.695], [0.222, 0.735], [0.252, 0.762], [0.265, 0.778], [Ro, 0.80], [Ro + 0.001, 0.84], [Ro - 0.002, 0.866],
    [Ro - 0.012, ringY - 0.001], [Ro - 0.028, ringY + 0.0015], [(Ro + Ri) / 2, ringY + 0.002], [Ri + 0.015, ringY + 0.0015],
    [Ri + 0.003, ringY - 0.006], [Ri, ringY - 0.02], [Ri - 0.001, 0.81], [Ri - 0.004, 0.785], [Ri - 0.014, 0.768],
    [Ri - 0.04, 0.759], [0.12, 0.756], [0.06, 0.755], [0, 0.755],
  ];
  const body = latheFrom(knots, 104);

  // battlements: real bevelled merlons (creased normals keep curved walls smooth)
  const MERLONS = 6;
  const span = (TAU / MERLONS) * 0.6;
  const bevel = 0.011;
  const top = 1.0, bottom = ringY - 0.012;
  const shape = new THREE.Shape();
  const arcSeg = 36;
  const ro = Ro - bevel, ri = Ri + bevel, half = span / 2 - bevel / ((ro + ri) / 2);
  for (let i = 0; i <= arcSeg; i++) {
    const a = -half + (2 * half * i) / arcSeg;
    i === 0 ? shape.moveTo(ro * Math.cos(a), ro * Math.sin(a)) : shape.lineTo(ro * Math.cos(a), ro * Math.sin(a));
  }
  for (let i = arcSeg; i >= 0; i--) {
    const a = -half + (2 * half * i) / arcSeg;
    shape.lineTo(ri * Math.cos(a), ri * Math.sin(a));
  }
  shape.closePath();
  const depth = top - bottom - 2 * bevel;
  let merlon = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: 0, bevelSegments: 5,
    curveSegments: 1, steps: 1,
  });
  merlon.rotateX(-Math.PI / 2);
  merlon.translate(0, bottom + bevel, 0);
  merlon = toCreasedNormals(merlon, 0.62);
  const merlons = [];
  for (let m = 0; m < MERLONS; m++) {
    const c = merlon.clone();
    c.rotateY((m / MERLONS) * TAU + Math.PI / MERLONS);
    merlons.push(c);
  }
  const battlements = mergeGeometries(merlons);

  const ring = accentRing(0.181, 0.672, 0.0115);
  const baseRing = accentRing(R * 0.765, 0.115, 0.0125);

  const g = new THREE.Group();
  g.name = 'rook';
  g.add(mesh(body, mat.body));
  g.add(mesh(battlements, mat.body));
  g.add(mesh(mergeGeometries([ring, baseRing]), mat.accent));
  return g;
}

/* ================================================================== */
/* KNIGHT                                                              */
/* ================================================================== */

const sgnpow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function segDist(p, a, b, out) {
  const ab = V().subVectors(b, a);
  const t = Math.min(1, Math.max(0, V().subVectors(p, a).dot(ab) / ab.lengthSq()));
  out.t = t;
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

function buildHead() {
  const N = 60, S = 176, CAP = 14;

  // side-view control curves as [z, y]; t index k aligns T[k] with B[k] (chord = head/neck depth)
  const lean = (y) => -0.085 * Math.max(0, y - 0.25); // neck leans forward
  const HS = 1.12, PV = [0.075, 0.965]; // head scale about the poll
  const hs = (arr) => arr.map(([z, y], k) => (k < 4 ? [z, y] : [PV[0] + (z - PV[0]) * HS, PV[1] + (y - PV[1]) * HS]));
  const Tk = hs([
    [0.225, 0.20], [0.245, 0.40], [0.205, 0.60], [0.140, 0.80], [0.075, 0.965],
    [-0.035, 1.040], [-0.140, 0.990], [-0.220, 0.895], [-0.305, 0.790], [-0.355, 0.715],
  ]).map(([z, y]) => [z + lean(y), y]);
  const Bk = hs([
    [-0.205, 0.20], [-0.195, 0.40], [-0.140, 0.575], [-0.095, 0.745], [-0.058, 0.730],
    [-0.100, 0.685], [-0.170, 0.655], [-0.228, 0.632], [-0.285, 0.610], [-0.330, 0.590],
  ]).map(([z, y]) => [z + lean(y), y]);
  // half width and superellipse exponent per station
  const Wk = [
    [0.170, 2.3], [0.165, 2.3], [0.140, 2.35], [0.112, 2.4], [0.132, 2.5],
    [0.142, 2.6], [0.125, 2.6], [0.093, 2.4], [0.097, 2.6], [0.092, 2.6],
  ].map(([w, n], k) => [k >= 4 ? w * 1.06 : w, n]);
  const cT = new THREE.CatmullRomCurve3(Tk.map(([z, y]) => V(0, y, z)), false, 'centripetal');
  const cB = new THREE.CatmullRomCurve3(Bk.map(([z, y]) => V(0, y, z)), false, 'centripetal');
  const cW = new THREE.CatmullRomCurve3(Wk.map(([w, n]) => V(w, n, 0)), false, 'centripetal');

  const turn = 0.2; // head turned slightly towards +x
  const pivotZ = 0.05;
  const capLen = 0.03;
  const endTan = cT.getPoint(1).clone().add(cB.getPoint(1)).multiplyScalar(0.5)
    .sub(cT.getPoint(0.99).clone().add(cB.getPoint(0.99)).multiplyScalar(0.5)).normalize();

  // surface point at station t, angle phi; scale/shift used by the rounded muzzle cap
  const P = (t, phi, scale = 1, shift = 0) => {
    const T = cT.getPoint(t), B = cB.getPoint(t);
    const M = T.clone().add(B).multiplyScalar(0.5);
    const q = T.clone().sub(M).multiplyScalar(scale);
    const wn = cW.getPoint(t);
    const e = 2 / wn.y;
    const p = M.clone().addScaledVector(q, sgnpow(Math.cos(phi), e));
    if (shift) p.addScaledVector(endTan, shift);
    p.x = wn.x * scale * sgnpow(Math.sin(phi), e);
    const a = turn * smooth01(0.3, 0.97, t);
    p.z -= pivotZ;
    p.applyAxisAngle(V(0, 1, 0), a);
    p.z += pivotZ;
    return p;
  };

  const rings = [];
  for (let i = 0; i < S; i++) {
    const t = i / (S - 1);
    const ring = [];
    for (let j = 0; j < N; j++) ring.push(P(t, (j / N) * TAU));
    rings.push(ring);
  }
  for (let c = 1; c <= CAP; c++) {
    const a = (c / CAP) * (Math.PI / 2);
    const scale = Math.cos(a), shift = Math.sin(a) * capLen;
    const ring = [];
    for (let j = 0; j < N; j++) ring.push(P(1, (j / N) * TAU, Math.max(scale, 0), shift));
    rings.push(ring);
  }
  // collapse the final ring to a single pole
  {
    const last = rings[rings.length - 1];
    const tip = last[0].clone();
    for (const p of last) p.copy(tip);
  }

  smoothGrid(rings, 5, 3, true);

  // surface detailing by displacement along normals
  const { nrm } = gridNormals(rings, true);
  const total = rings.length;
  const nearest = (pt) => {
    let best = 1e9, bi = 0, bj = 0;
    for (let i = 0; i < total; i++) for (let j = 0; j < N; j++) {
      const d = rings[i][j].distanceToSquared(pt);
      if (d < best) { best = d; bi = i; bj = j; }
    }
    return { i: bi, j: bj };
  };
  const dents = [];    // {p, rx, depth}
  const lines = [];    // {pts, r, d0, d1}
  const sideSign = [1, -1];
  const surf = (t, phi, side) => P(t, side === 1 ? phi : TAU - phi);

  const eyeInfo = [];
  const noseInfo = [];
  for (const s of sideSign) {
    // eye socket
    const eyePt = surf(0.6, 1.32, s);
    dents.push({ p: eyePt, r: 0.052, depth: 0.014 });
    // brow ridge above the eye (raised)
    dents.push({ p: surf(0.585, 0.62, s), r: 0.04, depth: -0.008 });
    // nostril
    const nPt = surf(0.965, 0.85, s);
    dents.push({ p: nPt, r: 0.024, depth: 0.019 });
    // cheek bone bulge and jaw hollow
    dents.push({ p: surf(0.5, 1.95, s), r: 0.085, depth: -0.016 });
    dents.push({ p: surf(0.6, 2.2, s), r: 0.06, depth: 0.007 });
    // mouth line from lip corner to the front, slightly parted at the muzzle
    const mp = [];
    const ts = [0.97, 0.93, 0.89, 0.85, 0.81, 0.77, 0.73];
    const ph = [1.92, 1.92, 1.9, 1.85, 1.78, 1.7, 1.6];
    ts.forEach((t, k) => mp.push(surf(t, ph[k], s)));
    lines.push({ pts: mp, r: 0.009, d0: 0.017, d1: 0.008 });
    eyeInfo.push({ t: 0.6, phi: 1.32, s });
    noseInfo.push({ t: 0.965, phi: 0.85, s });
  }
  // displace
  const tmp = { t: 0 };
  for (let i = 4; i < total - 1; i++) {
    for (let j = 0; j < N; j++) {
      const p = rings[i][j];
      let dsp = 0;
      for (const d of dents) {
        const dd = p.distanceTo(d.p) / d.r;
        if (dd < 3) dsp += d.depth * Math.exp(-dd * dd);
      }
      for (const l of lines) {
        let best = 1e9, bt = 0;
        for (let k = 0; k < l.pts.length - 1; k++) {
          const dist = segDist(p, l.pts[k], l.pts[k + 1], tmp);
          if (dist < best) { best = dist; bt = (k + tmp.t) / (l.pts.length - 1); }
        }
        const dd = best / l.r;
        if (dd < 3) dsp += (l.d0 + (l.d1 - l.d0) * bt) * Math.exp(-dd * dd);
      }
      if (dsp !== 0) p.addScaledVector(nrm[i][j], -dsp);
    }
  }
  smoothGrid(rings, 3, 3, true, 0.3, -0.32);
  const geo = gridToGeometry(rings, true, 1.6);

  // eye + nostril placements from final grid
  const finalN = gridNormals(rings, true).nrm;
  const place = (pt) => { const { i, j } = nearest(pt); return { p: rings[i][j].clone(), n: finalN[i][j].clone() }; };
  const eyes = eyeInfo.map((e) => place(surf(e.t, e.phi, e.s)));
  const nostrils = noseInfo.map((e) => place(surf(e.t, e.phi, e.s)));
  return { geo, P, eyes, nostrils, Tcurve: cT, Bcurve: cB, turn, pivotZ };
}

function buildMane(head) {
  const { P, Tcurve, Bcurve } = head;
  const geos = [];
  const side = V(-1, 0, 0);
  const t0 = 0.045, t1 = 0.47;

  // continuous rolled ridge along the crest so the locks grow out of something
  {
    const pts = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t = t0 - 0.01 + (i / (n - 1)) * (t1 - t0 + 0.01);
      const T = Tcurve.getPoint(t), B = Bcurve.getPoint(t);
      const out = T.clone().sub(B).normalize();
      pts.push(P(t, 0).addScaledVector(out, 0.004).add(V(-0.012, 0, 0)));
    }
    const rings = loftAlong(pts, V(1, 0, 0), 60, 16, (u, phi) => {
      const env = Math.pow(Math.sin(Math.PI * Math.min(0.999, 0.04 + 0.96 * u)), 0.5);
      return [0.03 * env * Math.cos(phi), 0.021 * env * Math.sin(phi)];
    });
    geos.push(gridToGeometry(rings, true, 1));
  }

  const COUNT = 15;
  for (let i = 0; i < COUNT; i++) {
    const f = i / (COUNT - 1);
    const t = t0 + f * (t1 - t0);
    const S = P(t, 0);
    const T = Tcurve.getPoint(t), B = Bcurve.getPoint(t);
    const out = T.clone().sub(B).normalize();
    const tg = Tcurve.getTangent(t).normalize();
    const down = tg.clone().negate();
    const r1 = Math.sin(i * 2.3), r2 = Math.sin(i * 1.7 + 0.6), r3 = Math.sin(i * 3.1 + 1.0);
    const len = (1.05 + 0.25 * r2) * (1.05 - 0.25 * f);
    const sx = 0.85 + 0.25 * r3;
    const path = [
      S.clone().addScaledVector(out, -0.035).addScaledVector(side, 0.008),
      S.clone().addScaledVector(out, 0.012).addScaledVector(side, 0.030 * sx),
      S.clone().addScaledVector(out, 0.030 * len).addScaledVector(down, 0.035 * len).addScaledVector(side, 0.075 * sx),
      S.clone().addScaledVector(out, 0.030 * len).addScaledVector(down, (0.10 + 0.02 * r1) * len).addScaledVector(side, 0.105 * sx),
      S.clone().addScaledVector(out, 0.040 * len).addScaledVector(down, (0.20 + 0.02 * r1) * len).addScaledVector(side, 0.105 * sx),
    ];
    const a0 = 0.046 * (1 - 0.18 * f), b0 = 0.019;
    const rings = loftAlong(path, down, 28, 10, (u, phi) => {
      const grow = smooth01(0.0, 0.10, u);
      const taper = Math.pow(1 - u, 0.55);
      const sc = grow * taper;
      return [a0 * sc * Math.cos(phi), b0 * sc * Math.sin(phi) * (1 + 0.2 * Math.cos(phi))];
    });
    geos.push(gridToGeometry(rings, true, 1));
  }
  return mergeGeometries(geos);
}

function buildEars(head) {
  const { P, Tcurve, Bcurve } = head;
  const geos = [];
  for (const s of [1, -1]) {
    const t = 0.475;
    const base = P(t, 0.42 * s > 0 ? 0.42 : TAU - 0.42);
    const T = Tcurve.getPoint(t), B = Bcurve.getPoint(t);
    const out = T.clone().sub(B).normalize();
    base.addScaledVector(out, -0.012);
    base.x = s * 0.060;
    const path = [
      base.clone().addScaledVector(out, -0.045),
      base.clone().add(V(-s * 0.002, 0.035, 0.003)),
      base.clone().add(V(-s * 0.008, 0.100, 0.000)),
      base.clone().add(V(-s * 0.016, 0.165, -0.012)),
      base.clone().add(V(-s * 0.022, 0.222, -0.030)),
    ];
    const rings = loftAlong(path, V(s, 0, 0), 40, 28, (u, phi, e2) => {
      const fs = e2.z < 0 ? 1 : -1; // which e2 direction faces forward (-z)
      const env = Math.pow(1 - u, 0.72) * (0.7 + 0.3 * smooth01(0, 0.28, u));
      const A = 0.057 * env, Bt = 0.026 * env;
      const c = Math.cos(phi), sn = Math.sin(phi);
      const front = Math.max(0, sn * fs);
      const hollow = 1 - 1.55 * front * front * Math.exp(-(c * c) / 0.55) * smooth01(0.02, 0.22, u) * (1 - 0.35 * u);
      let y = Bt * sn;
      if (sn * fs > 0) y = fs * Bt * Math.abs(sn) * hollow;
      return [A * c, y];
    });
    geos.push(gridToGeometry(rings, true, 1));
  }
  return mergeGeometries(geos);
}

function orientRing(pos, normal, radius, tube) {
  const g = new THREE.TorusGeometry(radius, tube, 12, 40);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), normal.clone().normalize());
  g.applyQuaternion(q);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

export function buildKnight(mat) {
  const R = 0.30;
  const baseKnots = [
    ...footKnots(R),
    [0.245, 0.182], [0.228, 0.205], [0.224, 0.235], [0.232, 0.256], [0.212, 0.272], [0.15, 0.278], [0.07, 0.279], [0, 0.279],
  ];
  const base = latheFrom(baseKnots, 64);
  const baseRing = accentRing(R * 0.765, 0.115, 0.0125);

  const head = buildHead();
  const mane = buildMane(head);
  const ears = buildEars(head);
  const bodyGeo = mergeGeometries([head.geo, mane, ears]);

  // eyes and nostrils
  const darkGeos = [];
  const accentGeos = [baseRing];
  for (const e of head.eyes) {
    const eye = new THREE.SphereGeometry(0.0235, 28, 20);
    eye.scale(1, 0.92, 1);
    const inward = e.n.clone().multiplyScalar(-0.0085);
    eye.translate(e.p.x + inward.x, e.p.y + inward.y, e.p.z + inward.z);
    darkGeos.push(eye);
    const c = e.p.clone().addScaledVector(e.n, 0.0006);
    accentGeos.push(orientRing(c, e.n, 0.0245, 0.0027));
  }
  for (const n of head.nostrils) {
    const nos = new THREE.SphereGeometry(0.0165, 24, 16);
    nos.scale(0.75, 0.6, 1.5);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n.n.clone().normalize());
    nos.applyQuaternion(q);
    const c = n.p.clone().addScaledVector(n.n, -0.006);
    nos.translate(c.x, c.y, c.z);
    darkGeos.push(nos);
  }

  const g = new THREE.Group();
  g.name = 'knight';
  g.add(mesh(base, mat.body));
  g.add(mesh(bodyGeo, mat.body));
  g.add(mesh(mergeGeometries(accentGeos), mat.accent));
  g.add(mesh(mergeGeometries(darkGeos), getDarkMaterial()));
  return g;
}

export const _debug = { triCount };
