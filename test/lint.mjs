// Text lint over tracked files (plus untracked files that are not ignored, so it also works before the first commit):
//   no em dashes, no spaced double hyphen used as punctuation, no local absolute paths.
// Run: node test/lint.mjs    Exit 0 clean, 1 on any hit. Also exports runLint() for test/run.mjs.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Patterns are assembled from parts so this file does not match itself.
const EM = new RegExp('\\u20' + '14');
const DD = ' -' + '- ';
const LOCAL = new RegExp('/Us' + 'ers/|/ho' + 'me/[a-z]|[A-Z]:\\\\Us' + 'ers\\\\|/priv' + 'ate/var/');
const TEXT = /\.(js|mjs|cjs|json|md|html|css|yml|yaml|svg|txt)$/;
const SKIP = new Set(['package-lock.json']);

export function listFiles() {
  const out = execSync('git ls-files --cached --others --exclude-standard', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.split('\n').filter(Boolean))]
    .filter((f) => TEXT.test(f) && !SKIP.has(f) && existsSync(join(ROOT, f)) && statSync(join(ROOT, f)).size < 2 * 1024 * 1024);
}

export function runLint() {
  const files = listFiles();
  const hits = { dash: [], dd: [], path: [] };
  for (const f of files) {
    readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((l, i) => {
      if (EM.test(l)) hits.dash.push(`${f}:${i + 1}`);
      if (l.includes(DD)) hits.dd.push(`${f}:${i + 1}`);
      if (LOCAL.test(l)) hits.path.push(`${f}:${i + 1}`);
    });
  }
  const row = (name, list) => ({ name, pass: list.length === 0, detail: list.length ? `${list.length} hits: ${list.slice(0, 6).join(', ')}` : `${files.length} files` });
  return [
    row('no em dashes in text files', hits.dash),
    row('no spaced double hyphen punctuation', hits.dd),
    row('no local absolute paths', hits.path),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = runLint();
  for (const r of res) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}  ${r.detail}`);
  process.exit(res.some((r) => !r.pass) ? 1 : 0);
}
