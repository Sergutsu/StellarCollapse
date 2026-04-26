// Defense-mission scene: Space-Invaders / Breakout hybrid rendered via
// Pixi.js. Reads entity state from DefenseState's snapshot each tick and
// paints paddle, balls, invaders, boss, towers, bullets, power-ups, and
// the HUD (score, health bars, buff strip, bonus progress).
//
// Contract (SceneManager + PixiView):
//   defense.show(defenseState)   -- makes root visible, subscribes state
//   defense.hide()               -- hides root (does NOT destroy)
//   defense.layout(screen)       -- scales the 800×600 arena into viewport
//   defense.tick(deltaMs)        -- repaints from state snapshot
//   defense.destroy()            -- tears down all Pixi nodes
//   defense.visible              -- scene-manager contract

import {
    Container,
    Graphics,
    Text,
} from 'pixi.js';

import {
    GRID as G,
    ARENA_W,
    ARENA_H,
    INVADER_PATTERNS,
    INVADER_PATTERN_ROWS,
    INVADER_PATTERN_COLS,
    INVADER_CELL,
    BOSS_PIXEL_OFFSETS,
    BONUS_DROP_INTERVAL,
    PLAYER_MAX_HEALTH,
} from '../defense-constants.js';

// ── Colour palette ────────────────────────────────────────────────────
const C_BG            = 0x111122;
const C_GRID          = 0x00ffff;
const C_PADDLE        = 0x00ff88;
const C_PADDLE_ACCENT = 0x00cc66;
const C_PADDLE_LASER  = 0xffff00;
const C_PADDLE_LASER_ACCENT = 0xffdd00;
const C_BALL          = 0xffff00;
const C_BALL_HIGHLIGHT = 0xffff88;
const C_BOSS          = 0xff00ff;
const C_TOWER         = 0x4444ff;
const C_TOWER_ACCENT  = 0x8888ff;
const C_POWERUP       = 0x00ffff;
const C_HEALTH_BG     = 0x222222;
const C_HEALTH_PLAYER = 0x00ff88;
const C_HEALTH_BOSS   = 0xff0088;
const C_WIN           = 0xffff00;
const C_SCORE         = 0xffffff;
const C_BUFF          = 0x00ffff;
const C_PROGRESS_BG   = 0x222222;
const C_PROGRESS_FILL = 0x00ffff;
const C_INVADER = [0xff0000, 0xff8800, 0x00ffff];

const BULLET_COLOR = {
    invader: 0xff0000,
    boss:    0xff4400,
    tower:   0x00ff00,
    laser:   0xffff00,
};

export class DefenseScene {
    constructor({ app, uiRoot }) {
        this._app = app;
        this._uiRoot = uiRoot;
        this._state = null;
        this._root = null;
        this._built = false;
        this.visible = false;

        // Node pools.
        this._gridGfx = null;
        this._paddleGfx = null;
        this._ballPool = [];
        this._invaderPool = [];
        this._bossContainer = null;
        this._bossPixels = [];
        this._towerPool = [];
        this._bulletPool = [];
        this._powerUpPool = [];
        this._scoreText = null;
        this._buffText = null;
        this._bonusBar = null;
        this._playerHealthBar = null;
        this._bossHealthBar = null;
        this._turretTip = null;
        this._winOverlay = null;
        this._gameOverOverlay = null;
    }

    // ── Scene contract ────────────────────────────────────────────────

    show(defenseState) {
        this._state = defenseState;
        if (!this._built) this._build();
        this._root.visible = true;
        this.visible = true;
        this._clearOverlays();
    }

    hide() {
        if (this._root) this._root.visible = false;
        this.visible = false;
        this._state = null;
    }

    layout(_screen) {
        // Arena is a fixed 800×600 logical canvas; PixiView's sceneRoot
        // scaling already handles viewport fit.
    }

    tick(_deltaMs) {
        if (!this._state || !this.visible) return;
        const snap = this._state.snapshot();
        this._drawPaddle(snap);
        this._drawBalls(snap);
        this._drawInvaders(snap);
        this._drawBoss(snap);
        this._drawTowers(snap);
        this._drawBullets(snap);
        this._drawPowerUps(snap);
        this._drawHUD(snap);
        if (snap.gameOver) this._drawEndScreen(snap);
    }

    destroy() {
        if (this._root) {
            this._root.destroy({ children: true });
            this._root = null;
        }
        this._built = false;
        this.visible = false;
        this._state = null;
        this._ballPool = [];
        this._invaderPool = [];
        this._towerPool = [];
        this._bulletPool = [];
        this._powerUpPool = [];
    }

    // ── Build ─────────────────────────────────────────────────────────

    _build() {
        this._root = new Container();
        this._uiRoot.addChild(this._root);

        // Background fill.
        const bg = new Graphics();
        bg.rect(0, 0, ARENA_W, ARENA_H).fill(C_BG);
        this._root.addChild(bg);

        // Grid overlay.
        this._gridGfx = new Graphics();
        for (let x = 0; x <= ARENA_W; x += G) {
            this._gridGfx.moveTo(x, 0);
            this._gridGfx.lineTo(x, ARENA_H);
        }
        for (let y = 0; y <= ARENA_H; y += G) {
            this._gridGfx.moveTo(0, y);
            this._gridGfx.lineTo(ARENA_W, y);
        }
        this._gridGfx.stroke({ width: 1, color: C_GRID, alpha: 0.08 });
        this._root.addChild(this._gridGfx);

        // HUD.
        this._scoreText = new Text({ text: 'Score: 0', style: { fontSize: 28, fill: C_SCORE, fontWeight: 'bold' } });
        this._scoreText.anchor.set(0.5, 0);
        this._scoreText.x = ARENA_W / 2;
        this._scoreText.y = 4;
        this._root.addChild(this._scoreText);

        this._buffText = new Text({ text: 'Buffs: None', style: { fontSize: 16, fill: C_BUFF } });
        this._buffText.x = 10;
        this._buffText.y = 50;
        this._root.addChild(this._buffText);

        this._bonusBar = new Graphics();
        this._bonusBar.x = 10;
        this._bonusBar.y = 70;
        this._root.addChild(this._bonusBar);

        this._turretTip = new Text({ text: 'Click above paddle to place turret', style: { fontSize: 14, fill: 0x888888 } });
        this._turretTip.x = 10;
        this._turretTip.y = 88;
        this._root.addChild(this._turretTip);

        this._playerHealthBar = new Graphics();
        this._root.addChild(this._playerHealthBar);

        this._bossHealthBar = new Graphics();
        this._root.addChild(this._bossHealthBar);

        // Paddle.
        this._paddleGfx = new Graphics();
        this._root.addChild(this._paddleGfx);

        this._built = true;
    }

    // ── Draw helpers ──────────────────────────────────────────────────

    _drawPaddle(snap) {
        const p = snap.paddle;
        const gfx = this._paddleGfx;
        gfx.clear();
        const baseColor = snap.laserActive ? C_PADDLE_LASER : C_PADDLE;
        const accent = snap.laserActive ? C_PADDLE_LASER_ACCENT : C_PADDLE_ACCENT;
        gfx.rect(0, 0, p.width, p.height).fill(baseColor);
        for (let px = 0; px < p.width; px += 20) {
            gfx.rect(px, 0, 10, p.height).fill(accent);
        }
        gfx.x = p.x;
        gfx.y = p.y;
    }

    _drawBalls(snap) {
        this._syncPool(this._ballPool, snap.balls.length, () => {
            const g = new Graphics();
            this._root.addChild(g);
            return g;
        });
        for (let i = 0; i < snap.balls.length; i++) {
            const ball = snap.balls[i];
            const gfx = this._ballPool[i];
            gfx.clear();
            gfx.rect(-G / 2, -G / 2, G, G).fill(C_BALL);
            gfx.rect(-G / 2, -G / 2, G / 2, G / 2).fill(C_BALL_HIGHLIGHT);
            gfx.rect(0, 0, G / 2, G / 2).fill(C_BALL_HIGHLIGHT);
            gfx.x = ball.x;
            gfx.y = ball.y;
            gfx.visible = true;
        }
    }

    _drawInvaders(snap) {
        this._syncPool(this._invaderPool, snap.invaders.length, () => {
            const g = new Graphics();
            this._root.addChild(g);
            return g;
        });
        for (let i = 0; i < snap.invaders.length; i++) {
            const inv = snap.invaders[i];
            const gfx = this._invaderPool[i];
            gfx.clear();
            const color = C_INVADER[inv.type] || C_INVADER[0];
            const pattern = INVADER_PATTERNS[inv.type];
            for (let py = 0; py < INVADER_PATTERN_ROWS; py++) {
                for (let px = 0; px < INVADER_PATTERN_COLS; px++) {
                    const idx = py * INVADER_PATTERN_COLS + px;
                    if (pattern[py][px] === 1 && inv.pixelHP[idx] > 0) {
                        gfx.rect(px * INVADER_CELL, py * INVADER_CELL, INVADER_CELL, INVADER_CELL).fill(color);
                    }
                }
            }
            gfx.x = inv.x;
            gfx.y = inv.y;
            gfx.visible = true;
        }
    }

    _drawBoss(snap) {
        if (!snap.boss) {
            if (this._bossContainer) this._bossContainer.visible = false;
            return;
        }
        if (!this._bossContainer) {
            this._bossContainer = new Container();
            this._root.addChild(this._bossContainer);
            for (let i = 0; i < BOSS_PIXEL_OFFSETS.length; i++) {
                const pg = new Graphics();
                this._bossContainer.addChild(pg);
                this._bossPixels.push(pg);
            }
        }
        this._bossContainer.visible = true;
        this._bossContainer.x = snap.boss.x;
        this._bossContainer.y = snap.boss.y;
        for (let i = 0; i < BOSS_PIXEL_OFFSETS.length; i++) {
            const pg = this._bossPixels[i];
            pg.clear();
            if (snap.boss.pixelHP[i] > 0) {
                pg.rect(BOSS_PIXEL_OFFSETS[i].x, BOSS_PIXEL_OFFSETS[i].y, 10, 10).fill(C_BOSS);
                pg.visible = true;
            } else {
                pg.visible = false;
            }
        }
    }

    _drawTowers(snap) {
        this._syncPool(this._towerPool, snap.towers.length, () => {
            const g = new Graphics();
            this._root.addChild(g);
            return g;
        });
        for (let i = 0; i < snap.towers.length; i++) {
            const tower = snap.towers[i];
            const gfx = this._towerPool[i];
            gfx.clear();
            for (let py = 0; py < 3; py++) {
                for (let px = 0; px < 4; px++) {
                    gfx.rect(px * 10, py * 10, 10, 10).fill(C_TOWER);
                }
            }
            gfx.rect(1 * 10, 0, 10, 10).fill(C_TOWER_ACCENT);
            gfx.rect(2 * 10, 0, 10, 10).fill(C_TOWER_ACCENT);
            gfx.x = tower.x;
            gfx.y = tower.y;
            gfx.visible = true;
        }
    }

    _drawBullets(snap) {
        this._syncPool(this._bulletPool, snap.bullets.length, () => {
            const g = new Graphics();
            this._root.addChild(g);
            return g;
        });
        for (let i = 0; i < snap.bullets.length; i++) {
            const b = snap.bullets[i];
            const gfx = this._bulletPool[i];
            gfx.clear();
            const color = BULLET_COLOR[b.owner] || 0xffffff;
            const sz = 6;
            gfx.rect(-sz / 2, -sz / 2, sz, sz).fill(color);
            gfx.x = b.x;
            gfx.y = b.y;
            gfx.visible = true;
        }
    }

    _drawPowerUps(snap) {
        this._syncPool(this._powerUpPool, snap.powerUps.length, () => {
            const g = new Graphics();
            this._root.addChild(g);
            return g;
        });
        for (let i = 0; i < snap.powerUps.length; i++) {
            const pu = snap.powerUps[i];
            const gfx = this._powerUpPool[i];
            gfx.clear();
            gfx.rect(-5, -5, 10, 10).fill(C_POWERUP);
            gfx.x = pu.x;
            gfx.y = pu.y;
            gfx.visible = true;
        }
    }

    _drawHUD(snap) {
        // Score.
        this._scoreText.text = `Score: ${snap.score}`;

        // Buffs.
        const buffs = [];
        if (snap.wideActive) buffs.push('WIDE');
        if (snap.laserActive) buffs.push('LASER');
        if (snap.balls.length > 1) buffs.push('MULTI');
        if (snap.availableTurrets > 0) buffs.push('TOWERx' + snap.availableTurrets);
        buffs.push(`Bonus: ${snap.pixelKills}/${BONUS_DROP_INTERVAL}`);
        this._buffText.text = 'Buffs: ' + buffs.join(', ');

        // Turret tip visibility.
        this._turretTip.visible = snap.availableTurrets > 0;

        // Bonus progress bar.
        this._bonusBar.clear();
        const pw = 150;
        const ph = 8;
        const progress = snap.pixelKills / BONUS_DROP_INTERVAL;
        this._bonusBar.rect(0, 0, pw, ph).fill(C_PROGRESS_BG);
        this._bonusBar.rect(0, 0, pw * progress, ph).fill(C_PROGRESS_FILL);
        this._bonusBar.rect(0, 0, pw, ph).stroke({ width: 1, color: C_PROGRESS_FILL });

        // Player health bar.
        this._playerHealthBar.clear();
        this._playerHealthBar.rect(20, 20, 200, 12).fill(C_HEALTH_BG);
        this._playerHealthBar.rect(20, 20, 200 * (snap.playerHealth / PLAYER_MAX_HEALTH), 12).fill(C_HEALTH_PLAYER);

        // Boss health bar.
        this._bossHealthBar.clear();
        if (snap.boss) {
            this._bossHealthBar.rect(ARENA_W - 220, 20, 200, 12).fill(C_HEALTH_BG);
            this._bossHealthBar.rect(
                ARENA_W - 220, 20,
                200 * (snap.boss.totalHP / snap.boss.maxHP), 12,
            ).fill(C_HEALTH_BOSS);
        }
    }

    _drawEndScreen(snap) {
        if (snap.won && !this._winOverlay) {
            this._winOverlay = new Container();
            const title = new Text({ text: 'MISSION COMPLETE', style: { fontSize: 64, fill: C_WIN, fontWeight: 'bold' } });
            title.anchor.set(0.5);
            title.x = ARENA_W / 2;
            title.y = ARENA_H / 2 - 60;
            this._winOverlay.addChild(title);
            const sc = new Text({ text: `Final Score: ${snap.score}`, style: { fontSize: 36, fill: C_SCORE } });
            sc.anchor.set(0.5);
            sc.x = ARENA_W / 2;
            sc.y = ARENA_H / 2 + 30;
            this._winOverlay.addChild(sc);
            this._root.addChild(this._winOverlay);
        }
        if (!snap.won && !this._gameOverOverlay) {
            this._gameOverOverlay = new Container();
            const title = new Text({ text: 'MISSION FAILED', style: { fontSize: 64, fill: 0xff4444, fontWeight: 'bold' } });
            title.anchor.set(0.5);
            title.x = ARENA_W / 2;
            title.y = ARENA_H / 2 - 60;
            this._gameOverOverlay.addChild(title);
            const sc = new Text({ text: `Final Score: ${snap.score}`, style: { fontSize: 36, fill: C_SCORE } });
            sc.anchor.set(0.5);
            sc.x = ARENA_W / 2;
            sc.y = ARENA_H / 2 + 30;
            this._gameOverOverlay.addChild(sc);
            this._root.addChild(this._gameOverOverlay);
        }
    }

    _clearOverlays() {
        if (this._winOverlay) {
            this._winOverlay.destroy({ children: true });
            this._winOverlay = null;
        }
        if (this._gameOverOverlay) {
            this._gameOverOverlay.destroy({ children: true });
            this._gameOverOverlay = null;
        }
    }

    // ── Pool management ───────────────────────────────────────────────

    _syncPool(pool, needed, factory) {
        while (pool.length < needed) pool.push(factory());
        for (let i = needed; i < pool.length; i++) pool[i].visible = false;
    }
}
