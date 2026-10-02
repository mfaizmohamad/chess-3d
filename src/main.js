// App entry: loads modules with progress, wires stage, board, pieces, game, controls and HUD.
import * as THREE from 'three';

window.__chessBooted = true;   // tells the start-up guard in index.html that this script ran
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const fillEl = $('loader-fill'), stepEl = $('loader-step'), errEl = $('loader-err'), loaderEl = $('loader');

let shownProgress = 0;
function progress(p, msg) {
  shownProgress = Math.max(shownProgress, p);
  fillEl.style.width = `${Math.round(shownProgress * 100)}%`;
  if (msg) stepEl.textContent = msg;
}
// Yield so the loader can repaint. rAF never fires in a background tab, so race it with a timer.
const tick = () => new Promise((res) => {
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(res, 0); } };
  requestAnimationFrame(go);
  setTimeout(go, 50);
});

function fail(err) {
  console.error(err);
  errEl.hidden = false;
  errEl.textContent = String(err && (err.stack || err.message) || err).slice(0, 900);
  stepEl.textContent = 'Something went wrong while loading';
  window.__chessError = String(err && err.message || err);
}
window.addEventListener('error', (e) => { if (!loaderEl.classList.contains('done')) fail(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => fail(e.reason));

async function boot() {
  progress(0.02, 'Loading modules');
  await tick();
  const [{ createStage }, { createBoard }, { createPieceMaterials }, { createPieceSet }, { createGame }, { createControls }, { createUI }] =
    await Promise.all([
      import('./scene.js'), import('./board.js'), import('./materials.js'),
      import('./pieceset.js'), import('./game.js'), import('./controls.js'), import('./ui.js'),
    ]);
  progress(0.1, 'Preparing the studio');
  await tick();

  const canvas = $('stage');
  const quality = params.get('quality') || 'high';
  const stage = createStage(canvas, { quality });
  const gimbal = new THREE.Group();
  gimbal.name = 'gimbal';
  stage.scene.add(gimbal);

  progress(0.16, 'Weaving marble and wood');
  await tick();
  const materials = createPieceMaterials();
  progress(0.3, 'Inlaying the board');
  await tick();
  const board = createBoard();
  gimbal.add(board.group);

  const pieceSet = createPieceSet(materials);
  await pieceSet.buildAll((f, msg) => progress(0.4 + f * 0.52, msg));
  progress(0.94, 'Setting up the game');
  await tick();

  const game = createGame({ gimbal, board, pieceSet, materials });
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    return game.pickSquare(raycaster);
  };
  let hoverQueued = false, hx = 0, hy = 0;
  const controls = createControls({
    stage, gimbal, canvas,
    onPick: (x, y) => game.clickSquare(pick(x, y)),
    onHover: (x, y) => {
      hx = x; hy = y;
      if (hoverQueued) return;
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        const r = canvas.getBoundingClientRect();
        ndc.set(((hx - r.left) / r.width) * 2 - 1, -((hy - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, stage.camera);
        canvas.style.cursor = game.hoverAction(raycaster) ? 'pointer' : '';
      });
    },
  });
  const ui = createUI({ game, controls, stage, quality });

  // resize
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    stage.resize(w, h);
    controls.onResize(w, h);
  };
  window.addEventListener('resize', resize);
  resize();

  // scripted states for testing and screenshots
  applyParams({ game, controls, stage, ui });

  window.__chess = { stage, gimbal, board, game, controls, ui, THREE, pick };

  // render loop
  let last = performance.now(), t = 0;
  const upLocal = new THREE.Vector3(), gimbalInv = new THREE.Quaternion();
  const orientLabels = () => {
    // screen-up expressed in board space decides which side the labels read upright from
    upLocal.set(0, 1, 0).applyQuaternion(stage.camera.quaternion).applyQuaternion(gimbalInv.copy(gimbal.quaternion).invert());
    board.orientLabels(upLocal);
  };
  const advance = (dt) => { t += dt; controls.update(dt); game.update(dt); board.update(dt, t); orientLabels(); ui.sync(); };
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    advance(dt);
    stage.render(dt);
    requestAnimationFrame(frame);
  }
  if (params.get('manual') === '1') {
    // deterministic mode for automated tests: no loop, caller steps time and draws
    window.__chess.step = (seconds, hz = 30) => { const n = Math.max(1, Math.round(seconds * hz)); for (let i = 0; i < n; i++) advance(1 / hz); };
    window.__chess.draw = (dt = 0.016) => { orientLabels(); stage.render(dt); stage.render(dt); };
    window.__chess.draw();
  } else requestAnimationFrame(frame);

  progress(1, 'Ready');
  await tick();
  loaderEl.classList.add('done');
  document.body.classList.add('ready');
  window.__chessReady = true;
}

function applyParams({ game, controls, stage, ui }) {
  const fen = params.get('fen');
  if (fen) { try { game.loadFen(fen); } catch (e) { console.warn('Ignoring invalid fen parameter'); } }
  const moves = params.get('moves');
  if (moves) game.playMoves(moves.split(',').filter(Boolean), { instant: true });
  const sel = params.get('select');
  if (sel) game.selectSquare(sel);
  const ai = params.get('ai');
  // vs computer is on by default (you play white, Easy); ?ai=0 turns it off, ?ai=3 or 4 picks a level.
  if (ai !== '0') game.setVsComputer(true, { color: 'b', depth: +ai || 2 });
  const preset = params.get('preset');
  if (preset) {
    controls.setPreset(preset);
    for (let i = 0; i < 120; i++) controls.update(0.02); // jump to the end of the transition
  }
  for (const a of ['x', 'y', 'z']) {
    if (params.has('g' + a)) controls.setGimbal(a, +params.get('g' + a));
  }
  if (params.has('yaw') || params.has('pitch') || params.has('dist')) {
    const c = controls.camera;
    const DEG = Math.PI / 180;
    controls.setCamera({
      yaw: params.has('yaw') ? +params.get('yaw') * DEG : c.yaw,
      pitch: params.has('pitch') ? +params.get('pitch') * DEG : c.pitch,
      dist: params.has('dist') ? +params.get('dist') : c.dist,
    });
  }
  if (params.get('hud') === '0') ui.toggleHud(true);
  if (params.get('help') === '1') ui.toggleHelp();
  const light = params.get('light');
  if (light) stage.setLightingPreset?.(light);
  if (params.get('spin') === '1') controls.toggleSpin();
  const promo = params.get('promo');
  if (promo) game.clickSquare(game.nameSq(promo.slice(0, 2))), game.clickSquare(game.nameSq(promo.slice(2, 4)));
}

boot().catch(fail);
