# ADR-0006: Rename to "Stellar Venture"

- **Status:** Accepted
- **Date:** 2026-04
- **Supersedes:** (none — first rename)

## Context

Through PR #38 the project was called **Stellar Collapse**. The name fit
the original concept — a cosmic falling-block / color-match puzzle whose
headline mechanic is the gravity-freeze + chain-collapse behavior in the
hardest complexity tier ("Totally Collapsed").

Since PR #32 the concept has pivoted. The puzzle is now one of several
mission types a "Chief Dispatcher" selects from a hub screen; the
overarching game is a **hybrid casual / idle space-exploration** game
with resources, rep tiers, and an idle mission loop (see `DESIGN.md`
and `ROADMAP.md`). Under the new framing:

- "Collapse" refers to one **complexity**, not the game. Calling the
  whole thing "Stellar Collapse" overweights a mechanic most missions
  will never see.
- The new identity fantasy is **going places** — picking missions, sending
  ships, exploring sectors. "Venture" captures that; "Collapse" fights
  it.
- The hub mock the designer produced (`docs/images/hub-mission-board-mock.png`)
  already says **STELLAR VENTURE** in the brand area. Keeping the old
  name in title bar / README / docs creates a permanent drift.

## Decision

Rename the **game** from "Stellar Collapse" to **"Stellar Venture"**
everywhere the name is *displayed to a player or reader*.

Keep the old name in every place a rename would break an external
reference:

| Touchpoint | Action |
|---|---|
| In-game Pixi title bar (`src/pixi-view.js`) | **Rename** to `STELLAR VENTURE` |
| `<title>` tag in `index.html` | **Rename** |
| `README.md` main heading + prose | **Rename** (retain one "formerly Stellar Collapse" note for SEO / returning players) |
| `docs/*.md` headings + prose | **Rename** |
| `CHANGELOG.md` headers | **Rename** moving forward; frozen past-release entries are left as shipped |
| Frozen ADRs (0001–0005) | **Left as written** — append-only log, see `adr/README.md` |
| `package.json` `name` | **Rename** to `stellar-venture` (private, not published) |
| `package.json` `description` | **Updated** to reflect the new framing |
| GitHub repo URL (`Sergutsu/StellarCollapse`) | **Unchanged** — renaming would break every external bookmark, the Pages URL, and every commit/PR link from the past 39 PRs |
| GitHub Pages URL (`sergutsu.github.io/StellarCollapse/`) | **Unchanged** — follows the repo name |
| jsdelivr Pixi.js import-map URL | **Unchanged** — Pixi's URL, has nothing to do with our game name |
| localStorage save key (once persistence lands) | `stellar-save:v1` — already neutral, no rename needed |
| Dead `stellarCollapseScoresV2` key (HighScores) | **Left orphaned** — nothing reads it; migration-to-nothing already documented in ADR-0005 |

## Consequences

**Pros**
- Brand matches the game we're actually building (exploration + idle,
  not single-mechanic puzzle).
- Removes the permanent mismatch between the designer's mock and the
  shipped title bar.
- Clean slate for future branding work (favicon, og:image, social
  cards) that hasn't been done yet.

**Cons**
- Anyone who bookmarked `README.md` for the old name sees a different
  title on next visit. Mitigated by the "Previously Stellar Collapse"
  note at the top of the README.
- A naive `grep` for the phrase "stellar collapse" in the repo still
  returns the frozen ADRs and CHANGELOG entries — this is **intentional**
  (append-only history). Do not "clean those up" in a future PR.

## Alternatives considered

1. **Keep "Stellar Collapse".** Rejected — the mock, the pivot doc
   (`DESIGN.md`), and the roadmap (`ROADMAP.md` P2+) all describe a
   game whose name fits badly.
2. **Rename the repo + Pages URL too.** Rejected — breaks all
   inbound references (commits, PRs, Devin sessions, anyone's
   bookmarks) for a cosmetic win. GitHub will redirect old URLs for
   a while, but CI config, badge URLs, and the `pages.yml` deploy path
   all encode `StellarCollapse` already. Not worth the churn right
   now; revisit if/when we do a real release.
3. **Dual-brand ("Stellar Collapse presents: Venture").** Rejected —
   more confusing than either name alone; the pivot is clean enough to
   just be Venture.
4. **Different name entirely** (e.g. "Dispatcher", "Outpost 7",
   "Starcall"). Rejected — "Venture" is the designer's pick and the
   mock reflects it; bikeshedding the name further would slow the
   pivot's real work.

## Implementation notes

- No string in the codebase should display "Stellar Collapse" to a
  player after this ADR is accepted. The only allowed occurrences are
  (a) the repo URL in clone/install commands, (b) frozen historical
  CHANGELOG entries and ADRs, (c) one opt-in "previously Stellar
  Collapse" note in `README.md`.
- Future ADRs + CHANGELOG entries use **Stellar Venture** from here on.
- Favicon, og:image, and social cards not done yet — when they land,
  they use the Venture brand.

## Revisit if

- A real release + marketing push happens and we want a fresh repo URL
  that matches the brand. Then rename the repo and follow-up with URL
  updates everywhere, *once*, as a tracked breaking change.
