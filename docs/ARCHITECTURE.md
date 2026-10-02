# Architecture

A short tour of how Chess 3D is put together. Plain ES modules on top of three.js 0.186, bundled by Vite. There are no asset files: geometry comes from code, textures from canvas, the lighting environment from a generated studio map.

## Coordinates

- One board square = 1.0 unit. Y is up. The board top surface is at y = 0, centred at x = z = 0.
- File f (0 to 7 = a to h) and rank r (0 to 7 = 1 to 8) map to the square centre x = f - 3.5, z = 3.5 - r. White starts at +z (ranks 1 and 2), black at -z.
- A piece origin is the centre of its base, with the bottom at y = 0. Piece builders return a piece facing -z (towards the opponent when white). The game turns black pieces by PI around y.
- Approximate piece heights in squares: pawn 0.90, rook 1.00, knight 1.20, bishop 1.35, queen 1.60, king 1.85. Base diameters run from about 0.55 (pawn) to 0.72 (king).
- Chess squares are also indexed 0 to 63 inside the rules engine: `sq = rank * 8 + file`, so a1 = 0, h1 = 7, a8 = 56.

## Layout

    index.html           canvas, loader, HUD containers, entry script
    src/main.js          boot sequence, wiring, render loop, URL parameters, window.__chess
    src/scene.js         stage: renderer, lights, studio environment, floor, post chain, quality
    src/board.js         board, frame, inlay, labels, plinth, square highlights
    src/textures.js      procedural canvas textures (marble, walnut, maple, brass, felt)
    src/materials.js     ivory, ebony and gold piece materials
    src/pieces/setA.js   pawn, rook, knight geometry
    src/pieces/setB.js   bishop, queen, king geometry
    src/pieceset.js      builds each piece once, hands out clones
    src/rules.js         chess rules engine, no dependencies, runs in node and the browser
    src/ai.js            computer opponent (alpha-beta search)
    src/game.js          rules plus 3D presentation: selection, animation, undo, captures, trays
    src/controls.js      camera orbit, board gimbal, presets, keyboard, pointer and touch
    src/ui.js            HUD: panels, move list, captured pieces, sliders, banners
    src/style.css        HUD styles
    test/                fast, smoke and perft checks (see the README)
    tools/               release check, audit plan, contact sheets and browser helpers

Everything the player sees on the board lives in one `gimbal` group inside the scene. The camera orbits outside it, so the gimbal rotation and the camera orbit are independent.

## Boot order (`src/main.js`)

1. Import the modules in parallel, with a progress bar over a loading screen.
2. `createStage(canvas, { quality })`, then a `gimbal` Group added to `stage.scene`.
3. `createPieceMaterials()`, `createBoard()` (added to the gimbal), `createPieceSet(materials).buildAll(progress)`.
4. `createGame({ gimbal, board, pieceSet, materials })`, `createControls(...)`, `createUI(...)`.
5. Apply URL parameters, expose `window.__chess`, start the render loop (or not, with `?manual=1`).

Loading yields to the browser between steps with a helper that races `requestAnimationFrame` against a 50 ms timer, because a background tab never fires `requestAnimationFrame`.

Per frame: `controls.update(dt)`, `game.update(dt)`, `board.update(dt, t)`, `ui.sync()`, then `stage.render(dt)`. The step is capped at 50 ms.

## Modules and APIs

### `src/scene.js`

    createStage(canvas, { quality = 'high' }) -> {
      renderer, scene, camera,     // PerspectiveCamera(35, aspect, 0.1, 200)
      floor,                       // shadow receiving studio floor, at y = -1.2
      lights: { key, fill, rim },  // key is a shadow casting DirectionalLight, frustum radius about 9
      lightingPresets,             // ['Studio', 'Gallery', 'Sunset', 'Night']
      setLightingPreset(name),     // animated transition of lights, environment, backdrop, exposure
      setFloorVisibility(t),       // 0..1, fades the floor and its shadow
      setQuality('low'|'medium'|'high'),
      resize(w, h),
      render(dt),                  // draws the frame, post chain included
      dispose(),
      quality, lightingPreset, composer   // read only
    }

- Tone mapping: ACES filmic, sRGB output. A procedural studio environment (softbox panels on a dome) is built with PMREM and assigned to `scene.environment`.
- Shadows use `PCFShadowMap` (the soft variant is deprecated in r186). `shadowMap.autoUpdate` is off: the stage updates the shadow map once per frame so the shadow, reflection and ambient occlusion passes share it.
- A lighting preset is plain data: key, fill and rim light colour, intensity and direction, the environment panels, the backdrop gradient, exposure, bloom, vignette, tint, shadow opacity and floor colour. Add an entry to `PRESET_DEFS` to add a preset.
- Quality tiers (`QUALITY` in the same file):

| Tier | Shadow map | Pixel ratio cap | Post chain |
|---|---|---|---|
| high | 4096 | 2 | 4x MSAA, ambient occlusion (GTAO), bloom, SMAA, floor reflection |
| medium | 2048 | 1.5 | bloom, SMAA, weaker floor reflection |
| low | 1024 | 1 | none, plain render |

- The final pass is a small grade shader: vignette, tint, a gentle contrast curve and a dither against banding.

### `src/textures.js`, `src/materials.js`

    marbleWhite(), marbleBlack(), walnut(), maple(), brass(), felt()
        -> { map, normalMap, roughnessMap, ... }    // cached on first use, tileable canvas textures
    disposeTextures()
    createPieceMaterials() -> { white: { body, accent }, black: { body, accent } }

Marble and walnut are 1024 px, maple and brass 512, felt 256. `body` is a `MeshPhysicalMaterial` (ivory for white, ebony for black, with clearcoat and sheen), `accent` is gold.

### `src/board.js`

    createBoard() -> {
      group,                          // board, frame and base, top surface at y = 0
      squareMeshes,                   // 64 pickable meshes, each with userData.square = { file, rank }
      squareCenter(file, rank),       // Vector3 in gimbal space, at y = 0
      setHighlights(list),            // [{ file, rank, kind }], kind: select | move | capture | check | last
      clearHighlights(),
      update(dt, time)                // animates the highlight glow
    }

The group extends to about +-4.65 including the frame and down to y = -0.6. Squares are separate meshes with small per-square tone variation, thin gaps and a gold inlay line. Coordinate labels are on the frame and read from both sides.

### `src/pieces/setA.js`, `src/pieces/setB.js`, `src/pieceset.js`

    buildPawn(mat), buildRook(mat), buildKnight(mat)       // setA
    buildBishop(mat), buildQueen(mat), buildKing(mat)      // setB    -> THREE.Group, unit scale

    createPieceSet(materials) -> {
      make(type, color),            // type 'p' | 'n' | 'b' | 'r' | 'q' | 'k', color 'w' | 'b'
      buildAll(onProgress)          // builds every prototype with progress callbacks
    }

Each (type, color) is built once and cloned, so clones share geometry. Piece triangle counts: pawn 58k, rook 65.5k, knight 74.4k, bishop 75.7k, queen 69.7k, king 82.8k. Bases, rings and bands use the accent material, the rest uses the body material. Every mesh casts and receives shadows. Knights of one colour face the same way.

### `src/rules.js`

A self contained engine. `class Chess`: `load(fen)`, `fen()`, `moves(fromSq?)`, `play({ from, to, promo })`, `undo()`, `san(move)`, `inCheck()`, `kingSquare(color)`, `isAttacked(sq, by)`, `status()`, `repetitionCount()`, `perft(depth)`. Helpers: `START_FEN`, `sqName(sq)`, `nameSq(name)`, `sqFile`, `sqRank`.

`status()` returns `{ over, result, reason, check, winner }` with reasons `checkmate`, `stalemate`, `fifty-move rule`, `threefold repetition` and `insufficient material`. Set `trackKeys = false` to skip repetition bookkeeping when only searching.

### `src/ai.js`

    searchMove(fen, depth = 2, margin) -> generator

A negamax search with alpha-beta pruning, move ordering, material and piece-square evaluation. It is a generator, so the game steps it in slices across frames and the page stays responsive. Every root move is scored with a full window and the move is picked at random among those within `margin` centipawns of the best, so play varies. The levels are depth 2 (Easy, about 900 estimated Elo), 3 (Normal, about 1200) and 4 (Hard, about 1450); see the README for how these were measured.

### `src/game.js`

    createGame({ gimbal, board, pieceSet, materials }) -> {
      chess, root,                         // the rules engine and the Group that holds the pieces
      on(event, fn),                       // 'change', 'promotion', 'gameover', 'newgame', 'undo'
      clickSquare(sq), pickSquare(raycaster), hoverAction(raycaster),
      update(dt), newGame(opts), undo(), loadFen(fen),
      setVsComputer(on, { color, depth }), // color is the computer's side
      getState(),                          // turn, moves (SAN), captured, advantage, check, over, thinking, fen, ...
      move(from, to, promo), playMoves(list), selectSquare(name), finishAnimations(),
      audit(), busy, pendingPromotion, pieceCount, sqName, nameSq
    }

- Moves animate: pieces slide, knights jump in an arc, captured pieces fly to the tray beside the board, a checkmated king topples. Castling moves both pieces, en passant removes the right pawn, promotion swaps the pawn for the chosen piece.
- `getState().captured.w` lists the white pieces that were lost, `captured.b` the black pieces. `advantage` is positive when white is ahead.
- The computer opponent is switched on at start (`main.js` calls `setVsComputer(true, { color: 'b', depth: 2 })` unless `?ai=0`). With it on, undo takes back the computer move and the player move together.
- `audit()` compares the visual pieces with the engine board and returns a list of problems (empty when consistent). The tests use it.
- `pickSquare` uses cheap proxies first, then the real meshes, then the square tops, and prefers what the player can actually use when a tall piece hides a smaller one.

### `src/controls.js`

    createControls({ stage, gimbal, canvas, onPick, onHover }) -> {
      update(dt), apply(), onResize(w, h),
      setPreset(name), reset(), levelBoard(), flip(), topDown(), toggleSpin(),
      setGimbal(axis, degrees), setCamera({ yaw, pitch, dist }), nudgeZoom(factor),
      presets, hooks, onChange(fn),
      spin, camera, gimbalDeg, animating      // read only
    }
    PRESETS   // White view, Black view, Top down, Side, Isometric

- Camera: yaw, pitch and distance around a target just above the board. Pitch is limited to 1.5 to 89.6 degrees, distance to 6 to 40. Drag gives damped inertia. On narrow screens the camera pulls back so the board fits the width.
- Gimbal: rotation of the `gimbal` group in YXZ order, set by sliders, keys (W S A D Q E) or Shift, Ctrl or right drag.
- Presets animate yaw, pitch, distance and the gimbal together on an ease curve, taking the shortest way round for every angle.
- The floor fades with `stage.setFloorVisibility` once the board tilts more than 8 degrees on X or Z, and is gone at 38.
- `hooks` is filled by the UI (`undo`, `newGame`, `toggleHud`, `toggleHelp`) so the keyboard handler can reach it.

### `src/ui.js`

    createUI({ game, controls, stage, quality }) -> { sync(), toast(msg), toggleHud(force), toggleHelp(), render(state) }

Builds the HUD into `#hud`: a left column (turn indicator, view presets, gimbal sliders, lighting and quality selects) and a right column (game buttons, computer opponent settings, SAN move list, captured pieces with the material balance). It also renders the promotion chooser (`#promo`), the game over banner (`#banner`), a toast for check (`#toast`) and the shortcut sheet. Below 900 px width the cards collapse and the left column becomes a sheet opened by the Controls button.

## Test hooks

`window.__chess = { stage, gimbal, board, game, controls, ui, THREE, pick }`. With `?manual=1` it also has `step(seconds, hz = 30)`, which advances controls, game and board by simulated time, and `draw(dt)`, which renders the current state. This makes browser tests deterministic: no real time passes, so slow software rendering does not matter.

`window.__chessReady` becomes `true` once loading is done and `window.__chessError` holds a message if loading failed.

## Conventions

- No em dashes or double hyphens as punctuation in code comments, UI text or docs.
- Every piece mesh casts and receives shadows and uses a physical material, so the environment lights it.
- Lathe profiles use at least 160 radial segments with a densely sampled profile, so there is no faceted look.
- Cross-module calls go through the APIs above. Modules do not reach into each other's internals.
