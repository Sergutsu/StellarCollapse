// Tetromino + special-shape templates.
// Each shape is a square-ish 2D matrix of 0/1. 1 means the cell is part of
// the piece; 0 is empty. Colors are assigned at spawn time, so these are
// purely geometric.

import { PIECE_COMPLEXITY } from './constants.js';

// The seven classic tetrominoes, in canonical order (I, J, L, O, S, T, Z).
export const CLASSIC_SHAPES = [
    // I
    [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ],
    // J
    [
        [1, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
    ],
    // L
    [
        [0, 0, 1],
        [1, 1, 1],
        [0, 0, 0],
    ],
    // O
    [
        [1, 1],
        [1, 1],
    ],
    // S
    [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0],
    ],
    // T
    [
        [0, 1, 0],
        [1, 1, 1],
        [0, 0, 0],
    ],
    // Z
    [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0],
    ],
];

// The mutated pool = classic seven + eight non-standard shapes that
// stress click-to-match chains (crosses, diamonds, windmills, etc.).
export const MUTATED_SHAPES = [
    ...CLASSIC_SHAPES,
    // Cross (Plus)
    [
        [0, 1, 0],
        [1, 1, 1],
        [0, 1, 0],
    ],
    // Big L
    [
        [1, 0, 0, 0],
        [1, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
    ],
    // Zigzag
    [
        [1, 0, 1],
        [1, 1, 1],
        [0, 0, 0],
    ],
    // X shape
    [
        [1, 0, 1],
        [0, 1, 0],
        [1, 0, 1],
    ],
    // Corner
    [
        [1, 1, 0],
        [1, 0, 0],
        [1, 0, 0],
    ],
    // Diamond (4x4)
    [
        [0, 0, 1, 0],
        [0, 1, 1, 1],
        [1, 1, 1, 1],
        [0, 1, 1, 0],
    ],
    // Windmill (4x4)
    [
        [1, 0, 0, 1],
        [0, 1, 1, 0],
        [0, 1, 1, 0],
        [1, 0, 0, 1],
    ],
    // Temple (4x4)
    [
        [0, 1, 1, 0],
        [1, 1, 1, 1],
        [1, 0, 0, 1],
        [1, 0, 0, 1],
    ],
];

// COLLAPSED uses the same 15-shape pool as MUTATED; what makes it harder
// is spawn-time mutation (random cells become bombs). Kept as an alias so
// the pool is a single source of truth and tests can reason about it.
export const COLLAPSED_SHAPES = MUTATED_SHAPES;

// Backward-compat export: the game-state module used to import SHAPES
// directly. Keep it pointing at the full mutated pool so any code path we
// didn't migrate still works.
export const SHAPES = MUTATED_SHAPES;

export function getShapePool(complexity) {
    if (complexity === PIECE_COMPLEXITY.CLASSIC) return CLASSIC_SHAPES;
    if (complexity === PIECE_COMPLEXITY.COLLAPSED) return COLLAPSED_SHAPES;
    return MUTATED_SHAPES;
}

// 90-degree clockwise rotation of a rectangular matrix. Works for both
// square and non-square pieces; callers pass shape and colorMatrix through
// this independently so nulls in the color matrix don't trip anything.
export function rotateMatrix(matrix) {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const rotated = Array.from({ length: cols }, () => Array(rows).fill(null));
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            rotated[x][rows - 1 - y] = matrix[y][x];
        }
    }
    return rotated;
}
