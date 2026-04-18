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
// to a tier that actually exists (tier 1 -- Classic/Classic) so the start
// button always maps to a valid leaderboard.
const DEFAULT_MODE = GAME_MODES.STELLAR;
const DEFAULT_COMPLEXITY = PIECE_COMPLEXITY.CLASSIC;

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
    };

    const startScreen = el('startScreen');
    const gameScreen = el('gameScreen');
    const startScreenScoreList = el('startScreenScoreList');
    const tierTabs = el('tierTabs');
    const tierLabel = el('tierLabel');
    const modeToggle = el('modeToggle');
    const complexityToggle = el('complexityToggle');
    const matchControlHint = el('matchControlHint');
    const playerNameInput = el('playerName');
    const soundIcon = el('soundToggleIcon');
    const soundText = el('soundToggleText');

    const audio = new Audio();
    const highScores = new HighScores();
    const state = new GameState({
        schedule: (fn, ms) => setTimeout(fn, ms),
        mode: DEFAULT_MODE,
        complexity: DEFAULT_COMPLEXITY,
    });
    const view = new GameView({ state, elements });

    view.createBoard();
    view.createPreviews();
    audio.bindState(state);
    bindInput({ state, elements });

    // UI state: which mode + complexity are currently selected, and which
    // tier is currently shown on the leaderboard. Selecting a mode +
    // complexity that matches a tier auto-switches the leaderboard to it;
    // other combos leave the leaderboard on whatever was last viewed.
    const uiState = {
        mode: DEFAULT_MODE,
        complexity: DEFAULT_COMPLEXITY,
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

    // --- Mode / complexity toggles --------------------------------------
    function applySelections() {
        modeToggle.querySelectorAll('.toggle-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.mode === uiState.mode);
        });
        complexityToggle.querySelectorAll('.toggle-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.complexity === uiState.complexity);
        });
        // Update controls-panel hint: in Tetris mode clicking does nothing
        // so the "Match 4+ Colors" line is misleading.
        if (matchControlHint) {
            matchControlHint.style.display = uiState.mode === GAME_MODES.TETRIS ? 'none' : '';
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
        state.configure({ mode: uiState.mode, complexity: uiState.complexity });
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
