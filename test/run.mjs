// Test runner: node test/run.mjs [fast|smoke|all]   (default fast; npm test calls it)
//   fast   no browser, seconds: rules (perft and game logic), piece geometry contract, text lint, audit planner rules
//   smoke  about a minute: vite build, preview on port 5303, headless Chrome, scripted game, gimbal, budgets, pixel checks, fix checks
//   all    fast, then smoke. The release check is separate and slow (fresh npm ci): node tools/release-check.mjs
// Extra options after the tier are passed to the smoke run, for example: node test/run.mjs smoke --skip-build --skip-fixes
// Exit codes: 0 all pass, 1 a check failed, 2 usage error.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [tier = 'fast', ...rest] = process.argv.slice(2);
if (!['fast', 'smoke', 'all'].includes(tier)) { console.error('usage: node test/run.mjs [fast|smoke|all] [smoke options]'); process.exit(2); }

const results = [];
const run = (name, script, args = [], { show = false } = {}) => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', stdio: show ? 'inherit' : ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const secs = (Date.now() - t) / 1000;
  const ok = r.status === 0;
  results.push({ name, ok, secs });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${secs.toFixed(1)}s`);
  if (!ok && !show) {
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n');
    const bad = out.filter((l) => /^FAIL|FAILED|Error/.test(l));
    console.log((bad.length ? bad : out.slice(-12)).slice(0, 25).map((l) => '      ' + l).join('\n'));
  }
  return ok;
};

const t0 = Date.now();
if (tier === 'fast' || tier === 'all') {
  console.log('--- fast tier (no browser)');
  run('rules: perft and game logic (test/perft.mjs)', 'test/perft.mjs');
  run('piece geometry contract (test/geometry.mjs)', 'test/geometry.mjs');
  run('text lint (test/lint.mjs)', 'test/lint.mjs');
  run('audit planner rules (test/audit-plan.mjs)', 'test/audit-plan.mjs');
}
if ((tier === 'smoke' || tier === 'all') && (tier === 'smoke' || results.every((r) => r.ok))) {
  console.log('--- smoke tier (headless Chrome)');
  run('smoke (test/smoke.mjs)', 'test/smoke.mjs', rest, { show: true });
} else if (tier === 'all') console.log('--- smoke tier skipped because the fast tier failed');

const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length} steps, ${bad} failed, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!bad && tier === 'all') console.log('Next: run the release check separately (fresh npm ci, slow): node tools/release-check.mjs');
process.exit(bad ? 1 : 0);
