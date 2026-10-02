// Audit plan: which audits a change needs, from the files changed since the last tag.
// Usage: node tools/audit-plan.mjs [--since=<ref>] [--json]
//   --since  compare against this ref instead of the last tag (committed, staged, unstaged and untracked files count)
//   --json   print the plan as JSON instead of text
// Exit codes: 0 plan printed, 2 usage or git error. The plan never fails a build: it says what to run.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Path patterns per audit. A file can trigger several audits.
const RULES = {
  smoke: [/^src\//, /^index\.html$/, /^vite\.config\./, /^package(-lock)?\.json$/, /^test\/(smoke|fixes)\.mjs$/, /^tools\/(_lib\.mjs|budgets\.json)$/, /^public\//],
  visual: [/^src\/(style\.css|ui\.js|main\.js|scene\.js|board\.js|materials\.js|textures\.js|pieceset\.js)$/, /^src\/pieces\//, /^index\.html$/, /^public\//],
  device: [/^src\/(style\.css|ui\.js|controls\.js|main\.js|scene\.js)$/, /^index\.html$/, /^public\//],
  ci: [/^\.github\//],
  install: [/^package(-lock)?\.json$/],
};

const semver = (v) => String(v || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);

/** Kind of version change between two semver strings: 'major' | 'minor' | 'patch' | 'none'. */
export function bumpKind(from, to) {
  const [a, b] = [semver(from), semver(to)];
  if (b[0] !== a[0]) return 'major';
  if (b[1] !== a[1]) return 'minor';
  if (b[2] !== a[2]) return 'patch';
  return 'none';
}

/** Pure planner: files is a list of repo relative paths, bump is the result of bumpKind. */
export function plan(files, bump = 'none') {
  const hits = (key) => files.filter((f) => RULES[key].some((re) => re.test(f)));
  const smoke = hits('smoke'), visual = hits('visual'), device = hits('device'), ci = hits('ci'), install = hits('install');
  return {
    files,
    bump,
    fast: { due: true, why: 'always' },
    smoke: { due: smoke.length > 0, why: smoke },
    visual: { due: visual.length > 0, why: visual },
    device: { due: device.length > 0, why: device },
    release: { due: true, why: install.length ? 'dependencies changed: run without --skip-install' : 'before every push', fullInstall: install.length > 0 },
    review: { due: bump === 'minor' || bump === 'major', why: bump },
    ci: { due: ci.length > 0, why: ci },
  };
}

/** The commands a plan asks for, in the order to run them. */
export function commands(p) {
  const c = ['node test/run.mjs'];
  if (p.visual.due) c.push('node test/smoke.mjs --shots   (then open .tmp/smoke-shots/contact-*.png)');
  else if (p.smoke.due) c.push('node test/smoke.mjs');
  c.push(p.release.fullInstall ? 'node tools/release-check.mjs' : 'node tools/release-check.mjs --skip-install');
  return c;
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function changedFiles(since) {
  const lines = [git('diff', '--name-only', since), git('ls-files', '--others', '--exclude-standard')].join('\n');
  return [...new Set(lines.split('\n').map((l) => l.trim()).filter(Boolean))].sort();
}

function versionAt(ref) {
  try { return JSON.parse(git('show', `${ref}:package.json`)).version; } catch (e) { return null; }
}

function main() {
  const args = process.argv.slice(2);
  const bad = args.filter((a) => !/^--(since=.+|json)$/.test(a));
  if (bad.length) { console.error(`unknown option ${bad[0]}\nusage: node tools/audit-plan.mjs [--since=<ref>] [--json]`); process.exit(2); }
  let since = (args.find((a) => a.startsWith('--since=')) || '').slice(8);
  try {
    if (!since) since = git('describe', '--tags', '--abbrev=0');
  } catch (e) { console.error('no tag found: pass --since=<ref>'); process.exit(2); }
  let files;
  try { files = changedFiles(since); } catch (e) { console.error(`git diff against ${since} failed: ${String(e.stderr || e.message).trim()}`); process.exit(2); }
  const from = versionAt(since), to = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const p = plan(files, bumpKind(from, to));
  if (args.includes('--json')) { console.log(JSON.stringify({ since, from, to, ...p, commands: commands(p) }, null, 2)); return; }

  const list = (xs) => (xs.length > 4 ? `${xs.slice(0, 4).join(', ')} and ${xs.length - 4} more` : xs.join(', '));
  const row = (name, a, note) => console.log(`  ${(a.due ? 'DUE ' : 'skip').padEnd(5)} ${name.padEnd(14)} ${note}`);
  console.log(`Audit plan: ${files.length} changed file${files.length === 1 ? '' : 's'} since ${since} (version ${from} to ${to}, ${p.bump === 'none' ? 'no bump' : p.bump + ' bump'})`);
  if (!files.length) console.log('  nothing changed');
  row('fast tier', p.fast, 'always');
  row('smoke tier', p.smoke, p.smoke.due ? list(p.smoke.why) : 'no app, build or smoke tool file changed');
  row('visual audit', p.visual, p.visual.due ? list(p.visual.why) : 'nothing that renders changed');
  row('device check', p.device, p.device.due ? `${list(p.device.why)}: owner checks on the phone` : 'nothing that touches mobile changed');
  row('release check', p.release, p.release.why);
  row('code review', p.review, p.review.due ? `${p.bump} release: /code-review on the changed code` : 'only for minor and major releases');
  row('ci run', p.ci, p.ci.due ? `${list(p.ci.why)}: watch the Pages run after the push` : 'workflow unchanged');
  console.log('Run (the browser tiers can run in the background):');
  for (const c of commands(p)) console.log(`  ${c}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
