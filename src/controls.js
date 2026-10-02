// Camera orbit + board gimbal controls.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

export const PRESETS = {
  'White view': { yaw: 0, pitch: 46 * DEG, dist: 19 },
  'Black view': { yaw: Math.PI, pitch: 46 * DEG, dist: 19 },
  'Top down': { yaw: 0, pitch: 89.4 * DEG, dist: 19.5 },
  'Side': { yaw: 0, pitch: 7 * DEG, dist: 20 },
  'Isometric': { yaw: 45 * DEG, pitch: 35.264 * DEG, dist: 20 },
};
const HOME = PRESETS['White view'];

export function createControls({ stage, gimbal, canvas, onPick, onHover }) {
  const camera = stage.camera;
  const target = new THREE.Vector3(0, 0.15, 0);
  const cam = { yaw: HOME.yaw, pitch: HOME.pitch, dist: HOME.dist };
  const gim = { x: 0, y: 0, z: 0 };            // radians
  const vel = { yaw: 0, pitch: 0 };
  const limits = { minDist: 6, maxDist: 40, minPitch: 1.5 * DEG, maxPitch: 89.6 * DEG };
  let spin = false;
  let tw = null;                                // preset transition
  let aspect = 1.5;
  let floorT = 1;
  const listeners = [];
  const keys = new Set();
  gimbal.rotation.order = 'YXZ';

  // --------------------------------------------------------------- apply to scene
  // Pull the camera back until the board fits the width (narrow screens), and, on desktop layouts, until the
  // capture trays (outer edge at x = 6.5, near edge about 3.2 units closer to the camera) clear the HUD columns.
  const TRAY_EDGE = 6.6, TRAY_NEAR = 3.2, TAN_V = Math.tan(17.5 * DEG), HUD_GAP = 14;
  let size = { w: 1500, h: 1000 }, hudW = 268;
  function fit() {
    let f = (11.5 / (0.63 * aspect)) / HOME.dist;
    if (size.w > 900) {
      const free = size.w / 2 - (hudW + 2 * HUD_GAP);          // pixels from screen centre to the HUD edge
      const depth = (size.h / 2) * TRAY_EDGE / (TAN_V * Math.max(60, free));
      f = Math.max(f, (depth + TRAY_NEAR) / HOME.dist);
    }
    return Math.max(1, f);
  }
  function apply() {
    cam.pitch = clamp(cam.pitch, limits.minPitch, limits.maxPitch);
    cam.dist = clamp(cam.dist, limits.minDist, limits.maxDist);
    const d = cam.dist * fit();
    const cp = Math.cos(cam.pitch);
    camera.position.set(target.x + d * cp * Math.sin(cam.yaw), target.y + d * Math.sin(cam.pitch), target.z + d * cp * Math.cos(cam.yaw));
    camera.lookAt(target);
    gimbal.rotation.set(gim.x, gim.y, gim.z, 'YXZ');
    // fade the floor as the board tilts away from horizontal
    const tilt = Math.max(Math.abs(wrapPi(gim.x)), Math.abs(wrapPi(gim.z))) / DEG;
    const t = clamp(1 - (tilt - 8) / 30, 0, 1);
    if (Math.abs(t - floorT) > 0.002) { floorT = t; stage.setFloorVisibility?.(t); }
  }
  const notify = () => listeners.forEach((fn) => fn());

  // --------------------------------------------------------------- presets / transitions
  function animateTo(to, dur = 0.95) {
    const from = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, gx: gim.x, gy: gim.y, gz: gim.z };
    const end = {
      yaw: to.yaw ?? cam.yaw, pitch: to.pitch ?? cam.pitch, dist: to.dist ?? cam.dist,
      gx: to.gx ?? 0, gy: to.gy ?? 0, gz: to.gz ?? 0,
    };
    // shortest way round for every angle
    end.yaw = from.yaw + wrapPi(end.yaw - from.yaw);
    end.gx = from.gx + wrapPi(end.gx - from.gx);
    end.gy = from.gy + wrapPi(end.gy - from.gy);
    end.gz = from.gz + wrapPi(end.gz - from.gz);
    vel.yaw = vel.pitch = 0;
    tw = { t: 0, dur, from, end };
  }
  function setPreset(name) {
    if (!Object.hasOwn(PRESETS, name)) return;
    const p = PRESETS[name];
    spin = false;
    animateTo({ ...p });
  }
  function levelBoard() { animateTo({ yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist }, 0.7); }
  function reset() { spin = false; animateTo({ ...HOME }); }
  function flip() {
    // turn the view to the other side of the board, keep pitch and zoom
    const target_ = Math.round(cam.yaw / Math.PI) * Math.PI + Math.PI;
    animateTo({ yaw: target_, pitch: cam.pitch, dist: cam.dist, gx: gim.x, gy: gim.y, gz: gim.z }, 0.9);
  }
  function topDown() { setPreset('Top down'); }
  function toggleSpin() { spin = !spin; notify(); return spin; }
  function setGimbal(axis, deg) { tw = null; gim[axis] = deg * DEG; notify(); }
  function nudgeZoom(f) { tw = null; cam.dist = clamp(cam.dist * f, limits.minDist, limits.maxDist); }
  function setCamera(v) { tw = null; Object.assign(cam, v); apply(); }

  // --------------------------------------------------------------- pointer input
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let lastMoveT = 0;
  const THRESH = 6;

  function onDown(e) {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, button: e.button, gimbalMode: e.button === 2 || e.shiftKey || e.ctrlKey };
      vel.yaw = vel.pitch = 0;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist };
      if (drag) drag.moved = true;
    }
  }
  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse' && onHover) onHover(e.clientX, e.clientY); return; }
    p.x = e.clientX; p.y = e.clientY;
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      tw = null;
      cam.dist = clamp(pinch.dist * (pinch.d / Math.max(10, d)), limits.minDist, limits.maxDist);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < THRESH) return;
      drag.moved = true;
      tw = null;
    }
    drag.lx = e.clientX; drag.ly = e.clientY;
    const now = performance.now();
    const dtm = Math.max(1, now - lastMoveT) / 1000;
    lastMoveT = now;
    if (drag.gimbalMode) {
      gim.y += dx * 0.006;
      gim.x += dy * 0.006;
    } else {
      const dyaw = -dx * 0.0055, dpitch = dy * 0.0055;
      cam.yaw += dyaw; cam.pitch += dpitch;
      vel.yaw = clamp(dyaw / dtm, -8, 8) * 0.6 + vel.yaw * 0.4;
      vel.pitch = clamp(dpitch / dtm, -8, 8) * 0.6 + vel.pitch * 0.4;
    }
    notify();
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && e.pointerId === drag.id) {
      const wasClick = !drag.moved && e.type === 'pointerup' && drag.button === 0;
      if (wasClick) onPick?.(e.clientX, e.clientY);
      else if (performance.now() - lastMoveT > 90) vel.yaw = vel.pitch = 0;
      drag = null;
    }
  }
  function onWheel(e) {
    e.preventDefault();
    tw = null;
    const k = e.deltaMode === 1 ? 0.05 : 0.0012;
    cam.dist = clamp(cam.dist * Math.exp(e.deltaY * k), limits.minDist, limits.maxDist);
  }
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // --------------------------------------------------------------- keyboard
  const inField = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '');
  const hooks = {};
  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || inField(e)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['q', 'e', 'w', 's', 'a', 'd', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(k)) {
      keys.add(k); tw = null; e.preventDefault(); return;
    }
    let handled = true;
    switch (k) {
      case 'r': reset(); break;
      case 'f': flip(); break;
      case 'v': topDown(); break;
      case ' ': toggleSpin(); break;
      case '1': setPreset('White view'); break;
      case '2': setPreset('Black view'); break;
      case '3': setPreset('Top down'); break;
      case '4': setPreset('Side'); break;
      case '5': setPreset('Isometric'); break;
      case 'u': hooks.undo?.(); break;
      case 'n': hooks.newGame?.(); break;
      case 'h': hooks.toggleHud?.(); break;
      case '?': case '/': hooks.toggleHelp?.(); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); if (document.activeElement?.blur && document.activeElement !== document.body) document.activeElement.blur(); }
  }
  function onKeyUp(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.delete(k);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  // --------------------------------------------------------------- per-frame update
  function update(dt) {
    let dirty = false;
    if (tw) {
      tw.t += dt;
      const u = Math.min(1, tw.t / tw.dur), e = easeInOut(u);
      const { from: f, end: n } = tw;
      cam.yaw = f.yaw + (n.yaw - f.yaw) * e;
      cam.pitch = f.pitch + (n.pitch - f.pitch) * e;
      cam.dist = f.dist + (n.dist - f.dist) * e;
      gim.x = f.gx + (n.gx - f.gx) * e;
      gim.y = f.gy + (n.gy - f.gy) * e;
      gim.z = f.gz + (n.gz - f.gz) * e;
      if (u >= 1) tw = null;
      dirty = true;
    } else if (!drag || !drag.moved) {
      if (Math.abs(vel.yaw) > 1e-4 || Math.abs(vel.pitch) > 1e-4) {
        cam.yaw += vel.yaw * dt; cam.pitch += vel.pitch * dt;
        const damp = Math.exp(-dt * 4);
        vel.yaw *= damp; vel.pitch *= damp;
        dirty = true;
      }
      if (spin) { cam.yaw += dt * 0.35; dirty = true; }
    }
    if (keys.size) {
      const boost = 1;
      const rot = 70 * DEG * dt * boost, orbit = 1.4 * dt, zoom = Math.exp(dt * 1.1);
      if (keys.has('q')) gim.z -= rot;
      if (keys.has('e')) gim.z += rot;
      if (keys.has('w')) gim.x -= rot;
      if (keys.has('s')) gim.x += rot;
      if (keys.has('a')) gim.y -= rot;
      if (keys.has('d')) gim.y += rot;
      if (keys.has('ArrowLeft')) cam.yaw -= orbit;
      if (keys.has('ArrowRight')) cam.yaw += orbit;
      if (keys.has('ArrowUp')) cam.pitch += orbit;
      if (keys.has('ArrowDown')) cam.pitch -= orbit;
      if (keys.has('+') || keys.has('=')) cam.dist /= zoom;
      if (keys.has('-') || keys.has('_')) cam.dist *= zoom;
      dirty = true;
    }
    for (const a of ['x', 'y', 'z']) gim[a] = wrapPi(gim[a]);
    apply();
    if (dirty) notify();
  }

  function onResize(w, h) { aspect = w / Math.max(1, h); size = { w, h }; hudW = document.querySelector('#hud .col.left')?.offsetWidth || 268; }
  apply();

  return {
    update, apply, setPreset, reset, levelBoard, flip, topDown, toggleSpin, setGimbal, nudgeZoom, setCamera, onResize,
    presets: Object.keys(PRESETS),
    hooks,
    onChange(fn) { listeners.push(fn); },
    get spin() { return spin; },
    get camera() { return { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist }; },
    get gimbalDeg() { return { x: gim.x / DEG, y: gim.y / DEG, z: gim.z / DEG }; },
    get animating() { return !!tw; },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
