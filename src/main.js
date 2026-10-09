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
import { RunLedger, DefenseLedger } from './run-ledger.js';
import { settleMission } from './settlement.js';
import { repInfo } from './reputation.js';
import { summarizeOffline } from './idle-clock.js';
import {
    GAME_MODES,
    PIECE_COMPLEXITY,
    DEFAULT_FIELD_SIZE_ID,
} from './constants.js';

const el = (id) => document.getElementById(id);

// Default selections the first time the UI opens. The Miner minigame is
// the sandbox default; Stellar/Classic remains the first mission card on
// the board for the match-4 game.
const DEFAULT_MODE = GAME_MODES.BLOCKS;
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
    // Offline report has to be computed BEFORE the first `touch()`, since
    // the whole point is the gap between the last time the hub was alive
    // and now. Idle jobs store absolute end times, so nothing needs to be
    // simulated — this just counts what finished while the tab was closed.
    const offlineReport = summarizeOffline({
        jobs: meta.activeMissionsSnapshot(),
        lastSeenMs: meta.lastTickAt,
        nowMs: Date.now(),
    });
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
    if (offlineReport.completed.length > 0) {
        view.setOfflineSummary(offlineReport);
    }

    // Keep the "hub was alive" clock fresh so the next offline report
    // measures from the last real heartbeat instead of the last mutation.
    meta.touch();
    window.setInterval(() => meta.touch(), 30_000);
    const stampAndSave = () => {
        meta.touch();
        persistence.save(meta.snapshot());
    };
    window.addEventListener('pagehide', stampAndSave);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') stampAndSave();
    });
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
            'Minerals fall in from all four edges -- toward the core.',
            'Fill a solid 6x6 square around the center to collapse it.',
            'Bigger cores collapse for more -- build 7x7 or 8x8 when you can.',
            'Arrow keys move relative to the screen; soft drop follows the fall.',
            'Collapses leave holes behind -- no gravity here, plan around them.',
            'Never seal an edge shut: a blocked spawn ends the run.',
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

    // --- Mission settlement (P8) ------------------------------------
    //
    // One reward path for every minigame. The hub owns the dispatch job
    // (which ship + crew were sent); main.js owns the run summary. Both
    // go into settleMission(), which applies crew level, hull fit, the
    // tech tree, charted-sector bonuses and rep, and hands back a single
    // settlement the results screen renders and CONTINUE banks.
    function settleManualRun(mission, summary, { won = true } = {}) {
        const job = view.getManualDispatch(mission?.id);
        const ship = job ? meta.fleetSnapshot().find((s) => s.id === job.shipId) || null : null;
        const crew = job ? meta.crewSnapshot().find((c) => c.id === job.crewId) || null : null;
        return settleMission({
            mission,
            job,
            summary,
            ship,
            crew,
            effects: meta.getEffects(),
            discoveredSectors: meta.discoveredSectorIds(),
            dispatchMode: 'manual',
            won,
            nowMs: Date.now(),
        });
    }

    // Merge a run summary with its settlement into the report the results
    // scene renders. The settlement's numbers win: they are what actually
    // lands in the profile.
    function buildReport(summary, settlement) {
        const before = meta.getRepInfo();
        const projected = repInfo(meta.reputation + (settlement?.rep || 0));
        return {
            ...summary,
            credits: settlement.credits,
            creditsBreakdown: settlement.creditsBreakdown,
            ores: settlement.ores,
            rep: settlement.rep,
            repTierBefore: before.tier,
            repTierAfter: projected.tier,
            repTitleAfter: projected.title,
            promoted: projected.tier > before.tier,
            crewName: settlement.crewName,
            crewXp: settlement.crewXp,
            crewLevel: settlement.crewLevel,
            crewLevelsGained: settlement.crewLevelsGained,
            shipName: settlement.shipName,
            hullDamage: settlement.hullDamage,
            hullAbsorbed: settlement.hullAbsorbed,
            warp: settlement.warp,
            sectorCharted: settlement.sectorCharted,
            settlementLog: settlement.log,
            won: settlement.won,
        };
    }

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
        run.ledger.detach();
        // A puzzle shift always ends with the board full — the ore you
        // banked is yours either way, so the run counts as completed.
        const settlement = settleManualRun(run.mission, summary, { won: true });
        const report = buildReport(summary, settlement);
        view.showResultsScreen(report, {
            onContinue: () => {
                meta.applySettlement(settlement);
                // Free the ship + crew this manual run consumed so the
                // next DISPATCH is available immediately.
                view.completeManualMission(run.mission.id);
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
        // P8: combat runs tally ore too (destroyed formations → pyrite /
        // cryonite / verdanite, power-ups → helium, the boss → both hazard
        // ores), so a Combat contract banks resources like any other.
        const defenseLedger = new DefenseLedger({ state: defenseState, mission });

        defenseState.on('game-over', ({ won }) => {
            if (defenseInputTeardown) { defenseInputTeardown(); defenseInputTeardown = null; }
            cancelAnimationFrame(defenseRaf);

            const summary = defenseLedger.summary(defenseState);
            defenseLedger.detach();
            const settlement = settleManualRun(mission, summary, { won });
            const report = buildReport(summary, settlement);

            view.showResultsScreen(report, {
                onContinue: () => {
                    meta.applySettlement(settlement);
                    // Free the ship + crew this manual defense run consumed.
                    if (mission) view.completeManualMission(mission.id);
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

    // Reset Game: wipe the persisted profile and reload for a fresh run.
    view.onResetGame(() => {
        persistence.clear();
        window.location.reload();
    });

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
