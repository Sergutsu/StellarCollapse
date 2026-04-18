// Tetromino + special-shape templates.
// Each shape is a square-ish 2D matrix of 0/1. 1 means the cell is part of
// the piece; 0 is empty. Colors are assigned at spawn time, so these are
// purely geometric.

export const SHAPES = [
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
