# ADR-0013: Convert all mechanics to clicker / idle

## Status
Accepted (supersedes the playable roles of ADR-0001's minigame scenes for the shipped entry point).

## Decision
`index.html` now loads `src/clicker-main.js` (DOM) backed by the pure, tested
`src/clicker-state.js`. Every former mechanic has a clicker/idle counterpart —
see the conversion table in that module's header and in `docs/GAMEPLAY.md`.
The former Pixi minigames remain in-tree as reference/legacy modules and their
pure tests still run, but they are no longer the shipped game. Market and
refinery math is reused directly from `src/economy.js`.

## Why
The brief: all mechanics clicker/idle, fun and playable, no exceptions.
Keeping two playable games would split tuning and confuse the loop.
