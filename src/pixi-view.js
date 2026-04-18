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

// Palette. Tuned by eye to stay close to the DOM gradients without
// going through Pixi's gradient API (which would add a per-cell render
// texture and hurt the perf budget). `body` is the main fill and
// `highlight` is the lighter inset used for the top-left gloss streak.
const CELL_PALETTE = {
    red:    { body: 0xd12f1a, highlight: 0xff8a5c, shadow: 0x5a0d06 },
    blue:   { body: 0x1e6fd0, highlight: 0x6fb6ff, shadow: 0x061a3a },
    green:  { body: 0x33a84a, highlight: 0x8fe39b, shadow: 0x08331a },
    yellow: { body: 0xe0b128, highlight: 0xffe480, shadow: 0x5a3f07 },
    bomb:   { body: 0x8b0000, highlight: 0xff4a4a, shadow: 0x1a0000 },
    snake:  { body: 0x00c070, highlight: 0x7fffc8, shadow: 0x003a1f },
};

const FLOATING_COLOR = 0x7dd3fc; // cyan-300; matches the DOM outline
const HIGHLIGHT_COLOR = 0xffffff;

const EFFECT_COLORS = {
    red:    [0xff6400, 0xffc864],
    blue:   [0x0096ff, 0x64c8ff],
    green:  [0x64ff64, 0xc8ffc8],
    yellow: [0xffff64, 0xffffc8],
    bomb:   [0xff6400, 0xffc800],
    snake:  [0x00ff88, 0x00ffcc],
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
        //   boardCells[y][x] = { container, body, accent, outline, icon }
        //   activeCells[y][x] = { container, body }
        this.boardCells = [];
        this.activeCells = [];
        this.activePaintedCells = [];

        // Countdown overlays for COLLAPSED bomb/snake cells. Same
        // contract as GameView: keyed by "x,y".
        this._specialOverlays = new Map();

        // Ongoing per-frame tween handles so we can cancel on reset.
        this._tweens = new Set();
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
            // Pixi's canvas is a block element by default; the mount
            // already centers it via flex. Ensure it doesn't introduce
            // extra baseline whitespace.
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

        // Drive per-frame tweens off Pixi's ticker so we only have one
        // rAF loop for all effects.
        app.ticker.add((ticker) => this._tickTweens(ticker.deltaMS));

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
        // Keep the legacy .game-container CSS (border + box-shadow) by
        // reading the mount's bounding size from the canvas.
        if (this.el.container) {
            this.el.container.style.width = `${w}px`;
            this.el.container.style.height = `${h}px`;
        }

        // Rebuild cell pools. Tear down the previous run's nodes first.
        this.layers.board.removeChildren().forEach((c) => c.destroy({ children: true }));
        this.layers.active.removeChildren().forEach((c) => c.destroy({ children: true }));
        this.layers.effects.removeChildren().forEach((c) => c.destroy({ children: true }));
        this.layers.overlay.removeChildren().forEach((c) => c.destroy({ children: true }));
        this._specialOverlays.clear();
        this._tweens.clear();

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
    // pre-allocated body / accent / outline / icon. Paint is done by
    // toggling visibility and redrawing Graphics in _paintCell.
    // -------------------------------------------------------------------

    _makeCell(isActive = false) {
        const container = new Container();
        // Make the whole cell selectable as one hit target for clicks.
        container.eventMode = 'none';
        const body = new Graphics();
        const accent = new Graphics();
        const outline = new Graphics();
        const iconStyle = new TextStyle({
            fill: 0xffffff,
            fontWeight: '900',
            fontSize: Math.floor(this.blockPx * 0.55),
            fontFamily: 'Arial, sans-serif',
            align: 'center',
        });
        const icon = new Text({ text: '', style: iconStyle });
        icon.anchor.set(0.5);
        icon.x = this.blockPx / 2;
        icon.y = this.blockPx / 2;
        icon.visible = false;

        container.addChild(body, accent, outline, icon);
        return { container, body, accent, outline, icon, isActive };
    }

    _paintCell(node, color, opts = {}) {
        const { body, accent, outline, icon } = node;
        const size = this.blockPx;
        body.clear();
        accent.clear();
        outline.clear();
        icon.visible = false;

        if (!color) {
            node.container.visible = false;
            return;
        }
        node.container.visible = true;

        const pal = CELL_PALETTE[color] || CELL_PALETTE.red;
        // Body: main flat fill with a thin dark stroke.
        body.roundRect(1, 1, size - 2, size - 2, Math.max(2, Math.floor(size * 0.12)))
            .fill({ color: pal.body, alpha: 1 })
            .stroke({ color: pal.shadow, width: 1, alignment: 1 });
        // Accent: top-left gloss streak + bottom-right shadow triangle
        // -- approximates the DOM radial gradients cheaply.
        const inset = Math.max(2, Math.floor(size * 0.12));
        accent.moveTo(inset, inset)
            .lineTo(size - inset, inset)
            .lineTo(inset, size - inset)
            .closePath()
            .fill({ color: pal.highlight, alpha: 0.18 });
        accent.moveTo(size - inset, inset)
            .lineTo(size - inset, size - inset)
            .lineTo(inset, size - inset)
            .closePath()
            .fill({ color: pal.shadow, alpha: 0.22 });

        // Color-specific icon glyphs. Kept to ASCII/emoji-free
        // primitives so the Pixi renderer doesn't need a special font.
        if (color === 'bomb') {
            // Dark circle + lighter core.
            accent.circle(size / 2, size / 2, size * 0.28)
                .fill({ color: 0x1a0000, alpha: 0.9 });
            accent.circle(size / 2, size / 2, size * 0.18)
                .fill({ color: 0xff5a3c, alpha: 0.95 });
            // Fuse tick on top.
            accent.rect(size / 2 - 1, size * 0.08, 2, size * 0.14)
                .fill({ color: 0xffcc55, alpha: 0.9 });
        } else if (color === 'snake') {
            // Rotated diamond + inner band.
            accent.moveTo(size / 2, size * 0.18)
                .lineTo(size * 0.82, size / 2)
                .lineTo(size / 2, size * 0.82)
                .lineTo(size * 0.18, size / 2)
                .closePath()
                .fill({ color: 0x003a1f, alpha: 0.8 });
            accent.moveTo(size / 2, size * 0.3)
                .lineTo(size * 0.7, size / 2)
                .lineTo(size / 2, size * 0.7)
                .lineTo(size * 0.3, size / 2)
                .closePath()
                .fill({ color: 0x7fffc8, alpha: 0.9 });
        }

        if (opts.floating) {
            // Dashed cyan outline -- eight short segments so it reads
            // as dashed without per-frame draw calls.
            const segs = 8;
            const step = (size - 4) / segs;
            outline.setStrokeStyle({ color: FLOATING_COLOR, width: 1.5, alpha: 0.9 });
            for (let i = 0; i < segs; i++) {
                if (i % 2) continue;
                // top
                outline.moveTo(2 + i * step, 2).lineTo(2 + (i + 1) * step, 2);
                // bottom
                outline.moveTo(2 + i * step, size - 2).lineTo(2 + (i + 1) * step, size - 2);
                // left
                outline.moveTo(2, 2 + i * step).lineTo(2, 2 + (i + 1) * step);
                // right
                outline.moveTo(size - 2, 2 + i * step).lineTo(size - 2, 2 + (i + 1) * step);
            }
            outline.stroke();
        }

        if (opts.highlight) {
            outline.rect(0, 0, size, size)
                .fill({ color: HIGHLIGHT_COLOR, alpha: 0.45 });
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
            node.container.visible = false;
            node.body.clear();
            node.accent.clear();
            node.outline.clear();
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
    // Transient effects: match-explode, bomb blast, snake trail.
    // Everything animates via _addTween so there's one ticker.
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

    _addExplosionEffect(x, y, color) {
        const [c1, c2] = EFFECT_COLORS[color] || EFFECT_COLORS.red;
        const g = new Graphics();
        g.x = (x + 0.5) * this.blockPx;
        g.y = (y + 0.5) * this.blockPx;
        this.layers.effects.addChild(g);
        const baseR = this.blockPx * 0.5;
        this._addTween({
            elapsed: 0,
            duration: 600,
            update: (p) => {
                g.clear();
                const r = baseR * (1 + p * 1.6);
                g.circle(0, 0, r).fill({ color: c1, alpha: 0.7 * (1 - p) });
                g.circle(0, 0, r * 0.55).fill({ color: c2, alpha: 0.5 * (1 - p) });
            },
            done: () => { g.destroy(); },
        });
    }

    _addBombEffect(x, y) {
        const g = new Graphics();
        g.x = (x + 0.5) * this.blockPx;
        g.y = (y + 0.5) * this.blockPx;
        this.layers.effects.addChild(g);
        const baseR = this.blockPx * 0.6;
        this._addTween({
            elapsed: 0,
            duration: 800,
            update: (p) => {
                g.clear();
                const r = baseR * (1 + p * 2.5);
                g.circle(0, 0, r).fill({ color: 0xff6400, alpha: 0.85 * (1 - p) });
                g.circle(0, 0, r * 0.6).fill({ color: 0xffc800, alpha: 0.8 * (1 - p) });
                g.circle(0, 0, r * 0.3).fill({ color: 0xffffff, alpha: 0.9 * (1 - p) });
            },
            done: () => { g.destroy(); },
        });
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
                    const alpha = i === 0 ? 0.9 : Math.max(0.1, 0.6 - i * 0.1);
                    g.circle(0, 0, size * 0.38)
                        .fill({ color: 0x00ff88, alpha });
                    g.circle(0, 0, size * 0.22)
                        .fill({ color: 0xccffcc, alpha: alpha * 0.7 });
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
                // Walk off the edge with a random exit.
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
            // Arc from -PI/2 (top) clockwise around by 2*PI*pct.
            const cx = this.blockPx / 2;
            const cy = this.blockPx / 2;
            const r = this.blockPx * 0.42;
            if (pct > 0.001) {
                ring.moveTo(cx, cy)
                    .arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct)
                    .lineTo(cx, cy)
                    .closePath()
                    .fill({ color: 0xffffff, alpha: 0.22 });
            }
            ring.circle(cx, cy, r)
                .stroke({ color: 0xffffff, width: 1.5, alpha: 0.7 });
            digit.text = String(Math.ceil(remaining / 1000));
            if (remaining <= 0) {
                entry.running = false;
            }
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
    // HUD (DOM) — same as GameView since that stays DOM for PR #15.
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
