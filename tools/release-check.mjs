// Release check: the mechanical part of a public readiness review, no AI involved. Slow (fresh npm ci, headless Chrome), run it before a push.
// Usage: node tools/release-check.mjs [--port=5303] [--skip-install] [--extra-audit="<shell command>"] [--since=<tag>] [--no-browser]
//   1. git hygiene: clean tree, no scratch, log, env or key files tracked, no tracked file over 1.5 MB (docs/ excepted), no wording from the
//      optional tools/internal-terms.txt (one word or regular expression per line), no em dashes or spaced double hyphens as punctuation
//      in tracked text and in commit messages since the last tag, no private data (home paths, private network addresses, e-mail
//      addresses other than the commit trailer address) in tracked text
//   2. a fresh copy of HEAD (git archive) is installed with npm ci and built; the build must succeed, dist must not contain local paths,
//      user names or key like strings, sizes are printed
//   3. the built site is served with vite preview and loaded in headless Chrome: normal pages and flag combinations must load with no console
//      error, no page error and no request to a foreign host
//   4. URL fuzzing: out of range and hostile values of every flag in src/main.js (prototype names, duplicates, null bytes, markup included)
//      must not throw and must not reach a foreign host, and no request may come back with an HTTP error status
//   4b. the built site is also served under a sub path (/chess-3d/, like GitHub Pages) and must boot there with no error
//   5. docs: every URL flag, script, tool, file and relative link mentioned in README.md and docs/*.md exists in the code or the repo
//      (skipped with a warning while there is no README.md)
//   6. version: package.json version is printed and must differ from the last tag's version when commits exist since that tag
// --extra-audit runs one more shell command in the repo (for example a project specific word list check) and fails on a non zero exit.
// --skip-install links the repo's node_modules into the fresh copy instead of running npm ci. --no-browser skips steps 3 and 4.
// Before the first commit there is no HEAD: the working tree files (tracked plus untracked, not ignored) are copied instead and a warning is printed.
// Exit codes: 0 all checks pass (warnings allowed), 1 at least one check failed, 2 usage or setup error.
// Chrome is taken from CHROME_PATH or the usual install paths. Needs network for npm ci unless --skip-install is given.
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, reporter, launchBrowser, watchPage, startServer, sleep } from './_lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const flag = (name) => args.includes(`--${name}`);
if (flag('help') || flag('h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 21).join('\n')); process.exit(0); }
const PORT = Number(opt('port', 5303));
const sh = (cmd, cwd = ROOT, opts = {}) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });

// Patterns are assembled from parts so this file does not match itself.
const DD = ' -' + '- ';
const EMD = new RegExp('\\u20' + '14');
const R = reporter();
const { pass, fail, warn } = R;

const hasHead = (() => { try { sh('git rev-parse --verify HEAD'); return true; } catch (e) { return false; } })();
const lastTag = (() => { try { return sh('git describe --tags --abbrev=0').trim(); } catch (e) { return ''; } })();
const since = opt('since', lastTag);
console.log(`release-check on ${hasHead ? sh('git rev-parse --short HEAD').trim() : 'no commit yet'} (branch ${sh('git symbolic-ref --short HEAD 2>/dev/null || echo detached').trim()}), compared with ${since || 'no tag'}\n`);
if (!hasHead) warn('repository has a commit', 'no commit yet: checking the working tree files instead of HEAD');

const tracked = () => {
  const list = hasHead ? sh('git ls-files') : sh('git ls-files --cached --others --exclude-standard');
  return [...new Set(list.split('\n').filter(Boolean))].filter((f) => existsSync(join(ROOT, f)));
};
const files = tracked();

// ------------------------------------------------------------------ 1. git hygiene
{
  const dirty = sh('git status --porcelain').trim();
  if (dirty) fail('working tree is clean', `${dirty.split('\n').length} paths: ` + dirty.split('\n').slice(0, 5).join(' | '));
  else pass('working tree is clean');

  const bad = files.filter((f) => /(^|\/)(\.tmp|node_modules|dist|\.claude)\//.test(f) || /\.(log|pem|key|p12)$/.test(f) || /(^|\/)\.env/.test(f) || /(^|\/)\.DS_Store$/.test(f)
    || /(^|\/)(id_rsa|credentials)/.test(f) || /(^|\/)(scratch|tmp|notes?)\.(md|txt|json)$/i.test(f));
  bad.length ? fail('no scratch, log, env or key files tracked', bad.slice(0, 8).join(', ')) : pass('no scratch, log, env or key files tracked', `${files.length} files`);
  const big = files.filter((f) => { try { return !f.startsWith('docs/') && statSync(join(ROOT, f)).size > 1.5 * 1024 * 1024; } catch (e) { return false; } });
  big.length ? fail('no tracked file over 1.5 MB (docs/ excepted)', big.join(', ')) : pass('no tracked file over 1.5 MB (docs/ excepted)');

  const textFiles = files.filter((f) => /\.(js|mjs|json|md|html|css|yml|yaml|svg|txt)$/.test(f) && f !== 'package-lock.json');
  const dashHits = [], internalHits = [], termHits = [];
  const INTERNAL = /\b(private notes|sub-?agent|round [0-9]+ agent|claude code)\b|\bAgent [0-9]+\b/i;   // process wording that should not be public
  const termsFile = join(ROOT, 'tools/internal-terms.txt');
  const TERMS = existsSync(termsFile) ? readFileSync(termsFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { try { return new RegExp(l, 'i'); } catch (e) { return new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } }) : [];
  for (const f of textFiles) {
    readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((l, i) => {
      if (EMD.test(l) || l.includes(DD)) dashHits.push(`${f}:${i + 1}`);
      if (!['tools/release-check.mjs', 'CLAUDE.md', 'bin/cc-chess3d'].includes(f) && INTERNAL.test(l)) internalHits.push(`${f}:${i + 1}`);   // developer tooling may name Claude
      if (f !== 'tools/internal-terms.txt' && TERMS.some((t) => t.test(l))) termHits.push(`${f}:${i + 1}`);
    });
  }
  dashHits.length ? fail('no em dashes or double hyphens as punctuation', dashHits.slice(0, 6).join(', ')) : pass('no em dashes or double hyphens as punctuation', `${textFiles.length} text files`);
  // private data: built from parts so this file does not match itself
  const PRIV = [['home path', new RegExp('/Us' + 'ers/|/ho' + 'me/[a-z]|[A-Z]:\\\\Us' + 'ers\\\\')],
    ['private network address', /\b(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}\b/],
    ['e-mail address', /[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[a-z]{2,}/]];
  const MAIL_OK = /noreply@anthropic\.com/g;   // the commit trailer line in CLAUDE.md
  const privHits = [];
  for (const f of textFiles) {
    if (f === 'tools/release-check.mjs') continue;
    readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((l, i) => { const t = l.replace(MAIL_OK, ''); for (const [what, re] of PRIV) if (re.test(t)) privHits.push(`${f}:${i + 1} (${what})`); });
  }
  privHits.length ? fail('no private data (home paths, private addresses, e-mail) in tracked text', privHits.slice(0, 6).join(', ')) : pass('no private data (home paths, private addresses, e-mail) in tracked text');
  internalHits.length ? warn('no internal process wording in tracked text', `${internalHits.length}: ` + internalHits.slice(0, 6).join(', ')) : pass('no internal process wording in tracked text');
  if (TERMS.length) termHits.length ? fail('no wording from tools/internal-terms.txt', termHits.slice(0, 6).join(', ')) : pass('no wording from tools/internal-terms.txt', `${TERMS.length} terms`);
  else pass('tools/internal-terms.txt', 'not present, nothing to check');

  if (hasHead) {
    const range = since ? `${since}..HEAD` : 'HEAD';
    const msgs = sh(`git log ${range} --format=%h%x1f%B%x1e`).split('\x1e').map((m) => m.trim()).filter(Boolean);
    const dashMsgs = msgs.filter((m) => EMD.test(m) || m.includes(DD)).map((m) => m.slice(0, 7));
    dashMsgs.length ? fail(`commit messages since ${since || 'the start'} have no em dashes or double hyphens`, `${dashMsgs.length} of ${msgs.length}: ${dashMsgs.slice(0, 6).join(' ')}`)
      : pass(`commit messages since ${since || 'the start'} have no em dashes or double hyphens`, `${msgs.length} commits`);
    const wordMsgs = msgs.filter((m) => INTERNAL.test(m) || TERMS.some((t) => t.test(m))).map((m) => m.slice(0, 7));
    wordMsgs.length ? warn('commit messages are free of internal wording', `${wordMsgs.length} of ${msgs.length}: ${wordMsgs.slice(0, 6).join(' ')}`) : pass('commit messages are free of internal wording');
  }
  const extra = opt('extra-audit', '');
  if (extra) {
    try { sh(extra); pass('extra audit command', extra.slice(0, 60)); } catch (e) { fail('extra audit command', String(e.stdout || e.message).split('\n').slice(-4).join(' | ')); }
  }
}

// ------------------------------------------------------------------ 2. fresh copy build
const work = mkdtempSync(join(tmpdir(), 'chess-release-'));
const copy = join(work, 'copy');
let built = false;
try {
  sh(`mkdir -p "${copy}"`);
  if (hasHead) sh(`git archive HEAD | tar -x -C "${copy}"`);
  else sh(`git ls-files --cached --others --exclude-standard -z | tar -cf - --null -T - | tar -x -C "${copy}"`);
  if (flag('skip-install')) symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'));
  else sh('npm ci --prefer-offline --no-audit --no-fund', copy, { timeout: 600000 });
  const out = sh('npm run build 2>&1', copy, { timeout: 600000 });
  built = existsSync(join(copy, 'dist', 'index.html'));
  const warnings = out.split('\n').filter((l) => /warn|error|\(!\)/i.test(l));
  built ? pass('fresh copy installs and builds', flag('skip-install') ? 'node_modules linked' : 'npm ci') : fail('fresh copy installs and builds', 'dist/index.html missing');
  warnings.length ? warn('build output has no warnings', warnings.slice(0, 3).join(' | ')) : pass('build output has no warnings');
  if (built) {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const dist = walk(join(copy, 'dist'));
    const total = dist.reduce((s, f) => s + statSync(f).size, 0);
    const biggest = dist.map((f) => [f, statSync(f).size]).sort((a, b) => b[1] - a[1])[0];
    pass('dist size', `${(total / 1024).toFixed(0)} kB in ${dist.length} files, largest ${biggest[0].split('/').pop()} ${(biggest[1] / 1024).toFixed(0)} kB`);
    const user = userInfo().username;
    const leaks = [];
    const LOCAL = new RegExp('/Us' + 'ers/|/ho' + 'me/[a-z]|[A-Z]:\\\\Us' + 'ers\\\\');
    for (const f of dist.filter((x) => /\.(js|css|html|json|svg|map|txt)$/.test(x))) {
      const t = readFileSync(f, 'utf8');
      if (LOCAL.test(t)) leaks.push(`${f.split('/').pop()} (local path)`);
      if (user && user.length > 3 && t.includes(user)) leaks.push(`${f.split('/').pop()} (user name)`);
      if (/(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(t)) leaks.push(`${f.split('/').pop()} (key like string)`);
    }
    leaks.length ? fail('dist has no local paths, user names or keys', leaks.slice(0, 5).join(', ')) : pass('dist has no local paths, user names or keys');
  }
} catch (e) {
  fail('fresh copy installs and builds', String(e.stderr || e.stdout || e.message).split('\n').slice(-4).join(' | ').slice(0, 400));
}

// ------------------------------------------------------------------ 3 and 4. serve and load, then fuzz
let server = null, browser = null;
if (built && !flag('no-browser')) {
  try {
    server = await startServer({ mode: 'preview', port: PORT, outDir: 'dist', cwd: copy });
    browser = await launchBrowser({ w: 1280, h: 720 });
    const page = await browser.newPage();
    const watch = await watchPage(page, ['127.0.0.1', 'localhost']);
    const base = server.base.replace(/\/$/, '');
    // one page is reused; a case is the URL plus the problems that appeared while it loaded and settled
    const visit = async (path, settleMs = 600) => {
      watch.errs.length = 0; watch.foreign.length = 0;
      try {
        await page.goto(base + path, { waitUntil: 'load', timeout: 60000 });
        await page.waitForFunction(() => window.__chessReady || window.__chessError, { timeout: 120000, polling: 100 });
      } catch (e) { watch.errs.push('NAV ' + String(e.message).slice(0, 100)); }
      await sleep(settleMs);
      const st = await page.evaluate(() => ({ ready: !!window.__chessReady, error: window.__chessError || null })).catch(() => ({ ready: false, error: 'page gone' }));
      return { problems: [...watch.errs, ...watch.foreign.map((u) => 'FOREIGN ' + u), ...(st.ready ? [] : ['NOT READY ' + (st.error || '')])] };
    };

    const pages = ['/', '/?quality=medium&manual=1', '/?quality=low&manual=1&ai=3', '/?quality=low&manual=1&ai=0&preset=Top%20down&hud=0&help=1&light=Studio',
      '/?quality=low&manual=1&ai=0&gx=20&gy=30&gz=-15&yaw=30&pitch=40&dist=24&spin=1',
      '/?quality=low&manual=1&ai=0&moves=e2e4,e7e5,g1f3,b8c6,f1c4,g8f6&select=f3', '/?quality=low&manual=1&ai=0&fen=' + encodeURIComponent('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'),
      '/?quality=low&manual=1&ai=0&fen=' + encodeURIComponent('8/P6k/8/8/8/8/8/K7 w - - 0 1') + '&promo=a7a8'];
    let bad = 0;
    for (const p of pages) {
      const r = await visit(p);
      if (r.problems.length) { bad++; fail(`page ${p.slice(0, 90)} loads clean`, r.problems.slice(0, 2).join(' | ')); }
    }
    if (!bad) pass('normal pages and flag combinations load clean', `${pages.length} pages, no console error, page error or foreign request`);

    const Q = '/?quality=low&manual=1&ai=0';
    const long = 'A'.repeat(6000);
    const fuzz = [
      '/?quality=ultra&manual=1', '/?quality=__proto__&manual=1', '/?quality=' + long + '&manual=1',
      Q + '&ai=99', Q.replace('&ai=0', '') + '&ai=-1', Q.replace('&ai=0', '') + '&ai=abc',
      Q + '&fen=garbage', Q + '&fen=' + encodeURIComponent('8/8/8/8/8/8/8/8 w - - 0 1'), Q + '&fen=' + encodeURIComponent('<img src=x onerror=alert(1)>'), Q + '&fen=' + long,
      Q + '&fen=' + encodeURIComponent('rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
      Q + '&moves=e2e5,zz,e7e5', Q + '&moves=,,,,', Q + '&moves=e2e4,e7e5q,a1a1',
      Q + '&select=zz', Q + '&select=a9', Q + '&select=e2e4', Q + '&promo=a7a8', Q + '&promo=zz',
      Q + '&preset=nope', Q + '&preset=__proto__',
      Q + '&gx=1e99&gy=-1e99&gz=NaN', Q + '&gx=Infinity&gy=abc&gz=%00',
      Q + '&yaw=abc&pitch=NaN&dist=-5', Q + '&yaw=1e99&pitch=-1e99&dist=1e99',
      Q + '&light=nope', Q + '&light=__proto__', Q + '&hud=%ff&help=%%%&manual=0',
      Q + '&evil=http://evil.example/x&report=evil.example&' + 'x=1&'.repeat(300),
      // prototype names as values, duplicates, null bytes and markup
      Q + '&preset=constructor&light=toString', '/?quality=constructor&manual=1&ai=0', '/?quality=toString&manual=1&ai=0', Q + '&select=__proto__&promo=constructor',
      Q + '&light=__proto__&light=Studio&preset=__proto__&preset=Side', Q + '&gx=1&gx=2&gx=NaN&ai=1&ai=2',
      Q + '&fen=%00&moves=%00&select=%00&light=%00&preset=%00', Q + '&light=%3Cscript%3Ealert(1)%3C%2Fscript%3E&preset=%3Cimg%20src%3Dx%3E&help=%3Cb%3E',
      Q + '&fen=__proto__&moves=__proto__,constructor,toString',
    ];
    let fuzzBad = 0;
    for (const p of fuzz) {
      const r = await visit(p, 400);
      if (r.problems.length) { fuzzBad++; fail(`hostile URL ${decodeURIComponent(p).slice(0, 70)}`, r.problems.slice(0, 2).join(' | ')); }
    }
    if (!fuzzBad) pass('hostile and out of range URL parameters', `${fuzz.length} cases, no error, no foreign request, no HTTP error`);
    // the same build under a sub path, as GitHub Pages serves it
    const SUB = '/chess-3d/';
    const subServer = await startServer({ mode: 'preview', port: PORT + 1, outDir: 'dist', cwd: copy, subPath: SUB });
    try {
      watch.errs.length = 0; watch.foreign.length = 0;
      let subOk = true;
      try {
        await page.goto(subServer.base + '?quality=low&manual=1&ai=0', { waitUntil: 'load', timeout: 60000 });
        await page.waitForFunction(() => window.__chessReady || window.__chessError, { timeout: 120000, polling: 100 });
      } catch (e) { watch.errs.push('NAV ' + String(e.message).slice(0, 100)); subOk = false; }
      await sleep(400);
      const st = await page.evaluate(() => ({ ready: !!window.__chessReady, error: window.__chessError || null })).catch(() => ({ ready: false, error: 'page gone' }));
      const subProblems = [...watch.errs, ...watch.foreign.map((u) => 'FOREIGN ' + u), ...(st.ready && subOk ? [] : ['NOT READY ' + (st.error || '')])];
      subProblems.length ? fail(`built site works under ${SUB}`, subProblems.slice(0, 3).join(' | ')) : pass(`built site works under ${SUB}`, 'boots, no error, no HTTP error');
    } finally { subServer.stop(); }
  } catch (e) {
    fail('serve and load the built site', String(e.message).slice(0, 300));
  }
}

// ------------------------------------------------------------------ 5. docs
{
  const docFiles = [...(existsSync(join(ROOT, 'README.md')) ? ['README.md'] : []),
    ...(existsSync(join(ROOT, 'docs')) ? readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`) : [])];
  if (!docFiles.length) warn('docs check', 'no README.md or docs/*.md yet, skipped');
  else {
    const srcFiles = files.filter((f) => /^src\/.*\.js$/.test(f) || f === 'index.html');
    const srcText = srcFiles.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const fileSet = new Set(files);
    const missingParams = new Set(), missingScripts = new Set(), missingFiles = new Set(), missingLinks = new Set();
    for (const f of docFiles) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      // URL flags: `?name`, `?name=value`, `name=value` in code spans, and `&name=value` inside URLs
      const names = new Set();
      for (const m of text.matchAll(/`[^`\n]*`/g)) for (const q of m[0].matchAll(/(?:[?&`]|^)([a-z][a-z0-9]*)=[^\s&`]*/g)) names.add(q[1]);
      for (const m of text.matchAll(/`\?([a-z][a-z0-9]*)`/g)) names.add(m[1]);
      for (const name of names) {
        if (['quality', 'manual'].includes(name) && srcText.includes(`'${name}'`)) continue;
        const direct = new RegExp(`['"\`]${name}['"\`]`).test(srcText);
        const axis = /^g[xyz]$/.test(name) && /['"]g['"]\s*\+/.test(srcText);   // gx gy gz are built as 'g' + axis
        if (!direct && !axis) missingParams.add(`${f}: ${name}`);
      }
      for (const m of text.matchAll(/npm (?:run )?([a-z][a-z:-]*)/g)) if (!['install', 'ci', 'test', 'start'].includes(m[1]) && !(pkg.scripts || {})[m[1]]) missingScripts.add(`${f}: npm run ${m[1]}`);
      if (/npm test\b/.test(text) && !(pkg.scripts || {}).test) missingScripts.add(`${f}: npm test`);
      for (const m of text.matchAll(/\b((?:tools|test|src|docs)\/[A-Za-z0-9_./-]+\.[a-z]+)\b/g)) if (!fileSet.has(m[1]) && !existsSync(join(ROOT, m[1]))) missingFiles.add(`${f}: ${m[1]}`);
      for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)) {
        const target = m[1];
        if (/^(https?:|mailto:|data:)/.test(target)) continue;
        if (!existsSync(join(ROOT, dirname(f) === '.' ? '' : dirname(f), target))) missingLinks.add(`${f}: ${target}`);
      }
    }
    missingParams.size ? fail('every URL flag in the docs exists in the code', [...missingParams].slice(0, 6).join(', ')) : pass('every URL flag in the docs exists in the code', docFiles.join(', '));
    missingScripts.size ? fail('every npm script in the docs exists', [...missingScripts].join(', ')) : pass('every npm script in the docs exists');
    missingFiles.size ? fail('every file path in the docs exists', [...missingFiles].slice(0, 6).join(', ')) : pass('every file path in the docs exists');
    missingLinks.size ? fail('every relative link and image in the docs exists', [...missingLinks].slice(0, 6).join(', ')) : pass('every relative link and image in the docs exists');
  }
}

// ------------------------------------------------------------------ 6. version
{
  const v = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const tagged = since ? (() => { try { return JSON.parse(sh(`git show ${since}:package.json`)).version; } catch (e) { return ''; } })() : '';
  const commits = since && hasHead ? Number(sh(`git rev-list ${since}..HEAD --count`).trim()) : 0;
  if (tagged && commits > 0 && v === tagged) warn('package.json version was bumped since the last tag', `still ${v}`);
  else pass('package.json version', `${v} (last tag ${since || 'none'}${tagged ? ` had ${tagged}` : ''})`);
}

// ------------------------------------------------------------------ done
try { await browser?.close(); } catch (e) { /* ignore */ }
try { server?.stop(); } catch (e) { /* ignore */ }
try { rmSync(work, { recursive: true, force: true }); } catch (e) { /* ignore */ }
const s = R.summary();
console.log(`\n${s.rows.length} checks: ${s.np} pass, ${s.nw} warn, ${s.nf} fail`);
console.log(s.nf ? 'RELEASE CHECK FAILED' : s.nw ? 'RELEASE CHECK OK WITH WARNINGS' : 'RELEASE CHECK OK');
process.exit(s.nf ? 1 : 0);
