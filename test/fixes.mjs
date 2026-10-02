// Regression checks for three fixed bugs: board label orientation, hidden piece picking, capture tray vs HUD overlap.
// Usage: const results = await runFixChecks({ page, baseUrl, log }); each result is { name, pass, detail }.
// Needs a served build (or dev server) at baseUrl. Uses ?quality=low&manual=1&ai=0 and the window.__chess hooks.

const FLAGS = 'quality=low&manual=1&ai=0';

async function load(page, baseUrl, query = '', size = { width: 1400, height: 800 }) {
  await page.setViewport(size);
  await page.goto(`${baseUrl}/?${FLAGS}${query ? `&${query}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('window.__chessReady === true && !!window.__chess.step', { timeout: 120000 });
  await page.evaluate(() => { window.__chess.step(2); window.__chess.draw(); });
}

// ---------------------------------------------------------------- (a) label orientation
// Every visible label quad is projected through the live camera. For a label to read upright and unmirrored
// its glyph "up" (texture v increasing) must point toward the screen top and its glyph "right" (u increasing)
// toward the screen right. The old board baked in White-side orientation on two edges and Black-side on the
// other two, so half of the labels were upside down from any single viewpoint.
async function checkLabels(page, baseUrl, log) {
  const out = [];
  for (const [preset, query] of [['White view', 'preset=White%20view'], ['Top down', 'preset=Top%20down'], ['Black view', 'preset=Black%20view']]) {
    await load(page, baseUrl, query);
    const r = await page.evaluate(() => {
      const { THREE, stage, gimbal } = window.__chess;
      stage.scene.updateMatrixWorld(true);
      stage.camera.updateMatrixWorld(true);
      const meshes = [];
      gimbal.traverse((o) => {
        if (!o.isMesh || !o.name.startsWith('labels')) return;
        for (let p = o; p; p = p.parent) if (!p.visible) return;
        meshes.push(o);
      });
      let quads = 0, bad = 0, flipY = null;
      const worst = [];
      const v = (g, i, m) => new THREE.Vector3().fromBufferAttribute(g.attributes.position, i).applyMatrix4(m).project(stage.camera);
      for (const m of meshes) {
        flipY = m.material.map.flipY;
        const g = m.geometry;
        for (let q = 0; q + 3 < g.attributes.position.count; q += 4) {
          const p0 = v(g, q, m.matrixWorld), p1 = v(g, q + 1, m.matrixWorld), p3 = v(g, q + 3, m.matrixWorld);
          const u = g.attributes.uv;
          // quad corners: 0 = (u0,v0) bottom left of the glyph cell, 1 = right of it, 3 = top of it
          const uRight = u.getX(q + 1) - u.getX(q), vUp = u.getY(q + 3) - u.getY(q);
          const sRight = (p1.x - p0.x) * Math.sign(uRight);
          const sUp = (p3.y - p0.y) * Math.sign(vUp) * (flipY ? 1 : -1);
          quads++;
          if (!(sRight > 0 && sUp > 0)) { bad++; if (worst.length < 3) worst.push({ mesh: m.name, q: q / 4, sRight, sUp }); }
        }
      }
      return { meshes: meshes.map((m) => m.name), quads, bad, worst };
    });
    const pass = r.quads === 32 && r.bad === 0;
    out.push({
      name: `labels upright in ${preset}`,
      pass,
      detail: pass ? `${r.quads} label quads read upright (${r.meshes.join(', ')})`
        : `${r.bad} of ${r.quads} visible label quads are rotated or mirrored (meshes ${r.meshes.join(', ')}) ${JSON.stringify(r.worst)}`,
    });
    log?.(`labels ${preset}: ${pass ? 'ok' : 'FAIL'}`);
  }
  return out;
}

// ---------------------------------------------------------------- (b) picking
// Real mouse clicks. Helpers run in the page: screen position of a point on a piece, and the nearest piece along a ray.
const PICK_HELPERS = `
  window.__fx = {
    screen(x, y, z) {
      const { THREE, stage } = window.__chess;
      const v = new THREE.Vector3(x, y, z).project(stage.camera);
      return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
    },
    // all pieces (by square name) whose real mesh the ray through client (cx, cy) hits, nearest first
    hits(cx, cy) {
      const { THREE, stage, game } = window.__chess;
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1), stage.camera);
      const out = [];
      game.root.children.forEach((g) => {
        if (!g.isGroup) return; // piece groups only (tray slabs are plain meshes)
        const meshes = [];
        g.traverse((o) => { if (o.isMesh && !o.userData.hit) meshes.push(o); });
        const h = rc.intersectObjects(meshes, false);
        if (h.length) out.push({ d: h[0].distance, x: g.position.x, z: g.position.z });
      });
      out.sort((a, b) => a.d - b.d);
      const sq = (x, z) => 'abcdefgh'[Math.round(x + 3.5)] + (Math.round(3.5 - z) + 1);
      return out.map((o) => ({ sq: sq(o.x, o.z), d: o.d }));
    },
  };
`;

async function settle(page) {
  await page.evaluate(() => { window.__chess.step(3); window.__chess.draw(); });
}

async function clickAt(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await settle(page);
}

async function checkPicking(page, baseUrl, log) {
  const out = [];

  // 1) A queen with no legal moves (boxed in by its own men) stands directly in front of a pawn that can move.
  //    Clicking the visible queen must select the queen, not the pawn hidden behind it.
  await load(page, baseUrl, `fen=${encodeURIComponent('4k3/8/8/8/8/2PPP3/2PQP3/2BRKB2 w - - 0 1')}`);
  await page.evaluate(PICK_HELPERS);
  const found = await page.evaluate(() => {
    // scan the queen's screen silhouette for a ray that hits the queen first and the d3 pawn right behind it
    const { game } = window.__chess;
    const fx = window.__fx;
    let best = null;
    for (let y = 0.2; y <= 2.2; y += 0.1) for (let dx = -0.25; dx <= 0.25; dx += 0.05) {
      const s = fx.screen(-0.5 + dx, y, 2.5); // d2 is x = -0.5, z = 2.5
      const h = fx.hits(s.x, s.y);
      if (h.length >= 2 && h[0].sq === 'd2' && h[1].sq === 'd3') { best = { x: s.x, y: s.y, hits: h.map((o) => o.sq) }; break; }
    }
    const legalFromD2 = game.chess.moves().filter((m) => m.from === 3 + 8).length;
    const legalFromD3 = game.chess.moves().filter((m) => m.from === 3 + 16).length;
    return { best, legalFromD2, legalFromD3 };
  });
  if (!found.best) {
    out.push({ name: 'front piece takes the click', pass: false, detail: 'test setup: no ray hits the queen with the pawn behind it' });
  } else {
    await clickAt(page, found.best.x, found.best.y);
    const st = await page.evaluate(() => window.__chess.game.getState());
    const pass = st.selected === 'd2' && found.legalFromD2 === 0 && found.legalFromD3 > 0;
    out.push({
      name: 'front piece takes the click (hidden piece not picked)',
      pass,
      detail: `ray hits ${found.best.hits.join(' then ')}; queen d2 has ${found.legalFromD2} moves, pawn d3 has ${found.legalFromD3}; selected = ${st.selected} (want d2)`,
    });
  }
  log?.(`picking front piece: ${out[out.length - 1].pass ? 'ok' : 'FAIL'}`);

  // 2) Clicking a capture target piece still captures; clicking an empty destination square still moves.
  await load(page, baseUrl, `fen=${encodeURIComponent('4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1')}`);
  await page.evaluate(PICK_HELPERS);
  const rook = await page.evaluate(() => window.__fx.screen(-0.5, 0.5, 3.5)); // rook on d1
  await clickAt(page, rook.x, rook.y);
  const sel = await page.evaluate(() => window.__chess.game.getState().selected);
  const s = await page.evaluate(() => window.__fx.screen(-0.5, 0.45, -0.5)); // pawn on d5
  await clickAt(page, s.x, s.y);
  const cap = await page.evaluate(() => { const st = window.__chess.game.getState(); return { moves: st.moves, fen: st.fen, captured: st.captured.b.length }; });
  const capPass = sel === 'd1' && cap.moves.length === 1 && /x/.test(cap.moves[0]) && cap.captured === 1;
  out.push({ name: 'clicking a capture target piece captures it', pass: capPass, detail: `selected ${sel}, moves ${JSON.stringify(cap.moves)}, black pieces captured ${cap.captured}` });
  log?.(`picking capture: ${capPass ? 'ok' : 'FAIL'}`);

  await load(page, baseUrl, `fen=${encodeURIComponent('4k3/8/8/8/8/8/8/3RK3 w - - 0 1')}`);
  await page.evaluate(PICK_HELPERS);
  const r2 = await page.evaluate(() => window.__fx.screen(-0.5, 0.5, 3.5));
  await clickAt(page, r2.x, r2.y);
  const dest = await page.evaluate(() => window.__fx.screen(-0.5, 0, 0.5)); // empty square d4
  await clickAt(page, dest.x, dest.y);
  const mv = await page.evaluate(() => window.__chess.game.getState().moves);
  const mvPass = mv.length === 1 && mv[0] === 'Rd4';
  out.push({ name: 'clicking an empty legal target square moves', pass: mvPass, detail: `moves ${JSON.stringify(mv)} (want Rd4)` });
  log?.(`picking move: ${mvPass ? 'ok' : 'FAIL'}`);
  return out;
}

// ---------------------------------------------------------------- (c) trays vs HUD
// Projects the two capture tray volumes (slab footprint, tall enough for the captured pieces) to the screen and
// compares the bounding rectangles against every visible HUD card and the viewport.
async function checkTrays(page, baseUrl, log) {
  const out = [];
  const sizes = [[1280, 720], [1280, 800], [1400, 788], [1600, 900], [1920, 1080]];
  for (const [width, height] of sizes) {
    // a fresh load per size: resizing a live software-GL page repeatedly can crash headless Chrome
    await load(page, baseUrl, 'moves=e2e4,d7d5,e4d5,d8d5,b1c3,d5a5', { width, height });
    const r = await page.evaluate(() => {
      const { THREE, stage, gimbal } = window.__chess;
      stage.scene.updateMatrixWorld(true);
      stage.camera.updateMatrixWorld(true);
      const slabs = [];
      gimbal.traverse((o) => { if (o.name === 'tray-slab') slabs.push(o); });
      const trays = slabs.map((s) => {
        const b = new THREE.Box3().setFromObject(s);
        b.max.y = 1.4; // captured pieces stand on the slab (scaled to 0.62, king about 1.4 tall at most)
        let l = Infinity, t = Infinity, rr = -Infinity, bt = -Infinity;
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
          const p = new THREE.Vector3(x, y, z).project(stage.camera);
          const sx = (p.x + 1) / 2 * innerWidth, sy = (1 - p.y) / 2 * innerHeight;
          l = Math.min(l, sx); rr = Math.max(rr, sx); t = Math.min(t, sy); bt = Math.max(bt, sy);
        }
        return { side: b.min.x < 0 ? 'left' : 'right', l, t, r: rr, b: bt };
      });
      const cards = [...document.querySelectorAll('#hud .card')].map((e) => {
        const q = e.getBoundingClientRect();
        return { name: e.dataset.card || e.className, l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height };
      }).filter((c) => c.w > 0 && c.h > 0);
      return { trays, cards, vw: innerWidth, vh: innerHeight };
    });
    const problems = [];
    for (const t of r.trays) {
      if (t.l < 0 || t.t < 0 || t.r > r.vw || t.b > r.vh) problems.push(`${t.side} tray leaves the viewport`);
      for (const c of r.cards) {
        if (t.l < c.r && t.r > c.l && t.t < c.b && t.b > c.t) problems.push(`${t.side} tray [${Math.round(t.l)}-${Math.round(t.r)} x ${Math.round(t.t)}-${Math.round(t.b)}] overlaps card ${c.name} [${Math.round(c.l)}-${Math.round(c.r)} x ${Math.round(c.t)}-${Math.round(c.b)}]`);
      }
    }
    const pass = r.trays.length === 2 && r.cards.length > 0 && problems.length === 0;
    const gaps = r.trays.map((t) => `${t.side} ${Math.round(t.side === 'left' ? t.l - Math.max(...r.cards.filter((c) => c.l < r.vw / 2).map((c) => c.r)) : Math.min(...r.cards.filter((c) => c.l >= r.vw / 2).map((c) => c.l)) - t.r)}px`).join(', ');
    out.push({ name: `trays clear of HUD at ${width}x${height}`, pass, detail: pass ? `no overlap, clearance to HUD: ${gaps}` : problems.join('; ') || 'tray or card not found' });
    log?.(`trays ${width}x${height}: ${pass ? 'ok' : 'FAIL'}`);
  }
  return out;
}

export async function runFixChecks({ page, baseUrl, log = () => {} }) {
  const results = [];
  for (const [name, fn] of [['labels', checkLabels], ['picking', checkPicking], ['trays', checkTrays]]) {
    try {
      results.push(...(await fn(page, baseUrl, log)));
    } catch (err) {
      results.push({ name: `${name} checks ran`, pass: false, detail: String(err && err.stack || err).slice(0, 400) });
    }
  }
  return results;
}
