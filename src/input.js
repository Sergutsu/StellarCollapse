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

    // Click-to-match is handled by PixiView's canvas hit detection.
    // Keep input.js focused on keyboard controls.
}
