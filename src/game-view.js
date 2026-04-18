// DOM renderer. Owns the board DOM, subscribes to GameState events, and
// translates them into cell paints, preview updates, and effect layer
// animations. It does not read game rules; anything it needs to know it
// learns from event payloads.

import { COLS, ROWS, SNAKE_LENGTH } from './constants.js';

export class GameView {
    constructor({ state, elements }) {
        this.state = state;
        this.el = elements;

        // Cached per-cell DOM references. Built once in createBoard().
        this.boardCells = [];
        this.activeCells = [];
        this.activePaintedCells = [];

        this._bindState();
    }

    // -------------------------------------------------------------------
    // Board construction
    // -------------------------------------------------------------------

    createBoard() {
        const { board, active, effects } = this.el;
        board.innerHTML = '';
        active.innerHTML = '';
        effects.innerHTML = '';

        this.boardCells = [];
        this.activeCells = [];
        this.activePaintedCells = [];

        const boardFrag = document.createDocumentFragment();
        const activeFrag = document.createDocumentFragment();

        for (let y = 0; y < ROWS; y++) {
            this.boardCells[y] = [];
            this.activeCells[y] = [];
            for (let x = 0; x < COLS; x++) {
                const boardCell = document.createElement('div');
                boardCell.className = 'cell';
                boardCell.dataset.x = String(x);
                boardCell.dataset.y = String(y);
                boardFrag.appendChild(boardCell);
                this.boardCells[y][x] = boardCell;

                const activeCell = document.createElement('div');
                activeCell.className = 'cell';
                activeCell.dataset.x = String(x);
                activeCell.dataset.y = String(y);
                activeCell.style.background = 'transparent';
                activeCell.style.border = 'none';
                activeFrag.appendChild(activeCell);
                this.activeCells[y][x] = activeCell;
            }
        }

        board.appendChild(boardFrag);
        active.appendChild(activeFrag);
    }

    createPreviews() {
        const { nextPreview, smallPreviews } = this.el;
        // Previews render as a 4x4 grid of standard `.cell` elements so the
        // upcoming pieces look identical to the ones on the board.
        const fillGrid = (container) => {
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
    // Active layer: paint only the cells the falling piece occupies.
    // -------------------------------------------------------------------

    _clearActiveLayer() {
        const painted = this.activePaintedCells;
        if (painted.length === 0) return;
        for (let i = 0; i < painted.length; i++) {
            const cell = painted[i];
            cell.className = 'cell';
            cell.style.background = 'transparent';
            cell.style.border = 'none';
        }
        painted.length = 0;
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
                if (by < 0 || bx < 0 || bx >= COLS || by >= ROWS) continue;
                if (this.state.board[by][bx]) continue;
                const cell = this.activeCells[by][bx];
                cell.className = 'cell';
                const color = colors[y][x];
                if (color) cell.classList.add(color);
                cell.style.background = '';
                cell.style.border = '';
                this.activePaintedCells.push(cell);
            }
        }
    }

    // -------------------------------------------------------------------
    // Board layer: repaint from state. Skips cells that already match.
    // -------------------------------------------------------------------

    _redrawBoard() {
        for (let y = 0; y < ROWS; y++) {
            const rowCells = this.boardCells[y];
            const rowState = this.state.board[y];
            for (let x = 0; x < COLS; x++) {
                const cell = rowCells[x];
                if (!cell) continue;
                const color = rowState[x];
                const desired = color ? `cell filled ${color}` : 'cell';
                if (cell.className !== desired) cell.className = desired;
            }
        }
        this._paintActivePiece();
    }

    _paintPreview(container, piece) {
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

    _updateNextPreview() {
        this._paintPreview(this.el.nextPreview, this.state.nextPiece);
    }

    _updateSmallPreviews() {
        this.el.smallPreviews.forEach((previewEl, index) => {
            this._paintPreview(previewEl, this.state.pieceQueue[index + 1]);
        });
    }

    _updatePreviews() {
        this._updateNextPreview();
        this._updateSmallPreviews();
    }

    _updateHUD() {
        this.el.score.textContent = String(this.state.score);
        this.el.level.textContent = String(this.state.level);
        this.el.lines.textContent = String(this.state.lines);
    }

    _flashScore() {
        const el = this.el.score;
        el.classList.add('score-animation');
        setTimeout(() => el.classList.remove('score-animation'), 500);
    }

    // -------------------------------------------------------------------
    // Effect layer: transient visuals (explosions, bomb blasts, snake
    // trail segments).
    // -------------------------------------------------------------------

    _addExplosionEffect(x, y, color) {
        const effect = document.createElement('div');
        effect.className = 'explosion-effect';
        effect.style.position = 'absolute';
        effect.style.left = `${(x * 100) / COLS}%`;
        effect.style.top = `${(y * 100) / ROWS}%`;
        effect.style.width = `${100 / COLS}%`;
        effect.style.height = `${100 / ROWS}%`;
        effect.style.background = `radial-gradient(circle, ${this._colorGradient(color)} 0%, transparent 70%)`;
        effect.style.animation = 'explode 0.6s ease-out forwards';
        effect.style.pointerEvents = 'none';
        effect.style.zIndex = '1';
        this.el.effects.appendChild(effect);
        setTimeout(() => {
            if (effect.parentNode) effect.parentNode.removeChild(effect);
        }, 600);
    }

    _addBombEffect(x, y) {
        const effect = document.createElement('div');
        effect.className = 'bomb-explosion-effect';
        effect.style.position = 'absolute';
        effect.style.left = `${(x * 100) / COLS}%`;
        effect.style.top = `${(y * 100) / ROWS}%`;
        effect.style.width = `${100 / COLS}%`;
        effect.style.height = `${100 / ROWS}%`;
        effect.style.background = 'radial-gradient(circle, rgba(255, 100, 0, 1) 0%, rgba(255, 200, 0, 0.8) 30%, transparent 70%)';
        effect.style.animation = 'bombExplode 0.8s ease-out forwards';
        effect.style.pointerEvents = 'none';
        effect.style.zIndex = '10';
        this.el.effects.appendChild(effect);
        setTimeout(() => {
            if (effect.parentNode) effect.parentNode.removeChild(effect);
        }, 800);
    }

    _colorGradient(color) {
        const gradients = {
            red: 'rgba(255, 100, 0, 0.8), rgba(255, 200, 100, 0.4)',
            blue: 'rgba(0, 150, 255, 0.8), rgba(100, 200, 255, 0.4)',
            green: 'rgba(100, 255, 100, 0.8), rgba(200, 255, 200, 0.4)',
            yellow: 'rgba(255, 255, 100, 0.8), rgba(255, 255, 200, 0.4)',
        };
        return gradients[color] || 'rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.4)';
    }

    // -------------------------------------------------------------------
    // Snake visual: pre-allocated trail nodes, positioned each step.
    // -------------------------------------------------------------------

    _animateSnake({ start, entry, recolors, stepInterval, segments }) {
        const trailNodes = [];
        for (let i = 0; i < segments; i++) {
            const n = document.createElement('div');
            n.className = 'snake-trail';
            n.style.position = 'absolute';
            n.style.width = `${100 / COLS}%`;
            n.style.height = `${100 / ROWS}%`;
            n.style.borderRadius = '50%';
            n.style.transform = 'rotate(45deg)';
            n.style.pointerEvents = 'none';
            n.style.zIndex = '15';
            n.style.animation = 'snakeGlow 0.3s ease-in-out';
            n.style.background = i === 0
                ? 'radial-gradient(circle, rgba(0, 255, 136, 0.9) 0%, rgba(0, 102, 68, 0.7) 50%, transparent 70%)'
                : `radial-gradient(circle, rgba(0, 255, 136, ${0.6 - i * 0.1}) 0%, transparent 70%)`;
            n.style.display = 'none';
            this.el.effects.appendChild(n);
            trailNodes.push(n);
        }

        const trail = new Array(segments).fill(null).map(() => ({ x: entry.x, y: entry.y, visible: false }));
        // Clear the snake origin cell on the board layer now.
        const originCell = this.boardCells[start.y] && this.boardCells[start.y][start.x];
        if (originCell) originCell.className = 'cell';

        let idx = 0;
        const step = () => {
            if (idx < recolors.length) {
                const target = recolors[idx];
                for (let i = segments - 1; i > 0; i--) trail[i] = { ...trail[i - 1] };
                trail[0] = { x: target.x, y: target.y, visible: true };
                const cell = this.boardCells[target.y] && this.boardCells[target.y][target.x];
                if (cell) cell.className = `cell ${target.color} filled`;
                idx++;
            } else {
                const exitEdges = [
                    { x: -2, y: trail[0].y },
                    { x: COLS + 1, y: trail[0].y },
                    { x: trail[0].x, y: -2 },
                    { x: trail[0].x, y: ROWS + 1 },
                ];
                const exit = exitEdges[Math.floor(Math.random() * exitEdges.length)];
                for (let i = segments - 1; i > 0; i--) trail[i] = { ...trail[i - 1] };
                trail[0] = { x: exit.x, y: exit.y, visible: false };
            }

            for (let i = 0; i < segments; i++) {
                const seg = trail[i];
                const node = trailNodes[i];
                if (seg.visible && seg.x >= 0 && seg.x < COLS && seg.y >= 0 && seg.y < ROWS) {
                    node.style.left = `${(seg.x * 100) / COLS}%`;
                    node.style.top = `${(seg.y * 100) / ROWS}%`;
                    node.style.display = '';
                } else {
                    node.style.display = 'none';
                }
            }

            if (idx < recolors.length + segments) {
                setTimeout(step, stepInterval);
            } else {
                setTimeout(() => {
                    for (let i = 0; i < trailNodes.length; i++) {
                        const n = trailNodes[i];
                        if (n.parentNode) n.parentNode.removeChild(n);
                    }
                }, 500);
            }
        };
        step();
    }

    // -------------------------------------------------------------------
    // Wire up state events.
    // -------------------------------------------------------------------

    _bindState() {
        const s = this.state;
        s.on('game-started', () => {
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
            // Auto-match can clear runs of several different colors in one
            // sweep, in which case the top-level `color` is null and each
            // cell carries its own color. Fall back to the cell color first,
            // then the run color. Without this the auto-match explosion
            // always rendered white.
            for (let i = 0; i < cells.length; i++) {
                const m = cells[i];
                const cell = this.boardCells[m.y][m.x];
                if (cell) cell.classList.add('highlight');
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
                const cell = this.boardCells[c.y][c.x];
                if (cell) cell.classList.add('highlight');
                this._addBombEffect(c.x, c.y);
            }
        });
        s.on('bomb-exploded', () => {
            this._redrawBoard();
            this._updateHUD();
            this._flashScore();
        });
        s.on('snake-activated', (plan) => {
            this._animateSnake(plan);
        });
        s.on('gravity-applied', () => this._redrawBoard());
        s.on('lines-cleared', () => {
            this._redrawBoard();
            this._updateHUD();
        });
        s.on('score-changed', () => this._updateHUD());
    }
}

export const _SNAKE_LENGTH = SNAKE_LENGTH;
