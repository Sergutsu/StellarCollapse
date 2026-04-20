# ADR 0001 — Pixi.js v8 is the only renderer

## Status

Accepted — 2025-04 (PR #22, #23, consolidated through PR #32).

## Context

The first playable prototype rendered the board as a DOM grid: one `<div>` per cell, CSS `@keyframes` for pulses and glows, CSS `filter` for the auto-match white-out. It worked at small field sizes. By the time we shipped 9 field sizes up to 15×28 (420 cells) with bomb / snake / floating-cell / countdown-arc animations, DOM + CSS hit a performance wall — layout + paint + composite per frame on every animated tile, with no escape past "disable the animations above N cells" (the `.low-fx` class in PR #13).

We briefly ran Pixi behind a `?engine=pixi` feature flag (PR #15–#21) to de-risk the port. The flag was a mistake: it stayed on for 8 PRs after parity, the root URL kept serving the old DOM version, and players (the user specifically) saw "no changes" because none of the Pixi work was on the default URL.

## Decision

- **Pixi.js v8** is the one and only renderer for the board, active piece, effects, starfield, scanner, HUD, previews, title bar, and mission-select scene.
- **No `<canvas>` fallback.** No `<div>` fallback. No DOM grid code kept in the tree "just in case".
- **No `?engine=*` URL flag.** The root URL is the game.
- **Pixi is pulled via ESM import map in `index.html` from jsdelivr.** No bundler, no `dist/`, GitHub Pages serves the repo as-is.
- **The player-name `<input>` is the one allowed DOM element** overlaid on Pixi — Pixi has no native text-input widget and writing one is not worth the effort. As of PR #32 the input is permanently hidden (identity is fixed to "Chief Dispatcher"), but the DOM node stays in the HTML for future rename/custom-name UX.

## Consequences

**Accept:**
- We take on Pixi v8 (~160 KB gzipped over CDN) as a hard runtime dep.
- Text rendering relies on web fonts + Pixi `Text`. We don't use bitmap fonts.
- The board is a `<canvas>`, so anything pixel-exact (screenshots, screen-reader text extraction, CSS inspect of cells) is out. View-only concerns, not gameplay concerns.
- One fewer "escape hatch" if Pixi ships a regression. We accept this because the port is well-tested visually and the fallback wasn't providing value anyway.

**Give up:**
- CSS-driven tweening of board cells. If we want a new animation, we write it in Pixi `ticker` code.
- Browser accessibility tree for the board (the canvas is a single opaque node). Mitigation: HUD text labels, keyboard input, colour contrast are all tested; we don't claim SR-parity for the board.

**Gain:**
- Constant per-frame cost regardless of cell count. 15×28 holds 60 fps with bomb + snake + floating + particles simultaneously.
- `.low-fx` goes away (kept as a constant in case we want it back, but no runtime effect).
- Sub-pixel grid alignment is Pixi's problem, not ours — the class of bug that motivated PR #2 is gone.
- Shaders / filters / particles / `RenderTexture` baking all become cheap.

## Alternatives considered

- **Keep DOM, push `.low-fx` harder.** Loses fidelity on large boards permanently. Doesn't scale when we want richer effects.
- **Plain `<canvas>` 2D, no library.** Works, and is the smallest possible dep. Loses Pixi's `Graphics` API, scene graph, `RenderTexture`, pooled particles, and `FillGradient`. We'd end up writing half a Pixi.
- **Phaser.** Full game framework. Overkill for a puzzle game; brings scenes, physics, input, audio we don't need. Also heavier.
- **Three.js / Babylon.** 3D. Not needed.
- **Vite + `npm install pixi.js`.** Would mean a build step, a `dist/` output, a bundler in the Pages workflow. Currently not justified. **Revisit** if we ever need tree-shaking of Pixi (we don't — we use most of it).

## Implementation notes

- `src/pixi-view.js` is the only file allowed to `import { ... } from 'pixi.js'`.
- `GameState`, `constants`, `shapes`, `highscores`, `missions`, `audio`, `emitter` stay pure.
- Rendering rules (diff cells, don't destroy+recreate, pool effects) live in `ARCHITECTURE.md`.

## Revisit if

- Pixi v9+ breaks compat significantly and stability requires pinning v8 for years.
- We port to mobile and find CDN latency unacceptable (then bundle Pixi locally).
- A non-trivial user base needs screen-reader support for the board (then add an ARIA-only DOM layer synced to state; don't replace the renderer).
