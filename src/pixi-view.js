// Pixi.js-based board renderer. Replaces the DOM grid (see
// game-view.js) while keeping the same public surface: subscribes to
// GameState events, owns the `#gameContainer` mount, and leaves the
// surrounding HUD / previews / start screen as DOM. The GameState
// module remains pure -- this file is the only one that touches Pixi.
//
// Public API mirrors GameView so main.js swaps implementations with a
// single import change:
//   const view = new PixiView({ state, elements });
//   await view.init();          // <-- extra async bootstrap step
//   view.createBoard();
//   view.createPreviews();
//   view._levelInfoFor = ...;   // optional HUD formatter
//
// Everything after `init()` is identical to GameView from main.js's
// perspective.

import {
    Application,
    Container,
    FillGradient,
    Graphics,
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
            // Placeholder size; createBoard() calls renderer.resize().
            width: 320,
            height: 640,
        });
        this.app = app;

        // Mount into #gameContainer. Wipe any DOM children (the old
        // board/active/effects divs) so the canvas takes the full
        // bounding box.
        const mount = this.el.container;
        if (mount) {
            mount.innerHTML = '';
            mount.appendChild(app.canvas);
            app.canvas.style.display = 'block';
        }

        // Z-order: board (locked pieces) -> active (falling piece) ->
        // effects (transient FX) -> overlay (countdown rings).
        this.layers.board = new Container();
        this.layers.active = new Container();
        this.layers.effects = new Container();
        this.layers.overlay = new Container();
        app.stage.addChild(
            this.layers.board,
            this.layers.active,
            this.layers.effects,
            this.layers.overlay,
        );

        // Single ticker: advances the clock, drives pulse animations on
        // bomb/snake cells, and runs the effects/particle tweens.
        app.ticker.add((ticker) => {
            this._clockMs += ticker.deltaMS;
            this._tickPulse();
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
        this.app.renderer.resize(w, h);
        if (this.el.container) {
            this.el.container.style.width = `${w}px`;
            this.el.container.style.height = `${h}px`;
        }

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

    // Previews stay in DOM for this pass (PR #15 scope). Keep the
    // signature so main.js doesn't branch on which view it got.
    createPreviews() {
        const { nextPreview, smallPreviews } = this.el;
        const fillGrid = (container) => {
            if (!container) return;
            container.innerHTML = '';
            const frag = document.createDocumentFragment();
            for (let i = 0; i < 16; i++) {
                const cell = document.createElement('div');
                cell.className = 'cell preview-slot';
                frag.appendChild(cell);
            }
            container.appendChild(frag);
        };
        fillGrid(nextPreview);
        smallPreviews.forEach(fillGrid);
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
        // Floating detection (COLLAPSED only) -- same rule as GameView.
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
        const rect = this.app.canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const cx = Math.floor(px / (rect.width / this.state.cols));
        const cy = Math.floor(py / (rect.height / this.state.rows));
        if (cx < 0 || cy < 0 || cx >= this.state.cols || cy >= this.state.rows) return;
        if (!this.state.board[cy][cx]) return;
        if (typeof this.state.clickCell === 'function') {
            this.state.clickCell(cx, cy);
        }
    }

    // -------------------------------------------------------------------
    // HUD (DOM). Identical to GameView's HUD path since the HUD stays
    // in DOM for this renderer.
    // -------------------------------------------------------------------

    _updateHUD() {
        if (this.el.score)  this.el.score.textContent = String(this.state.score);
        if (this.el.level)  this.el.level.textContent = String(this.state.level);
        if (this.el.lines)  this.el.lines.textContent = String(this.state.lines);
        if (this.el.multiplier) {
            const total = this.state.level * (this.state.sizeMultiplier || 1);
            this.el.multiplier.textContent = `x${total.toFixed(1)}`;
        }
        if (this.el.levelProgress) {
            const into = this.state.lines % LINES_PER_LEVEL;
            this.el.levelProgress.textContent = `${into} / ${LINES_PER_LEVEL} lines`;
        }
        if (this.el.levelInfo && typeof this._levelInfoFor === 'function') {
            this.el.levelInfo.textContent = this._levelInfoFor(this.state.level);
        }
    }

    _flashScore() {
        const el = this.el.score;
        if (!el) return;
        el.classList.add('score-animation');
        setTimeout(() => el.classList.remove('score-animation'), 500);
    }

    _paintPreview(container, piece) {
        if (!container) return;
        const cells = container.children;
        for (let i = 0; i < cells.length; i++) {
            cells[i].className = 'cell preview-slot';
        }
        if (!piece) return;
        const { shape, colorMatrix } = piece;
        for (let y = 0; y < Math.min(shape.length, 4); y++) {
            for (let x = 0; x < Math.min(shape[y].length, 4); x++) {
                if (!shape[y][x]) continue;
                const color = colorMatrix[y][x];
                if (!color) continue;
                const idx = y * 4 + x;
                const cell = cells[idx];
                if (cell) cell.className = `cell preview-slot filled ${color}`;
            }
        }
    }

    _updatePreviews() {
        this._paintPreview(this.el.nextPreview, this.state.nextPiece);
        (this.el.smallPreviews || []).forEach((previewEl, index) => {
            this._paintPreview(previewEl, this.state.pieceQueue[index + 1]);
        });
    }

    // -------------------------------------------------------------------
    // Event wiring: same contract as GameView so no GameState changes.
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
        });
        s.on('match-detected', ({ cells, color }) => {
            for (let i = 0; i < cells.length; i++) {
                const m = cells[i];
                this._addExplosionEffect(m.x, m.y, m.color || color);
            }
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
        });
        s.on('bomb-exploded', () => {
            this._redrawBoard();
            this._updateHUD();
            this._flashScore();
        });
        s.on('snake-activated', (plan) => this._animateSnake(plan));
        s.on('gravity-applied', () => this._redrawBoard());
        s.on('floating-changed', () => this._redrawBoard());
        s.on('lines-cleared', () => {
            this._redrawBoard();
            this._updateHUD();
        });
        s.on('score-changed', () => this._updateHUD());
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
}

export const _SNAKE_LENGTH = SNAKE_LENGTH;
