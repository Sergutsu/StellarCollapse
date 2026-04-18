// Bootstrap: wire GameState + GameView + Audio + Input, handle screen
// transitions and high scores. Tiny on purpose; everything meaningful
// lives in the dedicated modules.

import { GameState } from './game-state.js';
import { GameView } from './game-view.js';
import { Audio } from './audio.js';
import { HighScores } from './highscores.js';
import { bindInput } from './input.js';
import { createStarsBackground, injectEffectKeyframes } from './stars.js';

const el = (id) => document.getElementById(id);

function updateLeaderboard(listEl, entries) {
    listEl.innerHTML = '';
    if (entries.length === 0) {
        listEl.innerHTML = '<div class="text-gray-400 text-center py-4">No high scores yet!<br>Be the first to play!</div>';
        return;
    }
    entries.forEach((entry, index) => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center py-2 px-3 rounded border border-gray-700 bg-gray-800 bg-opacity-50';
        div.innerHTML = `
            <span class="text-yellow-300 font-bold">#${index + 1}</span>
            <span class="text-white font-medium">${entry.name}</span>
            <span class="text-green-300 font-bold">${entry.score.toLocaleString()}</span>
        `;
        listEl.appendChild(div);
    });
}

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
    const playerNameInput = el('playerName');
    const soundIcon = el('soundToggleIcon');
    const soundText = el('soundToggleText');

    const audio = new Audio();
    const highScores = new HighScores();
    const state = new GameState({ schedule: (fn, ms) => setTimeout(fn, ms) });
    const view = new GameView({ state, elements });

    view.createBoard();
    view.createPreviews();
    audio.bindState(state);
    bindInput({ state, elements });

    updateLeaderboard(startScreenScoreList, highScores.top());
    playerNameInput.focus();
    playerNameInput.select();

    const showStart = () => {
        gameScreen.classList.add('opacity-0', 'pointer-events-none');
        startScreen.classList.remove('opacity-0', 'pointer-events-none');
        updateLeaderboard(startScreenScoreList, highScores.top());
    };
    const showGame = () => {
        startScreen.classList.add('opacity-0', 'pointer-events-none');
        gameScreen.classList.remove('opacity-0', 'pointer-events-none');
    };

    state.on('game-over', ({ score }) => {
        const name = (playerNameInput.value || '').trim() || 'Pilot';
        highScores.save(name, score);
        showStart();
    });

    el('startBtn').addEventListener('click', () => {
        if (!audio.ctx && audio.enabled) audio.init();
        audio.resume();
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
