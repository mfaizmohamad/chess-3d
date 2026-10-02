// Game controller: rules from ./rules.js plus 3D presentation, animation, undo, optional computer opponent.
import * as THREE from 'three';
import { Chess, START_FEN, sqName, nameSq } from './rules.js';
import { searchMove } from './ai.js';

export * from './rules.js';

const TRAY_X = 5.5, TRAY_COL = 0.5, TRAY_ROW = 0.56, TRAY_SCALE = 0.62, TRAY_Z0 = 3.45;
const sqX = (sq) => (sq & 7) - 3.5;
const sqZ = (sq) => 3.5 - (sq >> 3);
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOut = (u) => 1 - Math.pow(1 - u, 3);
const easeOutBack = (u) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function createGame({ gimbal, board, pieceSet, materials }) {
  const chess = new Chess();
  const root = new THREE.Group();
  root.name = 'pieces';
  gimbal.add(root);

  const listeners = {};
  const emit = (evt, data) => (listeners[evt] || []).forEach((fn) => fn(data));

  let map = new Map();           // square -> piece object
  let records = [];              // parallel to chess.history
  const tray = { w: [], b: [] }; // captured pieces by their own color, in capture order
  let anims = [];
  let selected = -1;
  let legal = [];
  let pendingPromo = null;
  let gameOver = null;
  let overTimer = 0;
  let vsComputer = false, computerColor = 'b', depth = 2;
  let search = null, thinkDelay = 0;
  let time = 0;
  let lastStatus = { over: false, check: false };

  // ---------------------------------------------------------------- tray slab
  const slabMat = new THREE.MeshPhysicalMaterial({ color: 0x14161c, roughness: 0.32, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.15 });
  const trimMat = materials?.white?.accent || new THREE.MeshStandardMaterial({ color: 0xb08d4a, metalness: 1, roughness: 0.3 });
  for (const sign of [1, -1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.26, 4.9), slabMat);
    slab.position.set(sign * (TRAY_X + 0.25), -0.13, 0.96);
    slab.castShadow = true; slab.receiveShadow = true;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 4.95), trimMat);
    trim.position.set(slab.position.x, -0.265, 0.96);
    root.add(slab, trim);
    slab.name = 'tray-slab';
  }

  // ---------------------------------------------------------------- tweens
  function tween({ dur, delay = 0, ease = easeInOut, step, done }) {
    anims.push({ t: -delay, dur, ease, step, done });
  }
  function updateAnims(dt) {
    if (!anims.length) return;
    const cur = anims;
    anims = [];
    const keep = [];
    for (const a of cur) {
      a.t += dt;
      if (a.t < 0) { keep.push(a); continue; }
      const u = Math.min(1, a.t / a.dur);
      a.step(a.ease(u), u);
      if (u >= 1) a.done?.(); else keep.push(a);
    }
    anims = keep.concat(anims);
  }
  function finishAnimations() {
    let guard = 0;
    while (anims.length && guard++ < 50) {
      const cur = anims; anims = [];
      for (const a of cur) { a.step(a.ease(1), 1); a.done?.(); }
    }
  }
  const busy = () => anims.length > 0;

  // ---------------------------------------------------------------- pieces
  let nextId = 1;
  function makePiece(type, color) {
    const group = pieceSet.make(type, color);
    const h = group.userData.height || 1.2;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, h, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = h / 2;
    hit.userData.hit = true;
    group.add(hit);
    const obj = { id: nextId++, type, color, group, hit, sq: -1, trayIndex: -1 };
    hit.userData.pieceObj = obj;
    return obj;
  }
  function place(obj, sq) {
    obj.sq = sq;
    obj.group.position.set(sqX(sq), 0, sqZ(sq));
    obj.group.scale.setScalar(1);
    obj.group.rotation.set(0, 0, 0);
    if (obj.group.parent !== root) root.add(obj.group);
    obj.group.visible = true;
    map.set(sq, obj);
  }
  function trayPos(color, index) {
    const sign = color === 'b' ? 1 : -1; // captured black pieces on the right (white's right), white on the left
    const row = Math.floor(index / 2), col = index % 2;
    return new THREE.Vector3(sign * (TRAY_X + (col - 0.5) * TRAY_COL + 0.25), 0, TRAY_Z0 - row * TRAY_ROW);
  }

  function clearPieces() {
    for (const obj of [...map.values(), ...tray.w, ...tray.b]) obj.group.parent?.remove(obj.group);
    for (const r of records) { r.promoPawn?.group.parent?.remove(r.promoPawn.group); }
    map = new Map(); records = []; tray.w = []; tray.b = [];
  }

  function setupPosition(animate) {
    const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    let k = 0;
    for (let f = 0; f < 8; f++) {
      const put = (type, color, sq) => {
        const o = makePiece(type, color);
        place(o, sq);
        if (animate) {
          const delay = 0.04 * k++ + Math.random() * 0.12;
          o.group.position.y = 3.2; o.group.visible = false;
          tween({
            dur: 0.7, delay, ease: easeOut,
            step: (e, u) => { o.group.visible = u > 0 || e > 0; o.group.position.y = 3.2 * (1 - e) + Math.max(0, Math.sin(u * Math.PI * 3)) * 0.05 * (1 - u); },
          });
        }
      };
      put(back[f], 'w', f); put('p', 'w', 8 + f);
      put('p', 'b', 48 + f); put(back[f], 'b', 56 + f);
    }
  }

  // ---------------------------------------------------------------- highlights
  function refreshHighlights() {
    const list = [];
    const last = records[records.length - 1];
    if (last) {
      list.push({ file: last.m.from & 7, rank: last.m.from >> 3, kind: 'last' });
      list.push({ file: last.m.to & 7, rank: last.m.to >> 3, kind: 'last' });
    }
    if (chess.inCheck()) {
      const k = chess.kingSquare(chess.turn);
      list.push({ file: k & 7, rank: k >> 3, kind: 'check' });
    }
    if (selected >= 0) {
      list.push({ file: selected & 7, rank: selected >> 3, kind: 'select' });
      const seen = new Set();
      for (const m of legal) {
        if (m.from !== selected || seen.has(m.to)) continue;
        seen.add(m.to);
        list.push({ file: m.to & 7, rank: m.to >> 3, kind: m.captured ? 'capture' : 'move' });
      }
    }
    board.setHighlights(list);
  }

  // ---------------------------------------------------------------- state / events
  function getState() {
    const captured = { w: tray.w.map((o) => o.type), b: tray.b.map((o) => o.type) }; // pieces lost by each side
    const mat = (list) => list.reduce((a, t) => a + VALUE[t], 0);
    return {
      turn: chess.turn,
      moves: records.map((r) => r.san),
      fullmove: chess.fullmove,
      captured,
      advantage: mat(captured.b) - mat(captured.w), // positive: white ahead
      check: chess.inCheck(),
      over: gameOver,
      thinking: !!search,
      vsComputer, computerColor, depth,
      canUndo: records.length > 0,
      busy: busy(),
      fen: chess.fen(),
      selected: selected >= 0 ? sqName(selected) : null,
    };
  }
  const changed = () => emit('change', getState());

  function evaluateEnd() {
    const st = chess.status();
    lastStatus = st;
    if (st.over) {
      gameOver = st;
      overTimer = 0.9;
      if (st.reason === 'checkmate') {
        const k = chess.kingSquare(chess.turn);
        const obj = map.get(k);
        if (obj) toppleKing(obj);
      }
    } else gameOver = null;
    return st;
  }
  let toppled = null;
  function resetToppled() {
    if (!toppled) return;
    toppled.group.rotation.z = 0;
    if (toppled.sq >= 0) toppled.group.position.set(sqX(toppled.sq), 0, sqZ(toppled.sq));
    toppled = null;
  }
  function toppleKing(obj) {
    // tip the mated king over, hinging on the edge of its base
    const g = obj.group;
    const dir = obj.color === 'w' ? 1 : -1;
    const px = -0.34 * dir;
    toppled = obj;
    tween({
      dur: 1.0, delay: 0.7, ease: easeOutBack,
      step: (e) => {
        const a = Math.min(e, 1.04) * 1.4 * dir;
        g.rotation.z = a;
        g.position.x = sqX(obj.sq) + px * (1 - Math.cos(a));
        g.position.y = -px * Math.sin(a);
      },
    });
  }

  // ---------------------------------------------------------------- moves
  function slide(obj, to, { dur, delay = 0, arc = 0.12, done }) {
    const from = obj.group.position.clone();
    tween({
      dur, delay,
      step: (e) => {
        const p = obj.group.position;
        p.lerpVectors(from, to, e);
        p.y = from.y + (to.y - from.y) * e + Math.sin(Math.PI * e) * arc;
      },
      done,
    });
  }
  function flyToTray(obj, delay) {
    const list = tray[obj.color];
    obj.trayIndex = list.length;
    list.push(obj);
    obj.sq = -1;
    const to = trayPos(obj.color, obj.trayIndex);
    const from = obj.group.position.clone();
    const spin = (Math.random() - 0.5) * 2;
    tween({
      dur: 0.85, delay, ease: easeInOut,
      step: (e) => {
        const p = obj.group.position;
        p.lerpVectors(from, to, e);
        p.y = Math.sin(Math.PI * e) * 1.6;
        obj.group.scale.setScalar(1 - (1 - TRAY_SCALE) * e);
        obj.group.rotation.y = spin * Math.sin(Math.PI * e);
      },
    });
  }

  function doMove(input, { instant = false } = {}) {
    const m = chess.play(input);
    if (!m) return null;
    const moving = map.get(m.from);
    map.delete(m.from);
    const rec = { m, san: m.san, piece: moving, captured: null, capSq: -1, rook: null, promoNew: null, promoPawn: null };
    if (m.captured) {
      rec.capSq = m.flag === 'e' ? m.to + (m.color === 'w' ? -8 : 8) : m.to;
      rec.captured = map.get(rec.capSq);
      map.delete(rec.capSq);
    }
    if (m.flag === 'k' || m.flag === 'q') {
      const rf = m.flag === 'k' ? m.from + 3 : m.from - 4;
      const rt = m.flag === 'k' ? m.from + 1 : m.from - 1;
      rec.rook = map.get(rf); rec.rookFrom = rf; rec.rookTo = rt;
      map.delete(rf); map.set(rt, rec.rook); rec.rook.sq = rt;
    }
    if (m.promo) {
      rec.promoPawn = moving;
      rec.promoNew = makePiece(m.promo, m.color);
      rec.promoNew.sq = m.to;
      map.set(m.to, rec.promoNew);
    } else { map.set(m.to, moving); moving.sq = m.to; }
    records.push(rec);
    selected = -1;
    legal = chess.moves();

    const target = new THREE.Vector3(sqX(m.to), 0, sqZ(m.to));
    const dist = Math.hypot((m.to & 7) - (m.from & 7), (m.to >> 3) - (m.from >> 3));
    const knight = m.piece === 'n';
    const dur = knight ? 0.8 : 0.4 + 0.07 * dist;

    const finishPromo = () => {
      if (!rec.promoNew) return;
      moving.group.parent?.remove(moving.group);
      const n = rec.promoNew;
      n.group.position.copy(target);
      root.add(n.group);
      n.group.scale.setScalar(0.01);
      tween({ dur: 0.5, ease: easeOutBack, step: (e) => { n.group.scale.setScalar(Math.max(0.01, e)); n.group.position.y = Math.sin(Math.PI * Math.min(1, e)) * 0.35; } });
    };

    if (instant) {
      finishAnimations();
      if (rec.captured) { flyToTray(rec.captured, 0); }
      moving.group.position.copy(target);
      if (rec.rook) rec.rook.group.position.set(sqX(rec.rookTo), 0, sqZ(rec.rookTo));
      if (rec.promoNew) finishPromo();
      finishAnimations();
    } else {
      slide(moving, target, { dur, arc: knight ? 1.0 : 0.12, done: finishPromo });
      if (rec.rook) slide(rec.rook, new THREE.Vector3(sqX(rec.rookTo), 0, sqZ(rec.rookTo)), { dur: dur * 0.9, delay: 0.05, arc: 0.1 });
      if (rec.captured) flyToTray(rec.captured, dur * 0.55);
    }
    evaluateEnd();
    refreshHighlights();
    changed();
    return rec;
  }

  function undoOne(animate) {
    const rec = records.pop();
    if (!rec) return false;
    const m = rec.m;
    chess.undo();
    const home = new THREE.Vector3(sqX(m.from), 0, sqZ(m.from));
    const dist = Math.hypot((m.to & 7) - (m.from & 7), (m.to >> 3) - (m.from >> 3));
    const dur = animate ? (m.piece === 'n' ? 0.6 : 0.3 + 0.05 * dist) : 0;

    let mover = rec.piece;
    if (rec.promoNew) {
      // swap the promoted piece back to the pawn
      rec.promoNew.group.parent?.remove(rec.promoNew.group);
      map.delete(m.to);
      mover = rec.promoPawn;
      mover.group.position.set(sqX(m.to), 0, sqZ(m.to));
      mover.group.scale.setScalar(1);
      root.add(mover.group);
    } else map.delete(m.to);
    mover.sq = m.from;
    map.set(m.from, mover);

    if (animate) slide(mover, home, { dur, arc: m.piece === 'n' ? 0.9 : 0.1 });
    else mover.group.position.copy(home);

    if (rec.rook) {
      map.delete(rec.rookTo); map.set(rec.rookFrom, rec.rook); rec.rook.sq = rec.rookFrom;
      const rp = new THREE.Vector3(sqX(rec.rookFrom), 0, sqZ(rec.rookFrom));
      if (animate) slide(rec.rook, rp, { dur, arc: 0.1 }); else rec.rook.group.position.copy(rp);
    }
    if (rec.captured) {
      const c = rec.captured;
      const list = tray[c.color];
      list.pop();
      c.trayIndex = -1; c.sq = rec.capSq;
      map.set(rec.capSq, c);
      const cp = new THREE.Vector3(sqX(rec.capSq), 0, sqZ(rec.capSq));
      if (animate) {
        const from = c.group.position.clone();
        tween({
          dur: 0.7, ease: easeInOut,
          step: (e) => {
            c.group.position.lerpVectors(from, cp, e);
            c.group.position.y = Math.sin(Math.PI * e) * 1.4;
            c.group.scale.setScalar(TRAY_SCALE + (1 - TRAY_SCALE) * e);
            c.group.rotation.y = 0;
          },
        });
      } else { c.group.position.copy(cp); c.group.scale.setScalar(1); c.group.rotation.set(0, 0, 0); }
    }
    return true;
  }

  // ---------------------------------------------------------------- public actions
  function clickSquare(sq) {
    if (busy() || pendingPromo || gameOver || search) return;
    if (vsComputer && chess.turn === computerColor) return;
    const piece = map.get(sq);
    const own = piece && piece.color === chess.turn;
    if (selected >= 0) {
      const cands = legal.filter((m) => m.from === selected && m.to === sq);
      if (cands.length) {
        if (cands[0].promo) {
          pendingPromo = { from: selected, to: sq, color: chess.turn };
          emit('promotion', {
            color: chess.turn,
            choose: (p) => { const pp = pendingPromo; pendingPromo = null; if (p && pp) doMove({ from: pp.from, to: pp.to, promo: p }); else refreshHighlights(); },
          });
          return;
        }
        doMove({ from: selected, to: sq });
        return;
      }
      if (own && sq !== selected) selected = sq;
      else selected = -1;
    } else if (own) selected = sq;
    refreshHighlights();
    changed();
  }

  function newGame({ instant = false, animate = true } = {}) {
    finishAnimations();
    search = null; pendingPromo = null; gameOver = null; selected = -1;
    resetToppled();
    clearPieces();
    chess.load(START_FEN);
    legal = chess.moves();
    setupPosition(animate && !instant);
    if (instant) finishAnimations();
    board.clearHighlights();
    refreshHighlights();
    changed();
    emit('newgame');
    maybeComputer();
  }

  // Test helper: set up an arbitrary position (instant, no animation).
  function loadFen(fen) {
    finishAnimations();
    search = null; pendingPromo = null; gameOver = null; selected = -1;
    resetToppled();
    clearPieces();
    chess.load(fen);
    for (let sq = 0; sq < 64; sq++) {
      const p = chess.board[sq];
      if (p) place(makePiece(p.toLowerCase(), p < 'a' ? 'w' : 'b'), sq);
    }
    legal = chess.moves();
    evaluateEnd();
    board.clearHighlights();
    refreshHighlights();
    changed();
  }

  function undo() {
    if (!records.length) return;
    finishAnimations();
    search = null; pendingPromo = null; gameOver = null; selected = -1;
    resetToppled();
    const two = vsComputer && records.length >= 2 && records[records.length - 1].m.color === computerColor;
    if (two) undoOne(false);
    undoOne(true);
    legal = chess.moves();
    refreshHighlights();
    changed();
    emit('undo');
  }

  function maybeComputer() {
    if (vsComputer && !gameOver && !search && chess.turn === computerColor && !pendingPromo) {
      search = searchMove(chess.fen(), depth);
      thinkDelay = 0.45;
      changed();
    }
  }
  function setVsComputer(on, opts = {}) {
    vsComputer = !!on;
    if (opts.color) computerColor = opts.color;
    if (opts.depth) depth = opts.depth;
    if (!vsComputer) search = null;
    selected = -1;
    refreshHighlights();
    changed();
    maybeComputer();
  }

  // ---------------------------------------------------------------- picking
  function pickSquare(raycaster) {
    // 1) cheap proxies find candidate pieces, 2) their real meshes give exact hits, 3) the board square as fallback.
    // The nearest thing under the cursor along the camera ray wins, exactly like what the player sees: a piece
    // standing in front takes the click even if it cannot move. Clicking a piece that is a capture target
    // captures it, and clicking an empty destination square (nothing in front of it) moves.
    const proxies = [];
    for (const o of map.values()) proxies.push(o.hit);
    const hits = [];
    for (const h of raycaster.intersectObjects(proxies, false)) {
      const obj = h.object.userData.pieceObj;
      const real = raycaster.intersectObject(obj.group.children[0], true);
      if (real.length) hits.push({ d: real[0].distance, sq: obj.sq });
    }
    for (const h of raycaster.intersectObjects(board.squareMeshes, false)) {
      const s = h.object.userData.square;
      if (s) { hits.push({ d: h.distance, sq: s.rank * 8 + s.file }); break; }
    }
    if (!hits.length) return -1;
    hits.sort((x, y) => x.d - y.d);
    return hits[0].sq;
  }

  // Cheap hover test (proxies and squares only): is there something clickable under the ray?
  function hoverAction(raycaster) {
    if (busy() || pendingPromo || gameOver || search || (vsComputer && chess.turn === computerColor)) return false;
    const proxies = [];
    for (const o of map.values()) proxies.push(o.hit);
    const hits = [];
    for (const h of raycaster.intersectObjects(proxies, false)) hits.push({ d: h.distance, sq: h.object.userData.pieceObj.sq });
    for (const h of raycaster.intersectObjects(board.squareMeshes, false)) {
      const q = h.object.userData.square;
      if (q) { hits.push({ d: h.distance, sq: q.rank * 8 + q.file }); break; }
    }
    if (!hits.length) return false;
    const h = hits.reduce((n, x) => (x.d < n.d ? x : n));
    return (legal.some((m) => m.from === h.sq) && map.get(h.sq)?.color === chess.turn) ||
      (selected >= 0 && legal.some((m) => m.from === selected && m.to === h.sq));
  }

  // ---------------------------------------------------------------- frame update
  function update(dt) {
    time += dt;
    updateAnims(dt);
    // selected piece hovers slightly
    for (const o of map.values()) {
      if (o.sq === selected && selected >= 0 && !busy()) {
        o.group.position.y += ((0.16 + Math.sin(time * 3.2) * 0.025) - o.group.position.y) * Math.min(1, dt * 12);
      } else if (!busy() && o.group.position.y !== 0 && o.group.visible && !o.group.userData.fixed && Math.abs(o.group.rotation.z) < 0.01) {
        o.group.position.y += (0 - o.group.position.y) * Math.min(1, dt * 12);
        if (o.group.position.y < 0.002) o.group.position.y = 0;
      }
    }
    if (search) {
      if (thinkDelay > 0 && !busy()) thinkDelay -= dt;
      else if (!busy()) {
        const t0 = performance.now();
        let r;
        while (performance.now() - t0 < 8) {
          r = search.next();
          if (r.done) break;
        }
        if (r && r.done) {
          search = null;
          const mv = r.value.move;
          if (mv && !gameOver) doMove({ from: mv.from, to: mv.to, promo: mv.promo });
          else changed();
        }
      }
    }
    if (gameOver && overTimer > 0 && !busy()) {
      overTimer -= dt;
      if (overTimer <= 0) emit('gameover', gameOver);
    }
    if (!busy() && !search) maybeComputer();
  }

  // ---------------------------------------------------------------- scripted play (tests, demos)
  function playMoves(list, { instant = true } = {}) {
    for (const s of list) {
      const from = nameSq(s.slice(0, 2)), to = nameSq(s.slice(2, 4));
      const r = doMove({ from, to, promo: s[4] || null }, { instant });
      if (!r) { console.warn('illegal scripted move', s); break; }
    }
    if (instant) finishAnimations();
  }
  function selectSquare(name) {
    selected = nameSq(name); legal = chess.moves(); refreshHighlights();
  }

  newGame({ instant: true });

  return {
    chess, root, on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    clickSquare, pickSquare, hoverAction, update, newGame, undo, loadFen, setVsComputer, getState, playMoves, selectSquare,
    move: (from, to, promo) => doMove({ from: nameSq(from), to: nameSq(to), promo }),
    finishAnimations,
    // consistency check for tests: compares visual pieces with the engine board; returns a list of problems
    audit() {
      const bad = [];
      for (let sq = 0; sq < 64; sq++) {
        const p = chess.board[sq], o = map.get(sq);
        if (!p && o) bad.push(`extra piece at ${sqName(sq)}`);
        if (p && !o) bad.push(`missing piece at ${sqName(sq)}`);
        if (p && o) {
          if (o.type !== p.toLowerCase() || o.color !== (p < 'a' ? 'w' : 'b')) bad.push(`wrong piece at ${sqName(sq)}`);
          const g = o.group;
          if (Math.abs(g.position.x - sqX(sq)) > 0.01 || Math.abs(g.position.z - sqZ(sq)) > 0.01 || Math.abs(g.position.y) > 0.02) bad.push(`misplaced ${sqName(sq)} ${g.position.toArray().map((n) => n.toFixed(2))}`);
          if (Math.abs(g.scale.x - 1) > 0.01 || !g.visible || g.parent !== root) bad.push(`bad state at ${sqName(sq)}`);
        }
      }
      for (const c of ['w', 'b']) tray[c].forEach((o, i) => {
        const t = trayPos(c, i);
        if (o.group.position.distanceTo(t) > 0.02 || Math.abs(o.group.scale.x - TRAY_SCALE) > 0.01) bad.push(`tray ${c}${i} misplaced`);
      });
      return bad;
    },
    get busy() { return busy(); },
    get pendingPromotion() { return pendingPromo; },
    get pieceCount() { return map.size; },
    sqName, nameSq,
  };
}
