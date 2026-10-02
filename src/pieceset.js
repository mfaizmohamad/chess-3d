// Piece set factory: builds each (type, color) once, hands out clones that share geometry.
import * as THREE from 'three';
import { buildPawn, buildRook, buildKnight } from './pieces/setA.js';
import { buildBishop, buildQueen, buildKing } from './pieces/setB.js';

const BUILDERS = { p: buildPawn, r: buildRook, n: buildKnight, b: buildBishop, q: buildQueen, k: buildKing };
const NAMES = { p: 'pawns', r: 'rooks', n: 'knights', b: 'bishops', q: 'queens', k: 'kings' };
const TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];

// rAF never fires in a background tab, so race it with a timer.
const tick = () => new Promise((res) => {
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(res, 0); } };
  requestAnimationFrame(go);
  setTimeout(go, 50);
});

export function createPieceSet(materials) {
  const protos = new Map();
  const heights = new Map();

  function proto(type, color) {
    const key = type + color;
    let p = protos.get(key);
    if (!p) {
      const mat = color === 'w' ? materials.white : materials.black;
      p = BUILDERS[type](mat);
      p.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(p);
      heights.set(key, Math.max(0.6, box.max.y));
      p.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      protos.set(key, p);
    }
    return p;
  }

  return {
    // Returns a fresh Group: outer wrapper (game owns position/scale), inner clone (black rotated by PI).
    make(type, color) {
      const wrap = new THREE.Group();
      const inner = proto(type, color).clone(true);
      inner.rotation.y = color === 'b' ? Math.PI : 0;
      wrap.add(inner);
      wrap.name = `${color}${type}`;
      wrap.userData.piece = { type, color };
      wrap.userData.height = heights.get(type + color);
      return wrap;
    },
    height(type, color) { proto(type, color); return heights.get(type + color); },
    // Builds all 12 prototypes, yielding to the event loop between each so the loader can animate.
    async buildAll(onProgress) {
      let i = 0;
      const total = TYPES.length * 2;
      for (const color of ['w', 'b']) {
        for (const type of TYPES) {
          onProgress?.(i / total, `Turning ${color === 'w' ? 'ivory' : 'ebony'} ${NAMES[type]}`);
          await tick();
          proto(type, color);
          i++;
        }
      }
      onProgress?.(1, 'Pieces ready');
    },
  };
}
