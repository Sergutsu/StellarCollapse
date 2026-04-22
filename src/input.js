// Keyboard + click wiring. Translates raw DOM events into GameState verbs.
// Stays in one small file so changing the control scheme (or adding a
// touch layer later) doesn't touch state or view internals.

export function bindInput({ state, elements }) {
    document.addEventListener('keydown', (event) => {
        if (state.gameOver) return;
        switch (event.key) {
            case 'ArrowLeft':
                event.preventDefault();
                state.move(-1, 0);
                break;
            case 'ArrowRight':
                event.preventDefault();
                state.move(1, 0);
                break;
            case 'ArrowDown':
                event.preventDefault();
                state.move(0, 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                state.rotate();
                break;
            case ' ':
                event.preventDefault();
                state.hardDrop();
                break;
        }
    });

    // Touch gestures (mobile): swipe to move/rotate/drop so the game
    // stays fully playable without a physical keyboard.
    const canvas = elements?.container?.querySelector?.('canvas');
    if (!canvas) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTs = 0;
    let activePointerId = null;

    const SWIPE_PX = 24;
    const FAST_SWIPE_MS = 140;

    canvas.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch') return;
        activePointerId = event.pointerId;
        touchStartX = event.clientX;
        touchStartY = event.clientY;
        touchStartTs = performance.now();
    });

    canvas.addEventListener('pointerup', (event) => {
        if (event.pointerType !== 'touch') return;
        if (activePointerId !== event.pointerId) return;
        if (state.gameOver) return;

        const dx = event.clientX - touchStartX;
        const dy = event.clientY - touchStartY;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const dt = Math.max(1, performance.now() - touchStartTs);

        activePointerId = null;

        if (adx < SWIPE_PX && ady < SWIPE_PX) return;

        if (adx > ady) {
            state.move(dx > 0 ? 1 : -1, 0);
            return;
        }
        if (dy < -SWIPE_PX) {
            state.rotate();
            return;
        }
        if (dy > SWIPE_PX) {
            if (dy > 88 || dt <= FAST_SWIPE_MS) state.hardDrop();
            else state.move(0, 1);
        }
    });
}
