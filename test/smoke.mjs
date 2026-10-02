// Smoke tier: build, serve, drive the real page in headless Chrome (software GL), about a minute.
// Usage: node test/smoke.mjs [--port=5303] [--dev] [--dev-port=5302] [--skip-build] [--write-budgets] [--shots]
//   page health        loads and reaches window.__chessReady, no console error, no page error, no foreign host, time to ready
//   scripted game      real pointer clicks on projected squares: capture, castling both sides, en passant, promotion chooser (cancel,
//                      queen, knight), fool's mate with the game over banner, undo of each, new game, vs computer reply
//   gimbal             each axis slider rotates gimbal.rotation, the floor fades when tilted, Reset and Level board restore
//   render budgets     draw calls, triangles, geometries, textures against tools/budgets.json (--write-budgets stores 1.5x measured)
//   pixels             canvas not blank, no black frame, no white out, board region holds light and dark pixels, in every view preset
//   fix checks         test/fixes.mjs runFixChecks({ page, baseUrl, log }) when that file exists
// vs computer is the default in the app: the page health run uses no ai flag and checks it, all other runs add ai=0.
// --skip-fixes leaves out test/fixes.mjs. --dev serves the vite dev server on the dev port instead of building. --shots saves screenshots to .tmp/smoke-shots/ (emptied first) and a contact sheet of them, contact-<w>x<h>.png.
// Exit codes: 0 pass (warnings allowed), 1 at least one check failed, 2 setup error.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, reporter, launchBrowser, watchPage, startServer, build, sleep } from '../tools/_lib.mjs';
import { contactSheets } from '../tools/contact-sheet.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const flag = (n) => args.includes(`--${n}`);
const PORT = Number(opt('port', 5303)), DEV_PORT = Number(opt('dev-port', 5302));
const OUT = '.tmp/smoke-dist', SHOTS = join(ROOT, '.tmp/smoke-shots'), BUDGETS = join(ROOT, 'tools/budgets.json');
const R = reporter();
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const URLQ = '?quality=low&manual=1&ai=0';   // human against human, deterministic
const URL_DEFAULT = '?quality=low&manual=1';   // no ai flag: the computer plays black
if (flag('shots')) {   // start empty, so the contact sheet shows this run only
  mkdirSync(SHOTS, { recursive: true });
  for (const f of readdirSync(SHOTS)) if (f.endsWith('.png')) rmSync(join(SHOTS, f));
}

let server = null, browser = null;
const finish = async () => {
  if (flag('shots') && browser) {
    try { for (const f of await contactSheets(browser, SHOTS)) console.log(`      contact sheet: ${f.slice(ROOT.length + 1)}`); }
    catch (e) { R.warn('contact sheet', String(e.message).slice(0, 200)); }
  }
  try { await browser?.close(); } catch (e) { /* ignore */ }
  try { server?.stop(); } catch (e) { /* ignore */ }
  const s = R.summary();
  console.log(`\nsmoke: ${s.rows.length} checks: ${s.np} pass, ${s.nw} warn, ${s.nf} fail (${secs()})`);
  console.log(s.nf ? 'SMOKE FAILED' : s.nw ? 'SMOKE OK WITH WARNINGS' : 'SMOKE OK');
  process.exit(s.nf ? 1 : 0);
};
process.on('uncaughtException', (e) => { console.error('FAIL  uncaught', e && e.stack || e); R.fail('uncaught exception', String(e && e.message).slice(0, 200)); finish(); });
const guard = async (name, fn) => { try { await fn(); } catch (e) { R.fail(name, 'threw: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 300)); } };

// ------------------------------------------------------------------ build and serve
try {
  if (flag('dev')) {
    server = await startServer({ mode: 'dev', port: DEV_PORT });
    R.pass('dev server up', server.base);
  } else {
    if (!flag('skip-build')) {
      const tb = Date.now();
      const out = build(OUT);
      const warns = out.split('\n').filter((l) => /warn|error|\(!\)/i.test(l));
      R.pass('vite build', `${((Date.now() - tb) / 1000).toFixed(1)}s`);
      if (warns.length) R.warn('build output has no warnings', warns.slice(0, 2).join(' | '));
    }
    server = await startServer({ mode: 'preview', port: PORT, outDir: OUT });
    R.pass('vite preview up', server.base);
  }
  browser = await launchBrowser({ w: 1280, h: 720 });
} catch (e) {
  R.fail('build, serve and launch', String(e.stderr || e.stdout || e.message).split('\n').slice(-4).join(' | ').slice(0, 400));
  await finish();
}
const base = server.base;

// ------------------------------------------------------------------ page health
const page = await browser.newPage();
const watch = await watchPage(page, ['127.0.0.1', 'localhost']);
let readyMs = NaN, ready = false;
await guard('page health', async () => {
  const t = Date.now();
  await page.goto(base + URL_DEFAULT, { waitUntil: 'load', timeout: 60000 });
  try { await page.waitForFunction(() => window.__chessReady || window.__chessError, { timeout: 120000, polling: 100 }); } catch (e) { /* reported below */ }
  readyMs = Date.now() - t;
  const st = await page.evaluate(() => ({ ready: !!window.__chessReady, error: window.__chessError || null, api: ['stage', 'gimbal', 'board', 'game', 'controls', 'step', 'draw'].filter((k) => !window.__chess || !(k in window.__chess)) }));
  ready = st.ready;
  R.expect('page reaches window.__chessReady', st.ready, `${(readyMs / 1000).toFixed(1)}s`, st.error || 'not ready');
  R.expect('test hooks are exposed on window.__chess', st.api.length === 0, 'stage gimbal board game controls step draw', 'missing ' + st.api.join(','));
  await sleep(300);
  R.expect('no console error and no page error while loading', watch.errs.length === 0, 'clean', watch.errs.slice(0, 3).join(' | '));
  R.expect('no request to a foreign host', watch.foreign.length === 0, 'only 127.0.0.1', watch.foreign.slice(0, 3).join(' | '));
  const w = watch.warns.filter((m) => !/GPU stall|ReadPixels|swiftshader|software|WebGL: CONTEXT_LOST/i.test(m));
  if (w.length) R.warn('console warnings while loading', `${w.length}: ${w[0].slice(0, 120)}`);
  else R.pass('no console warnings while loading');
});
if (!ready) { R.fail('app ready, remaining checks skipped', ''); await finish(); }

// ------------------------------------------------------------------ helpers (Node side)
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const step = (s) => ev((x) => window.__chess.step(x), s);
/** Screen position that the app's own picking resolves to the given square: tries a few heights and offsets, so a tall piece in front
 *  of the target cannot steal the click. Returns null when no point on the canvas picks that square. */
const sqXY = (name) => ev((n) => {
  const c = window.__chess, T = c.THREE, sq = c.game.nameSq(n);
  c.gimbal.updateMatrixWorld(true); c.stage.camera.updateMatrixWorld(true);
  const r = c.stage.renderer.domElement.getBoundingClientRect();
  for (const [dx, dz] of [[0, 0], [0, -0.2], [0, 0.2], [-0.2, 0], [0.2, 0], [0, -0.35], [0.3, 0.3], [-0.3, 0.3]]) {
    for (const y of [0.3, 0.6, 0.15, 0.9, 0.05, 1.2]) {
      const v = new T.Vector3((sq & 7) - 3.5 + dx, y, 3.5 - (sq >> 3) + dz);
      c.gimbal.localToWorld(v); v.project(c.stage.camera);
      const x = r.left + ((v.x + 1) / 2) * r.width, y2 = r.top + ((1 - v.y) / 2) * r.height;
      const top = document.elementFromPoint(x, y2);
      if (!top || top.id !== 'stage') continue;
      if (c.pick(x, y2) === sq) return { x, y: y2, found: true };
    }
  }
  return { found: false };
}, name);
const clickSq = async (name) => {
  const p = await sqXY(name);
  if (!p.found) throw new Error(`no free point on the canvas picks square ${name}`);
  await page.mouse.click(p.x, p.y);
  if (process.env.SMOKE_DEBUG) console.log('      click', name, p.x.toFixed(0), p.y.toFixed(0));
};
const snap = () => ev(() => {
  const g = window.__chess.game, s = g.getState();
  return { moves: s.moves, fen: s.fen, turn: s.turn, over: s.over ? { reason: s.over.reason, result: s.over.result } : null, check: s.check, captured: s.captured, audit: g.audit(),
    pieces: g.pieceCount, promo: !!g.pendingPromotion, board: g.chess.board.slice(), selected: s.selected };
});
const sq = (name) => (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
const loadFen = (fen) => ev((f) => { window.__chess.game.loadFen(f); window.__chess.step(0.5); }, fen);
/** one human move through two real clicks, then let the animation finish */
const play = async (from, to) => { await clickSq(from); await clickSq(to); await step(2.5); };
const key = (k) => page.keyboard.press(k);
const lastSan = (s) => s.moves[s.moves.length - 1];
const sameFen = (a, b) => a.split(' ').slice(0, 4).join(' ') === b.split(' ').slice(0, 4).join(' ');

// ------------------------------------------------------------------ vs computer is the default
await guard('vs computer default', async () => {
  await step(0.5);
  const d = await ev(() => ({ on: window.__chess.game.getState().vsComputer, color: window.__chess.game.getState().computerColor, chk: document.getElementById('chk-ai').checked }));
  R.expect('without an ai flag the computer is on and plays black', d.on && d.color === 'b', 'vsComputer true, black', JSON.stringify(d));
  R.expect('the vs computer checkbox is checked', d.chk, '#chk-ai checked', 'unchecked');
  await play('e2', 'e4');
  let n = 0;
  while (n++ < 40 && (await snap()).moves.length < 2) await step(1);
  const s = await snap();
  R.expect('after e2e4 the computer has replied as black with a legal move', s.moves.length === 2 && s.turn === 'w' && s.audit.length === 0, s.moves.join(' '), `${s.moves.join(' ')} ${s.audit.join(',')}`);
  // from here on: human against human
  await page.goto(base + URLQ, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__chessReady || window.__chessError, { timeout: 120000, polling: 100 });
  const off = await ev(() => window.__chess.game.getState().vsComputer);
  R.expect('ai=0 turns the computer off', off === false, 'vsComputer false', String(off));
});

// ------------------------------------------------------------------ scripted game
await guard('scripted game', async () => {
  await ev(() => window.__chess.game.newGame({ instant: true }));
  await step(0.5);
  let s = await snap();
  R.expect('start position: 32 pieces, white to move, view matches the rules', s.pieces === 32 && s.turn === 'w' && s.audit.length === 0, 'audit clean', s.audit.slice(0, 2).join(','));
  const startFen = s.fen;

  // a legal move through real input, and an illegal one is refused
  await clickSq('e2');
  s = await snap();
  R.expect('click selects an own piece', s.selected === 'e2', 'e2 selected');
  await clickSq('e5');
  s = await snap();
  R.expect('clicking an illegal target does not move', s.moves.length === 0 && s.selected === null, 'refused, selection cleared');
  await play('e2', 'e4');
  s = await snap();
  R.expect('pawn move e2e4 by two clicks', lastSan(s) === 'e4' && s.turn === 'b' && s.board[sq('e4')] === 'P' && s.audit.length === 0, 'e4', `got ${lastSan(s)} ${s.audit.join(',')}`);
  await play('d7', 'd5');

  // capture
  await play('e4', 'd5');
  s = await snap();
  R.expect('capture exd5: san, board, captured list, view consistent', lastSan(s) === 'exd5' && s.board[sq('d5')] === 'P' && s.captured.b.join('') === 'p' && s.audit.length === 0,
    'exd5, black pawn in the tray', `${lastSan(s)} cap=${JSON.stringify(s.captured)} ${s.audit.join(',')}`);
  await key('u'); await step(2.5);
  s = await snap();
  R.expect('undo of the capture restores the pawn and empties the tray', s.moves.length === 2 && s.captured.b.length === 0 && s.board[sq('d5')] === 'p' && s.audit.length === 0 && s.turn === 'w', 'restored', `${s.moves.join(' ')} ${JSON.stringify(s.captured)} ${s.audit.join(',')}`);
  await key('u'); await key('u'); await step(2.5);
  s = await snap();
  R.expect('undo back to the start position', sameFen(s.fen, startFen) && s.moves.length === 0 && s.audit.length === 0, 'start fen', s.fen);

  // castling, both sides, both colors
  await loadFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const castleFen = (await snap()).fen;
  await play('e1', 'g1');
  s = await snap();
  R.expect('white kingside castling: O-O, rook on f1, view consistent', lastSan(s) === 'O-O' && s.board[sq('g1')] === 'K' && s.board[sq('f1')] === 'R' && s.audit.length === 0, 'O-O', `${lastSan(s)} ${s.audit.join(',')}`);
  await play('e8', 'c8');
  s = await snap();
  R.expect('black queenside castling: O-O-O, rook on d8, view consistent', lastSan(s) === 'O-O-O' && s.board[sq('c8')] === 'k' && s.board[sq('d8')] === 'r' && s.audit.length === 0, 'O-O-O', `${lastSan(s)} ${s.audit.join(',')}`);
  await key('u'); await key('u'); await step(2.5);
  s = await snap();
  R.expect('undo of both castles restores kings and rooks', sameFen(s.fen, castleFen) && s.audit.length === 0 && s.board[sq('h1')] === 'R' && s.board[sq('a8')] === 'r', 'restored', `${s.fen} ${s.audit.join(',')}`);

  // en passant
  await loadFen('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  const epFen = (await snap()).fen;
  await play('e5', 'f6');
  s = await snap();
  R.expect('en passant exf6 removes the pawn on f5', lastSan(s) === 'exf6' && s.board[sq('f5')] === null && s.board[sq('f6')] === 'P' && s.captured.b.join('') === 'p' && s.audit.length === 0,
    'exf6, f5 empty, pawn in the tray', `${lastSan(s)} f5=${s.board[sq('f5')]} ${s.audit.join(',')}`);
  await key('u'); await step(2.5);
  s = await snap();
  R.expect('undo of en passant puts the pawn back on f5', sameFen(s.fen, epFen) && s.board[sq('f5')] === 'p' && s.captured.b.length === 0 && s.audit.length === 0, 'restored', `${s.fen} ${s.audit.join(',')}`);

  // promotion chooser
  await loadFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const promoFen = (await snap()).fen;
  await clickSq('a7'); await clickSq('a8');
  s = await snap();
  const chooser = await ev(() => { const e = document.getElementById('promo'); return { shown: !e.hidden, buttons: [...e.querySelectorAll('button')].map((b) => b.dataset.p).join('') }; });
  R.expect('promotion opens the chooser with queen, rook, bishop, knight', s.promo && chooser.shown && chooser.buttons === 'qrbn', 'qrbn', JSON.stringify(chooser));
  await key('Escape'); await step(0.3);
  s = await snap();
  const hidden = await ev(() => document.getElementById('promo').hidden);
  R.expect('Escape cancels the chooser without moving', !s.promo && hidden && s.moves.length === 0 && s.board[sq('a7')] === 'P', 'cancelled', `promo=${s.promo} hidden=${hidden} moves=${s.moves.length}`);
  await clickSq('a8');   // the cancelled pawn is still selected
  await page.click('#promo button[data-p="q"]'); await step(2.5);
  s = await snap();
  R.expect('promotion to a queen: a8=Q, queen on a8, view consistent', lastSan(s) === 'a8=Q' && s.board[sq('a8')] === 'Q' && s.audit.length === 0, 'a8=Q', `${lastSan(s)} ${s.audit.join(',')}`);
  await key('u'); await step(2.5);
  s = await snap();
  R.expect('undo of the promotion brings the pawn back', sameFen(s.fen, promoFen) && s.board[sq('a7')] === 'P' && s.board[sq('a8')] === null && s.audit.length === 0, 'pawn on a7', `${s.fen} ${s.audit.join(',')}`);
  await clickSq('a7'); await clickSq('a8');
  await page.click('#promo button[data-p="n"]'); await step(2.5);
  s = await snap();
  R.expect('underpromotion to a knight: a8=N', lastSan(s) === 'a8=N' && s.board[sq('a8')] === 'N' && s.audit.length === 0, 'a8=N', `${lastSan(s)} ${s.audit.join(',')}`);

  // fool's mate
  await ev(() => window.__chess.game.newGame({ instant: true })); await step(0.5);
  for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) await play(a, b);
  await step(3);
  s = await snap();
  R.expect("fool's mate ends the game: Qh4#, checkmate, 0-1", lastSan(s) === 'Qh4#' && s.over && s.over.reason === 'checkmate' && s.over.result === '0-1', 'checkmate 0-1', `${lastSan(s)} ${JSON.stringify(s.over)}`);
  const banner = await ev(() => { const b = document.getElementById('banner'); return { shown: !b.hidden, text: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) }; });
  R.expect('game over banner is shown', banner.shown, banner.text, 'banner hidden');
  const kingTilt = await ev(() => { let r = null; window.__chess.game.root.children.forEach((g) => { if (g.name === 'wk') r = Math.abs(g.rotation.z); }); return r; });
  R.expect('the mated king is toppled', kingTilt !== null && kingTilt > 0.5, `${kingTilt && kingTilt.toFixed(2)} rad`, `rotation ${kingTilt}`);
  await clickSq('e2').catch(() => {});
  s = await snap();
  R.expect('no moves accepted after the game is over', s.moves.length === 4, '4 plies');
  await key('u'); await step(2.5);
  s = await snap();
  const kingUp = await ev(() => { let r = 0; window.__chess.game.root.children.forEach((g) => { if (g.name === 'wk') r = Math.abs(g.rotation.z); }); return r; });
  R.expect('undo after mate reopens the game and rights the king', s.over === null && s.moves.length === 3 && kingUp < 0.01 && s.audit.length === 0, 'game open again', `over=${JSON.stringify(s.over)} tilt=${kingUp} ${s.audit.join(',')}`);
  await key('n'); await step(4);
  s = await snap();
  R.expect('new game (key N) resets to 32 pieces and the start position', sameFen(s.fen, startFen) && s.pieces === 32 && s.moves.length === 0 && s.audit.length === 0 && s.over === null, 'reset', `${s.fen} ${s.audit.join(',')}`);
});

// ------------------------------------------------------------------ gimbal
await guard('gimbal', async () => {
  const rot = () => ev(() => { const r = window.__chess.gimbal.rotation; return { x: r.x, y: r.y, z: r.z }; });
  const floor = () => ev(() => { const f = window.__chess.stage.floor; return { visible: f.visible, opacity: f.material.opacity }; });
  const setSlider = (axis, deg) => ev((a, d) => { const i = document.getElementById('sl-' + a); i.value = String(d); i.dispatchEvent(new Event('input', { bubbles: true })); window.__chess.step(0.3); }, axis, deg);
  const DEG = Math.PI / 180;
  const f0 = await floor();
  R.expect('the floor is fully visible with a level board', f0.visible && f0.opacity > 0.99, 'opacity 1', JSON.stringify(f0));
  for (const [axis, deg] of [['x', 30], ['y', 40], ['z', -25]]) {
    await setSlider(axis, deg);
    const r = await rot();
    const others = ['x', 'y', 'z'].filter((a) => a !== axis).every((a) => Math.abs(r[a]) < 1e-3);
    R.expect(`${axis.toUpperCase()} slider rotates the gimbal ${deg} degrees about ${axis}`, Math.abs(r[axis] - deg * DEG) < 2e-3 && others, `${(r[axis] / DEG).toFixed(1)} deg`, JSON.stringify(r));
    const f = await floor();
    if (axis === 'y') R.expect('floor stays when only yawing', f.opacity > 0.99, 'opacity 1', JSON.stringify(f));
    else R.expect(`floor fades when tilted about ${axis}`, f.opacity < 0.5, `opacity ${f.opacity.toFixed(2)}`, JSON.stringify(f));
    await setSlider(axis, 0);
  }
  await setSlider('x', 50);
  const f1 = await floor();
  R.expect('floor is hidden at a steep tilt', !f1.visible || f1.opacity < 0.02, `visible=${f1.visible}`, JSON.stringify(f1));
  await setSlider('y', 33); await setSlider('z', -20);
  await page.click('#btn-reset'); await step(2);
  const r1 = await rot(), cam1 = await ev(() => window.__chess.controls.camera), f2 = await floor();
  R.expect('Reset restores the gimbal, the camera and the floor', Math.max(Math.abs(r1.x), Math.abs(r1.y), Math.abs(r1.z)) < 1e-3 && Math.abs(cam1.yaw) < 1e-2 && f2.opacity > 0.99, 'level, white view', `${JSON.stringify(r1)} yaw=${cam1.yaw} floor=${f2.opacity}`);
  await setSlider('x', 35); await setSlider('z', 20);
  await page.evaluate(() => [...document.querySelectorAll('#sliders button')].find((b) => /level/i.test(b.textContent)).click()); await step(1.5);
  const r2 = await rot();
  R.expect('Level board restores the gimbal', Math.max(Math.abs(r2.x), Math.abs(r2.y), Math.abs(r2.z)) < 1e-3, 'level', JSON.stringify(r2));
  await page.keyboard.down('w'); await step(0.4); await page.keyboard.up('w');
  const r3 = await rot();
  R.expect('keyboard W tilts the board about X', Math.abs(r3.x) > 5 * DEG, `${(r3.x / DEG).toFixed(1)} deg`, JSON.stringify(r3));
  await key('r'); await step(2);
  const r4 = await rot();
  R.expect('key R resets the board', Math.max(Math.abs(r4.x), Math.abs(r4.y), Math.abs(r4.z)) < 1e-3, 'level', JSON.stringify(r4));
});

// ------------------------------------------------------------------ render budgets
await guard('render budgets', async () => {
  const m = await ev(() => {
    const st = window.__chess.stage, info = st.renderer.info;
    window.__chess.game.newGame({ instant: true });   // the full start position, white view, level board
    window.__chess.controls.setGimbal('x', 0); window.__chess.controls.setGimbal('y', 0); window.__chess.controls.setGimbal('z', 0);
    window.__chess.controls.reset(); window.__chess.step(2);
    window.__chess.draw();
    info.autoReset = false; info.reset();
    st.render(0.016);
    const out = { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: (info.programs || []).length };
    info.autoReset = true; info.reset();
    return out;
  });
  const measured = { ...m, readyMs };
  console.log('      measured: ' + JSON.stringify(measured));
  if (flag('write-budgets')) {
    const b = { note: 'ceilings for the start position at quality=low, 1280x720: 1.5x measured (ready time: 5x, at least 30000 ms). Rewrite with: node test/smoke.mjs --write-budgets',
      calls: Math.ceil(m.calls * 1.5), triangles: Math.ceil(m.triangles * 1.5), geometries: Math.ceil(m.geometries * 1.5), textures: Math.ceil(m.textures * 1.5), programs: Math.ceil(m.programs * 1.5),
      readyMs: Math.max(30000, Math.ceil(readyMs * 5)), measured };
    writeFileSync(BUDGETS, JSON.stringify(b, null, 2) + '\n');
    R.pass('budgets written', 'tools/budgets.json');
  }
  if (!existsSync(BUDGETS)) { R.warn('render budgets', 'tools/budgets.json missing, run with --write-budgets'); return; }
  const b = JSON.parse(readFileSync(BUDGETS, 'utf8'));
  for (const k of ['calls', 'triangles', 'geometries', 'textures', 'programs']) {
    if (b[k] === undefined) continue;
    R.expect(`render budget ${k}`, m[k] <= b[k], `${m[k]} <= ${b[k]}`, `${m[k]} > ${b[k]}`);
  }
  if (b.readyMs !== undefined) R.expect('time to ready', readyMs <= b.readyMs, `${(readyMs / 1000).toFixed(1)}s <= ${(b.readyMs / 1000).toFixed(0)}s`, `${readyMs} ms > ${b.readyMs} ms`);
});

// ------------------------------------------------------------------ pixels
/** runs in the page: render, read the whole canvas back, and describe it */
const PIXELS = () => {
  const c = window.__chess, gl = c.stage.renderer.getContext(), cv = gl.canvas, T = c.THREE;
  c.draw();
  const W = cv.width, H = cv.height, buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let sum = 0, sum2 = 0, n = 0, black = 0, white = 0;
  const seen = new Set();
  for (let i = 0; i < buf.length; i += 16) {
    const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    sum += l; sum2 += l * l; n++;
    if (l < 4) black++;
    if (l > 240) white++;
    seen.add(((buf[i] >> 3) << 10) | ((buf[i + 1] >> 3) << 5) | (buf[i + 2] >> 3));
  }
  const mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  // projected board corners (drawing buffer pixels, origin bottom left)
  c.gimbal.updateMatrixWorld(true); c.stage.camera.updateMatrixWorld(true);
  const corners = [[-4, -4], [4, -4], [4, 4], [-4, 4]].map(([x, z]) => { const v = new T.Vector3(x, 0, z); c.gimbal.localToWorld(v); v.project(c.stage.camera); return [((v.x + 1) / 2) * W, ((v.y + 1) / 2) * H]; });
  const inside = (px, py) => { let pos = 0, neg = 0; for (let k = 0; k < 4; k++) { const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4]; const cr = (bx - ax) * (py - ay) - (by - ay) * (px - ax); if (cr > 0) pos++; else if (cr < 0) neg++; } return pos === 0 || neg === 0; };
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  let bp = 0, light = 0, dark = 0;
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
    if (!inside(x, y)) continue;
    const i = (y * W + x) * 4, l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    bp++; if (l > 150) light++; else if (l < 60) dark++;
  }
  const onScreen = corners.filter(([x, y]) => x >= 0 && x <= W && y >= 0 && y <= H).length;
  return { W, H, mean, std, blackFrac: black / n, whiteFrac: white / n, colors: seen.size, boardPx: bp, lightFrac: bp ? light / bp : 0, darkFrac: bp ? dark / bp : 0, onScreen };
};
await guard('pixels', async () => {
  await ev(() => window.__chess.game.newGame({ instant: true })); await step(0.5);
  const views = [['White view', 0], ['Black view', 0], ['Top down', 0], ['Side', 0], ['Isometric', 0], ['White view', 30]];
  for (const [preset, tilt] of views) {
    await ev((p, t) => { const c = window.__chess.controls; c.setPreset(p); window.__chess.step(2); if (t) { c.setGimbal('x', t); window.__chess.step(0.3); } }, preset, tilt);
    const p = await ev(PIXELS);
    const tag = `${preset}${tilt ? ` tilted ${tilt} deg` : ''}`;
    if (flag('shots')) await page.screenshot({ path: join(SHOTS, `${tag.replace(/\W+/g, '-')}.png`) });
    console.log(`      ${tag}: mean ${p.mean.toFixed(0)} std ${p.std.toFixed(0)} colors ${p.colors} black ${(p.blackFrac * 100).toFixed(0)}% white ${(p.whiteFrac * 100).toFixed(1)}% board px ${p.boardPx} light ${(p.lightFrac * 100).toFixed(0)}% dark ${(p.darkFrac * 100).toFixed(0)}%`);
    R.expect(`${tag}: frame is not blank`, p.std > 8 && p.colors > 40, `std ${p.std.toFixed(0)}, ${p.colors} colors`, `std ${p.std.toFixed(1)}, ${p.colors} colors`);
    R.expect(`${tag}: no black frame`, p.mean > 8 && p.blackFrac < 0.6, `mean ${p.mean.toFixed(0)}`, `mean ${p.mean.toFixed(1)}, black ${(p.blackFrac * 100).toFixed(0)}%`);
    R.expect(`${tag}: no white out`, p.mean < 200 && p.whiteFrac < 0.4, `mean ${p.mean.toFixed(0)}`, `mean ${p.mean.toFixed(1)}, white ${(p.whiteFrac * 100).toFixed(0)}%`);
    R.expect(`${tag}: board region holds light and dark pixels`, p.boardPx > 2000 && p.lightFrac > 0.04 && p.darkFrac > 0.04, `light ${(p.lightFrac * 100).toFixed(0)}% dark ${(p.darkFrac * 100).toFixed(0)}%`, `px ${p.boardPx} light ${(p.lightFrac * 100).toFixed(1)}% dark ${(p.darkFrac * 100).toFixed(1)}%`);
  }
  await ev(() => { window.__chess.controls.reset(); window.__chess.step(2); });
});
await sleep(100);
R.expect('no console error or page error during the whole run', watch.errs.length === 0, 'clean', watch.errs.slice(0, 3).join(' | '));
R.expect('no request to a foreign host during the whole run', watch.foreign.length === 0, 'only 127.0.0.1', watch.foreign.slice(0, 3).join(' | '));

// ------------------------------------------------------------------ fix checks (written by another agent, optional)
await guard('fix checks', async () => {
  if (flag('skip-fixes')) { R.warn('fix checks', 'skipped by --skip-fixes'); return; }
  const file = join(ROOT, 'test/fixes.mjs');
  if (!existsSync(file)) { R.warn('fix checks', 'test/fixes.mjs not found, skipped'); return; }
  const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
  if (typeof mod.runFixChecks !== 'function') { R.fail('fix checks', 'test/fixes.mjs does not export runFixChecks'); return; }
  await page.close().catch(() => {});   // one busy page at a time
  const fp = await browser.newPage();
  const fw = await watchPage(fp, ['127.0.0.1', 'localhost']);
  await fp.setViewport({ width: 1280, height: 720 });
  try {
    // a fresh page with request and error watching; runFixChecks navigates it itself (baseUrl has no trailing slash)
    const res = await Promise.race([
      mod.runFixChecks({ page: fp, baseUrl: base.replace(/\/$/, ''), log: (m) => console.log('      ' + m) }),
      sleep(420000).then(() => { throw new Error('runFixChecks timed out after 420 s'); }),
    ]);
    for (const r of res || []) R.expect(`fix: ${r.name}`, !!r.pass, r.detail || '', r.detail || '');
    if (!res || !res.length) R.warn('fix checks', 'runFixChecks returned no rows');
  } finally { await fp.close().catch(() => {}); }
  if (fw.errs.length) R.fail('fix checks page had console or page errors', fw.errs.slice(0, 2).join(' | '));
});

await finish();
