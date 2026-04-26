// Pure defense-mission game logic. No DOM, no Pixi, no hard-coded
// timers. Follows the same contract as GameState: construct → attach
// listeners via `on()` → call `start()` → drive with `tick(deltaMs)`.
//
// Injectable dependencies:
//   rng      — () → [0,1)   (default Math.random)
//   schedule — (fn, ms) → id  (default immediate)
//
// All entity positions snap to a G×G grid so movement is deterministic
// and pixel-art aligned. Velocities are grid-cells-per-step; intervals
// control how often each entity type steps.

import { Emitter } from './emitter.js';
import {
    GRID as G,
    ARENA_W,
    ARENA_H,
    PADDLE_WIDTH,
    PADDLE_HEIGHT,
    PADDLE_WIDE_MULTIPLIER,
    PADDLE_STEP_MS,
    BALL_SIZE,
    BALL_STEP_MS,
    BALL_LOST_DAMAGE,
    INVADER_ROWS,
    INVADER_COLS,
    INVADER_CELL,
    INVADER_MOVE_MS,
    INVADER_DROP_CELLS,
    INVADER_SHOOT_MS,
    INVADER_SHOOT_CHANCE,
    INVADER_PATTERNS,
    INVADER_PATTERN_ROWS,
    INVADER_PATTERN_COLS,
    BOSS_PIXEL_HP,
    BOSS_STEP_MS,
    BOSS_STEP_CELLS,
    BOSS_SHOOT_MS,
    BOSS_PIXEL_OFFSETS,
    MAX_TOWERS,
    TOWER_SHOOT_MS,
    TOWER_BULLET_SPEED,
    BULLET_STEP_MS,
    INVADER_BULLET_SPEED,
    BOSS_BULLET_SPEED,
    ENEMY_BULLET_DAMAGE,
    LASER_COOLDOWN_MS,
    LASER_DURATION_MS,
    LASER_BULLET_SPEED,
    WIDE_DURATION_MS,
    POWER_UP_TYPES,
    BONUS_DROP_INTERVAL,
    BONUS_STEP_MS,
    MAX_BALLS,
    LIFE_RESTORE,
    SCORE_PIXEL_BULLET,
    SCORE_PIXEL_BALL,
    BOSS_BONUS_DROP_COUNT,
    HIT_RADIUS,
    BALL_BROAD_PAD,
    BULLET_BROAD_PAD,
    PLAYER_MAX_HEALTH,
} from './defense-constants.js';

function snap(v) { return Math.round(v / G) * G; }
function immediateSchedule(fn) { fn(); return 0; }

export class DefenseState extends Emitter {
    constructor({ rng = Math.random, schedule = immediateSchedule } = {}) {
        super();
        this._rng = rng;
        this._schedule = schedule;
        this._reset();
    }

    // ── Public read-only state ────────────────────────────────────────
    get paddleX() { return this._paddle.x; }
    get paddleY() { return this._paddle.y; }
    get paddleWidth() { return this._paddleWidth(); }

    // ── Lifecycle ─────────────────────────────────────────────────────

    start() {
        this._reset();
        this.gameOver = false;
        this.won = false;
        this._spawnInvaders();
        this._spawnBoss();
        this._balls.push(this._makeBall(
            snap(ARENA_W / 2),
            snap(ARENA_H / 2),
            1,
            -1,
        ));
        this.emit('game-started');
    }

    tick(deltaMs) {
        if (this.gameOver) return;
        this._elapsed += deltaMs;
        const now = this._elapsed;

        this._tickPaddle(now);
        this._tickTimers(deltaMs);
        this._tickBalls(now);
        this._tickInvaders(now);
        this._tickPowerUps(now);
        this._tickInvaderShooting(now);
        this._tickTowerShooting(now);
        this._tickLaser(now);
        this._tickBullets(now);
        this._tickBallCollisions();
        this._tickBoss(now);
        this._checkWin();
        this._checkInvaderReachBottom();
        this.emit('tick');
    }

    // ── Player actions ────────────────────────────────────────────────

    setPaddleTarget(x) {
        this._paddleTargetX = x;
    }

    movePaddleBy(dx) {
        this._paddle.x = snap(
            Math.max(0, Math.min(ARENA_W - this._paddleWidth(), this._paddle.x + dx * G)),
        );
    }

    placeTower(x, y) {
        if (this._availableTurrets <= 0) return false;
        if (this._towers.length >= MAX_TOWERS) return false;
        if (y >= this._paddle.y - G * 3) return false;
        this._towers.push({
            x: snap(x - 20),
            y: snap(y - 15),
            lastShot: 0,
        });
        this._availableTurrets--;
        this.emit('tower-placed', this._towers[this._towers.length - 1]);
        return true;
    }

    fireLaser() {
        if (!this._laserActive) return;
        const now = this._elapsed;
        if (now - this._lastLaserShot < LASER_COOLDOWN_MS) return;
        this._lastLaserShot = now;

        const pw = this._paddleWidth();
        const centerX = snap(this._paddle.x + pw / 2);

        // Visual spread bullets.
        const leftX = snap(centerX - G);
        const rightX = snap(centerX + G);
        const xs = [...new Set([leftX, centerX, rightX])];
        for (const bx of xs) {
            this._bullets.push(this._makeBullet(bx, this._paddle.y - G, LASER_BULLET_SPEED, 'laser'));
        }

        // Targeted laser bullets toward nearest enemy pixels.
        const candidates = this._gatherLaserTargets(centerX);
        candidates.sort((a, b) => a.d - b.d);
        const picked = [];
        for (let i = 0; i < candidates.length && picked.length < 3; i++) {
            const sx = snap(candidates[i].x);
            if (!picked.includes(sx)) picked.push(sx);
        }
        if (picked.length === 0) {
            picked.push(centerX, snap(centerX - G), snap(centerX + G));
        }
        for (const bx of picked) {
            this._bullets.push(this._makeBullet(bx, this._paddle.y - G, LASER_BULLET_SPEED, 'laser'));
        }

        this.emit('laser-fired');
    }

    // ── Internals ─────────────────────────────────────────────────────

    _reset() {
        this.score = 0;
        this.playerHealth = PLAYER_MAX_HEALTH;
        this.gameOver = false;
        this.won = false;
        this._elapsed = 0;

        this._paddle = { x: snap(ARENA_W / 2 - PADDLE_WIDTH / 2), y: snap(ARENA_H - 40) };
        this._paddleTargetX = ARENA_W / 2;
        this._balls = [];
        this._invaders = [];
        this._boss = null;
        this._towers = [];
        this._bullets = [];
        this._powerUps = [];

        this._laserActive = false;
        this._laserTimer = 0;
        this._wideTimer = 0;
        this._lastLaserShot = 0;
        this._availableTurrets = 0;
        this._pixelKills = 0;

        this._gridDirection = G;
        this._lastInvaderMove = 0;
        this._lastInvaderShot = 0;
        this._lastBossStep = 0;
        this._lastBallStep = 0;
        this._lastBulletStep = 0;
        this._lastPaddleStep = 0;
        this._lastBonusStep = 0;
        this._bossDirection = BOSS_STEP_CELLS * G;
    }

    _paddleWidth() {
        return snap(this._wideTimer > 0 ? PADDLE_WIDTH * PADDLE_WIDE_MULTIPLIER : PADDLE_WIDTH);
    }

    // ── Entity factories ──────────────────────────────────────────────

    _makeBall(x, y, vx, vy) {
        return {
            x: snap(x),
            y: snap(y),
            vx: vx >= 0 ? Math.max(1, Math.round(vx)) : Math.min(-1, Math.round(vx)),
            vy: vy >= 0 ? Math.max(1, Math.round(vy)) : Math.min(-1, Math.round(vy)),
        };
    }

    _makeBullet(x, y, vy, owner) {
        return { x: snap(x), y: snap(y), vy, owner };
    }

    _makePowerUp(x, y) {
        const type = POWER_UP_TYPES[Math.floor(this._rng() * POWER_UP_TYPES.length)];
        return { x: snap(x), y: snap(y), type };
    }

    // ── Spawners ──────────────────────────────────────────────────────

    _spawnInvaders() {
        this._invaders = [];
        for (let r = 0; r < INVADER_ROWS; r++) {
            for (let c = 0; c < INVADER_COLS; c++) {
                const pattern = INVADER_PATTERNS[r % INVADER_PATTERNS.length];
                const pixelHP = [];
                let totalHP = 0;
                for (let py = 0; py < INVADER_PATTERN_ROWS; py++) {
                    for (let px = 0; px < INVADER_PATTERN_COLS; px++) {
                        if (pattern[py][px] === 1) {
                            pixelHP.push(1);
                            totalHP++;
                        } else {
                            pixelHP.push(0);
                        }
                    }
                }
                this._invaders.push({
                    x: snap(80 + c * 70 - 20),
                    y: snap(90 + r * 50 - 15 + 40),
                    type: r % INVADER_PATTERNS.length,
                    pixelHP,
                    totalHP,
                    maxHP: totalHP,
                });
            }
        }
    }

    _spawnBoss() {
        const pixelHP = BOSS_PIXEL_OFFSETS.map(() => BOSS_PIXEL_HP);
        const totalHP = pixelHP.reduce((a, b) => a + b, 0);
        this._boss = {
            x: snap(ARENA_W / 2 - 20),
            y: snap(80),
            pixelHP,
            totalHP,
            maxHP: totalHP,
            lastShot: 0,
        };
    }

    // ── Tick helpers ──────────────────────────────────────────────────

    _tickPaddle(now) {
        if (now - this._lastPaddleStep < PADDLE_STEP_MS) return;
        this._lastPaddleStep = now;
        const pw = this._paddleWidth();
        let targetX = snap(this._paddleTargetX - pw / 2);
        targetX = Math.max(0, Math.min(ARENA_W - pw, targetX));
        this._paddle.x = snap(Math.max(0, Math.min(ARENA_W - pw, targetX)));
    }

    _tickTimers(deltaMs) {
        if (this._wideTimer > 0) this._wideTimer -= deltaMs;
        if (this._laserTimer > 0) this._laserTimer -= deltaMs;
        if (this._laserTimer <= 0) this._laserActive = false;
    }

    _tickBalls(now) {
        if (now - this._lastBallStep < BALL_STEP_MS) return;
        this._lastBallStep = now;
        const pw = this._paddleWidth();

        for (let i = this._balls.length - 1; i >= 0; i--) {
            const ball = this._balls[i];
            ball.x = snap(ball.x + ball.vx * G);
            ball.y = snap(ball.y + ball.vy * G);

            // Wall bounce.
            const halfBall = BALL_SIZE / 2;
            if (ball.x - halfBall < 0) { ball.vx = Math.abs(ball.vx); ball.x = snap(halfBall); }
            if (ball.x + halfBall > ARENA_W) { ball.vx = -Math.abs(ball.vx); ball.x = snap(ARENA_W - halfBall); }
            if (ball.y - halfBall < 0) { ball.vy = Math.abs(ball.vy); ball.y = snap(halfBall); }

            // Paddle bounce.
            if (
                ball.y + halfBall >= this._paddle.y &&
                ball.y - halfBall <= this._paddle.y + PADDLE_HEIGHT &&
                ball.x >= this._paddle.x &&
                ball.x <= this._paddle.x + pw
            ) {
                ball.vy = -Math.abs(ball.vy);
                const hitPos = (ball.x - (this._paddle.x + pw / 2)) / (pw / 2);
                ball.vx = Math.round(hitPos * 3) || (ball.vx > 0 ? 1 : -1);
                ball.y = snap(this._paddle.y - halfBall);
            }

            // Ball lost below screen.
            if (ball.y - halfBall > ARENA_H) {
                this._balls.splice(i, 1);
                this.playerHealth -= BALL_LOST_DAMAGE;
                this.emit('ball-lost');
                if (this.playerHealth <= 0) { this._endGame(false); return; }
                if (this._balls.length === 0 && this.playerHealth > 0) {
                    this._balls.push(this._makeBall(snap(ARENA_W / 2), snap(ARENA_H / 2), 1, -1));
                }
            }
        }
    }

    _tickInvaders(now) {
        if (now - this._lastInvaderMove < INVADER_MOVE_MS) return;
        this._lastInvaderMove = now;
        let drop = false;
        for (const inv of this._invaders) {
            inv.x += this._gridDirection;
            if (inv.x < 20 || inv.x > ARENA_W - 60) drop = true;
        }
        if (drop) {
            this._gridDirection *= -1;
            for (const inv of this._invaders) inv.y += G * INVADER_DROP_CELLS;
        }
        for (const inv of this._invaders) {
            inv.x = snap(inv.x);
            inv.y = snap(inv.y);
        }
    }

    _tickPowerUps(now) {
        if (now - this._lastBonusStep < BONUS_STEP_MS) return;
        this._lastBonusStep = now;
        for (const pu of this._powerUps) pu.y += G;

        const pw = this._paddleWidth();
        for (let i = this._powerUps.length - 1; i >= 0; i--) {
            const pu = this._powerUps[i];
            if (pu.y > ARENA_H) {
                this._powerUps.splice(i, 1);
                continue;
            }
            if (
                pu.y + G > this._paddle.y &&
                pu.y < this._paddle.y + PADDLE_HEIGHT &&
                pu.x >= this._paddle.x &&
                pu.x <= this._paddle.x + pw
            ) {
                this._powerUps.splice(i, 1);
                this._applyPowerUp(pu.type);
            }
        }
    }

    _applyPowerUp(type) {
        switch (type) {
            case 'MULTI':
                if (this._balls.length < MAX_BALLS && this._balls.length > 0) {
                    const last = this._balls[this._balls.length - 1];
                    this._balls.push(this._makeBall(
                        last.x + G * 3, last.y, -(last.vx || 1), last.vy,
                    ));
                }
                break;
            case 'WIDE':
                this._wideTimer = WIDE_DURATION_MS;
                break;
            case 'LASER':
                this._laserActive = true;
                this._laserTimer = LASER_DURATION_MS;
                break;
            case 'LIFE':
                this.playerHealth = Math.min(PLAYER_MAX_HEALTH, this.playerHealth + LIFE_RESTORE);
                break;
            case 'TOWER':
                this._availableTurrets = Math.min(MAX_TOWERS, this._availableTurrets + 1);
                break;
        }
        this.emit('powerup-collected', { type });
    }

    _tickInvaderShooting(now) {
        if (now - this._lastInvaderShot < INVADER_SHOOT_MS) return;
        this._lastInvaderShot = now;
        if (this._rng() >= INVADER_SHOOT_CHANCE) return;
        if (this._invaders.length === 0) return;
        const shooter = this._invaders[Math.floor(this._rng() * this._invaders.length)];
        this._bullets.push(this._makeBullet(shooter.x + 20, shooter.y + 30, INVADER_BULLET_SPEED, 'invader'));
    }

    _tickTowerShooting(now) {
        for (const tower of this._towers) {
            if (now - tower.lastShot < TOWER_SHOOT_MS) continue;
            if (this._invaders.length === 0 && !this._boss) continue;
            const targets = [...this._invaders];
            if (this._boss) targets.push(this._boss);
            let closest = null;
            let minDist = Infinity;
            for (const t of targets) {
                const d = Math.hypot(t.x - tower.x, t.y - tower.y);
                if (d < minDist) { minDist = d; closest = t; }
            }
            if (closest) {
                this._bullets.push(this._makeBullet(tower.x, tower.y - 30, TOWER_BULLET_SPEED, 'tower'));
                tower.lastShot = now;
            }
        }
    }

    _tickLaser(_now) {
        // Laser firing is driven by player action (fireLaser()), not auto.
    }

    _tickBullets(now) {
        if (now - this._lastBulletStep < BULLET_STEP_MS) return;
        this._lastBulletStep = now;
        const pw = this._paddleWidth();

        for (let i = this._bullets.length - 1; i >= 0; i--) {
            const b = this._bullets[i];
            b.y = snap(b.y + b.vy * G);

            if (b.vy < 0) {
                // Player / tower / laser bullet going up.
                if (this._bulletHitBoss(b, i)) continue;
                if (this._bulletHitInvader(b, i)) continue;
            } else {
                // Enemy bullet going down — check paddle hit.
                if (
                    b.y >= this._paddle.y &&
                    b.x >= this._paddle.x &&
                    b.x <= this._paddle.x + pw
                ) {
                    this.playerHealth -= ENEMY_BULLET_DAMAGE;
                    this._bullets.splice(i, 1);
                    this.emit('player-hit');
                    if (this.playerHealth <= 0) { this._endGame(false); return; }
                    continue;
                }
            }

            // Off-screen cleanup.
            if (b.y < 0 || b.y > ARENA_H) {
                this._bullets.splice(i, 1);
            }
        }
    }

    _bulletHitBoss(b, bulletIdx) {
        if (!this._boss) return false;
        for (let pi = 0; pi < BOSS_PIXEL_OFFSETS.length; pi++) {
            if (this._boss.pixelHP[pi] <= 0) continue;
            const px = this._boss.x + BOSS_PIXEL_OFFSETS[pi].x + 5;
            const py = this._boss.y + BOSS_PIXEL_OFFSETS[pi].y + 5;
            if (Math.hypot(b.x - px, b.y - py) <= HIT_RADIUS) {
                this._boss.pixelHP[pi]--;
                this._boss.totalHP--;
                if (this._boss.pixelHP[pi] === 0) this._onPixelKilled(this._boss.x + 20, this._boss.y + 15);
                this._bullets.splice(bulletIdx, 1);
                this.score += SCORE_PIXEL_BULLET;
                this.emit('boss-hit', { pixelIndex: pi });
                if (this._boss.totalHP <= 0) this._destroyBoss();
                return true;
            }
        }
        return false;
    }

    _bulletHitInvader(b, bulletIdx) {
        for (let j = 0; j < this._invaders.length; j++) {
            const inv = this._invaders[j];
            if (
                b.x + BULLET_BROAD_PAD < inv.x ||
                b.x - BULLET_BROAD_PAD >= inv.x + INVADER_PATTERN_COLS * INVADER_CELL ||
                b.y - BULLET_BROAD_PAD >= inv.y + INVADER_PATTERN_ROWS * INVADER_CELL ||
                b.y + BULLET_BROAD_PAD < inv.y
            ) continue;

            for (let py = 0; py < INVADER_PATTERN_ROWS; py++) {
                for (let px = 0; px < INVADER_PATTERN_COLS; px++) {
                    const idx = py * INVADER_PATTERN_COLS + px;
                    if (inv.pixelHP[idx] <= 0) continue;
                    const cx = inv.x + px * INVADER_CELL + 5;
                    const cy = inv.y + py * INVADER_CELL + 5;
                    if (Math.hypot(b.x - cx, b.y - cy) <= HIT_RADIUS) {
                        inv.pixelHP[idx]--;
                        inv.totalHP--;
                        if (inv.pixelHP[idx] === 0) this._onPixelKilled(inv.x + 20, inv.y + 15);
                        if (inv.totalHP <= 0) {
                            this._invaders.splice(j, 1);
                            this.emit('invader-destroyed', { type: inv.type });
                        } else {
                            this.emit('invader-hit', { index: j });
                        }
                        this._bullets.splice(bulletIdx, 1);
                        this.score += SCORE_PIXEL_BULLET;
                        return true;
                    }
                }
            }
        }
        return false;
    }

    _tickBallCollisions() {
        for (let bi = this._balls.length - 1; bi >= 0; bi--) {
            const ball = this._balls[bi];
            this._ballHitBoss(ball);
            this._ballHitInvaders(ball);
        }
    }

    _ballHitBoss(ball) {
        if (!this._boss) return;
        for (let pi = 0; pi < BOSS_PIXEL_OFFSETS.length; pi++) {
            if (this._boss.pixelHP[pi] <= 0) continue;
            const px = this._boss.x + BOSS_PIXEL_OFFSETS[pi].x + 5;
            const py = this._boss.y + BOSS_PIXEL_OFFSETS[pi].y + 5;
            if (Math.hypot(ball.x - px, ball.y - py) <= HIT_RADIUS) {
                this._boss.pixelHP[pi]--;
                this._boss.totalHP--;
                if (this._boss.pixelHP[pi] === 0) this._onPixelKilled(this._boss.x + 20, this._boss.y + 15);
                ball.vy = -Math.abs(ball.vy);
                this.score += SCORE_PIXEL_BALL;
                this.emit('boss-hit', { pixelIndex: pi });
                if (this._boss.totalHP <= 0) this._destroyBoss();
                return;
            }
        }
    }

    _ballHitInvaders(ball) {
        for (let i = 0; i < this._invaders.length; i++) {
            const inv = this._invaders[i];
            if (
                ball.x + BALL_BROAD_PAD < inv.x ||
                ball.x - BALL_BROAD_PAD >= inv.x + INVADER_PATTERN_COLS * INVADER_CELL ||
                ball.y - BALL_BROAD_PAD >= inv.y + INVADER_PATTERN_ROWS * INVADER_CELL ||
                ball.y + BALL_BROAD_PAD < inv.y
            ) continue;

            const relX = (ball.x - inv.x) / INVADER_CELL;
            const relY = (ball.y - inv.y) / INVADER_CELL;
            let pixelX = Math.max(0, Math.min(INVADER_PATTERN_COLS - 1, Math.round(relX)));
            let pixelY = Math.max(0, Math.min(INVADER_PATTERN_ROWS - 1, Math.round(relY)));
            const idx = pixelY * INVADER_PATTERN_COLS + pixelX;

            if (idx >= 0 && idx < INVADER_PATTERN_ROWS * INVADER_PATTERN_COLS && inv.pixelHP[idx] > 0) {
                inv.pixelHP[idx]--;
                inv.totalHP--;
                if (inv.pixelHP[idx] === 0) this._onPixelKilled(inv.x + 20, inv.y + 15);
                if (inv.totalHP <= 0) {
                    this._invaders.splice(i, 1);
                    this.emit('invader-destroyed', { type: inv.type });
                } else {
                    this.emit('invader-hit', { index: i });
                }
                ball.vy *= -1;
                this.score += SCORE_PIXEL_BALL;
                return;
            }
        }
    }

    _tickBoss(now) {
        if (!this._boss) return;
        // Movement.
        if (now - this._lastBossStep > BOSS_STEP_MS) {
            this._lastBossStep = now;
            this._boss.x += this._bossDirection;
            if (this._boss.x < 80 || this._boss.x > ARENA_W - 80) {
                this._bossDirection *= -1;
                this._boss.x += this._bossDirection * 2;
            }
            this._boss.x = snap(this._boss.x);
            this._boss.y = snap(this._boss.y);
        }
        // Shooting.
        if (now - this._boss.lastShot > BOSS_SHOOT_MS) {
            this._boss.lastShot = now;
            this._bullets.push(this._makeBullet(this._boss.x, this._boss.y + G * 4, BOSS_BULLET_SPEED, 'boss'));
        }
    }

    _destroyBoss() {
        for (let i = 0; i < BOSS_BONUS_DROP_COUNT; i++) {
            const x = this._rng() * (ARENA_W - 40) + 20;
            const y = this._rng() * (ARENA_H / 2) + 50;
            this._powerUps.push(this._makePowerUp(x, y));
        }
        this._boss = null;
        this.emit('boss-destroyed');
    }

    _onPixelKilled(dropX, dropY) {
        this._pixelKills++;
        if (this._pixelKills >= BONUS_DROP_INTERVAL) {
            this._powerUps.push(this._makePowerUp(dropX, dropY));
            this._pixelKills = 0;
        }
    }

    _gatherLaserTargets(centerX) {
        const candidates = [];
        for (const inv of this._invaders) {
            for (let py = 0; py < INVADER_PATTERN_ROWS; py++) {
                for (let px = 0; px < INVADER_PATTERN_COLS; px++) {
                    const idx = py * INVADER_PATTERN_COLS + px;
                    if (inv.pixelHP[idx] <= 0) continue;
                    const cx = inv.x + px * INVADER_CELL + 5;
                    const cy = inv.y + py * INVADER_CELL + 5;
                    if (cy >= this._paddle.y) continue;
                    candidates.push({ x: cx, d: Math.abs(cx - centerX) });
                }
            }
        }
        if (this._boss) {
            for (let pi = 0; pi < BOSS_PIXEL_OFFSETS.length; pi++) {
                if (this._boss.pixelHP[pi] <= 0) continue;
                const cx = this._boss.x + BOSS_PIXEL_OFFSETS[pi].x + 5;
                const cy = this._boss.y + BOSS_PIXEL_OFFSETS[pi].y + 5;
                if (cy >= this._paddle.y) continue;
                candidates.push({ x: cx, d: Math.abs(cx - centerX) });
            }
        }
        return candidates;
    }

    _checkWin() {
        if (!this._boss && this._invaders.length === 0) {
            this._endGame(true);
        }
    }

    _checkInvaderReachBottom() {
        if (this._invaders.some((inv) => inv.y > ARENA_H - 110)) {
            this._endGame(false);
        }
    }

    _endGame(won) {
        if (this.gameOver) return;
        this.gameOver = true;
        this.won = won;
        this.emit('game-over', { won, score: this.score });
    }

    // ── Snapshot for rendering ────────────────────────────────────────

    snapshot() {
        return {
            paddle: { ...this._paddle, width: this._paddleWidth(), height: PADDLE_HEIGHT },
            balls: this._balls.map((b) => ({ ...b })),
            invaders: this._invaders.map((inv) => ({
                x: inv.x, y: inv.y, type: inv.type,
                pixelHP: [...inv.pixelHP], totalHP: inv.totalHP, maxHP: inv.maxHP,
            })),
            boss: this._boss ? {
                x: this._boss.x, y: this._boss.y,
                pixelHP: [...this._boss.pixelHP],
                totalHP: this._boss.totalHP, maxHP: this._boss.maxHP,
            } : null,
            towers: this._towers.map((t) => ({ x: t.x, y: t.y })),
            bullets: this._bullets.map((b) => ({ x: b.x, y: b.y, vy: b.vy, owner: b.owner })),
            powerUps: this._powerUps.map((pu) => ({ x: pu.x, y: pu.y, type: pu.type })),
            score: this.score,
            playerHealth: this.playerHealth,
            laserActive: this._laserActive,
            wideActive: this._wideTimer > 0,
            availableTurrets: this._availableTurrets,
            pixelKills: this._pixelKills,
            gameOver: this.gameOver,
            won: this.won,
        };
    }
}
