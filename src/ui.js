// HUD: glass panels, move list, captured pieces, sliders, presets, menus, banners.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const g = (t) => GLYPH[t] + '︎';
const VAL = { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 };
const PIECE_NAME = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };

const KEYS = [
  ['Drag', 'Orbit camera'], ['Shift + drag / right drag', 'Rotate board'], ['Wheel / pinch', 'Zoom'],
  ['Q / E', 'Board roll (Z)'], ['W / S', 'Board pitch (X)'], ['A / D', 'Board yaw (Y)'],
  ['Arrow keys', 'Orbit camera'], ['+ / -', 'Zoom'], ['R', 'Reset view'], ['F', 'Flip to other side'],
  ['V', 'Top down'], ['1 to 5', 'View presets'], ['Space', 'Auto spin'], ['U', 'Undo'], ['N', 'New game'], ['H', 'Hide / show HUD'],
];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function createUI({ game, controls, stage, quality = 'high' }) {
  const hud = document.getElementById('hud');
  hud.innerHTML = '';

  // ------------------------------------------------------------ left column
  const left = el('aside', 'col left');
  left.innerHTML = `
    <section class="card brand">
      <div class="brand-row">
        <div class="logo" aria-hidden="true">${g('n')}</div>
        <div><h1>Chess 3D</h1><p class="sub">Studio edition</p></div>
        <button class="icon-btn" id="btn-hide" title="Hide HUD (H)" aria-label="Hide HUD">&#x2715;</button>
      </div>
      <div class="turn" id="turn"><i class="dot w"></i><div><b id="turn-main">White to move</b><small id="turn-sub">&nbsp;</small></div></div>
    </section>

    <div class="tools" id="tools">
    <section class="card" data-card="view">
      <header><h2>View</h2><span class="chev"></span></header>
      <div class="body">
        <div class="presets" id="presets"></div>
        <div class="row three">
          <button class="btn" id="btn-flip" title="Flip to the other side (F)">Flip</button>
          <button class="btn toggle" id="btn-spin" title="Auto spin (Space)">Spin</button>
          <button class="btn" id="btn-reset" title="Reset view (R)">Reset</button>
        </div>
      </div>
    </section>

    <section class="card" data-card="gimbal">
      <header><h2>Board gimbal</h2><span class="chev"></span></header>
      <div class="body sliders" id="sliders"></div>
    </section>

    <section class="card" data-card="scene">
      <header><h2>Scene</h2><span class="chev"></span></header>
      <div class="body">
        <label class="field"><span>Lighting</span><select id="sel-light"></select></label>
        <label class="field"><span>Quality</span><select id="sel-quality">
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      </div>
    </section>
    </div>`;

  // ------------------------------------------------------------ right column
  const right = el('aside', 'col right');
  right.innerHTML = `
    <section class="card" data-card="game">
      <header><h2>Game</h2><span class="chev"></span></header>
      <div class="body">
        <div class="row three">
          <button class="btn primary" id="btn-new" title="New game (N)">New game</button>
          <button class="btn" id="btn-undo" title="Undo (U)">Undo</button>
          <button class="btn" id="btn-help" title="Keyboard shortcuts (?)">Keys</button>
        </div>
        <div class="row ai">
          <label class="switch"><input type="checkbox" id="chk-ai"><span class="track"><i></i></span><em>vs computer</em></label>
          <select id="sel-ai-color" title="Your side"><option value="w">Play white</option><option value="b">Play black</option></select>
          <select id="sel-ai-level" title="Strength"><option value="2">Easy ~900</option><option value="3">Normal ~1200</option><option value="4">Hard ~1450</option></select>
        </div>
      </div>
    </section>

    <section class="card grow" data-card="moves">
      <header><h2>Moves</h2><span class="chev"></span></header>
      <div class="body">
        <ol class="moves" id="moves"></ol>
      </div>
    </section>

    <section class="card" data-card="captured">
      <header><h2>Captured</h2><span class="chev"></span></header>
      <div class="body">
        <div class="cap"><span class="who">By white</span><span class="glyphs b" id="cap-b"></span><span class="adv" id="adv-w"></span></div>
        <div class="cap"><span class="who">By black</span><span class="glyphs w" id="cap-w"></span><span class="adv" id="adv-b"></span></div>
      </div>
    </section>`;

  const help = el('div', 'help card');
  help.hidden = true;
  help.innerHTML = `<header><h2>Keyboard and mouse</h2></header><dl>${KEYS.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

  const showBtn = el('button', 'show-btn', 'Show HUD');
  showBtn.hidden = true;
  const drawerBtn = el('button', 'drawer-btn', 'Controls');

  hud.append(left, right, help, showBtn, drawerBtn);

  const $ = (sel, root = hud) => root.querySelector(sel);

  // ------------------------------------------------------------ collapsible cards
  const narrow = () => window.matchMedia('(max-width: 900px)').matches;
  hud.querySelectorAll('.card[data-card] > header').forEach((h) => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
  });
  if (narrow()) right.querySelectorAll('.card[data-card]').forEach((c) => { if (c.dataset.card !== 'game') c.classList.add('collapsed'); });
  drawerBtn.addEventListener('click', () => { $('#tools').style.bottom = `${right.offsetHeight + 20}px`; left.classList.toggle('open'); drawerBtn.classList.toggle('on', left.classList.contains('open')); });
  // expose toolbox on narrow screens as a sheet

  // ------------------------------------------------------------ presets and view buttons
  const presetBox = $('#presets');
  for (const name of controls.presets) {
    const b = el('button', 'btn preset', name);
    b.addEventListener('click', () => controls.setPreset(name));
    presetBox.append(b);
  }
  $('#btn-flip').addEventListener('click', () => controls.flip());
  $('#btn-reset').addEventListener('click', () => controls.reset());
  $('#btn-spin').addEventListener('click', () => controls.toggleSpin());

  // ------------------------------------------------------------ gimbal sliders
  const sliderBox = $('#sliders');
  const AXES = [['x', 'X', 'pitch'], ['y', 'Y', 'yaw'], ['z', 'Z', 'roll']];
  const sliders = {};
  for (const [axis, label, hint] of AXES) {
    const row = el('div', 'slider');
    row.innerHTML = `<label for="sl-${axis}"><b>${label}</b><span>${hint}</span></label>
      <input type="range" id="sl-${axis}" min="-180" max="180" step="1" value="0">
      <output id="out-${axis}">0&deg;</output>`;
    sliderBox.append(row);
    const input = row.querySelector('input'), out = row.querySelector('output');
    sliders[axis] = { input, out, sliding: false };
    input.addEventListener('pointerdown', () => { sliders[axis].sliding = true; });
    window.addEventListener('pointerup', () => { sliders[axis].sliding = false; });
    input.addEventListener('input', () => { controls.setGimbal(axis, +input.value); out.innerHTML = `${input.value}&deg;`; });
    input.addEventListener('dblclick', () => { controls.setGimbal(axis, 0); });
    input.addEventListener('keydown', (e) => e.stopPropagation());
  }
  const resetG = el('button', 'btn small', 'Level board');
  resetG.addEventListener('click', () => controls.levelBoard());
  sliderBox.append(resetG);

  // ------------------------------------------------------------ scene selects
  const selLight = $('#sel-light'), selQuality = $('#sel-quality');
  const presets = stage.lightingPresets || [];
  for (const n of presets) selLight.append(new Option(n, n));
  selLight.parentElement.hidden = !presets.length;
  selLight.addEventListener('change', () => stage.setLightingPreset?.(selLight.value));
  selQuality.value = quality;
  selQuality.addEventListener('change', () => stage.setQuality?.(selQuality.value));

  // ------------------------------------------------------------ game buttons
  $('#btn-new').addEventListener('click', () => { game.newGame(); hideBanner(); });
  $('#btn-undo').addEventListener('click', () => { game.undo(); hideBanner(); });
  $('#btn-help').addEventListener('click', toggleHelp);
  const chkAi = $('#chk-ai'), selAiColor = $('#sel-ai-color'), selAiLevel = $('#sel-ai-level');
  function applyAi() {
    const human = selAiColor.value;
    game.setVsComputer(chkAi.checked, { color: human === 'w' ? 'b' : 'w', depth: +selAiLevel.value });
    if (chkAi.checked) controls.setPreset(human === 'w' ? 'White view' : 'Black view');
  }
  chkAi.addEventListener('change', applyAi);
  selAiColor.addEventListener('change', () => { if (chkAi.checked) applyAi(); });
  selAiLevel.addEventListener('change', () => { if (chkAi.checked) applyAi(); });

  // ------------------------------------------------------------ hud visibility / help
  function toggleHud(force) {
    const hide = force ?? !hud.classList.contains('hidden');
    hud.classList.toggle('hidden', hide);
    showBtn.hidden = !hide;
    if (hide) { help.hidden = true; }
  }
  function toggleHelp() { help.hidden = !help.hidden; }
  $('#btn-hide').addEventListener('click', () => toggleHud(true));
  showBtn.addEventListener('click', () => toggleHud(false));
  controls.hooks.undo = () => { game.undo(); hideBanner(); };
  controls.hooks.newGame = () => { game.newGame(); hideBanner(); };
  controls.hooks.toggleHud = () => toggleHud();
  controls.hooks.toggleHelp = toggleHelp;
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { help.hidden = true; hideBanner(); game.pendingPromotion && promoCancel?.(); } });

  // ------------------------------------------------------------ state rendering
  const movesEl = $('#moves');
  let lastMovesKey = null;
  let lastCheck = false;
  function render(st) {
    // turn
    const white = st.turn === 'w';
    const dot = $('.turn .dot');
    dot.className = 'dot ' + st.turn;
    let main = white ? 'White to move' : 'Black to move', sub = ' ';
    if (st.over) {
      const w = st.over.winner;
      main = st.over.reason === 'checkmate' ? `Checkmate. ${w === 'w' ? 'White' : 'Black'} wins` : 'Draw';
      sub = st.over.reason === 'checkmate' ? 'Game over' : st.over.reason;
    } else if (st.thinking) { sub = 'Computer is thinking'; }
    else if (st.check) sub = 'Check';
    else if (st.vsComputer) sub = st.turn === st.computerColor ? 'Computer to move' : 'Your move';
    $('#turn-main').textContent = main;
    $('#turn-sub').textContent = sub;
    $('.turn').classList.toggle('check', !!st.check && !st.over);
    $('.turn').classList.toggle('think', !!st.thinking);

    // moves
    const key = st.moves.join(' ');
    if (key !== lastMovesKey) {
      lastMovesKey = key;
      movesEl.innerHTML = '';
      for (let i = 0; i < st.moves.length; i += 2) {
        const li = el('li');
        li.innerHTML = `<span class="n">${i / 2 + 1}.</span><span class="m">${st.moves[i]}</span><span class="m">${st.moves[i + 1] || ''}</span>`;
        if (i + 1 >= st.moves.length - 1) li.classList.add('latest');
        movesEl.append(li);
      }
      const latest = movesEl.querySelector('.latest');
      if (latest) latest.scrollIntoView({ block: 'nearest' });
      if (!st.moves.length) movesEl.append(el('li', 'empty', 'No moves yet. Click a piece to begin.'));
    }
    // captured: st.captured.b = black pieces lost (captured by white)
    const sortFn = (a, b) => VAL[b] - VAL[a];
    $('#cap-b').innerHTML = [...st.captured.b].sort(sortFn).map((t) => `<i>${g(t)}</i>`).join('');
    $('#cap-w').innerHTML = [...st.captured.w].sort(sortFn).map((t) => `<i>${g(t)}</i>`).join('');
    $('#adv-w').textContent = st.advantage > 0 ? `+${st.advantage}` : '';
    $('#adv-b').textContent = st.advantage < 0 ? `+${-st.advantage}` : '';

    $('#btn-undo').disabled = !st.canUndo;
    if (st.check && !lastCheck && !st.over) toast('Check');
    lastCheck = st.check;
    if (chkAi.checked !== st.vsComputer) chkAi.checked = st.vsComputer;
  }
  game.on('change', render);
  render(game.getState());

  // ------------------------------------------------------------ promotion chooser
  const promoEl = document.getElementById('promo');
  let promoCancel = null;
  game.on('promotion', ({ color, choose }) => {
    promoEl.innerHTML = `<div class="promo-card"><h3>Promote pawn</h3><div class="promo-row">${['q', 'r', 'b', 'n']
      .map((t) => `<button data-p="${t}" class="pbtn ${color}" title="${PIECE_NAME[t]}"><span>${g(t)}</span><small>${PIECE_NAME[t]}</small></button>`).join('')}</div></div>`;
    promoEl.hidden = false;
    const done = (p) => { promoEl.hidden = true; promoCancel = null; choose(p); };
    promoCancel = () => done(null);
    promoEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => done(b.dataset.p)));
    promoEl.onclick = (e) => { if (e.target === promoEl) done(null); };
  });

  // ------------------------------------------------------------ banner
  const banner = document.getElementById('banner');
  function hideBanner() { banner.hidden = true; }
  game.on('gameover', (st) => {
    const mate = st.reason === 'checkmate';
    const title = mate ? 'Checkmate' : 'Draw';
    const sub = mate ? `${st.winner === 'w' ? 'White' : 'Black'} wins` : st.reason.charAt(0).toUpperCase() + st.reason.slice(1);
    banner.innerHTML = `<div class="banner-card"><small>${st.result}</small><h2>${title}</h2><p>${sub}</p>
      <div class="row"><button class="btn primary" id="bn-new">New game</button><button class="btn" id="bn-view">Review board</button></div></div>`;
    banner.hidden = false;
    banner.querySelector('#bn-new').onclick = () => { game.newGame(); hideBanner(); };
    banner.querySelector('#bn-view').onclick = hideBanner;
  });
  game.on('newgame', hideBanner);

  // ------------------------------------------------------------ toast
  const toastEl = document.getElementById('toast');
  let toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 1400);
  }

  // ------------------------------------------------------------ per-frame control sync
  let lastSig = '';
  function sync() {
    const d = controls.gimbalDeg;
    const sig = `${d.x.toFixed(0)}|${d.y.toFixed(0)}|${d.z.toFixed(0)}|${controls.spin}`;
    if (sig === lastSig) return;
    lastSig = sig;
    for (const [axis] of AXES) {
      const s = sliders[axis];
      const v = Math.round(d[axis]);
      if (!s.sliding) s.input.value = v;
      s.out.innerHTML = `${v}&deg;`;
    }
    $('#btn-spin').classList.toggle('on', controls.spin);
  }

  return { sync, toast, toggleHud, toggleHelp, render };
}
