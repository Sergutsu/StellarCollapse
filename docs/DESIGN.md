# Stellar Venture — Design Doc

> The **why** and **what** of the game. For the **how** of the code, see `ARCHITECTURE.md`. For canonical mechanics + tunable numbers, see `GAMEPLAY.md`.

---

## Logline

You are the **Chief Dispatcher** of a fringe mining outpost. Captains bring you asteroids; you pick which rock is worth the fuel. Each run is a single puzzle shift — clear the rock, tally the ores, bank the credits, pick the next.

Short casual sessions stack into a longer idle/meta progression. You can play one mission on a coffee break, or grind tiers for an afternoon.

---

## Pillars

1. **Every run is a finite shift.** No lives, no stakes beyond the mission. A run ends cleanly — no dead screen, no limbo.
2. **One action to deploy.** The mission-select screen has exactly one primary verb: **click a card**. No mode toggle, no complexity toggle, no size toggle, no BEGIN button.
3. **Every tile you clear is a resource.** There is no junk colour. Red is Pyrite, blue is Cryonite, and so on. Scoring and resource-tally are the same event fired twice.
4. **The puzzle and the meta are separate economies.** Puzzle difficulty doesn't get "easier" because you bought upgrades. Upgrades change the **shape** of a run (bomb radius, snake length, starting level), never the scoring multiplier.
5. **No feature flags in production.** When something ships, it ships on the root URL. No `?engine=*`, no beta toggles, no shadow-DOM fallback to "the old version."

---

## Core loop (per mission)

```
MISSION BOARD  ─(click a card)─▶  MISSION RUN  ─(win or game-over)─▶  RESULTS
      ▲                                                                   │
      └───────────────────────(CONTINUE)─────────────────────────────────┘
```

One screen per stage. No pauses inserted between them.

- **Mission board** — narrative mission cards (see [`UI-HUB.md` § Narrative
  mission catalog](UI-HUB.md#narrative-mission-catalog)). Each card shows
  mission name, type (Mining / Exploration / Research / Salvage / Combat),
  sector, flavor brief, risk factor, duration ETA, expected ore preview,
  credit reward. Under the hood each narrative mission resolves to one
  `HIGHSCORE_TIERS` archetype (`gameConfig`) so the puzzle run stays the same
  9-tier matrix. Today's transitional screen still shows the raw tier
  archetype grid (3×3); the narrative re-skin lands with the P2 hub.
- **Mission run** — one of two modes depending on the mission's type:
  - *Puzzle run* (Mining / Exploration / Research / Salvage) — match-4 / auto-match / block-drop, three complexities, three field sizes per complexity.
  - *Defense run* (Combat) — Space-Invaders / Breakout hybrid. Player controls a paddle; a bouncing ball destroys pixel-art invaders and a boss. Power-ups (MULTI, WIDE, LASER, LIFE, TOWER) drop every 10 pixel kills. Towers auto-shoot the nearest enemy. Win by destroying all invaders + boss; lose when health reaches 0 or invaders reach the bottom.
- **Results** — asteroid name, final score, credits earned, ore breakdown, CONTINUE back to the board.

## Meta loop (across missions)

Shipped in P8 — see [`META-SYSTEMS.md`](META-SYSTEMS.md) for the numbers and
[ADR-0011](adr/0011-meta-economy-single-source.md) for why it is shaped this way.

```
            ┌────────────── dispatch (manual or idle) ──────────────┐
            ▼                                                       │
   MISSION BOARD ──▶ optional MINIGAME ──▶ settleMission() ─────────┘
    (daily seed,        (skill expression)     │
     paid rerolls)                             ▼
                     credits · ore · REP · crew XP · hull wear · warp
                             │            │           │          │
                             ▼            ▼           ▼          ▼
                        RESEARCH      MARKET +     BUILD/UPGRADE  STAR MAP
                        (effects)     REFINERY     (hulls, repairs) (sectors)
                             └────────────┴───────────┴──────────┘
                                          │
                                          ▼
                              better-priced dispatches
```

- **Credits** are the primary currency; **ore** is the tradeable/refinable
  output; **minerals** are the build + research sink (fed by the refinery and
  sector grants — they have no other faucet); **warp cells** are the STAR MAP
  fuel and are *found*, never bought; **REP** is the rank and is earned only by
  finishing dispatches.
- **REP is not a wallet.** It is banked experience with a derived tier
  (Apprentice → Master Dispatcher), gating T8/T9 contracts and threat-5 sectors.
  You cannot buy your way into a rank.
- **The minigame is optional but strictly better.** A hands-on run pays full rep
  and XP, keeps the score bonus, and can find a warp cell at any qualifying risk;
  an idle contract pays 60 % rep, half XP and only finds warp at risk 4+.
- **Mission list refreshes free at the UTC boundary** and can be rerolled for an
  escalating credit price (150 × n+1, capped per day, +1 with research).
- **Loss is a cost, not a wall.** A failed run still pays ~a third of the rep,
  damages the hull more, and the hull is repairable with minerals.
- **No persistent leaderboard.** The old HighScores module was removed — the
  game is about banking resources, not bragging about a top score. Per-run stats
  live in the results screen; lifetime stats are recorded in the profile
  (`getStats()`) and can surface as a station log later.

---

## Screens

### Main menu — long-term target: the Hub

The main menu will become a **viewport-filling hub** with a persistent top
resource bar + Galactic News ticker, left ACTIVE MISSIONS column, right
**FLEET & CREW STATUS** column (ships with hull %, assigned crew, availability),
a tab-swapped center pane, and a 6-tab bottom nav (STAR MAP, MISSIONS,
BUILD/UPGRADE, RESEARCH, CREW, MARKET). The MISSIONS tab opens a **MISSION
BOARD modal** with narrative mission cards (Operation: Black Hole Anomaly,
Xeno-archeology Dig, Trade Route Defense, Relic Recovery, …). Full
element-by-element spec + narrative mission catalog live in
[`UI-HUB.md`](UI-HUB.md).

### Main menu — today (P2+ hub shell)

The hub shell is live and has evolved through P2–P4 scaffolding. The start
screen is the viewport-filling 5-zone hub from [`UI-HUB.md`](UI-HUB.md):

- **Top bar** — STELLAR VENTURE brand, Chief Dispatcher callsign badge,
  resource strip (Minerals / Credits / Warp Cells — backed
  by persistent `MetaState` since P3), settings gear.
- **Galactic News ticker** under the top bar, right→left scrolling flavor.
- **Left column — ACTIVE MISSIONS** with idle fleet dispatch panel.
  Dispatched idle missions show progress, ETA, and ABORT/COMPLETE actions.
  Real `IdleClock` ticking + completion-to-results flow still pending (P4).
- **Center panel** — tab-swapped; MISSIONS opens the mission planner
  (ship + crew assignment, IDLE/MANUAL dispatch toggle). Three additional
  tabs are now shipped as extracted scene classes: **STAR MAP** (sector pins,
  SYSTEM DATA panel), **BUILD/UPGRADE** (station diorama, stub build queue),
  **RESEARCH** (tech tree, hex nodes, detail card). CREW and MARKET remain
  locked stubs.
- **MISSION BOARD modal** — 2×2 narrative mission cards over a dim overlay.
  Each card maps 1:1 to a `HIGHSCORE_TIERS` archetype under the hood, so
  DISPATCH launches the existing puzzle gameplay with the tier's
  `gameConfig` (ADR-0003 holds).
- **Right column — FLEET & CREW STATUS** with 3 starter ships + 3 starter
  crew (persistent via `MetaState`; availability tracked per dispatch).
- **Bottom nav** — 6 tab pills (STAR MAP, MISSIONS, BUILD/UPGRADE,
  RESEARCH, CREW, MARKET). MISSIONS is active at boot; STAR MAP,
  BUILD/UPGRADE, and RESEARCH are now unlocked; CREW and MARKET are
  locked stubs.

No player-name input. No BEGIN button. No mode/complexity/size toggles —
each mission card encapsulates its own config. No MISSION LOG / leaderboard
panel — the HighScores system was removed. The game is about banking
resources, not a bragging scoreboard.

### Mission run (gameplay)

Unchanged from the pre-expansion game. HUD columns, previews, title bar, Pixi board with starfield + scanner.

### Results (P1)

Single panel, full-screen:
- Asteroid name + tier in the header
- Win / failure framing (mission complete vs. overrun)
- Ore breakdown: 6-row grid, ore icon + name + count + small "+ credit contribution"
- Credits earned (big number)
- Session totals footer: cumulative credits and top ore this session
- CONTINUE button back to board

Persists nothing in P1 (session totals reset on reload). P2 makes it persistent.

---

## Ore catalogue

| Palette | Ore | Rarity | Use |
|---|---|---|---|
| red | **Pyrite** | common | primary fuel / smelter input |
| blue | **Cryonite** | common | cooling / station systems |
| green | **Verdanite** | common | bio-habitat / food |
| yellow | **Helium** | common | drives / reactors |
| bomb | **Volatiles** | rare | explosives / combat upgrades |
| snake | **Biomass** | rare | exotic / research |

Collapsed-complexity missions are the only ones that preview rare ores because that's the only complexity where bomb/snake tiles spawn.

Individual ore economies (what Pyrite actually *does*) are a P2 concern. For P1 we only need counts.

---

## Player identity

- **Title:** Chief Dispatcher (fixed, non-editable).
- **Callsign:** 3 letters + 3 digits (e.g. `KXV-487`), rolled per session until P2 persists it.
- **Rep tier:** deferred to P2.

There is no player-name input. If a player wants a custom name, a later PR can add a rename action on the dispatcher card — but it never leaves the mission-select screen.

---

## Difficulty tiers (T1 → T9)

One mission archetype per ranked tier. Green → red gradient across the 3×3 grid: top-left is easiest, bottom-right is hardest. Order below mirrors `HIGHSCORE_TIERS` in `src/constants.js`; default sizes come from `TIER_SIZE_BY_ID` in `src/missions.js` and difficulty labels from `TIER_DIFFICULTY_BY_ID`.

| Tier | Mode | Complexity | Default size | Difficulty |
|---|---|---|---|---|
| T1 | Stellar | Classic | small | LOW |
| T2 | Stellar | Mutated | medium | LOW |
| T3 | Auto-Match | Classic | small | MODERATE |
| T4 | Auto-Match | Mutated | medium | MODERATE |
| T5 | Stellar | Collapsed | medium | ELEVATED |
| T6 | Auto-Match | Collapsed | medium | HIGH |
| T7 | Blocks | Classic | medium | HIGH |
| T8 | Blocks | Mutated | medium | EXTREME |
| T9 | Blocks | Collapsed | large | CRITICAL |

Canonical tier list lives in `constants.HIGHSCORE_TIERS`. Field-size defaults and difficulty labels live in `src/missions.js`.

---

## Non-goals

- **Not a live-service game.** No server, no accounts, no PvP. All state is local.
- **Not a cutscene-driven narrative.** Missions have flavor names + one-line
  briefs (`"Trade Route Defense—Outer Rim"`) that reskin tier archetypes, not
  branching stories. No VO, no dialogue trees, no scripted NPCs.
- **Not a deckbuilder / roguelite.** Runs don't mutate rules mid-session; variety comes from mission choice + tier.
- **Not mobile-first.** Desktop remains the primary design target, but
  the shipped hub/game surfaces now scale to fit narrow mobile viewports
  and gameplay has touch gestures (swipe to move/rotate/drop) so runs
  remain playable on phones.

---

## Open design questions

Things we'll answer as we build, noted so they don't get forgotten.

Answered in P8:

- ~~How expensive should daily reroll be? Free, credit-cost, or ore-cost?~~
  **Free once per UTC day** (the board re-seeds itself at the boundary); extra
  rolls cost **credits**, escalating 150 × (n+1) with a daily cap of 6 (+1 from
  Countermeasures). Credits — not ore — because a reroll is an impatience tax and
  ore is a refining input with its own sink.
- ~~Is rep tier advancement cumulative credits, or "hardest mission cleared"?~~
  **Neither: cumulative REP earned by finishing dispatches.** REP is awarded per
  contract from risk + tier with multipliers for mode and outcome, so a rich
  player who never flies stays an Apprentice and a player who grinds hard
  contracts ranks up.
- ~~Do upgrades apply to a single mission per purchase, or permanent?~~
  **Permanent.** Research nodes resolve into one effect bundle that every
  dispatch, market quote and jump price reads. Hulls persist with their hull
  percentage; crew levels persist with their XP.
- ~~Does idle generation use offline-time-since-close, or a global daily bucket?~~
  **Offline-time-since-close**, with no simulation: jobs store absolute
  `startedAt`/`endsAt`, so `summarizeOffline()` just compares against a heartbeat
  stamped on boot, every 30 s and on `pagehide`. Anything that finished while you
  were away is claimable (or partially claimable if you RETURN it).
- ~~Are the 6 ores all gameplay-relevant, or are some purely decorative?~~
  **All six are relevant, at different ratios.** Four commons refine 4:1 into
  minerals and trade at 6–9 CR; the two hazard ores (Volatiles, Biomass) refine
  2:1 and trade at 26/30 CR. Combat is the reliable way to farm the hazard pair
  (the boss pays 4 + 3), which gives the defense minigame an economic reason to
  exist beyond the REP win bonus.

Still open:

- Should a charted sector be able to *spawn* its own contract (a sector-specific
  board slot), rather than only buffing contracts that already fly there?
- Do lifetime stats deserve a surface (station log / career panel), and if so
  which of the 15 counters are worth showing?
- Should hull damage below some threshold block dispatch (a grounded hull), or
  stay a pure repair-tax as it is today?
- Is the mineral faucet (refinery + sector grants) sized correctly against the
  research tree's 300–1 100 per node, or does the mid-game stall?
