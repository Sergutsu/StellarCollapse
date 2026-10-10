# ADR-0012: Understandability pass — onboarding, pause, one dispatch path

- **Status:** Accepted
- **Date:** 2026-10-09
- **Supersedes:** —
- **Superseded by:** —
- **Related:** [ADR-0007](0007-hub-wireframe-pivot.md) (MISSION BOARD as the deploy surface), [ADR-0009](0009-scene-graph-extraction.md) (scene graph), [ADR-0010](0010-hub-tab-scenes.md) (tab scenes), [ADR-0011](0011-meta-economy-single-source.md) (one reward path)

---

## Context

P8/P9 made the game *deep* and the code *correct* — 416 unit tests, one
settlement path, six meta systems — but the player-facing shell lagged behind
the docs. Four concrete defects, all found by reading the live code against the
specs:

- **The MISSION BOARD was unreachable.** `_openMissionBoard()` had zero call
  sites: the pillar-2 deploy surface ("one action to deploy: click a card")
  built itself at boot and then sat at `visible = false` forever. The only way
  to dispatch was the dense planner console.
- **No onboarding and no manual.** A first-time player landed on a six-tab
  dispatcher sim with nine currencies of jargon and nothing to read. The gear
  button in the top bar looked like settings and did nothing (no handler).
- **Two payout shapes for one verb.** Planner DISPATCH created a ship/crew job
  (fit bonus, crew XP, hull wear); board quick-ACCEPT launched the same minigame
  with no job and settled neutral. "The number the planner quotes is the number
  that lands" was false for half the entry points.
- **No safe exit.** "⎋ Exit Mission" ended a run on one click, the ESC key
  implied by its label did nothing, and combat missions had *no* way out at all
  on touch devices. An early exit settled as a *win* (full rep), so bailing
  after ten seconds was free money.

## Decision

1. **The MISSION BOARD is the boot surface and the loop's home.** It opens at
   boot, after every settled shift (`HubScene.show()`), and from a planner
   button + the `M` hotkey. Closing it by hand (`CLOSE` / dim tap / ESC) sets
   `_boardDismissed`, which stops tab flips from re-opening it — dismissal is
   respected, discoverability is restored. Pillar 2 holds for real.
2. **One help system, paged, everywhere.** `src/help-content.js` (pure, tested
   copy) + `src/scenes/help-overlay.js` (renderer). First boot opens the manual
   over the board with a `START SHIFT` CTA; the top-bar `? HELP` button (the
   dead gear is cut), `H`/`?`, and the pause menu's `HOW TO SHIFT` all open the
   same overlay. `MetaState.ui.helpSeen` (additive save field) stops the
   first-run open; nothing else about the save changes.
3. **One dispatch path.** Board quick-ACCEPT now locks the first free ship +
   crew onto the same manual job shape `_createManualJob()` builds for planner
   DISPATCH, so fit bonuses, crew XP and hull wear apply to every shift. With
   every asset busy the shift still launches — flown solo at base rate, and the
   news ticker says so. Play is never blocked; pay is never mysterious.
4. **Pause replaces instant exit; abort is a priced choice.** ESC (and the
   in-run `PAUSE` button on both puzzle and combat scenes) freezes the game
   loop and opens a dialog: RESUME / HOW TO SHIFT / ABORT SHIFT. Aborting calls
   `GameState.endGameEarly()` / the new `DefenseState.endGameEarly()` and now
   settles `won: false` — reduced rep (+6 hull wear) — mirroring the idle
   RETURN rule. `RESET` also gained a confirmation dialog. Special arming
   timers are wall-time and keep counting through a pause (documented); every
   player-driven tick stops.
5. **Navigation is keyboard-complete.** `src/hotkeys.js` routes `H`/`?`,
   `ESC`, `1`–`6`, `M`, `P` per screen context (hub / run / overlay); movement
   keys stay in `input.js`. After a run, CONTINUE returns to the MISSION BOARD.

Small cuts that fell out of the same pass: the dead settings gear, the instant
exit, the instant save-wipe, the cryptic `T5 · MINING · HARD` planner rows
(narrative names now), and the mismatched `FLEET UPGRADE` tab label (now
`SHIPYARD`, matching its own panel header).

## Consequences

**Pros**

- A new player is one `START SHIFT` away from a contract, with a manual one
  key away at all times.
- Every dispatch — card or console — runs through one job shape and one
  settlement ([ADR-0011](0011-meta-economy-single-source.md) holds everywhere).
- No destructive or dead one-click controls; no dead-end screens on desktop or
  touch.
- Pure pieces (`help-content`, `results-hints`, `hotkeys`, `ui.helpSeen`) are
  unit-tested; overlays execute in the hub smoke suite.

**Cons**

- Two more overlay classes in the scene graph (`HelpOverlay`, `ModalDialog`).
- Pause is not cycle-accurate: bomb/snake arming timers are wall-clock and can
  expire while paused (5 s windows, Collapsed tier only).
- Quick-ACCEPT now reserves a ship + crew, so a full idle roster pushes the
  player to RETURN a contract (or fly solo) — a real trade-off, surfaced in the
  ticker instead of hidden.

## Alternatives considered

- **Cut Auto-Match / Miner to shrink the surface.** Rejected: mode variety is
  the game's identity, and the confusion was navigational, not mechanical. The
  help pages teach the modes in one card each.
- **A tutorial rail that force-feeds steps.** Rejected as brittle and
  patronizing; a paged manual + context hints (results "NEXT" lines, ticker
  feedback) respect the player's pace.
- **Cut the planner, keep only cards.** Rejected: the planner is the
  power-user surface (ship/crew choice, idle dispatch) and ADR-0007's shape.
- **True pause (freeze wall-clock timers).** Deferred: it needs `GameState`
  timer snapshots and a save-safe clock; the current compromise is honest and
  documented.

## Revisit if

- arming-timer expiry during pause draws real complaints (then snapshot
  `schedule` deadlines on pause),
- a second onboarding channel (video, tooltips) is ever proposed (the manual
  is the single source of truth — extend `help-content.js` instead),
- quick-ACCEPT solo mode turns out to hide the job system from casual players
  (consider quoting the payout delta in the news line).
