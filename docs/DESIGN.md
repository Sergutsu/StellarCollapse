# Stellar Collapse — Design Doc

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

- **Mission board** — 9 mission cards (3×3 grid, one per ranked tier). Each card shows asteroid name, tier, mode/complexity/size summary, flavor brief, difficulty tag, expected ore preview dots, credit reward.
- **Mission run** — the puzzle. Same game as before: match-4 / auto-match / block-drop, three complexities, three field sizes per complexity.
- **Results** — asteroid name, final score, credits earned, ore breakdown, CONTINUE back to the board.

## Meta loop (across missions)

```
RUN ─▶ credits + ores banked ─▶ MISSION LOG / REP ─▶ unlocks ─▶ more missions
```

- Credits are the primary currency. Ores are secondary, consumed by upgrades.
- Rep tier is a cumulative-credits rank (Apprentice → Master Dispatcher, etc.). Gates some T8/T9 missions.
- Mission list shuffles on daily reroll; reroll manually for credits if impatient.

This is all **P2+** work. P1 only introduces the per-run tally and results screen.

---

## Screens

### Main menu — long-term target: the Hub

The main menu will become a **viewport-filling hub** with a persistent top
resource bar, left ACTIVE MISSIONS column, right BASE COMMAND column, a
tab-swapped center pane, and a 6-tab bottom nav (STAR MAP, MISSIONS,
BUILD/UPGRADE, RESEARCH, CREW, MARKET). Full element-by-element spec lives in
[`UI-HUB.md`](UI-HUB.md). That is the destination we are migrating toward — it
is NOT the current implementation.

### Main menu — today (transitional)

What ships today is a slimmed version of the future hub's MISSIONS tab:

- Left panel: **AVAILABLE MISSIONS** heading + 3×3 mission card grid.
- Right panel: **CHIEF DISPATCHER** identity card (role + callsign + status), below it **MISSION LOG** (tier tabs + top-5 score per tier).
- Title bar on top: shiny "STELLAR COLLAPSE" with the reactive star actor.

No player-name input. No BEGIN button. No mode/complexity/size toggles — each
card encapsulates its own config. The MISSION LOG panel stays on the main menu
until a dedicated home for it lands in a later phase (candidates: top-bar chip
that opens a modal, or a panel in the CREW tab — decided in `UI-HUB.md` as we
build).

Known layout defects on today's main menu (tracked in `ROADMAP.md`):

- MISSION LOG panel overlaps the dispatcher identity card and the title bar.
- Whole layout is clustered in the top-left of wide viewports instead of
  centering / filling the screen.

Fixing both is part of the P1 → P2 transition; the same PR that introduces the
hub scaffolding will fix the centering as a side effect (the hub is viewport-
filling by construction).

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
- **Not a narrative game.** Missions have flavor briefs, not cutscenes.
- **Not a deckbuilder / roguelite.** Runs don't mutate rules mid-session; variety comes from mission choice + tier.
- **Not mobile-first** (yet). Targeted at desktop browsers until the desktop loop is tight.

---

## Open design questions

Things we'll answer as we build, noted so they don't get forgotten:

- How expensive should daily reroll be? Free, credit-cost, or ore-cost?
- Is rep tier advancement cumulative credits, or "hardest mission cleared"?
- Do upgrades apply to a single mission per purchase, or permanent?
- Does idle generation use offline-time-since-close, or a global daily bucket?
- Are the 6 ores all gameplay-relevant, or are some purely decorative? (Leaning: all relevant, different ratios.)
