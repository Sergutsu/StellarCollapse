// Bootstrap: wire GameState + PixiView + Audio + Input, handle screen
// transitions. Tiny on purpose; everything meaningful lives in the
// dedicated modules. Highscores have been removed -- the game loop is
// about mission-run resource tallies now (landing in P1+).

import { GameState } from './game-state.js';
import { DefenseState } from './defense-state.js';
import { PixiView } from './pixi-view.js';
import { Audio } from './audio.js';
import { bindInput } from './input.js';
import { bindDefenseInput } from './defense-input.js';
import { MetaState } from './meta-state.js';
import { Persistence } from './persistence.js';
import { RunLedger } from './run-ledger.js';
import {
    GAME_MODES,
    PIECE_COMPLEXITY,
    DEFAULT_FIELD_SIZE_ID,
} from './constants.js';

const el = (id) => document.getElementById(id);

// Default selections the first time the UI opens. Mode/complexity
// default to tier 1 (Stellar/Classic) which is the mission the player
// starts highlighted on the board.
const DEFAULT_MODE = GAME_MODES.STELLAR;
const DEFAULT_COMPLEXITY = PIECE_COMPLEXITY.CLASSIC;
const DEFAULT_SIZE_ID = DEFAULT_FIELD_SIZE_ID;

async function boot() {
    const elements = {
        container: el('gameContainer'),
    };

    const audio = new Audio();
    // Persistence + MetaState. If localStorage is unavailable (SSR,
    // private-mode Safari, quota errors) the game still boots with a
    // fresh starter profile; save() just no-ops. No feature flag --
    // persistence is always on where the platform supports it.
    const persistence = new Persistence();
    const meta = new MetaState(persistence.load());
    meta.on('change', () => { persistence.save(meta.snapshot()); });
    const state = new GameState({
        schedule: (fn, ms) => setTimeout(fn, ms),
        mode: DEFAULT_MODE,
        complexity: DEFAULT_COMPLEXITY,
        fieldSizeId: DEFAULT_SIZE_ID,
    });
    const view = new PixiView({ state, meta, elements });
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
    bindInput({ state, elements, view });
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

    // --- Per-run tally (P1) -----------------------------------------
    //
    // `currentRun` holds the active mission + its RunLedger while a
    // run is in flight. `game-over` takes the final summary, shows
    // the results overlay, and stashes a CONTINUE handler that wires
    // the reward into MetaState (which then auto-saves via the meta
    // listener above). Both references are cleared on CONTINUE so a
    // second run starts with a clean tally.
    let currentRun = null;

    state.on('game-over', () => {
        const run = currentRun;
        if (!run || !run.mission) {
            // No mission selected (e.g. sandbox boot); keep behaviour
            // matching the pre-P1 path and drop straight back to the
            // hub without trying to render a results panel.
            view.showStartScreen();
            return;
        }
        const summary = run.ledger.summary(state);
        const envelope = run.ledger.rewardEnvelope(summary);
        run.ledger.detach();
        view.showResultsScreen(summary, {
            onContinue: () => {
                meta.applyMissionReward(envelope);
                view.hideResultsScreen();
                view.showStartScreen();
                currentRun = null;
            },
        });
    });

    // --- Defense mission support ---------------------------------
    let defenseState = null;
    let defenseInputTeardown = null;
    let defenseRaf = 0;

    function launchDefenseMission(mission) {
        if (!audio.ctx && audio.enabled) audio.init();
        audio.resume();

        defenseState = new DefenseState({
            rng: Math.random,
            schedule: (fn, ms) => setTimeout(fn, ms),
        });

        defenseState.on('game-over', ({ won, score }) => {
            if (defenseInputTeardown) { defenseInputTeardown(); defenseInputTeardown = null; }
            cancelAnimationFrame(defenseRaf);

            // Build a results-compatible summary from the defense run.
            const summary = {
                missionName: mission?.narrativeName || 'Defense Mission',
                sector: mission?.sector || 'Unknown Sector',
                tier: mission?.tierId || 'defense',
                won,
                score,
                level: 1,
                lines: 0,
                cells: 0,
                matches: 0,
                bombs: 0,
                ores: {},
                credits: Math.floor(score / 10),
                baseCredits: mission?.baseCredits || 0,
            };
            const envelope = {
                credits: summary.credits,
                ores: {},
                missionId: mission?.id || null,
            };

            view.showResultsScreen(summary, {
                onContinue: () => {
                    meta.applyMissionReward(envelope);
                    view.hideResultsScreen();
                    view.showStartScreen();
                    defenseState = null;
                },
            });
        });

        defenseState.start();
        view.showDefenseScreen(defenseState);

        if (view.app?.canvas) {
            defenseInputTeardown = bindDefenseInput({
                state: defenseState,
                canvas: view.app.canvas,
                getScale: () => view._defense?.scale ?? 1,
                getOffset: () => ({
                    x: view._defense?._root?.x ?? 0,
                    y: view._defense?._root?.y ?? 0,
                }),
            });
        }

        let lastDefenseFrame = -1;
        function defenseLoop(time = 0) {
            if (defenseState?.gameOver) return;
            defenseRaf = requestAnimationFrame(defenseLoop);
            if (lastDefenseFrame < 0) { lastDefenseFrame = time; return; }
            const delta = time - lastDefenseFrame;
            lastDefenseFrame = time;
            defenseState?.tick(delta);
        }
        defenseRaf = requestAnimationFrame(defenseLoop);
    }

    view.onStartGame(({ mode, complexity, fieldSizeId, mission }) => {
        // Route Combat / defense missions to the defense game mode.
        if (mission?.type === 'Combat') {
            launchDefenseMission(mission);
            return;
        }

        if (!audio.ctx && audio.enabled) audio.init();
        audio.resume();
        state.configure({
            mode,
            complexity,
            fieldSizeId,
        });
        // Tear down any stale ledger from a run the player quit early
        // without hitting CONTINUE so listeners don't double-fire.
        if (currentRun?.ledger) currentRun.ledger.detach();
        currentRun = {
            mission: mission || null,
            ledger: new RunLedger({ state, mission }),
        };
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
