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

    elements.container.addEventListener('click', (event) => {
        if (state.gameOver) return;
        const cell = event.target && event.target.closest
            ? event.target.closest('.cell.filled')
            : null;
        if (!cell || !elements.board.contains(cell)) return;
        const x = Number(cell.dataset.x);
        const y = Number(cell.dataset.y);
        if (!(x >= 0 && x < state.cols && y >= 0 && y < state.rows)) return;
        state.clickCell(x, y);
    });
}
