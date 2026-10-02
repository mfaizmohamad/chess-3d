# Tools and tests

Three tiers, from instant to thorough. `npm test` runs the fast tier.

| Tier | Command | Time | Needs | Checks |
| --- | --- | --- | --- | --- |
| fast | `node test/run.mjs fast` (or `npm test`) | about 1 s | Node only | rules (perft, SAN, endings, `test/perft.mjs`), piece geometry contract (`test/geometry.mjs`), text lint (`test/lint.mjs`), audit planner rules (`test/audit-plan.mjs`) |
| smoke | `node test/run.mjs smoke` | 1 to 2 min | Chrome | `vite build`, `vite preview` on port 5303, a scripted game by real clicks, gimbal, render budgets, pixel checks, regression checks from `test/fixes.mjs` |
| all | `node test/run.mjs all` | fast plus smoke | Chrome | both tiers, then a reminder to run the release check |
| release | `node tools/release-check.mjs` | 5 to 10 min | Chrome, network for `npm ci` | git hygiene, fresh copy build, dist scan, page loads, URL fuzzing, docs, version |

## Fast tier

- `test/perft.mjs`: perft counts for five reference positions, SAN, check, mate, stalemate, repetition, en passant, promotion, castling. Exits 1 on any mismatch.
- `test/geometry.mjs`: builds all six pieces in both colors with the real materials, headless. Height within 8 percent of the contract (pawn 0.90, rook 1.00, knight 1.20, bishop 1.35, queen 1.60, king 1.85), footprint 0.5 to 0.85, centered within 0.06, sitting on y = 0, 20k to 90k triangles, finite positions and normals, shadow flags on every mesh.
- `test/audit-plan.mjs`: the audit planner's rules (docs only needs no browser tier, the stylesheet needs smoke, visual and device checks, and so on).
- `test/lint.mjs`: no em dashes, no spaced double hyphen punctuation and no local absolute paths in text files (tracked, plus untracked files that are not ignored).

## Smoke tier

`node test/smoke.mjs [--skip-build] [--dev] [--skip-fixes] [--write-budgets] [--shots]`

- Builds into `.tmp/smoke-dist` (never touches `dist/`), serves it on port 5303, drives headless Chrome with software GL (swiftshader), `quality=low`, `manual=1`.
- The first page load uses no `ai` flag and checks that vs computer is on by default and that black replies to e2e4. Every other run adds `ai=0` so both sides are played by the test.
- Game: capture, undo, both castles, en passant, promotion chooser (cancel, queen, knight), fool's mate with banner and toppled king, undo of each, new game. Moves are two real mouse clicks on projected square positions that the app's own picking resolves to the right square. After every step the view is compared with the rules through `game.audit()`.
- Gimbal: each axis slider, floor fade when tilted, Reset, Level board, keyboard W and R.
- Budgets: draw calls, triangles, geometries, textures and shader programs of one frame at the start position (`renderer.info`) and the time to `window.__chessReady`, against `tools/budgets.json` (1.5x the measured value). After an intended change to the scene, run `node test/smoke.mjs --write-budgets` and commit the new file.
- Pixels: not blank, no black frame, no white out, and light plus dark pixels inside the projected board corners, in five view presets and one tilted view.
- `test/fixes.mjs` (`runFixChecks({ page, baseUrl, log })`) is called with a fresh page when the file exists.
- `--dev` uses the vite dev server on port 5302 instead of a build. `--shots` empties `.tmp/smoke-shots/`, saves the screenshots there and adds a contact sheet per screen size (`contact-<w>x<h>.png`).

## Audit plan

`node tools/audit-plan.mjs [--since=<ref>] [--json]`

Lists the files changed since the last tag (committed, staged, unstaged and untracked) and says which audits are due: fast tier (always), smoke tier, visual audit, device check on a phone, release check (with a fresh `npm ci` when dependencies changed), code review (minor and major version bumps), and watching the Pages run (workflow changed). Ends with the commands to run. It never fails: it is a plan, not a check.

## Contact sheets

`node tools/contact-sheet.mjs <dir> [--cols=3] [--width=640]`

Puts every PNG in a folder on one labelled grid per screen size (`<dir>/contact-<w>x<h>.png`), so a visual audit means opening one image instead of each screenshot. `test/smoke.mjs --shots` does this itself with its open browser.

## Release check

`node tools/release-check.mjs [--port=5303] [--skip-install] [--since=<tag>] [--extra-audit="<cmd>"] [--no-browser]`

Git hygiene (clean tree, no scratch or key files, no file over 1.5 MB outside `docs/`, optional `tools/internal-terms.txt` with one word or regular expression per line, no em dashes or double hyphens in text or commit messages since the last tag), fresh copy of HEAD built with `npm ci`, dist scanned for local paths, user names and keys, normal pages loaded without console errors or foreign requests, URL fuzzing of every flag in `src/main.js`, README and `docs/*.md` checked against the code and the repo, version compared with the last tag. Before the first commit it copies the working tree instead of HEAD and says so.

## URL flags used by the tests

`quality=low|medium|high`, `manual=1` (no render loop, tests call `window.__chess.step(sec)` and `.draw()`), `ai=0` (computer off; default is on, you play white; `ai=3` or `ai=4` raises the level), `fen`, `moves`, `select`, `preset`, `gx` `gy` `gz`, `yaw` `pitch` `dist`, `hud=0`, `help=1`, `light`, `spin=1`, `promo`.

## Files

- `_lib.mjs`: shared reporter, Chrome launcher, page watcher, server starter.
- `budgets.json`: render budgets for the smoke tier.
- `release-check.mjs`: the release tier.
