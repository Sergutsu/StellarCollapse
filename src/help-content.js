// Content for the HOW TO PLAY overlay. Pure data — no Pixi, no DOM —
// so the help copy is unit-testable and the overlay module stays a
// dumb renderer. Keep every page short enough to read in one sitting;
// this is a field manual, not a wiki.
//
// Shape:
//   HELP_PAGES: [{ id, title, accent, blocks: [{ heading, body, color? }] }]
// `accent` is a pixi-ui-kit accent key ('cyan' | 'amber' | 'magenta' | 'green').
// `color` on a block is a theme `colors.*` int the overlay tints the
// heading with; omit for the default heading tint.

export const HELP_PAGES = Object.freeze([
    Object.freeze({
        id: 'loop',
        title: 'THE LOOP',
        accent: 'cyan',
        blocks: Object.freeze([
            Object.freeze({
                heading: 'YOU ARE THE CHIEF DISPATCHER',
                body: 'You run a fringe mining outpost. Contracts arrive; you decide which rock is worth the fuel. Every shift you fly is short — the station grows across many of them.',
            }),
            Object.freeze({
                heading: '1 · DISPATCH',
                body: 'Open the MISSION BOARD and ACCEPT a contract, or use the planner to choose the ship and crew first. MANUAL flies the shift yourself (full pay). IDLE sends it out on a timer for 60% of the reputation.',
            }),
            Object.freeze({
                heading: '2 · SHIFT',
                body: 'Each contract is one quick minigame: a match-4 puzzle, a core-mining run, or a combat sweep. Every cell you clear is ore in the hold.',
            }),
            Object.freeze({
                heading: '3 · SETTLE',
                body: 'Every shift pays through one honest ledger: credits, ore, reputation, crew XP, hull wear, and sometimes a warp cell. The numbers on the report are the numbers that land.',
            }),
            Object.freeze({
                heading: '4 · UPGRADE & RANK UP',
                body: 'Refine ore into minerals, repair and build hulls, research permanent tech, trade the market, chart sectors. Reputation — earned only by finishing dispatches — unlocks the fattest contracts.',
            }),
        ]),
    }),
    Object.freeze({
        id: 'dispatch',
        title: 'DISPATCHING',
        accent: 'green',
        blocks: Object.freeze([
            Object.freeze({
                heading: 'THE MISSION BOARD',
                body: 'Four daily contracts. ACCEPT flies the shift now with your first free ship and crew. The board refreshes free at midnight UTC; REROLL BOARD re-rolls it for an escalating credit price.',
            }),
            Object.freeze({
                heading: 'THE PLANNER',
                body: 'Behind the board sits the dispatch console: pick a ship, a crew member, a contract, and a dispatch mode. DISPATCH launches immediately (MANUAL) or queues an autonomous run with a quoted ETA (IDLE). RETURN an idle run early for a partial payout.',
            }),
            Object.freeze({
                heading: 'SHIPS & CREW',
                body: 'Ships take hull damage on every dispatch — repair them in the SHIPYARD at 3 minerals per point. Crew earn XP and level up; a higher-level crew member pays better. A ship whose class fits the contract type earns a fit bonus.',
            }),
            Object.freeze({
                heading: 'REPUTATION',
                body: 'REP is banked by finishing dispatches and never bought. Locked cards show the rank they need. The top bar chip tracks progress to the next tier.',
            }),
        ]),
    }),
    Object.freeze({
        id: 'minigames',
        title: 'THE MINIGAMES',
        accent: 'magenta',
        blocks: Object.freeze([
            Object.freeze({
                heading: 'STELLAR — CLICK MATCH',
                body: 'Pieces drop and lock. A run of 4+ same-color cells clears when you CLICK one of them. Stack chains, keep the board low.',
            }),
            Object.freeze({
                heading: 'AUTO-MATCH',
                body: 'Same board, no clicking: every 4+ run clears by itself the moment a piece locks. Plan colors two pieces ahead.',
            }),
            Object.freeze({
                heading: 'MINER — CORE COLLAPSE',
                body: 'Mineral formations fall inward from all four edges toward the center. Fill a solid 6×6 square over the glowing core to collapse it for the big score. Nothing falls after a collapse — plan around the holes.',
            }),
            Object.freeze({
                heading: 'DEFENSE — COMBAT',
                body: 'Paddle and ball against invader formations. Break the pixels, grab power-ups (MULTI / WIDE / LASER / LIFE / TOWER), and kill the boss. Click above the paddle to place a turret.',
            }),
        ]),
    }),
    Object.freeze({
        id: 'station',
        title: 'THE STATION',
        accent: 'amber',
        blocks: Object.freeze([
            Object.freeze({
                heading: 'THE SIX BAYS',
                body: 'STAR MAP — chart sectors with warp cells for permanent pay bonuses.\nMISSIONS — the board and the dispatch planner (home).\nSHIPYARD — build hulls, repair wear, disassemble.\nRESEARCH — a 12-node tech tree; minerals in, permanent bonuses out.\nCREW — hire, level, and dismiss. Roles fit some contract types better.\nMARKET — seven goods with daily prices, and the refinery that melts ore into minerals.',
            }),
            Object.freeze({
                heading: 'THE RESOURCES',
                body: 'CREDITS — spend anywhere; earned by dispatches and sales.\nORE — the haul; trade it or refine it.\nMINERALS — the build + research sink; refined from ore (4:1 common, 2:1 rare) or granted by sectors.\nWARP CELLS — fuel for sector jumps; found, never bought.\nREPUTATION — your rank; earned only by finishing dispatches.',
            }),
            Object.freeze({
                heading: 'THE LEFT BAY',
                body: 'The hub’s left column follows you: active missions on MISSIONS, active projects on RESEARCH, system data / shipyard / market watchlist on their own tabs.',
            }),
        ]),
    }),
    Object.freeze({
        id: 'controls',
        title: 'CONTROLS & HOTKEYS',
        accent: 'cyan',
        blocks: Object.freeze([
            Object.freeze({
                heading: 'KEYBOARD',
                body: '← →  move piece        ↓  soft drop        ↑  rotate\nSPACE  hard drop (or fire / click-match)\nESC  pause a shift · close any panel\nH or ?  this manual        P  pause',
            }),
            Object.freeze({
                heading: 'HUB HOTKEYS',
                body: '1 – 6  switch bottom-nav tabs\nM  open the MISSION BOARD\nESC  close the board or a dialog',
            }),
            Object.freeze({
                heading: 'TOUCH',
                body: 'Swipe ← → to move, swipe ↑ to rotate, swipe ↓ to soft drop, flick ↓ to hard drop. Everything in the hub is tappable.',
            }),
            Object.freeze({
                heading: 'STAYING OUT OF TROUBLE',
                body: 'RESET wipes the save and always asks first. Pausing freezes the board while you read — resume any time. The sound toggle sits next to PAUSE during a shift.',
            }),
        ]),
    }),
]);

export const HELP_FIRST_RUN_CTA = 'START SHIFT';
