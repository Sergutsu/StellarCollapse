import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { DefenseState } from '../src/defense-state.js';
import {
    ARENA_W,
    ARENA_H,
    GRID,
    PADDLE_WIDTH,
    PADDLE_HEIGHT,
    BALL_STEP_MS,
    INVADER_ROWS,
    INVADER_COLS,
    INVADER_MOVE_MS,
    BOSS_PIXEL_HP,
    BOSS_PIXEL_OFFSETS,
    PLAYER_MAX_HEALTH,
    BALL_LOST_DAMAGE,
    ENEMY_BULLET_DAMAGE,
    SCORE_PIXEL_BALL,
    SCORE_PIXEL_BULLET,
    BONUS_DROP_INTERVAL,
    MAX_TOWERS,
    INVADER_PATTERN_COLS,
    INVADER_PATTERN_ROWS,
} from '../src/defense-constants.js';

// Deterministic RNG: cycles through a list of values.
function seededRng(values) {
    let i = 0;
    return () => values[(i++) % values.length];
}

describe('DefenseState', () => {
    let state;

    beforeEach(() => {
        state = new DefenseState({ rng: seededRng([0.5]) });
    });

    describe('constructor + start', () => {
        it('initialises with default health and zero score', () => {
            state.start();
            assert.equal(state.playerHealth, PLAYER_MAX_HEALTH);
            assert.equal(state.score, 0);
            assert.equal(state.gameOver, false);
            assert.equal(state.won, false);
        });

        it('spawns the correct number of invaders', () => {
            state.start();
            const snap = state.snapshot();
            assert.equal(snap.invaders.length, INVADER_ROWS * INVADER_COLS);
        });

        it('spawns a boss with the right total HP', () => {
            state.start();
            const snap = state.snapshot();
            assert.ok(snap.boss);
            assert.equal(snap.boss.totalHP, BOSS_PIXEL_OFFSETS.length * BOSS_PIXEL_HP);
        });

        it('starts with one ball', () => {
            state.start();
            assert.equal(state.snapshot().balls.length, 1);
        });

        it('emits game-started on start', () => {
            let fired = false;
            state.on('game-started', () => { fired = true; });
            state.start();
            assert.ok(fired);
        });
    });

    describe('paddle', () => {
        it('moves paddle to target via setPaddleTarget', () => {
            state.start();
            state.setPaddleTarget(200);
            state.tick(20);
            const snap = state.snapshot();
            assert.ok(snap.paddle.x >= 0);
            assert.ok(snap.paddle.x <= ARENA_W);
        });

        it('clamps paddle within arena bounds', () => {
            state.start();
            state.setPaddleTarget(-100);
            state.tick(20);
            assert.ok(state.snapshot().paddle.x >= 0);

            state.setPaddleTarget(ARENA_W + 100);
            state.tick(40);
            assert.ok(state.snapshot().paddle.x <= ARENA_W - PADDLE_WIDTH);
        });

        it('moves paddle by relative offset', () => {
            state.start();
            const before = state.snapshot().paddle.x;
            state.movePaddleBy(3);
            assert.equal(state.snapshot().paddle.x, before + 3 * GRID);
        });
    });

    describe('ball physics', () => {
        it('ball moves on each step', () => {
            state.start();
            const before = state.snapshot().balls[0];
            state.tick(BALL_STEP_MS + 1);
            const after = state.snapshot().balls[0];
            assert.notEqual(before.x, after.x);
        });

        it('ball bounces off left wall', () => {
            state.start();
            // Force ball to left edge heading left.
            state._balls[0].x = GRID / 2;
            state._balls[0].vx = -1;
            state.tick(BALL_STEP_MS + 1);
            assert.ok(state._balls[0].vx > 0);
        });

        it('ball bounces off right wall', () => {
            state.start();
            state._balls[0].x = ARENA_W - GRID / 2;
            state._balls[0].vx = 1;
            state.tick(BALL_STEP_MS + 1);
            assert.ok(state._balls[0].vx < 0);
        });

        it('ball bounces off top wall', () => {
            state.start();
            state._balls[0].y = GRID / 2;
            state._balls[0].vy = -1;
            state.tick(BALL_STEP_MS + 1);
            assert.ok(state._balls[0].vy > 0);
        });

        it('losing a ball deals damage', () => {
            state.start();
            state._balls[0].y = ARENA_H + GRID;
            state._balls[0].vy = 1;
            state.tick(BALL_STEP_MS + 1);
            assert.equal(state.playerHealth, PLAYER_MAX_HEALTH - BALL_LOST_DAMAGE);
        });

        it('respawns a ball when the last one is lost and player still alive', () => {
            state.start();
            state._balls[0].y = ARENA_H + GRID;
            state._balls[0].vy = 1;
            state.tick(BALL_STEP_MS + 1);
            assert.equal(state._balls.length, 1);
        });
    });

    describe('invaders', () => {
        it('invaders step sideways after interval', () => {
            state.start();
            const before = state._invaders[0].x;
            state.tick(INVADER_MOVE_MS + 1);
            assert.notEqual(state._invaders[0].x, before);
        });

        it('invader types cycle across rows', () => {
            state.start();
            const snap = state.snapshot();
            assert.equal(snap.invaders[0].type, 0);
            assert.equal(snap.invaders[INVADER_COLS].type, 1);
            assert.equal(snap.invaders[INVADER_COLS * 2].type, 2);
        });

        it('each invader has pixel HP matching its pattern', () => {
            state.start();
            for (const inv of state._invaders) {
                const alive = inv.pixelHP.filter((h) => h > 0).length;
                assert.equal(alive, inv.totalHP);
                assert.equal(inv.totalHP, inv.maxHP);
            }
        });
    });

    describe('boss', () => {
        it('boss moves after step interval', () => {
            state.start();
            const before = state._boss.x;
            // Advance past boss step interval.
            for (let t = 0; t < 3000; t += 100) state.tick(100);
            assert.notEqual(state._boss.x, before);
        });

        it('boss shoots periodically', () => {
            state.start();
            const bulletsBefore = state._bullets.length;
            // Advance far enough for boss to shoot (1800ms + buffer).
            for (let t = 0; t < 2500; t += 100) state.tick(100);
            assert.ok(state._bullets.length > bulletsBefore);
        });
    });

    describe('towers', () => {
        it('cannot place tower without available turrets', () => {
            state.start();
            assert.equal(state.placeTower(100, 100), false);
        });

        it('places tower when turret is available', () => {
            state.start();
            state._availableTurrets = 1;
            assert.equal(state.placeTower(200, 200), true);
            assert.equal(state._towers.length, 1);
            assert.equal(state._availableTurrets, 0);
        });

        it('limits towers to MAX_TOWERS', () => {
            state.start();
            state._availableTurrets = MAX_TOWERS + 2;
            for (let i = 0; i < MAX_TOWERS; i++) {
                state.placeTower(100 + i * 50, 200);
            }
            assert.equal(state._towers.length, MAX_TOWERS);
            assert.equal(state.placeTower(500, 200), false);
        });

        it('cannot place tower too close to paddle', () => {
            state.start();
            state._availableTurrets = 1;
            const result = state.placeTower(200, state._paddle.y);
            assert.equal(result, false);
        });
    });

    describe('power-ups', () => {
        it('LIFE power-up restores health', () => {
            state.start();
            state.playerHealth = 50;
            state._applyPowerUp('LIFE');
            assert.equal(state.playerHealth, 75);
        });

        it('LIFE power-up caps at max health', () => {
            state.start();
            state._applyPowerUp('LIFE');
            assert.equal(state.playerHealth, PLAYER_MAX_HEALTH);
        });

        it('WIDE power-up doubles paddle width', () => {
            state.start();
            state._applyPowerUp('WIDE');
            assert.equal(state.snapshot().paddle.width, PADDLE_WIDTH * 2);
        });

        it('LASER power-up enables laser firing', () => {
            state.start();
            state._applyPowerUp('LASER');
            assert.equal(state.snapshot().laserActive, true);
        });

        it('MULTI power-up adds a ball', () => {
            state.start();
            assert.equal(state._balls.length, 1);
            state._applyPowerUp('MULTI');
            assert.equal(state._balls.length, 2);
        });

        it('TOWER power-up increases available turrets', () => {
            state.start();
            state._applyPowerUp('TOWER');
            assert.equal(state._availableTurrets, 1);
        });
    });

    describe('scoring + bonus drops', () => {
        it('destroying pixels increments pixel kill counter', () => {
            state.start();
            const inv = state._invaders[0];
            const aliveIdx = inv.pixelHP.findIndex((h) => h > 0);
            inv.pixelHP[aliveIdx] = 0;
            inv.totalHP--;
            state._onPixelKilled(inv.x, inv.y);
            assert.equal(state._pixelKills, 1);
        });

        it('drops a power-up every BONUS_DROP_INTERVAL pixel kills', () => {
            state.start();
            state._pixelKills = BONUS_DROP_INTERVAL - 1;
            const puBefore = state._powerUps.length;
            state._onPixelKilled(100, 100);
            assert.equal(state._powerUps.length, puBefore + 1);
            assert.equal(state._pixelKills, 0);
        });
    });

    describe('game over', () => {
        it('ends in loss when health reaches 0', () => {
            state.start();
            state.playerHealth = ENEMY_BULLET_DAMAGE;
            // Simulate enemy bullet hitting paddle.
            state._bullets.push(state._makeBullet(
                state._paddle.x + PADDLE_WIDTH / 2,
                state._paddle.y,
                1,
                'invader',
            ));
            state.tick(50);
            assert.ok(state.gameOver);
            assert.equal(state.won, false);
        });

        it('ends in win when boss and all invaders are destroyed', () => {
            state.start();
            state._invaders = [];
            state._boss = null;
            state.tick(1);
            assert.ok(state.gameOver);
            assert.ok(state.won);
        });

        it('ends in loss when invaders reach bottom', () => {
            state.start();
            for (const inv of state._invaders) inv.y = ARENA_H - 50;
            state.tick(1);
            assert.ok(state.gameOver);
            assert.equal(state.won, false);
        });

        it('emits game-over with won flag', () => {
            let payload = null;
            state.on('game-over', (p) => { payload = p; });
            state.start();
            state._invaders = [];
            state._boss = null;
            state.tick(1);
            assert.ok(payload);
            assert.ok(payload.won);
        });

        it('tick is a no-op after game over', () => {
            state.start();
            state._invaders = [];
            state._boss = null;
            state.tick(1);
            const scoreBefore = state.score;
            state.tick(1000);
            assert.equal(state.score, scoreBefore);
        });
    });

    describe('snapshot', () => {
        it('returns a complete state snapshot', () => {
            state.start();
            const snap = state.snapshot();
            assert.ok('paddle' in snap);
            assert.ok('balls' in snap);
            assert.ok('invaders' in snap);
            assert.ok('boss' in snap);
            assert.ok('towers' in snap);
            assert.ok('bullets' in snap);
            assert.ok('powerUps' in snap);
            assert.ok('score' in snap);
            assert.ok('playerHealth' in snap);
            assert.ok('laserActive' in snap);
            assert.ok('wideActive' in snap);
            assert.ok('availableTurrets' in snap);
            assert.ok('pixelKills' in snap);
            assert.ok('gameOver' in snap);
            assert.ok('won' in snap);
        });

        it('snapshot is a deep copy (mutations do not leak)', () => {
            state.start();
            const snap1 = state.snapshot();
            snap1.balls[0].x = -999;
            const snap2 = state.snapshot();
            assert.notEqual(snap2.balls[0].x, -999);
        });
    });

    describe('laser', () => {
        it('fireLaser does nothing when laser is not active', () => {
            state.start();
            const bulletsBefore = state._bullets.length;
            state.fireLaser();
            assert.equal(state._bullets.length, bulletsBefore);
        });

        it('fireLaser creates bullets when laser is active', () => {
            state.start();
            state._applyPowerUp('LASER');
            // Advance elapsed time past the cooldown so the first shot fires.
            state.tick(200);
            const bulletsBefore = state._bullets.length;
            state.fireLaser();
            assert.ok(state._bullets.length > bulletsBefore);
        });

        it('fireLaser respects cooldown', () => {
            state.start();
            state._applyPowerUp('LASER');
            state.tick(200);
            state.fireLaser();
            const count1 = state._bullets.length;
            // No time has passed — still within cooldown.
            state.fireLaser();
            assert.equal(state._bullets.length, count1);
        });
    });

    describe('injectable RNG', () => {
        it('uses provided RNG for power-up type selection', () => {
            // RNG that always returns 0 → first power-up type.
            const s = new DefenseState({ rng: seededRng([0]) });
            s.start();
            const pu = s._makePowerUp(100, 100);
            assert.equal(pu.type, 'MULTI');
        });
    });
});
