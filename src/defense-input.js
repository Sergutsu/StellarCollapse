// Input wiring for the defense (Space-Invaders / Breakout) mission mode.
// Translates keyboard, mouse, and touch events into DefenseState verbs.
//
// Returns a teardown function so the caller can unbind everything when
// the defense scene is hidden or destroyed.

import { GRID } from './defense-constants.js';

export function bindDefenseInput({ state, canvas, getScale }) {
    const keys = {};
    const scale = () => (typeof getScale === 'function' ? getScale() : 1);

    function onKeyDown(e) {
        if (state.gameOver) return;
        keys[e.key] = true;
        if (e.code === 'Space') keys.Space = true;

        switch (e.key) {
            case 'ArrowLeft':
            case 'a':
            case 'A':
                e.preventDefault();
                state.movePaddleBy(-1);
                break;
            case 'ArrowRight':
            case 'd':
            case 'D':
                e.preventDefault();
                state.movePaddleBy(1);
                break;
            case ' ':
                e.preventDefault();
                state.fireLaser();
                break;
        }
    }

    function onKeyUp(e) {
        keys[e.key] = false;
        if (e.code === 'Space') keys.Space = false;
    }

    function onPointerMove(e) {
        if (state.gameOver) return;
        const rect = canvas.getBoundingClientRect();
        const s = scale();
        const x = Math.max(0, Math.min(800, (e.clientX - rect.left) / s));
        state.setPaddleTarget(x);
    }

    function onPointerDown(e) {
        if (state.gameOver) return;
        const rect = canvas.getBoundingClientRect();
        const s = scale();
        const x = (e.clientX - rect.left) / s;
        const y = (e.clientY - rect.top) / s;
        state.placeTower(x, y);
    }

    // Continuous laser firing while space is held.
    let laserInterval = null;
    function startLaserLoop() {
        if (laserInterval) return;
        laserInterval = setInterval(() => {
            if (keys[' '] || keys.Space) state.fireLaser();
        }, 80);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    startLaserLoop();

    return function teardown() {
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerdown', onPointerDown);
        if (laserInterval) { clearInterval(laserInterval); laserInterval = null; }
    };
}
