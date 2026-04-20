// Shared cell-palette reference used across scenes. Mirrors the DOM
// CSS in index.html so the Pixi view reads as the same game. Lives
// here (and not in src/constants.js) because it is strictly Pixi
// render data -- tints + gradients -- that no pure-state module
// should ever import.
//
// Consumers today: GameScene (tiles + effects + previews), HubScene
// (mission preview ore chips), ResultsScene (reward breakdown icons).

export const CELL_PALETTE = {
    red:    { highlight: 0xff6b4a, body: 0xcc2200, shadow: 0x660000,
              linearStart: 0xff4400, linearEnd: 0xaa0000, glow: 0xff4400 },
    blue:   { highlight: 0x4a9eff, body: 0x0055cc, shadow: 0x002266,
              linearStart: 0x3388ff, linearEnd: 0x0044aa, glow: 0x4488ff },
    green:  { highlight: 0x4aff6b, body: 0x00cc22, shadow: 0x006600,
              linearStart: 0x44ff00, linearEnd: 0x00aa44, glow: 0x44ff66 },
    yellow: { highlight: 0xffeb4a, body: 0xcc9900, shadow: 0x664400,
              linearStart: 0xffdd00, linearEnd: 0xaa7700, glow: 0xffdd00 },
    bomb:   { highlight: 0xff4444, body: 0x990000, shadow: 0x330000,
              linearStart: 0xcc0000, linearEnd: 0x440000, glow: 0xff0000 },
    snake:  { highlight: 0x00ff88, body: 0x006644, shadow: 0x002211,
              linearStart: 0x00cc66, linearEnd: 0x004433, glow: 0x00ff64 },
};
