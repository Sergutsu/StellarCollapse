// Pixi.js-based board + HUD renderer. Subscribes to GameState events,
// owns the `#gameContainer` mount, and draws the title bar + HUD
// columns + previews inside the canvas. The start screen, sound /
// exit buttons, and player-name input stay DOM (Pixi has no native
// text-input or button widget worth writing from scratch).
// GameState remains pure -- this file is the only one that touches Pixi.
//
//   const view = new PixiView({ state, elements });
//   await view.init();          // async bootstrap (Pixi v8 requires it)
//   view.createBoard();
//   view.createPreviews();
//   view._levelInfoFor = ...;   // optional HUD formatter

import {
    Application,
    Container,
    FillGradient,
    Graphics,
    Rectangle,
    Text,
    TextStyle,
} from 'pixi.js';

import {
    SNAKE_LENGTH,
    PIECE_COMPLEXITY,
    BLOCK_SIZE_FOR,
    LINES_PER_LEVEL,
    LOW_FX_CELL_THRESHOLD,
} from './constants.js';

import { createPixiStarfield } from './pixi-starfield.js';

// Palette mirrors the DOM CSS in index.html so the Pixi view reads as
// the same game. `highlight` is the top-left gloss tint, `body` is the
// mid-tone flat fill, `shadow` is the bottom-right darker tint, and
// `linearStart/End` drive the background diagonal gradient.
const CELL_PALETTE = {
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

// Emoji glyphs map 1:1 to the DOM `.cell.X::before` content rules.
// Pixi Text renders emoji natively via the browser font stack; no
// bitmap font or spritesheet needed.
const ICON_EMOJI = {
    red:    '🔥',
    blue:   '💎',
    green:  '🌟',
    yellow: '⚡',
    bomb:   '💣',
    snake:  '🐍',
};

const FLOATING_COLOR = 0x7dd3fc; // cyan-300; matches the DOM outline

// Effect colors: [inner, outer] for the match/bomb explosion layers.
const EFFECT_COLORS = {
    red:    [0xff6400, 0xffc864],
    blue:   [0x0096ff, 0x64c8ff],
    green:  [0x64ff64, 0xc8ffc8],
    yellow: [0xffff64, 0xffffc8],
    bomb:   [0xff6400, 0xffc800],
    snake:  [0x00ff88, 0x00ffcc],
};

// Pulsing bomb/snake cells share a single ticker. Frequency mirrors
// the DOM `bombPulse` (1s) and `snakePulse` (1.5s) keyframes so the
// cadence feels identical.
const PULSE_PERIOD_MS = { bomb: 1000, snake: 1500 };

// --------------------------------------------------------------------
// HUD layout. Canvas is a fixed 860x820 rectangle regardless of field
// size; the board slot is always 400x720 centered, the three columns
// stay put, and the title bar spans the top. Matches the DOM layout
// defined by .game-board-slot / .hud-column / .game-title-bar.
// --------------------------------------------------------------------
const HUD_W = 860;
const HUD_H = 820;
const TITLE_H = 80;
const COL_W = 210;
const COL_GAP = 10;
const BOARD_SLOT_W = 400;
const BOARD_SLOT_H = 720;
const LEFT_X = COL_GAP;
const BOARD_SLOT_X = LEFT_X + COL_W + COL_GAP;
const RIGHT_X = BOARD_SLOT_X + BOARD_SLOT_W + COL_GAP;
const COL_Y = TITLE_H + 8;

// Hologram panel tints -- picked to match the DOM CSS backdrop
// (cyan-ish translucent gradient with a thin cyan border).
const PANEL_BG_TOP = 0x0b1b3a;
const PANEL_BG_BOT = 0x050a1c;
const PANEL_BORDER = 0x00d4ff;
const PANEL_BORDER_ALPHA = 0.28;
const PANEL_GLOW = 0x00d4ff;

// Title-bar + panel text colors, also pulled from the DOM CSS so the
// two engines read as the same game.
const COLOR_BLUE_300 = 0x93c5fd;
const COLOR_BLUE_200 = 0xbfdbfe;
const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_CYAN_400 = 0x22d3ee;
const COLOR_YELLOW_300 = 0xfde047;
const COLOR_GREEN_300 = 0x86efac;
const COLOR_PINK_300 = 0xf9a8d4;
const COLOR_WHITE = 0xffffff;

// Title-star reaction -> {color, periodMs, kind}. kind drives the
// animation shape; periodMs matches the DOM @keyframes durations.
const STAR_REACTIONS = {
    lock:     { color: 0xfacc15, duration: 280, kind: 'pop' },
    line:     { color: 0x22d3ee, duration: 550, kind: 'spin' },
    match:    { color: 0x34d399, duration: 550, kind: 'pop-big' },
    bomb:     { color: 0xf97316, duration: 750, kind: 'shake' },
    snake:    { color: 0xa855f7, duration: 900, kind: 'wobble' },
    gameover: { color: 0xf87171, duration: 900, kind: 'fall' },
    levelup:  { color: 0xfde68a, duration: 750, kind: 'burst' },
};

export class PixiView {
    constructor({ state, elements }) {
        this.state = state;
        this.el = elements;

        this.app = null;
        this.blockPx = 30;
        // Layer containers. Populated in init().
        this.layers = { board: null, active: null, effects: null, overlay: null };

        // Per-cell reusable node pools:
        //   boardCells[y][x] = { container, body, accent, outline, icon, pulse }
        //   activeCells[y][x] = same shape
        this.boardCells = [];
        this.activeCells = [];
        this.activePaintedCells = [];

        // Special-cell countdown overlays (COLLAPSED hardcore timer).
        this._specialOverlays = new Map();

        // Ongoing per-frame tween handles (effects, particles) so we
        // can cancel on reset.
        this._tweens = new Set();
        // Free particle Graphics pool -- reused across explosions so a
        // big chain-match doesn't churn GC.
        this._particlePool = [];
        // Board cells currently rendering a bomb/snake. We pulse these
        // on the shared ticker so alpha/scale animations run on the
        // GPU without per-cell setInterval timers.
        this._pulsingCells = new Set();
        // Monotonic ticker time; used for pulse sine phases.
        this._clockMs = 0;

        // Whether to skip idle-pulse tickers on big boards.
        this._lowFx = false;

        // HUD: containers, text nodes, preview grids. Populated in init().
        this.hud = null;
        // Root container for the board layers so we can position the
        // board inside the canvas without moving every child by hand.
        this.boardRoot = null;
        // Star actor state: base color + active reaction tween handle.
        this._starReactionTween = null;

        this._bindState();
    }

    // -------------------------------------------------------------------
    // Bootstrap. Pixi v8 requires async init; main.js awaits this once.
    // -------------------------------------------------------------------

    async init() {
        const app = new Application();
        await app.init({
            antialias: true,
            backgroundAlpha: 0,
            // autoDensity keeps the canvas crisp on hi-dpi without
            // blurring on the compositor.
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            autoDensity: true,
            // Fixed HUD canvas -- see HUD_W/HUD_H. The board slot inside
            // scales with field size; the outer frame stays constant.
            width: HUD_W,
            height: HUD_H,
        });
        this.app = app;

        // Mount into #gameContainer. Wipe any DOM children (the old
        // board/active/effects divs) so the canvas takes the full
        // bounding box. Also resize the container itself to the HUD
        // dimensions so the DOM layout in #gameScreen makes room for
        // the wider-than-board canvas.
        const mount = this.el.container;
        if (mount) {
            mount.innerHTML = '';
            mount.appendChild(app.canvas);
            app.canvas.style.display = 'block';
            mount.style.width = `${HUD_W}px`;
            mount.style.height = `${HUD_H}px`;
            // Drop the cyan border + box-shadow from .game-container --
            // the Pixi HUD draws its own frame now.
            mount.style.border = 'none';
            mount.style.boxShadow = 'none';
            mount.style.background = 'transparent';
            mount.style.animation = 'none';
        }

        // Starfield goes on the stage first so it renders behind the
        // HUD panels and the board frame. The DOM `.stars` layer is
        // hidden in engine-pixi mode (see CSS) so we don't double up.
        this._starfield = createPixiStarfield(app, {
            width: HUD_W,
            height: HUD_H,
        });
        app.stage.addChild(this._starfield.container);

        // Title bar + left/right columns next so they sit above the
        // starfield but behind the board. boardRoot wraps the existing
        // cell layers so we can position the entire board inside the
        // HUD with one container transform.
        this._buildHud();

        this.boardRoot = new Container();
        app.stage.addChild(this.boardRoot);

        // Z-order inside boardRoot: board (locked) -> active ->
        // effects -> overlay (countdown rings).
        this.layers.board = new Container();
        this.layers.active = new Container();
        this.layers.effects = new Container();
        this.layers.overlay = new Container();
        this.boardRoot.addChild(
            this.layers.board,
            this.layers.active,
            this.layers.effects,
            this.layers.overlay,
        );

        // Single ticker: advances the clock, drives pulse animations on
        // bomb/snake cells, and runs the effects/particle tweens.
        app.ticker.add((ticker) => {
            this._clockMs += ticker.deltaMS;
            this._starfield?.update(ticker.deltaMS);
            this._tickScanner(ticker.deltaMS);
            this._tickPulse();
            this._tickStar(ticker.deltaMS);
            this._tickTweens(ticker.deltaMS);
        });

        // Click-to-match input: forward canvas clicks to game state as
        // cell coordinates. Match the old DOM behavior where only
        // filled cells respond.
        app.canvas.addEventListener('click', (ev) => this._handleCanvasClick(ev));
    }

    // -------------------------------------------------------------------
    // Board construction. Called on every game-started so each run gets
    // a fresh cell pool sized to the current field.
    // -------------------------------------------------------------------

    createBoard() {
        if (!this.app) return;
        const cols = this.state.cols;
        const rows = this.state.rows;
        this.blockPx = BLOCK_SIZE_FOR(rows);
        this._lowFx = cols * rows >= LOW_FX_CELL_THRESHOLD;

        const w = cols * this.blockPx;
        const h = rows * this.blockPx;

        // Center the board inside the fixed BOARD_SLOT area so every
        // field size sits in the same rectangle of the canvas.
        if (this.boardRoot) {
            this.boardRoot.x = BOARD_SLOT_X + Math.round((BOARD_SLOT_W - w) / 2);
            this.boardRoot.y = COL_Y + Math.round((BOARD_SLOT_H - h) / 2);
        }
        // Redraw the board frame + background grid inside the slot.
        this._drawBoardFrame(w, h);

        // Rebuild cell pools. Tear down the previous run's nodes first.
        for (const layer of Object.values(this.layers)) {
            const kids = layer.removeChildren();
            for (const c of kids) c.destroy({ children: true });
        }
        this._specialOverlays.clear();
        this._tweens.clear();
        this._pulsingCells.clear();
        this._particlePool.length = 0;

        this.boardCells = [];
        this.activeCells = [];
        this.activePaintedCells = [];

        for (let y = 0; y < rows; y++) {
            this.boardCells[y] = [];
            this.activeCells[y] = [];
            for (let x = 0; x < cols; x++) {
                const bc = this._makeCell();
                bc.container.x = x * this.blockPx;
                bc.container.y = y * this.blockPx;
                bc.container.visible = false;
                this.layers.board.addChild(bc.container);
                this.boardCells[y][x] = bc;

                const ac = this._makeCell(true);
                ac.container.x = x * this.blockPx;
                ac.container.y = y * this.blockPx;
                ac.container.visible = false;
                this.layers.active.addChild(ac.container);
                this.activeCells[y][x] = ac;
            }
        }
    }

    // Preview grids are Pixi-owned now (built inside _buildHud). The
    // DOM el.nextPreview / el.smallPreviews stay hidden by the
    // .engine-pixi CSS rule. Kept as a no-op so main.js's contract is
    // unchanged.
    createPreviews() {
        /* preview cells are built during _buildHud(); nothing to do. */
    }

    // -------------------------------------------------------------------
    // Cell factory: one reusable Container per grid slot with a
    // pre-allocated body / accent / outline / icon / pulse layer. Paint
    // is done by toggling visibility and redrawing Graphics in
    // _paintCell.
    // -------------------------------------------------------------------

    _makeCell(_isActive = false) {
        const container = new Container();
        container.eventMode = 'none';
        const pulse = new Graphics();   // outer glow (bomb/snake)
        const body = new Graphics();    // main fill + inset stroke
        const accent = new Graphics();  // radial highlight + shadow
        const outline = new Graphics(); // floating dashes / highlight flash
        const iconSize = Math.max(10, Math.floor(this.blockPx * 0.58));
        const icon = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
                fontSize: iconSize,
                fill: 0xffffff,
                align: 'center',
                dropShadow: {
                    color: 0x000000,
                    alpha: 0.7,
                    blur: 2,
                    distance: 1,
                    angle: Math.PI / 4,
                },
            }),
        });
        icon.anchor.set(0.5);
        icon.x = this.blockPx / 2;
        icon.y = this.blockPx / 2;
        icon.visible = false;

        // Z-order inside the cell: pulse (under) -> body -> accent ->
        // outline -> icon.
        container.addChild(pulse, body, accent, outline, icon);
        return { container, pulse, body, accent, outline, icon, color: null };
    }

    _paintCell(node, color, opts = {}) {
        const { container, pulse, body, accent, outline, icon } = node;
        const size = this.blockPx;
        pulse.clear();
        body.clear();
        accent.clear();
        outline.clear();
        icon.visible = false;

        // Remove any stale pulse registration before we re-evaluate.
        this._pulsingCells.delete(node);
        node.color = color || null;

        if (!color) {
            container.visible = false;
            return;
        }
        container.visible = true;

        const pal = CELL_PALETTE[color] || CELL_PALETTE.red;
        const radius = Math.max(2, Math.floor(size * 0.12));

        // Body: diagonal linear gradient (matches the DOM's
        // `linear-gradient(135deg, start, end)` backdrop). Pixi v8's
        // FillGradient is linear -- we approximate the radial layers
        // on top with the `accent` Graphics below.
        const grad = new FillGradient(0, 0, size, size);
        grad.addColorStop(0, pal.linearStart);
        grad.addColorStop(1, pal.linearEnd);
        body.roundRect(1, 1, size - 2, size - 2, radius)
            .fill(grad)
            .stroke({ color: pal.shadow, width: 1, alpha: 0.7, alignment: 1 });

        // Accent radials: a bright highlight top-left and a darker
        // pool bottom-right to approximate the two radial layers in
        // the DOM background. Numbers mirror the `circle at 30% 30%`
        // and `circle at 70% 75%` stops.
        accent.circle(size * 0.3, size * 0.3, size * 0.38)
            .fill({ color: pal.highlight, alpha: 0.45 });
        accent.circle(size * 0.72, size * 0.78, size * 0.34)
            .fill({ color: pal.shadow, alpha: 0.55 });
        // Inner speculars: small bright dots pick up the "wet" look
        // from the extra `circle at 25% 25%` / `circle at 45% 20%`
        // after-gradients in the DOM CSS.
        accent.circle(size * 0.26, size * 0.24, size * 0.1)
            .fill({ color: 0xffffff, alpha: 0.3 });
        accent.circle(size * 0.58, size * 0.35, size * 0.07)
            .fill({ color: pal.highlight, alpha: 0.25 });
        // Inset gloss streak under the top edge.
        accent.roundRect(3, 3, size - 6, 2, 1)
            .fill({ color: 0xffffff, alpha: 0.2 });

        // Icon glyph. Skip the text cost when we're rendering a piece
        // that's off-screen or tiny (icons get illegible below ~20px
        // anyway). Font size is resampled per-block because block size
        // varies with field size.
        const emoji = ICON_EMOJI[color];
        if (emoji && size >= 20) {
            icon.text = emoji;
            icon.style.fontSize = Math.max(10, Math.floor(size * 0.58));
            icon.x = size / 2;
            // Nudge the emoji down slightly so it sits visually
            // centered (most emoji fonts render with a top-heavy
            // bounding box).
            icon.y = size / 2 + Math.max(1, Math.floor(size * 0.04));
            icon.visible = true;
        }

        // Register bomb/snake for the shared pulse ticker. Skip when
        // low-fx is on (big boards; keeps the ticker budget bounded).
        if (!this._lowFx && (color === 'bomb' || color === 'snake')) {
            this._pulsingCells.add(node);
        }

        if (opts.floating) {
            // Dashed cyan outline -- eight short segments per side so
            // it reads as dashed without the per-frame stroke cost of
            // a shader dash pattern.
            const segs = 8;
            const step = (size - 4) / segs;
            outline.setStrokeStyle({ color: FLOATING_COLOR, width: 1.5, alpha: 0.9 });
            for (let i = 0; i < segs; i++) {
                if (i % 2) continue;
                outline.moveTo(2 + i * step, 2).lineTo(2 + (i + 1) * step, 2);
                outline.moveTo(2 + i * step, size - 2).lineTo(2 + (i + 1) * step, size - 2);
                outline.moveTo(2, 2 + i * step).lineTo(2, 2 + (i + 1) * step);
                outline.moveTo(size - 2, 2 + i * step).lineTo(size - 2, 2 + (i + 1) * step);
            }
            outline.stroke();
        }

        // Snake cells are drawn with a 45 degree rotation (diamond
        // shape) to mirror the DOM CSS `transform: rotate(45deg)`.
        // We rotate the container around its center; to keep the top-
        // left grid anchor, we also shift position by size/2. The icon
        // counter-rotates so the snake glyph stays upright. Guard both
        // the snake->snake repaint (so we don't double-shift) and the
        // snake->other transition (restore original anchor).
        const wasRotated = container.rotation !== 0;
        if (color === 'snake') {
            if (!wasRotated) {
                container.pivot.set(size / 2, size / 2);
                container.position.set(container.position.x + size / 2, container.position.y + size / 2);
                container.rotation = Math.PI / 4;
            }
            icon.rotation = -Math.PI / 4;
        } else if (wasRotated) {
            container.rotation = 0;
            container.pivot.set(0, 0);
            container.position.set(container.position.x - size / 2, container.position.y - size / 2);
            icon.rotation = 0;
        }
    }

    // Shared pulse ticker for bomb + snake cells. Computes a sine
    // wave on the monotonic clock and bumps alpha + scale on the
    // outer glow Graphics. O(n) where n = # pulsing cells; caps at
    // board size anyway.
    _tickPulse() {
        if (this._pulsingCells.size === 0) return;
        const t = this._clockMs;
        for (const node of this._pulsingCells) {
            if (!node.color) continue;
            const period = PULSE_PERIOD_MS[node.color] || 1000;
            const phase = (t % period) / period; // 0..1
            // Smooth 0 -> 1 -> 0 curve.
            const s = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
            const pal = CELL_PALETTE[node.color];
            const alpha = 0.35 + 0.35 * s;
            const radius = this.blockPx * (0.52 + 0.1 * s);
            node.pulse.clear();
            node.pulse.circle(this.blockPx / 2, this.blockPx / 2, radius)
                .fill({ color: pal.glow, alpha });
        }
    }

    // -------------------------------------------------------------------
    // Board / active repaint
    // -------------------------------------------------------------------

    _redrawBoard() {
        const cols = this.state.cols;
        const rows = this.state.rows;
        // Floating detection (COLLAPSED only).
        const floating = new Array(rows);
        for (let y = 0; y < rows; y++) floating[y] = new Array(cols).fill(false);
        if (this.state.complexity === PIECE_COMPLEXITY.COLLAPSED) {
            for (let x = 0; x < cols; x++) {
                let sawGap = false;
                for (let y = rows - 1; y >= 0; y--) {
                    if (!this.state.board[y][x]) sawGap = true;
                    else if (sawGap) floating[y][x] = true;
                }
            }
        }
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const color = this.state.board[y][x];
                this._paintCell(this.boardCells[y][x], color, { floating: floating[y][x] });
            }
        }
        this._paintActivePiece();
    }

    _clearActiveLayer() {
        for (let i = 0; i < this.activePaintedCells.length; i++) {
            const node = this.activePaintedCells[i];
            // Deregister pulsing active cells on clear so a bomb-cell
            // in the falling piece doesn't keep pulsing after lock.
            this._pulsingCells.delete(node);
            node.color = null;
            node.container.visible = false;
            node.pulse.clear();
            node.body.clear();
            node.accent.clear();
            node.outline.clear();
            node.icon.visible = false;
        }
        this.activePaintedCells.length = 0;
    }

    _paintActivePiece() {
        this._clearActiveLayer();
        const piece = this.state.currentPiece;
        if (!piece) return;
        const shape = piece.shape;
        const colors = piece.colorMatrix;
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (!shape[y][x]) continue;
                const bx = piece.x + x;
                const by = piece.y + y;
                if (by < 0 || bx < 0 || bx >= this.state.cols || by >= this.state.rows) continue;
                if (this.state.board[by][bx]) continue;
                const cell = this.activeCells[by][bx];
                const color = colors[y][x];
                if (!color) continue;
                this._paintCell(cell, color);
                this.activePaintedCells.push(cell);
            }
        }
    }

    // -------------------------------------------------------------------
    // Transient effects: match-explode, bomb blast, snake trail, and
    // particle bursts. All animate off a single ticker via _addTween.
    // -------------------------------------------------------------------

    _addTween(obj) {
        this._tweens.add(obj);
    }

    _tickTweens(deltaMs) {
        for (const t of this._tweens) {
            t.elapsed += deltaMs;
            const p = Math.min(1, t.elapsed / t.duration);
            t.update(p);
            if (p >= 1) {
                t.done && t.done();
                this._tweens.delete(t);
            }
        }
    }

    _acquireParticle() {
        const g = this._particlePool.pop() || new Graphics();
        g.visible = true;
        this.layers.effects.addChild(g);
        return g;
    }

    _releaseParticle(g) {
        g.clear();
        g.visible = false;
        if (g.parent) g.parent.removeChild(g);
        // Cap pool so a huge chain doesn't permanently retain refs.
        if (this._particlePool.length < 256) this._particlePool.push(g);
        else g.destroy();
    }

    // Explosion burst: expanding radial flare + a ring of particles
    // flying outward and fading. Used on every cleared cell in a
    // match. Cheap enough to run on low-fx boards too.
    _addExplosionEffect(x, y, color) {
        const [c1, c2] = EFFECT_COLORS[color] || EFFECT_COLORS.red;
        const cx = (x + 0.5) * this.blockPx;
        const cy = (y + 0.5) * this.blockPx;
        const flare = new Graphics();
        flare.x = cx;
        flare.y = cy;
        this.layers.effects.addChild(flare);
        const baseR = this.blockPx * 0.5;
        this._addTween({
            elapsed: 0,
            duration: 600,
            update: (p) => {
                flare.clear();
                const r = baseR * (1 + p * 1.8);
                flare.circle(0, 0, r).fill({ color: c1, alpha: 0.7 * (1 - p) });
                flare.circle(0, 0, r * 0.55).fill({ color: c2, alpha: 0.5 * (1 - p) });
            },
            done: () => { flare.destroy(); },
        });

        // Skip the particle burst on low-fx to keep the ticker cheap.
        if (this._lowFx) return;
        const count = 8;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
            const speed = this.blockPx * (1.2 + Math.random() * 1.2);
            const dx = Math.cos(angle) * speed;
            const dy = Math.sin(angle) * speed;
            const g = this._acquireParticle();
            g.x = cx;
            g.y = cy;
            const startR = this.blockPx * (0.1 + Math.random() * 0.1);
            this._addTween({
                elapsed: 0,
                duration: 500 + Math.random() * 200,
                update: (p) => {
                    g.clear();
                    const px = dx * p;
                    const py = dy * p + (p * p) * this.blockPx * 0.8; // gravity-ish
                    g.x = cx + px;
                    g.y = cy + py;
                    const r = startR * (1 - p * 0.5);
                    const a = 1 - p;
                    g.circle(0, 0, r).fill({ color: c1, alpha: a });
                    g.circle(0, 0, r * 0.5).fill({ color: c2, alpha: a });
                },
                done: () => this._releaseParticle(g),
            });
        }
    }

    _addBombEffect(x, y) {
        const cx = (x + 0.5) * this.blockPx;
        const cy = (y + 0.5) * this.blockPx;
        const g = new Graphics();
        g.x = cx;
        g.y = cy;
        this.layers.effects.addChild(g);
        const baseR = this.blockPx * 0.6;
        this._addTween({
            elapsed: 0,
            duration: 800,
            update: (p) => {
                g.clear();
                const r = baseR * (1 + p * 2.8);
                g.circle(0, 0, r).fill({ color: 0xff6400, alpha: 0.85 * (1 - p) });
                g.circle(0, 0, r * 0.6).fill({ color: 0xffc800, alpha: 0.8 * (1 - p) });
                g.circle(0, 0, r * 0.3).fill({ color: 0xffffff, alpha: 0.9 * (1 - p) });
            },
            done: () => { g.destroy(); },
        });
        // Shockwave ring.
        const ring = new Graphics();
        ring.x = cx;
        ring.y = cy;
        this.layers.effects.addChild(ring);
        this._addTween({
            elapsed: 0,
            duration: 600,
            update: (p) => {
                ring.clear();
                const r = this.blockPx * (0.5 + p * 3);
                ring.circle(0, 0, r)
                    .stroke({ color: 0xffe066, width: 3 * (1 - p), alpha: 0.8 * (1 - p) });
            },
            done: () => { ring.destroy(); },
        });
        // Particle shrapnel (skip in low-fx).
        if (this._lowFx) return;
        const count = 18;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = this.blockPx * (1.8 + Math.random() * 2.2);
            const dx = Math.cos(angle) * speed;
            const dy = Math.sin(angle) * speed;
            const p = this._acquireParticle();
            p.x = cx;
            p.y = cy;
            const startR = this.blockPx * (0.12 + Math.random() * 0.1);
            this._addTween({
                elapsed: 0,
                duration: 700 + Math.random() * 400,
                update: (q) => {
                    p.clear();
                    p.x = cx + dx * q;
                    p.y = cy + dy * q + (q * q) * this.blockPx * 1.2;
                    const r = startR * (1 - q * 0.4);
                    const a = 1 - q;
                    p.circle(0, 0, r).fill({ color: 0xff9033, alpha: a });
                    p.circle(0, 0, r * 0.5).fill({ color: 0xffe066, alpha: a });
                },
                done: () => this._releaseParticle(p),
            });
        }
    }

    _animateSnake({ start, entry, recolors, stepInterval, segments }) {
        const size = this.blockPx;
        const trailNodes = [];
        for (let i = 0; i < segments; i++) {
            const g = new Graphics();
            g.visible = false;
            this.layers.effects.addChild(g);
            trailNodes.push(g);
        }
        const trail = new Array(segments).fill(null).map(() => ({ x: entry.x, y: entry.y, visible: false }));

        const originCell = this.boardCells[start.y] && this.boardCells[start.y][start.x];
        if (originCell) this._paintCell(originCell, null);

        let idx = 0;
        const paintTrail = () => {
            for (let i = 0; i < segments; i++) {
                const seg = trail[i];
                const g = trailNodes[i];
                if (seg.visible && seg.x >= 0 && seg.x < this.state.cols && seg.y >= 0 && seg.y < this.state.rows) {
                    g.clear();
                    g.x = (seg.x + 0.5) * size;
                    g.y = (seg.y + 0.5) * size;
                    const alpha = i === 0 ? 0.95 : Math.max(0.1, 0.65 - i * 0.08);
                    g.circle(0, 0, size * 0.42)
                        .fill({ color: 0x00ff88, alpha });
                    g.circle(0, 0, size * 0.28)
                        .fill({ color: 0xccffdd, alpha: alpha * 0.7 });
                    g.circle(0, 0, size * 0.12)
                        .fill({ color: 0xffffff, alpha: alpha * 0.8 });
                    g.visible = true;
                } else {
                    g.visible = false;
                }
            }
        };

        const step = () => {
            if (idx < recolors.length) {
                const target = recolors[idx];
                for (let i = segments - 1; i > 0; i--) trail[i] = { ...trail[i - 1] };
                trail[0] = { x: target.x, y: target.y, visible: true };
                const cellNode = this.boardCells[target.y] && this.boardCells[target.y][target.x];
                if (cellNode && this.state.board[target.y] && this.state.board[target.y][target.x] === target.color) {
                    this._paintCell(cellNode, target.color);
                }
                idx++;
            } else {
                const exits = [
                    { x: -2, y: trail[0].y },
                    { x: this.state.cols + 1, y: trail[0].y },
                    { x: trail[0].x, y: -2 },
                    { x: trail[0].x, y: this.state.rows + 1 },
                ];
                const ex = exits[Math.floor(Math.random() * exits.length)];
                for (let i = segments - 1; i > 0; i--) trail[i] = { ...trail[i - 1] };
                trail[0] = { x: ex.x, y: ex.y, visible: false };
            }
            paintTrail();
            if (idx < recolors.length + segments) {
                setTimeout(step, stepInterval);
            } else {
                setTimeout(() => {
                    for (const g of trailNodes) g.destroy();
                }, 500);
            }
        };
        step();
    }

    // -------------------------------------------------------------------
    // COLLAPSED special-cell countdown ring. Positioned on the overlay
    // layer so it sits above everything else and doesn't interfere with
    // the underlying cell paint.
    // -------------------------------------------------------------------

    _addSpecialOverlay(x, y, type, durationMs) {
        this._removeSpecialOverlay(x, y);
        const container = new Container();
        container.x = x * this.blockPx;
        container.y = y * this.blockPx;
        const ring = new Graphics();
        const digit = new Text({
            text: '',
            style: new TextStyle({
                fill: 0xffffff,
                fontWeight: '900',
                fontSize: Math.floor(this.blockPx * 0.45),
                fontFamily: 'Arial, sans-serif',
                dropShadow: {
                    color: 0x000000,
                    alpha: 0.8,
                    blur: 2,
                    distance: 1,
                    angle: Math.PI / 4,
                },
            }),
        });
        digit.anchor.set(0.5);
        digit.x = this.blockPx / 2;
        digit.y = this.blockPx / 2;
        container.addChild(ring, digit);
        this.layers.overlay.addChild(container);

        const entry = {
            container,
            ring,
            digit,
            type,
            armedAt: performance.now(),
            durationMs,
        };
        const tick = () => {
            const remaining = Math.max(0, entry.durationMs - (performance.now() - entry.armedAt));
            const pct = entry.durationMs > 0 ? Math.max(0, remaining / entry.durationMs) : 0;
            ring.clear();
            const cx = this.blockPx / 2;
            const cy = this.blockPx / 2;
            const r = this.blockPx * 0.42;
            if (pct > 0.001) {
                ring.moveTo(cx, cy)
                    .arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct)
                    .lineTo(cx, cy)
                    .closePath()
                    .fill({ color: 0xffffff, alpha: 0.25 });
            }
            ring.circle(cx, cy, r)
                .stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
            digit.text = String(Math.ceil(remaining / 1000));
            if (remaining <= 0) entry.running = false;
        };
        tick();
        entry.running = true;
        entry.tickFn = tick;
        entry.tickHandle = setInterval(() => { if (entry.running) tick(); }, 100);
        this._specialOverlays.set(`${x},${y}`, entry);
    }

    _removeSpecialOverlay(x, y) {
        const key = `${x},${y}`;
        const entry = this._specialOverlays.get(key);
        if (!entry) return;
        entry.running = false;
        if (entry.tickHandle) clearInterval(entry.tickHandle);
        entry.container.destroy({ children: true });
        this._specialOverlays.delete(key);
    }

    _moveSpecialOverlay(fromX, fromY, toX, toY) {
        const key = `${fromX},${fromY}`;
        const entry = this._specialOverlays.get(key);
        if (!entry) return;
        this._specialOverlays.delete(key);
        entry.container.x = toX * this.blockPx;
        entry.container.y = toY * this.blockPx;
        this._specialOverlays.set(`${toX},${toY}`, entry);
    }

    _clearAllSpecialOverlays() {
        for (const entry of this._specialOverlays.values()) {
            entry.running = false;
            if (entry.tickHandle) clearInterval(entry.tickHandle);
            entry.container.destroy({ children: true });
        }
        this._specialOverlays.clear();
    }

    // -------------------------------------------------------------------
    // Click -> cell coord translation. Matches the DOM handler behavior:
    // only filled cells respond; handler dispatches to state.clickCell.
    // -------------------------------------------------------------------

    _handleCanvasClick(ev) {
        if (!this.state || this.state.gameOver) return;
        const canvas = this.app.canvas;
        const rect = canvas.getBoundingClientRect();
        // CSS-pixels -> canvas-pixels (the canvas may be scaled when
        // the window is narrower than HUD_W).
        const scaleX = rect.width / HUD_W;
        const scaleY = rect.height / HUD_H;
        // Strip the boardRoot offset so the coordinate is local to the
        // board's top-left instead of the canvas's.
        const px = (ev.clientX - rect.left) / scaleX - (this.boardRoot?.x || 0);
        const py = (ev.clientY - rect.top) / scaleY - (this.boardRoot?.y || 0);
        const cx = Math.floor(px / this.blockPx);
        const cy = Math.floor(py / this.blockPx);
        if (cx < 0 || cy < 0 || cx >= this.state.cols || cy >= this.state.rows) return;
        if (!this.state.board[cy][cx]) return;
        if (typeof this.state.clickCell === 'function') {
            this.state.clickCell(cx, cy);
        }
    }

    // -------------------------------------------------------------------
    // HUD (Pixi). Text nodes and preview cell grids built in _buildHud()
    // are mutated in-place on state events; no DOM HUD when Pixi owns it.
    // -------------------------------------------------------------------

    _updateHUD() {
        if (!this.hud) return;
        if (this.hud.scoreValue)
            this.hud.scoreValue.text = String(this.state.score);
        if (this.hud.levelValue)
            this.hud.levelValue.text = String(this.state.level);
        if (this.hud.linesValue)
            this.hud.linesValue.text = String(this.state.lines);
        if (this.hud.multiplierValue) {
            const total = this.state.level * (this.state.sizeMultiplier || 1);
            this.hud.multiplierValue.text = `x${total.toFixed(1)}`;
        }
        if (this.hud.levelProgress) {
            const into = this.state.lines % LINES_PER_LEVEL;
            this.hud.levelProgress.text = `${into} / ${LINES_PER_LEVEL} lines`;
        }
        if (this.hud.levelInfo && typeof this._levelInfoFor === 'function') {
            this.hud.levelInfo.text = this._levelInfoFor(this.state.level);
        }
        this._updateControlHint();
    }

    _flashScore() {
        const t = this.hud?.scoreValue;
        if (!t) return;
        // Brief scale pop. Reuses the tween system so no timers leak.
        // _tickTweens expects {elapsed, duration, update(p), done()} --
        // same shape as every other tween in this file.
        this._addTween({
            elapsed: 0,
            duration: 260,
            update: (p) => {
                const s = 1 + 0.2 * Math.sin(p * Math.PI);
                t.scale.set(s);
            },
            done: () => t.scale.set(1),
        });
    }

    _paintPreview(preview, piece) {
        if (!preview) return;
        const { cells, size } = preview;
        for (let i = 0; i < 16; i++) this._paintPreviewCell(cells[i], size, null);
        if (!piece) return;
        const { shape, colorMatrix } = piece;
        for (let y = 0; y < Math.min(shape.length, 4); y++) {
            for (let x = 0; x < Math.min(shape[y].length, 4); x++) {
                if (!shape[y][x]) continue;
                const color = colorMatrix[y][x];
                if (!color) continue;
                this._paintPreviewCell(cells[y * 4 + x], size, color);
            }
        }
    }

    _updatePreviews() {
        if (!this.hud) return;
        this._paintPreview(this.hud.previewNext, this.state.nextPiece);
        const coming = this.hud.previewComing || [];
        for (let i = 0; i < coming.length; i++) {
            this._paintPreview(coming[i], this.state.pieceQueue[i + 1]);
        }
    }

    // -------------------------------------------------------------------
    // Event wiring: maps GameState events to board/HUD updates.
    // -------------------------------------------------------------------

    _bindState() {
        const s = this.state;
        s.on('game-started', () => {
            this._clearAllSpecialOverlays();
            this.createBoard();
            this._updateHUD();
            this._updatePreviews();
            this._paintActivePiece();
        });
        s.on('piece-spawned', () => {
            this._updatePreviews();
            this._paintActivePiece();
        });
        s.on('piece-moved', () => this._paintActivePiece());
        s.on('piece-rotated', () => this._paintActivePiece());
        s.on('piece-hard-dropped', () => this._paintActivePiece());
        s.on('piece-locked', () => {
            this._clearActiveLayer();
            this._redrawBoard();
            this._reactStar('lock');
        });
        s.on('match-detected', ({ cells, color, special }) => {
            for (let i = 0; i < cells.length; i++) {
                const m = cells[i];
                this._addExplosionEffect(m.x, m.y, m.color || color);
            }
            // A 4-cell match in COLLAPSED spawns a snake; the snake run
            // has its own star reaction (see snake-activated below), so
            // suppress the generic 'match' one. Mirrors the DOM guard in
            // main.js:166-170.
            if (special && special.type === 'snake') return;
            this._reactStar('match');
        });
        s.on('match-cleared', () => {
            this._redrawBoard();
            this._updateHUD();
            this._flashScore();
        });
        s.on('bomb-detonating', ({ cells }) => {
            for (let i = 0; i < cells.length; i++) {
                const c = cells[i];
                this._addBombEffect(c.x, c.y);
            }
            this._reactStar('bomb');
        });
        s.on('bomb-exploded', () => {
            this._redrawBoard();
            this._updateHUD();
            this._flashScore();
        });
        s.on('snake-activated', (plan) => {
            this._animateSnake(plan);
            this._reactStar('snake');
        });
        s.on('gravity-applied', () => this._redrawBoard());
        s.on('floating-changed', () => this._redrawBoard());
        s.on('lines-cleared', () => {
            this._redrawBoard();
            this._updateHUD();
            this._reactStar('line');
        });
        s.on('score-changed', () => this._updateHUD());
        s.on('level-up', () => this._reactStar('levelup'));
        s.on('game-over', () => this._reactStar('gameover'));
        s.on('special-armed', ({ x, y, type, durationMs }) => {
            this._addSpecialOverlay(x, y, type, durationMs);
        });
        s.on('special-cleared', ({ x, y }) => this._removeSpecialOverlay(x, y));
        s.on('special-expired', ({ x, y }) => {
            this._removeSpecialOverlay(x, y);
            this._redrawBoard();
        });
        s.on('special-moved', ({ fromX, fromY, toX, toY }) => {
            this._moveSpecialOverlay(fromX, fromY, toX, toY);
        });
        s.on('special-cleared-all', () => this._clearAllSpecialOverlays());
        s.on('game-over', () => this._clearAllSpecialOverlays());
    }

    // -------------------------------------------------------------------
    // HUD construction. Runs once in init(); panels are reused for every
    // game. Mirrors the DOM layout exactly (see .game-title-bar,
    // .hud-column, .hologram-panel in index.html).
    // -------------------------------------------------------------------

    _buildHud() {
        const root = new Container();
        this.app.stage.addChild(root);

        const titleBar = this._buildTitleBar();
        titleBar.y = 0;
        root.addChild(titleBar);

        // Left column (level + previews)
        const leftCol = new Container();
        leftCol.x = LEFT_X;
        leftCol.y = COL_Y;
        root.addChild(leftCol);

        const levelPanel = this._buildLevelPanel();
        leftCol.addChild(levelPanel.container);

        const previewPanel = this._buildPreviewPanel();
        previewPanel.container.y = levelPanel.height + 8;
        leftCol.addChild(previewPanel.container);

        // Right column (score + tip + controls)
        const rightCol = new Container();
        rightCol.x = RIGHT_X;
        rightCol.y = COL_Y;
        root.addChild(rightCol);

        const scorePanel = this._buildScorePanel();
        rightCol.addChild(scorePanel.container);

        const tipsPanel = this._buildTipsPanel();
        tipsPanel.container.y = scorePanel.height + 8;
        rightCol.addChild(tipsPanel.container);

        const controlsPanel = this._buildControlsPanel();
        controlsPanel.container.y = scorePanel.height + 8 + tipsPanel.height + 8;
        rightCol.addChild(controlsPanel.container);

        this.hud = {
            root,
            titleBar,
            star: titleBar.star,
            starBase: titleBar.starBase,
            starTitle: titleBar.titleText,
            // Level panel
            levelValue: levelPanel.value,
            levelInfo: levelPanel.info,
            levelProgress: levelPanel.progress,
            // Preview panels
            previewNext: previewPanel.next,
            previewComing: previewPanel.coming,
            // Score panel
            scoreValue: scorePanel.score,
            linesValue: scorePanel.lines,
            multiplierValue: scorePanel.multiplier,
            // Tip panel
            tipText: tipsPanel.text,
            // Controls panel
            matchControlHintText: controlsPanel.matchHint,
        };
    }

    // ---- Title bar with reactive star ---------------------------------

    _buildTitleBar() {
        const c = new Container();

        // Center the title horizontally across the whole HUD.
        const star = this._drawStarShape(28, 0xfacc15);
        star.x = HUD_W / 2 - 180;
        star.y = TITLE_H / 2;
        c.addChild(star);

        // Soft glow behind the star (larger, alpha-faded, untouched by
        // the reaction tween so the aura always stays lit).
        const starBase = new Graphics();
        starBase.circle(0, 0, 26).fill({ color: 0xfde68a, alpha: 0.22 });
        starBase.circle(0, 0, 16).fill({ color: 0xfacc15, alpha: 0.35 });
        starBase.x = star.x;
        starBase.y = star.y;
        // Draw aura BEHIND the star shape.
        c.addChildAt(starBase, 0);

        // "STELLAR COLLAPSE" gradient text. FillGradient is linear in
        // Pixi v8; the cyan -> yellow -> coral diagonal reads as the
        // same signature palette as the DOM.
        const titleGradient = new FillGradient(0, 0, 520, 0);
        titleGradient.addColorStop(0, 0x22d3ee);
        titleGradient.addColorStop(0.5, 0xfacc15);
        titleGradient.addColorStop(1, 0xf87171);
        const title = new Text({
            text: 'STELLAR COLLAPSE',
            style: new TextStyle({
                fontFamily: 'Inter, "Segoe UI", sans-serif',
                fontSize: 38,
                fontWeight: '700',
                letterSpacing: 2,
                fill: titleGradient,
                dropShadow: {
                    color: 0xfacc15,
                    alpha: 0.35,
                    blur: 8,
                    distance: 0,
                    angle: 0,
                },
            }),
        });
        title.anchor.set(0, 0.5);
        title.x = star.x + 28;
        title.y = TITLE_H / 2;
        c.addChild(title);

        c.star = star;
        c.starBase = starBase;
        c.titleText = title;
        return c;
    }

    _drawStarShape(r, color) {
        // Five-pointed star as a single Graphics. Cached as-is; we
        // tween the parent container's scale/rotation/tint for the
        // reactions so we don't have to redraw the geometry.
        const g = new Graphics();
        const spikes = 5;
        const inner = r * 0.42;
        let rot = -Math.PI / 2;
        const step = Math.PI / spikes;
        const pts = [];
        for (let i = 0; i < spikes; i++) {
            pts.push(Math.cos(rot) * r, Math.sin(rot) * r);
            rot += step;
            pts.push(Math.cos(rot) * inner, Math.sin(rot) * inner);
            rot += step;
        }
        g.poly(pts).fill({ color });
        g.pivot.set(0, 0);
        return g;
    }

    // ---- Hologram panel backdrop (shared by every panel) --------------

    _drawHologramPanel(w, h, { accent = 0x00d4ff } = {}) {
        const c = new Container();
        // Two-stop vertical gradient from deep navy to near-black so
        // the panel reads through the starfield without going opaque.
        // Pixi v8 fill() rejects `{color: <FillGradient>}` -- pass the
        // gradient positionally and control alpha on the Graphics node.
        const grad = new FillGradient(0, 0, 0, h);
        grad.addColorStop(0, PANEL_BG_TOP);
        grad.addColorStop(1, PANEL_BG_BOT);
        const bgFill = new Graphics();
        bgFill.roundRect(0, 0, w, h, 6).fill(grad);
        bgFill.alpha = 0.65;
        c.addChild(bgFill);
        // Thin cyan border + outer glow.
        const bg = new Graphics();
        bg.roundRect(0, 0, w, h, 6).stroke({ color: accent, width: 1, alpha: PANEL_BORDER_ALPHA });
        c.addChild(bg);

        // Subtle scanline overlay (matches .hologram-panel::before).
        // A single semi-opaque full-width rect is cheaper than drawing
        // per-line striping; the DOM effect was already very faint.
        const scan = new Graphics();
        for (let y = 1; y < h; y += 3) {
            scan.rect(1, y, w - 2, 1).fill({ color: accent, alpha: 0.04 });
        }
        c.addChild(scan);

        return c;
    }

    _panelLabel(text, color, { size = 12, weight = '700' } = {}) {
        return new Text({
            text,
            style: new TextStyle({
                fontFamily: 'Inter, "Segoe UI", sans-serif',
                fontSize: size,
                fontWeight: weight,
                letterSpacing: 1,
                fill: color,
                dropShadow: {
                    color, alpha: 0.6, blur: 6, distance: 0, angle: 0,
                },
            }),
        });
    }

    _panelValue(text, color = 0x00d4ff, { size = 28 } = {}) {
        // "score-display" style: cyan neon, monospaced.
        const t = new Text({
            text,
            style: new TextStyle({
                fontFamily: '"Courier New", monospace',
                fontSize: size,
                fontWeight: '700',
                letterSpacing: 2,
                fill: color,
                dropShadow: {
                    color, alpha: 0.8, blur: 10, distance: 0, angle: 0,
                },
            }),
        });
        t.anchor.set(0.5, 0);
        return t;
    }

    // ---- Level panel --------------------------------------------------

    _buildLevelPanel() {
        const w = COL_W;
        const h = 110;
        const container = this._drawHologramPanel(w, h);

        const label = this._panelLabel('LEVEL', COLOR_BLUE_300);
        label.anchor.set(0.5, 0);
        label.x = w / 2;
        label.y = 10;
        container.addChild(label);

        const value = this._panelValue('1', 0x00d4ff, { size: 28 });
        value.x = w / 2;
        value.y = 26;
        container.addChild(value);

        const info = new Text({
            text: 'Cosmic Dust',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fill: COLOR_BLUE_200,
            }),
        });
        info.anchor.set(0.5, 0);
        info.x = w / 2;
        info.y = 66;
        container.addChild(info);

        const progress = new Text({
            text: `0 / ${LINES_PER_LEVEL} lines`,
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 10,
                fill: COLOR_BLUE_300,
            }),
        });
        progress.anchor.set(0.5, 0);
        progress.x = w / 2;
        progress.y = 86;
        container.addChild(progress);

        return { container, value, info, progress, height: h };
    }

    // ---- Preview panel (NEXT + COMING UP) -----------------------------

    _buildPreviewPanel() {
        const w = COL_W;
        // Heights picked so the panel sits flush above COL_Y + 720. We
        // have 720 - levelPanel.h - 8 = 602 available.
        const h = 602;
        const container = this._drawHologramPanel(w, h);

        const nextLabel = this._panelLabel('NEXT', COLOR_CYAN_300, { size: 14 });
        nextLabel.anchor.set(0.5, 0);
        nextLabel.x = w / 2;
        nextLabel.y = 8;
        container.addChild(nextLabel);

        // Big NEXT preview: 4x4 grid of 24px cells.
        const next = this._buildPreviewGrid(24);
        next.container.x = (w - 24 * 4) / 2;
        next.container.y = 30;
        container.addChild(next.container);

        const upLabel = this._panelLabel('COMING UP', COLOR_CYAN_400, { size: 11 });
        upLabel.anchor.set(0.5, 0);
        upLabel.x = w / 2;
        upLabel.y = 30 + 24 * 4 + 10;
        container.addChild(upLabel);

        // Three small 4x4 grids of 14px cells, stacked vertically.
        const coming = [];
        let yCursor = upLabel.y + 16;
        for (let i = 0; i < 3; i++) {
            const g = this._buildPreviewGrid(14);
            g.container.x = (w - 14 * 4) / 2;
            g.container.y = yCursor;
            container.addChild(g.container);
            coming.push(g);
            yCursor += 14 * 4 + 10;
        }

        return { container, next, coming, height: h };
    }

    _buildPreviewGrid(cellPx) {
        const container = new Container();
        const cells = [];
        for (let i = 0; i < 16; i++) {
            const g = new Graphics();
            const x = (i % 4) * cellPx;
            const y = Math.floor(i / 4) * cellPx;
            g.x = x;
            g.y = y;
            container.addChild(g);
            cells.push(g);
            // Paint the empty slot look once up-front.
            this._paintPreviewCell(g, cellPx, null);
        }
        return { container, cells, size: cellPx };
    }

    _paintPreviewCell(g, size, color) {
        g.clear();
        if (!color) {
            g.roundRect(1, 1, size - 2, size - 2, 2).fill({ color: 0x0a1a2a, alpha: 0.5 });
            g.roundRect(1, 1, size - 2, size - 2, 2).stroke({ color: 0x1e3a5c, width: 1, alpha: 0.5 });
            return;
        }
        const pal = CELL_PALETTE[color];
        if (!pal) return;
        const pad = 1;
        const w = size - pad * 2;
        // Diagonal body fill (same as full-size cell, downscaled).
        const bodyGrad = new FillGradient(0, 0, w, w);
        bodyGrad.addColorStop(0, pal.linearStart);
        bodyGrad.addColorStop(1, pal.linearEnd);
        g.roundRect(pad, pad, w, w, 3).fill(bodyGrad);
        // Highlight spot + border.
        g.circle(pad + w * 0.3, pad + w * 0.3, w * 0.25).fill({ color: pal.highlight, alpha: 0.55 });
        // Match the full-size cell's border: CELL_PALETTE has no
        // `border` field, the dark edge comes from `shadow`.
        g.roundRect(pad, pad, w, w, 3).stroke({ color: pal.shadow, width: 1, alpha: 0.9 });
    }

    // ---- Score / Lines / Multiplier panel -----------------------------

    _buildScorePanel() {
        const w = COL_W;
        const h = 210;
        const container = this._drawHologramPanel(w, h);

        let yCursor = 10;
        const labelScore = this._panelLabel('SCORE', COLOR_YELLOW_300);
        labelScore.anchor.set(0.5, 0);
        labelScore.x = w / 2;
        labelScore.y = yCursor;
        container.addChild(labelScore);
        yCursor += 16;

        const score = this._panelValue('0', 0x00d4ff, { size: 26 });
        score.x = w / 2;
        score.y = yCursor;
        container.addChild(score);
        yCursor += 44;

        const div1 = new Graphics().rect(12, yCursor, w - 24, 1).fill({ color: 0x0e3a52 });
        container.addChild(div1);
        yCursor += 6;

        const labelLines = this._panelLabel('LINES', COLOR_GREEN_300);
        labelLines.anchor.set(0.5, 0);
        labelLines.x = w / 2;
        labelLines.y = yCursor;
        container.addChild(labelLines);
        yCursor += 16;

        const lines = this._panelValue('0', 0x00d4ff, { size: 24 });
        lines.x = w / 2;
        lines.y = yCursor;
        container.addChild(lines);
        yCursor += 40;

        const div2 = new Graphics().rect(12, yCursor, w - 24, 1).fill({ color: 0x0e3a52 });
        container.addChild(div2);
        yCursor += 6;

        const labelMult = this._panelLabel('MULTIPLIER', COLOR_PINK_300);
        labelMult.anchor.set(0.5, 0);
        labelMult.x = w / 2;
        labelMult.y = yCursor;
        container.addChild(labelMult);
        yCursor += 16;

        const multiplier = this._panelValue('x1.0', 0xf9a8d4, { size: 22 });
        multiplier.x = w / 2;
        multiplier.y = yCursor;
        container.addChild(multiplier);

        return { container, score, lines, multiplier, height: h };
    }

    // ---- Mission tip panel --------------------------------------------

    _buildTipsPanel() {
        const w = COL_W;
        const h = 140;
        const container = this._drawHologramPanel(w, h);

        const label = this._panelLabel('MISSION TIP', COLOR_CYAN_300, { size: 13 });
        label.anchor.set(0.5, 0);
        label.x = w / 2;
        label.y = 10;
        container.addChild(label);

        const text = new Text({
            text: 'Drop pieces to clear lines and climb the tier.',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 12,
                fill: 0xcfe9ff,
                align: 'center',
                wordWrap: true,
                wordWrapWidth: w - 16,
                leading: 2,
            }),
        });
        text.anchor.set(0.5, 0);
        text.x = w / 2;
        text.y = 30;
        container.addChild(text);

        return { container, text, height: h };
    }

    // ---- Controls panel -----------------------------------------------

    _buildControlsPanel() {
        const w = COL_W;
        // Whatever's left in the column after score + tip + gaps.
        const h = BOARD_SLOT_H - 210 - 140 - 16;
        const container = this._drawHologramPanel(w, h);

        const label = this._panelLabel('CONTROLS', COLOR_CYAN_300, { size: 13 });
        label.anchor.set(0.5, 0);
        label.x = w / 2;
        label.y = 10;
        container.addChild(label);

        const lines = [
            { icon: '\u21ba', label: 'Rotate' },
            { icon: '\u2190', label: 'Move Left' },
            { icon: '\u2192', label: 'Move Right' },
            { icon: '\u2193', label: 'Soft Drop' },
            { icon: '\u2423', label: 'Hard Drop' },
            // Last row text is dynamic (auto-match vs click-match vs
            // disabled); we track the Text instance to swap the label
            // when state.mode changes.
            { icon: '\u2316', label: 'Match 4+ Colors', dynamic: true },
        ];
        let yCursor = 32;
        let matchHint = null;
        for (const row of lines) {
            const icon = new Text({
                text: row.icon,
                style: new TextStyle({
                    fontFamily: '"Segoe UI Symbol", "Arial Unicode MS", sans-serif',
                    fontSize: 14,
                    fontWeight: '700',
                    fill: COLOR_YELLOW_300,
                }),
            });
            icon.x = 14;
            icon.y = yCursor;
            container.addChild(icon);

            const txt = new Text({
                text: row.label,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 12,
                    fill: 0xcfe9ff,
                }),
            });
            txt.x = 38;
            txt.y = yCursor + 1;
            container.addChild(txt);

            if (row.dynamic) matchHint = txt;
            yCursor += 22;
        }

        return { container, matchHint, height: h };
    }

    // ---- Board frame --------------------------------------------------

    _drawBoardFrame(w, h) {
        if (!this.boardRoot) return;
        // Frame is drawn once per createBoard and lives behind the
        // cell layers. Clean up the previous frame if there is one.
        if (this._boardFrame) {
            this._boardFrame.destroy({ children: true });
            this._boardFrame = null;
        }
        if (this._scannerGrid) {
            this._scannerGrid.destroy({ children: true });
            this._scannerGrid = null;
        }
        const frame = new Graphics();
        // Very low-alpha navy fill so the board reads as a distinct
        // window onto space without fully blocking the starfield
        // behind it. The grid is no longer painted statically --
        // _tickScanner reveals rows/cols as the scanner band passes.
        frame.roundRect(-2, -2, w + 4, h + 4, 8).fill({ color: 0x03132b, alpha: 0.25 });
        // Cyan outline with soft glow (matches the old .game-container).
        frame.roundRect(-2, -2, w + 4, h + 4, 8).stroke({ color: 0x00d4ff, width: 2, alpha: 0.75 });
        this._boardFrame = frame;
        this.boardRoot.addChildAt(frame, 0);

        // Scanner-reveal grid: sits above the frame but below the
        // cell + active layers so locked pieces always draw on top.
        // The graphics object is cleared and rebuilt each tick with
        // alpha falloff around the scanner's current Y.
        const scanner = new Graphics();
        this._scannerGrid = scanner;
        this._scannerW = w;
        this._scannerH = h;
        // Reset scanner clock so every new run starts at the top.
        this._scannerY = 0;
        // Insert right after the frame (index 1) so it draws behind
        // the board/active/effects/overlay layers.
        this.boardRoot.addChildAt(scanner, 1);
    }

    // ---- Scanner sweep ------------------------------------------------
    //
    // Animates a horizontal scanner band top -> bottom, redrawing grid
    // lines with an alpha falloff around its current Y. The effect is
    // "grid scanned into existence" -- outside the band the board is
    // pure space (starfield shows through).

    _tickScanner(dtMs) {
        const g = this._scannerGrid;
        if (!g || !dtMs || dtMs <= 0) return;
        const h = this._scannerH;
        const w = this._scannerW;
        if (!h || !w) return;

        // Band sweep: constant pixels-per-second so the cadence feels
        // the same across field sizes. Loop a little past the bottom
        // so the lower rows get fully revealed before reset.
        const SPEED_PX_S = 120;
        const BAND_HALF = 60; // pixels of reveal radius around scanY
        this._scannerY += (SPEED_PX_S * dtMs) / 1000;
        if (this._scannerY > h + BAND_HALF) {
            this._scannerY = -BAND_HALF;
        }
        const scanY = this._scannerY;

        // Rebuild the reveal lines. We clear/redraw every frame --
        // with a 15x28 board that's ~(15+28)+vertical-segments*16
        // stroke ops, well under Pixi's batcher threshold.
        g.clear();
        const bp = this.blockPx;
        const color = 0x67e8f9; // cyan-300, matches HUD accents
        const bandColor = 0x00d4ff;

        // Soft cyan glow band behind the revealed grid -- reads as
        // the scanner's physical beam.
        const bandTop = Math.max(0, scanY - BAND_HALF);
        const bandBot = Math.min(h, scanY + BAND_HALF);
        if (bandBot > bandTop) {
            // Three horizontal strips with decreasing alpha to fake
            // a vertical gradient (FillGradient would work too but
            // this keeps the scanner in one Graphics so Pixi can
            // batch it).
            const strips = 6;
            for (let i = 0; i < strips; i++) {
                // Both bounds share the same denominator so strips are
                // contiguous (the previous code mixed 1/(strips-1) with
                // 1/strips, leaving ~15% gaps and a zero-height last
                // strip -- flagged by Devin Review on #20).
                const y0 = bandTop + (bandBot - bandTop) * (i / strips);
                const y1 = bandTop + (bandBot - bandTop) * ((i + 1) / strips);
                const d = Math.abs((y0 + y1) * 0.5 - scanY) / BAND_HALF;
                const alpha = 0.10 * (1 - d) * (1 - d);
                if (alpha <= 0) continue;
                g.rect(0, y0, w, y1 - y0).fill({ color: bandColor, alpha });
            }
            // Leading-edge bright line at the center of the band.
            g.moveTo(0, scanY).lineTo(w, scanY).stroke({
                color: 0xbef7ff, width: 1.5, alpha: 0.85,
            });
        }

        // Horizontal grid lines: one stroke per row boundary, alpha
        // ramped by distance to the band center.
        for (let gy = 0; gy <= this.state.rows; gy++) {
            const y = gy * bp;
            const d = Math.abs(y - scanY);
            if (d > BAND_HALF) continue;
            const t = 1 - d / BAND_HALF;
            const alpha = 0.85 * t * t;
            g.moveTo(0, y).lineTo(w, y).stroke({ color, width: 1.2, alpha });
        }

        // Vertical grid lines: only the portion inside the band, split
        // into short segments so each segment gets an alpha matching
        // its distance to scanY (gives the smooth fade-in/out).
        const y1 = Math.max(0, scanY - BAND_HALF);
        const y2 = Math.min(h, scanY + BAND_HALF);
        if (y2 > y1) {
            const SEG = 8;
            for (let gx = 0; gx <= this.state.cols; gx++) {
                const x = gx * bp;
                for (let i = 0; i < SEG; i++) {
                    const ya = y1 + ((y2 - y1) * i) / SEG;
                    const yb = y1 + ((y2 - y1) * (i + 1)) / SEG;
                    const midY = (ya + yb) * 0.5;
                    const d = Math.abs(midY - scanY);
                    if (d > BAND_HALF) continue;
                    const t = 1 - d / BAND_HALF;
                    const alpha = 0.85 * t * t;
                    if (alpha < 0.02) continue;
                    g.moveTo(x, ya).lineTo(x, yb).stroke({
                        color, width: 1.2, alpha,
                    });
                }
            }
        }
    }

    // ---- Control hint (auto-match / click-match / disabled) -----------

    _updateControlHint() {
        const t = this.hud?.matchControlHintText;
        if (!t) return;
        const mode = this.state.mode;
        // Mode strings come from GAME_MODES in constants.js: STELLAR
        // is 'stellar', AUTO_MATCH is 'auto-match', BLOCKS is 'blocks'.
        if (mode === 'blocks') t.text = 'Match disabled';
        else if (mode === 'auto-match') t.text = 'Auto-Match 4+ Colors';
        else t.text = 'Match 4+ Colors';
    }

    // ---- Public: set mission tip text from main.js --------------------

    setTip(text) {
        if (this.hud?.tipText) this.hud.tipText.text = text;
    }

    // ---- Title-star reactions -----------------------------------------

    _reactStar(kind) {
        const star = this.hud?.star;
        if (!star) return;
        const cfg = STAR_REACTIONS[kind];
        if (!cfg) return;
        // Reset base transform before kicking off a new reaction so the
        // animation starts from a known state (avoids stacking tints /
        // scales / positions if two events land on the same frame --
        // the 'fall' kind is the only one that mutates star.y but the
        // reset has to cover it or a subsequent reaction starts low).
        star.scale.set(1);
        star.rotation = 0;
        star.y = TITLE_H / 2;
        star.tint = cfg.color;

        this._starReactionTween = {
            elapsed: 0,
            duration: cfg.duration,
            kind: cfg.kind,
            color: cfg.color,
        };
    }

    _tickStar(deltaMs) {
        const star = this.hud?.star;
        if (!star) return;
        const r = this._starReactionTween;
        if (!r) {
            // Idle breathing pulse. Same period as the DOM animation.
            const t = (this._clockMs % 3500) / 3500;
            const s = 1 + Math.sin(t * Math.PI * 2) * 0.04;
            star.scale.set(s);
            return;
        }
        r.elapsed += deltaMs;
        const p = Math.min(1, r.elapsed / r.duration);
        switch (r.kind) {
            case 'pop':
                star.scale.set(1 + 0.25 * Math.sin(p * Math.PI));
                break;
            case 'pop-big':
                star.scale.set(1 + 0.5 * Math.sin(p * Math.PI));
                break;
            case 'spin':
                star.scale.set(1 + 0.35 * Math.sin(p * Math.PI));
                star.rotation = Math.sin(p * Math.PI) * 0.35;
                break;
            case 'shake':
                star.scale.set(1 + 0.3 * Math.sin(p * Math.PI));
                star.rotation = Math.sin(p * Math.PI * 8) * 0.15 * (1 - p);
                break;
            case 'wobble':
                star.scale.set(1 + 0.25 * Math.sin(p * Math.PI));
                star.rotation = Math.sin(p * Math.PI * 4) * 0.45 * (1 - p);
                break;
            case 'fall':
                star.rotation = p * Math.PI * 0.6;
                star.scale.set(1 - 0.3 * p);
                star.y = (TITLE_H / 2) + p * 8;
                break;
            case 'burst':
                star.scale.set(1 + 0.6 * Math.sin(p * Math.PI));
                star.rotation = Math.sin(p * Math.PI) * 0.25;
                break;
            default:
                star.scale.set(1 + 0.2 * Math.sin(p * Math.PI));
        }
        if (p >= 1) {
            star.scale.set(1);
            star.rotation = 0;
            star.tint = 0xfacc15;
            star.y = TITLE_H / 2;
            this._starReactionTween = null;
        }
    }
}

export const _SNAKE_LENGTH = SNAKE_LENGTH;
