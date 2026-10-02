// procedural canvas textures (marble, wood, brass, felt). No image files, all tileable.
import * as THREE from 'three';

// ---------------------------------------------------------------- noise
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periodic gradient noise. Periods must be powers of two (mx = period - 1). Output roughly -1..1. */
function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(2048);
  for (let i = 0; i < 2048; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  return function noise(x, y, mx, my) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = xi & mx, x1 = (xi + 1) & mx, y0 = yi & my, y1 = (yi + 1) & my;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const h00 = perm[perm[x0] + y0], h10 = perm[perm[x1] + y0];
    const h01 = perm[perm[x0] + y1], h11 = perm[perm[x1] + y1];
    const n00 = gx[h00] * xf + gy[h00] * yf;
    const n10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const n01 = gx[h01] * xf + gy[h01] * (yf - 1);
    const n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.4142;
  };
}

/** Periodic fbm, base frequency f (power of two) cells per unit, normalised amplitude. */
function fbm(n, u, v, f, oct, gain = 0.5) {
  let a = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n(u * f, v * f, f - 1, f - 1);
    norm += a; a *= gain; f *= 2;
  }
  return s / norm;
}

/** Anisotropic fbm: separate base frequencies along u and v. */
function fbmA(n, u, v, fx, fy, oct, gain = 0.5) {
  let a = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n(u * fx, v * fy, fx - 1, fy - 1);
    norm += a; a *= gain; fx *= 2; fy *= 2;
  }
  return s / norm;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

/** Low resolution periodic grid for smooth fields, bilinear lookup with wrap. */
function makeGrid(G, fn) {
  const a = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) a[j * G + i] = fn(i / G, j / G);
  return { a, G };
}
function gridS(gr, u, v) {
  const G = gr.G, m = G - 1, a = gr.a;
  const fx = u * G, fy = v * G;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const x0 = ix & m, x1 = (ix + 1) & m, y0 = iy & m, y1 = (iy + 1) & m;
  const a0 = a[y0 * G + x0] + (a[y0 * G + x1] - a[y0 * G + x0]) * tx;
  const a1 = a[y1 * G + x0] + (a[y1 * G + x1] - a[y1 * G + x0]) * tx;
  return a0 + (a1 - a0) * ty;
}

// ---------------------------------------------------------------- map output
function canvasFromData(N, data) {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  c.getContext('2d').putImageData(new ImageData(data, N, N), 0, 0);
  return c;
}

/** Tangent-space normal map (OpenGL convention) from a height field, wrap-around sampling. */
function normalFromHeight(N, h, strength) {
  const out = new Uint8ClampedArray(N * N * 4);
  const m = N - 1;
  for (let y = 0; y < N; y++) {
    const ym = ((y - 1) & m) * N, y0 = y * N, yp = ((y + 1) & m) * N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1) & m, xp = (x + 1) & m;
      const dx = (h[y0 + xp] - h[y0 + xm]) * 0.5 * strength;
      const dy = (h[yp + x] - h[ym + x]) * 0.5 * strength; // canvas y down == -v, so +dy is the +v slope sign flip
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y0 + x) * 4;
      out[i] = (-dx * il * 0.5 + 0.5) * 255;
      out[i + 1] = (dy * il * 0.5 + 0.5) * 255;
      out[i + 2] = (il * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function grayData(N, arr) {
  const out = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) { const v = arr[i] * 255; out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255; }
  return out;
}

function finishTex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function pack(N, color, height, rough, normalStrength, metal) {
  const res = {
    map: finishTex(canvasFromData(N, color), true),
    normalMap: finishTex(canvasFromData(N, normalFromHeight(N, height, normalStrength)), false),
    roughnessMap: finishTex(canvasFromData(N, grayData(N, rough)), false),
  };
  if (metal) res.metalnessMap = finishTex(canvasFromData(N, grayData(N, metal)), false);
  return res;
}

// ---------------------------------------------------------------- marble
function genMarble(kind, N, seed) {
  const nz = makeNoise(seed), nz2 = makeNoise(seed + 101), nz3 = makeNoise(seed + 202), nzf = makeNoise(seed + 303);
  const white = kind === 'white';
  const G = 128;
  const W1 = makeGrid(G, (u, v) => fbm(nz3, u + 0.13, v, 2, 3));
  const W2 = makeGrid(G, (u, v) => fbm(nz3, u + 0.51, v + 0.77, 2, 3));
  const WM = makeGrid(G, (u, v) => fbm(nz2, u + 0.3, v + 0.2, 2, 3) * 0.5 + 0.5);
  const CL = makeGrid(G, (u, v) => fbm(nz2, u, v + 0.6, 2, 4));
  const GB = 256;
  const BR = makeGrid(GB, (u, v) => fbm(nz3, u + 0.9, v + 0.4, 16, 2));
  const BR2 = makeGrid(GB, (u, v) => fbm(nz3, u + 0.2, v + 0.8, 16, 2));
  const inv = 1 / N;
  const color = new Uint8ClampedArray(N * N * 4);
  const height = new Float32Array(N * N);
  const rough = new Float32Array(N * N);
  const metal = white ? null : new Float32Array(N * N);
  const fv = 2;

  for (let y = 0; y < N; y++) {
    const v = y * inv;
    for (let x = 0; x < N; x++) {
      const u = x * inv;
      const wx = gridS(W1, u, v), wy = gridS(W2, u, v);
      const cloud = gridS(CL, u, v);
      const wm = 0.35 + 1.25 * gridS(WM, u, v);
      const ws = white ? 0.22 : 0.15;
      const uu = u + ws * wx, vv = v + ws * wy;
      const n1 = fbm(nz, uu, vv, fv, 3, white ? 0.5 : 0.4);
      const a1 = Math.abs(n1);
      const n2 = fbm(nz2, uu + 0.4, vv + 0.1, fv * 2, 2);
      const a2 = Math.abs(n2);
      const fine = nzf(u * 256, v * 256, 255, 255); // micro crystal texture
      const idx = (y * N + x);
      const o = idx * 4;
      let r, g, b, ht, rg, mt = 0;
      if (white) {
        // Carrara: bright warm white, grey-blue feathery veins and cloudy haze
        const w1 = 0.05 * wm;
        let v1 = 1 - smooth(0, w1, a1); v1 *= v1;
        const halo = Math.exp(-a1 / (w1 * 6.5)) * 0.50 * (0.5 + 0.5 * smooth(-0.3, 0.5, cloud));
        const breakup = smooth(-0.55, 0.15, gridS(BR, uu, vv));
        const w2 = 0.016 * wm;
        let v2 = 1 - smooth(0, w2, a2); v2 = v2 * v2 * 0.6 * (0.3 + 0.7 * (1 - smooth(0.02, 0.22, a1))); // branch veins cluster near main
        const v2b = (1 - smooth(0, w2 * 0.8, a2)) * 0.22;
        const haze = smooth(-0.35, 0.6, cloud) * 0.10;
        let vein = clamp01(v1 * 0.85 * breakup + halo * 0.55 * breakup + v2 + v2b);
        // base tones
        const baseR = 244 - 7 * haze * 6 + fine * 1.6, baseG = 243 - 7 * haze * 6 + fine * 1.6, baseB = 239 - 6 * haze * 6 + fine * 1.6;
        const veinR = 138, veinG = 144, veinB = 152;
        // warm brownish tint on the widest halo
        const warm = halo * 0.25;
        r = mix(baseR, veinR, vein * 0.88) + warm * 10;
        g = mix(baseG, veinG, vein * 0.88) + warm * 4;
        b = mix(baseB, veinB, vein * 0.88) - warm * 6;
        ht = cloud * 0.35 - vein * 0.25;
        rg = 0.11 + 0.05 * (fine * 0.5 + 0.5) + vein * 0.06 + haze * 0.3;
      } else {
        // Nero Marquina with gold veining
        const w1 = 0.034 * wm;
        let v1 = 1 - smooth(0, w1, a1); v1 *= v1;
        const core = 1 - smooth(0, w1 * 0.35, a1);
        const halo = Math.exp(-a1 / (w1 * 3.5)) * 0.22;
        const breakup = smooth(-0.6, 0.10, gridS(BR2, uu, vv));
        const w2 = 0.013 * wm;
        let v2 = (1 - smooth(0, w2, a2)); v2 = v2 * v2 * 0.75 * (0.35 + 0.65 * (1 - smooth(0.02, 0.16, a1)));
        const v2b = (1 - smooth(0, w2 * 0.7, a2)) * 0.12;
        const dust = smooth(0.55, 0.9, nzf(u * 64 + 3, v * 64 + 3, 63, 63) * 0.5 + 0.5) * 0.35 * (halo * 2 + 0.25);
        const vein = clamp01((v1 * breakup + v2 + v2b) * 1.0);
        const goldMask = clamp01(vein + halo * 0.35 * breakup + dust * 0.6);
        const haze = smooth(-0.25, 0.7, cloud) * 14;
        const br = 11 + haze * 0.55 + fine * 1.5, bg = 11 + haze * 0.55 + fine * 1.5, bb = 14 + haze * 0.7 + fine * 1.5;
        // gold: dark warm edge to bright core
        const hot = clamp01(core * 0.9 + v1 * 0.5 + v2 * 0.35);
        const gr = mix(125, 246, hot) + fine * 5, gg = mix(82, 198, hot) + fine * 5, gb = mix(26, 92, hot) + fine * 3;
        r = mix(br, gr, goldMask); g = mix(bg, gg, goldMask); b = mix(bb, gb, goldMask);
        ht = cloud * 0.3 + vein * 0.35;
        rg = 0.07 + 0.04 * (fine * 0.5 + 0.5) + goldMask * 0.15;
        mt = clamp01(goldMask * 1.2 - 0.1) * 0.9;
        metal[idx] = mt;
      }
      color[o] = r; color[o + 1] = g; color[o + 2] = b; color[o + 3] = 255;
      height[idx] = ht; rough[idx] = rg;
    }
  }
  return pack(N, color, height, rough, white ? 1.2 : 1.6, metal);
}

// ---------------------------------------------------------------- wood
function lerp3(out, a, b, t) { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; }

function genWood(kind, N, seed) {
  const walnut = kind === 'walnut';
  const nz = makeNoise(seed), nz2 = makeNoise(seed + 11), nz3 = makeNoise(seed + 23);
  const G = 128;
  const RING = walnut ? 22 : 30;
  const WA = makeGrid(G, (u, v) => fbmA(nz, u, v, 2, 4, 3));
  const WB = makeGrid(G, (u, v) => fbmA(nz2, u + 0.3, v + 0.1, 2, 2, 3));
  const FIG = makeGrid(G, (u, v) => fbmA(nz3, u + 0.5, v + 0.2, 2, 4, 3) * 0.5 + 0.5);
  const inv = 1 / N;
  const color = new Uint8ClampedArray(N * N * 4);
  const height = new Float32Array(N * N);
  const rough = new Float32Array(N * N);
  const cLight = walnut ? [96, 62, 38] : [232, 200, 150];
  const cDark = walnut ? [34, 20, 12] : [196, 158, 106];
  const cPlum = walnut ? [58, 36, 38] : [214, 180, 130]; // slight violet-brown drift in walnut
  const tmp = [0, 0, 0];
  for (let y = 0; y < N; y++) {
    const v = y * inv;
    for (let x = 0; x < N; x++) {
      const u = x * inv;
      const wa = gridS(WA, u, v), wb = gridS(WB, u, v), fg = gridS(FIG, u, v);
      const t = v * RING + wa * (walnut ? 3.2 : 2.4) + wb * 1.8;
      const s = t - Math.floor(t);
      // early wood to late wood: slow darkening, sudden reset, slightly softened
      const ring = s * s * (1 - smooth(0.96, 1.0, s) * 0.6);
      // long streaks along the grain at two scales, plus very fine fibre
      const st1 = nz(u * 4, v * 64, 3, 63) * 0.6 + nz2(u * 8 + 1.7, v * 128, 7, 127) * 0.4;
      const fibre = nz3(u * 8, v * 512, 7, 511);
      const pn = nz3(u * 128 + 3, v * 256 + 5, 127, 255);
      const pore = smooth(0.42, 0.68, pn);
      let tone = ring * (walnut ? 0.50 : 0.34) + st1 * (walnut ? 0.22 : 0.10) + fibre * (walnut ? 0.07 : 0.05) + (fg - 0.5) * (walnut ? 0.38 : 0.22) + 0.22;
      tone = clamp01(tone);
      lerp3(tmp, cLight, cDark, tone);
      const pl = clamp01((st1 + 0.3) * 0.7) * (walnut ? 0.35 : 0.15);
      tmp[0] = mix(tmp[0], cPlum[0], pl); tmp[1] = mix(tmp[1], cPlum[1], pl); tmp[2] = mix(tmp[2], cPlum[2], pl);
      const pd = 1 - pore * (walnut ? 0.22 : 0.10);
      const idx = y * N + x, o = idx * 4;
      color[o] = tmp[0] * pd; color[o + 1] = tmp[1] * pd; color[o + 2] = tmp[2] * pd; color[o + 3] = 255;
      height[idx] = fibre * 0.3 + st1 * 0.2 - pore * 0.35;
      rough[idx] = (walnut ? 0.40 : 0.42) + 0.05 * (fibre * 0.5 + 0.5) + pore * 0.12;
    }
  }
  return pack(N, color, height, rough, walnut ? 2.0 : 1.5);
}

// ---------------------------------------------------------------- brass
function genBrass(N, seed) {
  const nz = makeNoise(seed), nz2 = makeNoise(seed + 5);
  const color = new Uint8ClampedArray(N * N * 4);
  const height = new Float32Array(N * N);
  const rough = new Float32Array(N * N);
  const inv = 1 / N;
  for (let y = 0; y < N; y++) {
    const v = y * inv;
    for (let x = 0; x < N; x++) {
      const u = x * inv;
      const s1 = nz(u * 2, v * 256, 1, 255);
      const s2 = nz2(u * 4, v * 128, 3, 127);
      const s3 = nz(u * 16 + 5, v * 512, 15, 511);
      const streak = s1 * 0.4 + s2 * 0.35 + s3 * 0.25;
      const t = streak * 0.5 + 0.5;
      const idx = y * N + x, o = idx * 4;
      color[o] = mix(205, 232, t); color[o + 1] = mix(158, 186, t); color[o + 2] = mix(78, 100, t); color[o + 3] = 255;
      height[idx] = streak;
      rough[idx] = 0.22 + 0.10 * t + 0.04 * s3;
    }
  }
  return pack(N, color, height, rough, 1.5);
}

// ---------------------------------------------------------------- felt
function genFelt(N, seed) {
  const nz = makeNoise(seed);
  const color = new Uint8ClampedArray(N * N * 4);
  const height = new Float32Array(N * N);
  const rough = new Float32Array(N * N);
  const inv = 1 / N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x * inv, v = y * inv;
    const a = nz(u * 128, v * 128, 127, 127), b = nz(u * 64 + 2.2, v * 64, 63, 63);
    const t = 0.5 + 0.5 * (a * 0.6 + b * 0.4);
    const idx = y * N + x, o = idx * 4;
    color[o] = mix(16, 30, t); color[o + 1] = mix(20, 34, t); color[o + 2] = mix(18, 30, t); color[o + 3] = 255;
    height[idx] = a; rough[idx] = 0.95;
  }
  return pack(N, color, height, rough, 1.2);
}

// ---------------------------------------------------------------- public, lazy and cached
const cache = {};
function lazy(name, fn) { return cache[name] || (cache[name] = fn()); }

export const marbleWhite = () => lazy('mw', () => genMarble('white', 1024, 7));
export const marbleBlack = () => lazy('mb', () => genMarble('black', 1024, 19));
export const walnut = () => lazy('wa', () => genWood('walnut', 1024, 31));
export const maple = () => lazy('ma', () => genWood('maple', 512, 47));
export const brass = () => lazy('br', () => genBrass(512, 61));
export const felt = () => lazy('fe', () => genFelt(256, 71));

export function disposeTextures() {
  for (const k of Object.keys(cache)) {
    for (const t of Object.values(cache[k])) t.dispose();
    delete cache[k];
  }
}
