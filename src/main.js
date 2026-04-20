// Bootstrap: wire GameState + PixiView + Audio + Input, handle screen
// transitions and high scores. Tiny on purpose; everything meaningful
// lives in the dedicated modules.

import { GameState } from './game-state.js';
import { PixiView } from './pixi-view.js';
import { Audio } from './audio.js';
import { HighScores } from './highscores.js';
import { bindInput } from './input.js';
import {
    GAME_MODES,
    PIECE_COMPLEXITY,
    DEFAULT_FIELD_SIZE_ID,
    findTier,
} from './constants.js';

const el = (id) => document.getElementById(id);

// Default selections the first time the UI opens. Mode/complexity default
// to a tier that actually exists (tier 1 -- Stellar/Classic) so the start
// button always maps to a valid leaderboard.
const DEFAULT_MODE = GAME_MODES.STELLAR;
const DEFAULT_COMPLEXITY = PIECE_COMPLEXITY.CLASSIC;
const DEFAULT_SIZE_ID = DEFAULT_FIELD_SIZE_ID;

async function boot() {
    const elements = {
        container: el('gameContainer'),
    };

    const audio = new Audio();
    const highScores = new HighScores();
    const state = new GameState({
        schedule: (fn, ms) => setTimeout(fn, ms),
        mode: DEFAULT_MODE,
        complexity: DEFAULT_COMPLEXITY,
        fieldSizeId: DEFAULT_SIZE_ID,
    });
    const view = new PixiView({ state, elements });
    // Pixi needs an async bootstrap. Await it before createBoard so
    // the stage/ticker are ready before any state event fires.
    await view.init();
    // Per-level flavor text. Short enough to not steal attention from the
    // board. Indexed by level (1-based); levels beyond the list wrap to
    // the last entry so veterans still get something to read.
    const LEVEL_INFO = [
        'Cosmic Dust',
        'Stellar Nursery',
        'Main Sequence',
        'Red Giant',
        'Supernova',
        'Neutron Star',
        'Black Hole',
        'Quasar',
        'Galactic Core',
        'Heat Death',
    ];
    view._levelInfoFor = (lvl) => LEVEL_INFO[Math.min(lvl, LEVEL_INFO.length) - 1] || LEVEL_INFO[LEVEL_INFO.length - 1];

    view.createBoard();
    view.createPreviews();
    audio.bindState(state);
    bindInput({ state, elements });
    view.setTopControlsHandlers({
        onExit: () => state.endGameEarly(),
        onToggleSound: () => {
            const on = audio.toggle();
            view.setSoundEnabled(on);
        },
    });
    view.setSoundEnabled(audio.enabled);

    // --- Mission tips: short cue per level ---------------------------
    const LEVEL_TIPS = {
        stellar: [
            'Click any run of 4+ same-color cells to clear.',
            'Bigger matches score the same per cell -- but stack chain reactions.',
            'Save a long column for a later 5-run bomb spawn.',
            'Rotate against a wall to wedge pieces into gaps.',
            'Lines still clear -- don\'t forget plain old stacking.',
            'Hard drop when the next piece queue looks friendly.',
        ],
        'auto-match': [
            'Lock a piece that completes 4+ in a row and it auto-clears.',
            'Cross patterns score every unique cell once -- no double dip.',
            'Plan colors two pieces ahead using the COMING UP preview.',
            'On COLLAPSED, bomb cells ride in with the next piece -- watch for them.',
            'Auto-match still triggers on vertical runs.',
            'Fill below, not above -- a tall stack kills your spawn zone.',
        ],
        blocks: [
            'Only full horizontal lines score. Colors do not matter.',
            'Flat stacks beat fancy ones -- leave one column for line clears.',
            'Use soft-drop to thread pieces into tight gaps.',
            'Four-line clears still exist -- bank a tall well for the bonus.',
            'Hard drop when you\'re confident; you can\'t undo it.',
            'The field grows taller on Mutated and Collapsed -- pace yourself.',
        ],
    };
    function pickTip(mode, level) {
        const pool = LEVEL_TIPS[mode] || LEVEL_TIPS.stellar;
        return pool[(level - 1) % pool.length];
    }
    function refreshTip() {
        const text = pickTip(state.mode, state.level);
        view.setTip(text);
    }
    state.on('game-started', refreshTip);
    state.on('level-up',     refreshTip);

    view.setHighScores(highScores);
    view.setSelectedTier(findTier(DEFAULT_MODE, DEFAULT_COMPLEXITY)?.id);

    state.on('game-over', ({ score }) => {
        // Player identity is fixed to "Chief Dispatcher" now that the
        // start screen is a mission-select. Callsign / reputation /
        // persistent ledger come in a later PR.
        const name = 'Chief Dispatcher';
        // Only save to a leaderboard if the (mode, complexity) the player
        // actually played is one of the 9 ranked tiers. Every legal
        // start-screen selection currently does map to a tier.
        const tier = findTier(state.mode, state.complexity);
        if (tier && score > 0) {
            highScores.save(tier.id, name, score);
            view.setSelectedTier(tier.id);
        }
        view.showStartScreen();
    });

    view.onStartGame(({ mode, complexity, fieldSizeId }) => {
        if (!audio.ctx && audio.enabled) audio.init();
        audio.resume();
        state.configure({
            mode,
            complexity,
            fieldSizeId,
        });
        // Rebuild the board DOM for the new grid dimensions before starting.
        view.createBoard();
        state.start();
        view.showGameScreen();
        lastFrame = 0;
        requestAnimationFrame(loop);
    });

    let lastFrame = 0;
    function loop(time = 0) {
        if (state.gameOver) return;
        requestAnimationFrame(loop);
        const delta = time - lastFrame;
        lastFrame = time;
        state.tick(delta);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
