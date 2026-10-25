# ADR-0014: Merge the clicker into the hub (supersedes ADR-0013's replacement)

## Status
Accepted. Supersedes the *entry-point* decision of ADR-0013; its conversion
design (clicker-state.js) is retained.

## Context
ADR-0013 replaced the Pixi game with a standalone DOM clicker. The owner
asked for the opposite: the old interface back, with the new mechanics
merged into it.

## Decision
- `index.html` again boots the Pixi game (`src/main.js`, HubScene, minigames,
  idle dispatch — everything as before). The DOM front-end is deleted.
- The clicker lives in the hub as a seventh bottom-nav tab, **STELLAR CORE**
  (hotkey `7`), implemented by `src/scenes/tabs/core-tab.js` on the pure
  `src/clicker-state.js` engine (ADR-0010 tab-scene pattern).
- One wallet: the clicker adopts MetaState's credits/minerals/warp/ores/
  reputation (`adoptWallet`/`walletDeltas` in clicker-state.js); everything
  it earns lands in the shared economy, and station research + charted
  sectors feed back as its production multiplier. Its private slice
  (stardust, generators, core, waves, Dark Matter) persists via
  `MetaState.getClickerSave()/saveClickerState()` in the same profile.
- The clicker ticks on every hub tab (idle means idle) and applies capped
  offline progress on boot. Manual minigames and idle dispatch are untouched:
  the clicker is an additional always-on production layer, and every old
  mechanic also keeps its converted clicker form inside the tab.
