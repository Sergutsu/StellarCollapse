// Bootstrap: wire GameState + GameView + Audio + Input, handle screen
// transitions and high scores. Tiny on purpose; everything meaningful
// lives in the dedicated modules.

import { GameState } from './game-state.js';
import { GameView } from './game-view.js';
import { Audio } from './audio.js';
import { HighScores } from './highscores.js';
import { bindInput } from './input.js';
import { createStarsBackground, injectEffectKeyframes } from './stars.js';
import {
    GAME_MODES,
    PIECE_COMPLEXITY,
    HIGHSCORE_TIERS,
    FIELD_SIZES,
    DEFAULT_FIELD_SIZE_ID,
    getSizeMultiplier,
    findTier,
} from './constants.js';

const el = (id) => document.getElementById(id);

function renderLeaderboard(listEl, entries) {
    listEl.innerHTML = '';
    if (!entries || entries.length === 0) {
        listEl.innerHTML = '<div class="text-gray-400 text-center py-4">No scores yet in this tier.<br>Be the first to rank!</div>';
        return;
    }
    entries.forEach((entry, index) => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center py-2 px-3 rounded border border-gray-700 bg-gray-800 bg-opacity-50';
        div.innerHTML = `
            <span class="text-yellow-300 font-bold">#${index + 1}</span>
            <span class="text-white font-medium"></span>
            <span class="text-green-300 font-bold"></span>
        `;
        // textContent writes to sidestep any HTML injection via pilot names.
        const nameEl = div.children[1];
        const scoreEl = div.children[2];
        nameEl.textContent = entry.name;
        scoreEl.textContent = entry.score.toLocaleString();
        listEl.appendChild(div);
    });
}

// Default selections the first time the UI opens. Mode/complexity default
// to a tier that actually exists (tier 1 -- Stellar/Classic) so the start
// button always maps to a valid leaderboard.
const DEFAULT_MODE = GAME_MODES.STELLAR;
const DEFAULT_COMPLEXITY = PIECE_COMPLEXITY.CLASSIC;
const DEFAULT_SIZE_ID = DEFAULT_FIELD_SIZE_ID;

function boot() {
    injectEffectKeyframes();
    createStarsBackground(document.getElementById('starsContainer'));

    const elements = {
        container: el('gameContainer'),
        board: el('gameBoard'),
        active: el('activePiece'),
        effects: el('gameEffects'),
        nextPreview: el('nextPiece'),
        smallPreviews: [el('nextPiece2'), el('nextPiece3'), el('nextPiece4')],
        score: el('score'),
        level: el('level'),
        lines: el('lines'),
        multiplier: el('multiplier'),
        levelInfo: el('levelInfo'),
        levelProgress: el('levelProgress'),
    };

    const startScreen = el('startScreen');
    const gameScreen = el('gameScreen');
    const startScreenScoreList = el('startScreenScoreList');
    const tierTabs = el('tierTabs');
    const tierLabel = el('tierLabel');
    const modeToggle = el('modeToggle');
    const complexityToggle = el('complexityToggle');
    const fieldSizeToggle = el('fieldSizeToggle');
    const matchControlHint = el('matchControlHint');
    const matchControlHintText = el('matchControlHintText');
    const playerNameInput = el('playerName');
    const soundIcon = el('soundToggleIcon');
    const soundText = el('soundToggleText');

    const audio = new Audio();
    const highScores = new HighScores();
    const state = new GameState({
        schedule: (fn, ms) => setTimeout(fn, ms),
        mode: DEFAULT_MODE,
        complexity: DEFAULT_COMPLEXITY,
        fieldSizeId: DEFAULT_SIZE_ID,
    });
    const view = new GameView({ state, elements });
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

    // --- In-game title star: reacts to gameplay events ---------------
    // Adds a short-lived modifier class; the CSS animation self-resets
    // after ~1s. If a second event arrives mid-animation we force a
    // reflow so the class is re-applied and the animation restarts.
    const titleStar = el('titleStar');
    let starResetTimer = 0;
    function reactStar(modifier, ms = 700) {
        if (!titleStar) return;
        titleStar.classList.remove(
            'title-star--lock', 'title-star--line', 'title-star--match',
            'title-star--bomb', 'title-star--snake', 'title-star--levelup',
            'title-star--gameover', 'title-star--reacting',
        );
        // Force reflow so re-adding the class restarts the CSS animation.
        void titleStar.offsetWidth;
        titleStar.classList.add('title-star--reacting', modifier);
        clearTimeout(starResetTimer);
        starResetTimer = setTimeout(() => {
            titleStar.classList.remove('title-star--reacting', modifier);
        }, ms);
    }
    state.on('piece-locked',    () => reactStar('title-star--lock', 320));
    state.on('lines-cleared',   () => reactStar('title-star--line', 600));
    state.on('match-cleared',   ({ special }) => {
        // The "snake" run visually is its own event; handled below so we
        // don't fire two reactions for one clear.
        if (special && special.type === 'snake') return;
        reactStar('title-star--match', 600);
    });
    state.on('bomb-exploded',   () => reactStar('title-star--bomb', 800));
    state.on('snake-activated', () => reactStar('title-star--snake', 950));
    state.on('level-up',        () => reactStar('title-star--levelup', 800));
    state.on('game-over',       () => reactStar('title-star--gameover', 1200));

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
    const levelTipEl = el('levelTip');
    function pickTip(mode, level) {
        const pool = LEVEL_TIPS[mode] || LEVEL_TIPS.stellar;
        return pool[(level - 1) % pool.length];
    }
    function refreshTip() {
        if (levelTipEl) levelTipEl.textContent = pickTip(state.mode, state.level);
    }
    state.on('game-started', refreshTip);
    state.on('level-up',     refreshTip);

    // UI state: which mode + complexity are currently selected, and which
    // tier is currently shown on the leaderboard. Selecting a mode +
    // complexity that matches a tier auto-switches the leaderboard to it;
    // other combos leave the leaderboard on whatever was last viewed.
    const uiState = {
        mode: DEFAULT_MODE,
        complexity: DEFAULT_COMPLEXITY,
        fieldSizeId: DEFAULT_SIZE_ID,
        selectedTierId: HIGHSCORE_TIERS[0].id,
    };

    // --- Tier tabs -------------------------------------------------------
    // Build a tab per tier, color the icon from the tier color (green ->
    // red gradient baked into constants.js).
    const tabNodes = [];
    HIGHSCORE_TIERS.forEach((tier) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'tier-tab';
        tab.dataset.tierId = tier.id;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', 'false');
        tab.title = tier.label;
        tab.style.color = tier.color;
        tab.innerHTML = `
            <i class="fas fa-rocket tier-icon"></i>
            <span class="tier-short"></span>
        `;
        tab.querySelector('.tier-short').textContent = tier.short;
        tab.addEventListener('click', () => {
            uiState.selectedTierId = tier.id;
            refreshLeaderboard();
        });
        tierTabs.appendChild(tab);
        tabNodes.push(tab);
    });

    function refreshLeaderboard() {
        const tier = HIGHSCORE_TIERS.find((t) => t.id === uiState.selectedTierId)
            || HIGHSCORE_TIERS[0];
        tabNodes.forEach((tab) => {
            const active = tab.dataset.tierId === tier.id;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        tierLabel.textContent = tier.label;
        tierLabel.style.color = tier.color;
        renderLeaderboard(startScreenScoreList, highScores.top(tier.id));
    }

    // --- Field size toggle ----------------------------------------------
    // The sizes (cols x rows) are per-complexity -- rebuild the buttons
    // whenever complexity changes. Size ids ('small' / 'medium' / 'large')
    // are stable across complexities so the player's picked size carries
    // through; only the actual dimensions change.
    function renderFieldSizeToggle() {
        if (!fieldSizeToggle) return;
        fieldSizeToggle.innerHTML = '';
        const sizes = FIELD_SIZES[uiState.complexity] || FIELD_SIZES[PIECE_COMPLEXITY.CLASSIC];
        const hasCurrent = sizes.some((s) => s.id === uiState.fieldSizeId);
        if (!hasCurrent) uiState.fieldSizeId = DEFAULT_SIZE_ID;
        sizes.forEach((size) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'toggle-btn field-size-btn';
            btn.dataset.sizeId = size.id;
            const mult = getSizeMultiplier(size.id);
            // Render e.g. "x1.5" without trailing zeros: 1.5 -> "x1.5",
            // 1.0 -> "x1", 0.75 -> "x0.75". `toString` on a Number drops
            // trailing zeros automatically.
            const multStr = `x${Number(mult).toString()}`;
            btn.title = `${size.cols} columns x ${size.rows} rows -- score multiplier ${multStr}`;
            btn.innerHTML = `
                <span class="field-size-label"></span>
                <span class="field-size-mult"></span>
            `;
            btn.querySelector('.field-size-label').textContent = size.label;
            btn.querySelector('.field-size-mult').textContent = multStr;
            if (size.id === uiState.fieldSizeId) btn.classList.add('active');
            btn.addEventListener('click', () => {
                uiState.fieldSizeId = size.id;
                applySelections();
            });
            fieldSizeToggle.appendChild(btn);
        });
    }

    // --- Mode / complexity toggles --------------------------------------
    function applySelections() {
        modeToggle.querySelectorAll('.toggle-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.mode === uiState.mode);
        });
        complexityToggle.querySelectorAll('.toggle-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.complexity === uiState.complexity);
        });
        renderFieldSizeToggle();
        // Controls-panel hint:
        //   - BLOCKS: click-match is disabled entirely -> hide the row.
        //   - AUTO_MATCH: clicks still aren't required, but the mechanic
        //     is about auto-clears on lock -- explicitly say "Auto" so
        //     players aren't surprised when clicking does nothing.
        //   - STELLAR: original manual click-match.
        if (matchControlHint && matchControlHintText) {
            if (uiState.mode === GAME_MODES.BLOCKS) {
                matchControlHint.style.display = 'none';
            } else {
                matchControlHint.style.display = '';
                if (uiState.mode === GAME_MODES.AUTO_MATCH) {
                    matchControlHintText.textContent = 'Auto-Match on Lock';
                } else {
                    matchControlHintText.textContent = 'Match 4+ Colors';
                }
            }
        }
        // If the current selection maps to a tier, sync the leaderboard
        // to it so the player sees the scoreboard they're about to play on.
        const tier = findTier(uiState.mode, uiState.complexity);
        if (tier) uiState.selectedTierId = tier.id;
        refreshLeaderboard();
    }

    modeToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        uiState.mode = btn.dataset.mode;
        applySelections();
    });
    complexityToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        uiState.complexity = btn.dataset.complexity;
        applySelections();
    });

    applySelections();
    playerNameInput.focus();
    playerNameInput.select();

    const showStart = () => {
        gameScreen.classList.add('opacity-0', 'pointer-events-none');
        startScreen.classList.remove('opacity-0', 'pointer-events-none');
        refreshLeaderboard();
    };
    const showGame = () => {
        startScreen.classList.add('opacity-0', 'pointer-events-none');
        gameScreen.classList.remove('opacity-0', 'pointer-events-none');
    };

    state.on('game-over', ({ score }) => {
        const name = (playerNameInput.value || '').trim() || 'Pilot';
        // Only save to a leaderboard if the (mode, complexity) the player
        // actually played is one of the 6 ranked tiers. Every legal
        // start-screen selection currently does map to a tier.
        const tier = findTier(state.mode, state.complexity);
        if (tier && score > 0) {
            highScores.save(tier.id, name, score);
            uiState.selectedTierId = tier.id;
        }
        showStart();
    });

    el('startBtn').addEventListener('click', () => {
        if (!audio.ctx && audio.enabled) audio.init();
        audio.resume();
        state.configure({
            mode: uiState.mode,
            complexity: uiState.complexity,
            fieldSizeId: uiState.fieldSizeId,
        });
        // Rebuild the board DOM for the new grid dimensions before starting.
        view.createBoard();
        state.start();
        showGame();
        lastFrame = 0;
        requestAnimationFrame(loop);
    });

    el('endGameBtn').addEventListener('click', () => {
        state.endGameEarly();
    });

    el('soundToggleBtn').addEventListener('click', () => {
        const on = audio.toggle();
        soundIcon.className = on ? 'fas fa-volume-up mr-2' : 'fas fa-volume-mute mr-2';
        soundText.textContent = on ? 'Sound ON' : 'Sound OFF';
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
