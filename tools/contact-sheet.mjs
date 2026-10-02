// Contact sheets: all screenshots of a run on one labelled grid image per screen size, so a visual audit means
// opening one or two images instead of twenty.
// Usage: node tools/contact-sheet.mjs <dir> [--cols=3] [--width=640]
//   Reads every PNG in <dir> (except earlier contact sheets), groups them by pixel size and writes
//   <dir>/contact-<w>x<h>.png per group. Prints the paths it wrote.
// Also exports contactSheets(browser, dir, opts) so a tool that already has a browser open (test/smoke.mjs --shots)
// does not start a second one.
// Exit codes: 0 sheets written (or no screenshots found), 2 usage error.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHEET = /^contact-.*\.png$/;

/** Width and height from a PNG header (IHDR follows the 8 byte signature and the chunk length and type). */
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const label = (file) => basename(file, '.png').replace(/[-_]+/g, ' ').trim();
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Group the PNGs in dir by size and render one sheet per group with the given browser. Returns the written paths. */
export async function contactSheets(browser, dir, { cols = 3, width = 640 } = {}) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.png') && !SHEET.test(f)).sort();
  const groups = new Map();
  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    const size = pngSize(buf);
    if (!size) continue;
    const key = `${size.w}x${size.h}`;
    if (!groups.has(key)) groups.set(key, { ...size, items: [] });
    groups.get(key).items.push({ name: label(f), src: `data:image/png;base64,${buf.toString('base64')}` });
  }
  const written = [];
  for (const [key, g] of groups) {
    const c = Math.min(cols, g.items.length);
    const tw = Math.min(width, g.w), th = Math.round((tw * g.h) / g.w);
    const html = `<!doctype html><meta charset="utf-8"><style>
      body { margin: 0; background: #15171c; color: #e8e6e1; font: 600 14px system-ui, sans-serif; }
      h1 { margin: 0; padding: 12px 14px 4px; font-size: 15px; font-weight: 650; }
      .grid { display: grid; grid-template-columns: repeat(${c}, ${tw}px); gap: 10px; padding: 10px 14px 14px; }
      figure { margin: 0; } img { display: block; width: ${tw}px; height: ${th}px; border-radius: 6px; }
      figcaption { padding: 5px 2px 0; }
    </style><h1>${esc(basename(resolve(dir)))}: ${g.items.length} shots at ${key}</h1><div class="grid">${
      g.items.map((it) => `<figure><img src="${it.src}"><figcaption>${esc(it.name)}</figcaption></figure>`).join('')}</div>`;
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: c * tw + (c - 1) * 10 + 28, height: 200, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      const out = join(dir, `contact-${key}.png`);
      await page.screenshot({ path: out, fullPage: true });
      written.push(out);
    } finally { await page.close().catch(() => {}); }
  }
  return written;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? Number(a.split('=')[1]) : d; };
  if (!dir || args.some((a) => a.startsWith('--') && !/^--(cols|width)=\d+$/.test(a))) {
    console.error('usage: node tools/contact-sheet.mjs <dir> [--cols=3] [--width=640]'); process.exit(2);
  }
  const { launchBrowser } = await import('./_lib.mjs');
  const browser = await launchBrowser({ w: 1280, h: 720 });
  try {
    const out = await contactSheets(browser, dir, { cols: opt('cols', 3), width: opt('width', 640) });
    console.log(out.length ? out.join('\n') : `no screenshots in ${dir}`);
  } finally { await browser.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
