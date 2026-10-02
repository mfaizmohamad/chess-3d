// Shared helpers for the test and release tools (test/smoke.mjs, tools/release-check.mjs). Not a tool itself.
//   ROOT                     repo root
//   reporter()               PASS / FAIL / WARN rows printed as they come, plus summary(): { rows, nf, nw }
//   launchBrowser(opts)      headless Chrome through puppeteer-core with software GL (swiftshader), so it runs anywhere
//   watchPage(page, hosts)   collects console errors and warnings, page errors and requests to foreign hosts (foreign requests are aborted)
//   startServer(opts)        vite preview of a built folder or the vite dev server, resolves when it answers
//   build(outDir)            vite build into outDir (inside a folder, never touches dist/)
// Exit codes used by the tools: 0 pass (warnings allowed), 1 a check failed, 2 usage or setup error.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const VITE = (cwd = ROOT) => join(cwd, 'node_modules', '.bin', 'vite');

export function reporter() {
  const rows = [];
  const add = (status, name, detail = '') => { rows.push({ status, name, detail }); console.log(`${status.padEnd(4)}  ${name}${detail ? '  ' + detail : ''}`); };
  return {
    rows,
    pass: (n, d) => add('PASS', n, d), fail: (n, d) => add('FAIL', n, d), warn: (n, d) => add('WARN', n, d),
    /** expect(name, condition, detailOnPass, detailOnFail) */
    expect(n, ok, dPass = '', dFail = dPass) { add(ok ? 'PASS' : 'FAIL', n, ok ? dPass : dFail); return ok; },
    summary() {
      const nf = rows.filter((r) => r.status === 'FAIL').length, nw = rows.filter((r) => r.status === 'WARN').length;
      return { rows, nf, nw, np: rows.length - nf - nw };
    },
  };
}

export function chromePath() {
  const cands = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  return cands.find((p) => existsSync(p));
}

export async function launchBrowser({ w = 1280, h = 720, args = [] } = {}) {
  const executablePath = chromePath();
  if (!executablePath) { console.error('Chrome not found. Set CHROME_PATH.'); process.exit(2); }
  return puppeteer.launch({
    executablePath, headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', `--window-size=${w},${h}`, '--hide-scrollbars', ...args],
    defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
  });
}

/** Attach collectors to a page. Requests to hosts other than the given ones are recorded and aborted. */
export async function watchPage(page, hosts = ['127.0.0.1', 'localhost']) {
  const w = { errs: [], warns: [], foreign: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') w.errs.push('console: ' + m.text().slice(0, 200));
    else if (m.type() === 'warning') w.warns.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => w.errs.push('PAGEERR ' + String(e.message).slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) w.errs.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`); });
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    const u = rq.url();
    if (/^(data|blob|about):/.test(u)) return rq.continue();
    let host = ''; try { host = new URL(u).hostname; } catch (e) { /* ignore */ }
    if (hosts.includes(host)) return rq.continue();
    w.foreign.push(u.slice(0, 100)); rq.abort();
  });
  return w;
}

/** Build into outDir (relative to cwd). Returns the combined vite output. */
export function build(outDir, cwd = ROOT) {
  return execFileSync(VITE(cwd), ['build', '--outDir', outDir, '--emptyOutDir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }) ;
}

const children = new Set();
const killAll = () => { for (const c of children) { try { c.kill(); } catch (e) { /* ignore */ } } };
process.on('exit', killAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killAll(); process.exit(130); });

/** mode 'preview' serves outDir with vite preview, mode 'dev' runs the dev server. Resolves { base, stop }. */
export async function startServer({ mode = 'preview', port, outDir = 'dist', cwd = ROOT, subPath = '' }) {
  const baseArg = subPath ? ['--base', subPath] : [];   // for example '/chess-3d/', like GitHub Pages
  const args = mode === 'dev' ? ['--port', String(port), '--strictPort', '--host', '127.0.0.1', ...baseArg]
    : ['preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1', '--outDir', outDir, ...baseArg];
  const child = spawn(VITE(cwd), args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  let exited = false; child.on('exit', () => { exited = true; });
  const base = `http://127.0.0.1:${port}${subPath || '/'}`;
  for (let i = 0; i < 80; i++) {
    if (exited) throw new Error(`vite ${mode} exited early (port ${port} busy?): ${log.trim().split('\n').slice(-3).join(' | ')}`);
    try { const r = await fetch(base); if (r.ok) return { base, stop() { try { child.kill(); } catch (e) { /* ignore */ } children.delete(child); } }; } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  child.kill();
  throw new Error(`vite ${mode} did not answer on ${base}`);
}
