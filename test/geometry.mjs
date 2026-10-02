// Piece geometry contract, headless. Builds every piece in both colors with the real materials (createPieceMaterials needs no DOM)
// and checks height, footprint, centering, triangle budget, finite attributes and shadow flags.
// Run: node test/geometry.mjs    Exit 0 pass, 1 on any failed check. Also exports runGeometryChecks() for test/run.mjs.
import * as THREE from 'three';
import { fileURLToPath } from 'node:url';
import { createPieceMaterials } from '../src/materials.js';
import { buildPawn, buildRook, buildKnight } from '../src/pieces/setA.js';
import { buildBishop, buildQueen, buildKing } from '../src/pieces/setB.js';

export const CONTRACT = {
  p: { name: 'pawn', build: buildPawn, height: 0.90 },
  r: { name: 'rook', build: buildRook, height: 1.00 },
  n: { name: 'knight', build: buildKnight, height: 1.20 },
  b: { name: 'bishop', build: buildBishop, height: 1.35 },
  q: { name: 'queen', build: buildQueen, height: 1.60 },
  k: { name: 'king', build: buildKing, height: 1.85 },
};
const HEIGHT_TOL = 0.08, FOOT_MIN = 0.5, FOOT_MAX = 0.85, CENTER_TOL = 0.06, MIN_Y = 0.02, TRI_MIN = 20000, TRI_MAX = 90000;

export function runGeometryChecks() {
  const out = [];
  const mats = createPieceMaterials();
  for (const color of ['w', 'b']) {
    for (const [type, c] of Object.entries(CONTRACT)) {
      const tag = `${color === 'w' ? 'white' : 'black'} ${c.name}`;
      const g = c.build(color === 'w' ? mats.white : mats.black);
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
      let tris = 0, meshes = 0, nonFinite = 0, noShadow = 0, noNormals = 0;
      g.traverse((o) => {
        if (!o.isMesh) return;
        meshes++;
        if (!o.castShadow || !o.receiveShadow) noShadow++;
        const pos = o.geometry.attributes.position, nor = o.geometry.attributes.normal;
        if (!nor) noNormals++;
        tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
        for (const attr of [pos, nor]) {
          if (!attr) continue;
          const a = attr.array;
          for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { nonFinite++; break; }
        }
      });
      const hErr = Math.abs(box.max.y - c.height) / c.height;
      const add = (what, pass, detail) => out.push({ name: `${tag}: ${what}`, pass, detail });
      add('height', hErr <= HEIGHT_TOL, `${box.max.y.toFixed(3)} vs ${c.height} (${(hErr * 100).toFixed(1)}%)`);
      add('footprint', size.x >= FOOT_MIN && size.x <= FOOT_MAX && size.z >= FOOT_MIN && size.z <= FOOT_MAX, `${size.x.toFixed(3)} x ${size.z.toFixed(3)}`);
      add('centered', Math.abs(ctr.x) <= CENTER_TOL && Math.abs(ctr.z) <= CENTER_TOL, `${ctr.x.toFixed(3)}, ${ctr.z.toFixed(3)}`);
      add('sits on the board', Math.abs(box.min.y) <= MIN_Y, `min y ${box.min.y.toFixed(3)}`);
      add('triangle count', tris >= TRI_MIN && tris <= TRI_MAX, `${Math.round(tris)} in ${meshes} meshes`);
      add('finite positions and normals', nonFinite === 0 && noNormals === 0, nonFinite ? `${nonFinite} bad arrays` : noNormals ? `${noNormals} meshes without normals` : 'ok');
      add('meshes cast and receive shadows', meshes > 0 && noShadow === 0, noShadow ? `${noShadow} meshes missing a flag` : `${meshes} meshes`);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = performance.now();
  const res = runGeometryChecks();
  for (const r of res) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}  ${r.detail}`);
  const bad = res.filter((r) => !r.pass).length;
  console.log(bad ? `${bad} FAILED of ${res.length}` : `ALL ${res.length} PASSED`, `(${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(bad ? 1 : 0);
}
