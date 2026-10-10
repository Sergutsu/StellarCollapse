// NEXT-STEP hints for the mission report. Pure — no Pixi — so the
// guidance logic is unit-testable and the results scene stays a dumb
// renderer (house rule: view reads, never re-derives).
//
// The mission report shows what the shift paid. These hints answer the
// next question a dispatcher actually has: "where does this go?" Each
// hint names the station bay that consumes the resource the player
// just earned, so the meta loop teaches itself after every run.

/**
 * @param {object} summary run summary + settlement merged (the object
 *   ResultsScene._populate receives): { ores, hullDamage, warp, crewName,
 *   crewXp, crewLevelsGained, promoted, repTierAfter, ... }
 * @param {number} [maxHints=2] cap on returned hints (first = most urgent)
 * @returns {Array<{ label: string, text: string }>}
 */
export function nextStepHints(summary = {}, maxHints = 2) {
    const s = summary || {};
    const hints = [];
    const oreTotal = Object.values(s.ores || {}).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

    if ((s.hullDamage || 0) > 0) {
        hints.push({
            label: 'SHIPYARD',
            text: `Repair the hull — ${s.hullDamage} points lost, at 3 minerals each.`,
        });
    }
    if ((s.warp || 0) > 0) {
        hints.push({
            label: 'STAR MAP',
            text: 'Spend the warp cell charting a sector — the bonus is permanent.',
        });
    }
    if (oreTotal > 0) {
        hints.push({
            label: 'MARKET',
            text: 'Refine your ore into minerals (4:1) or sell it for credits.',
        });
    }
    if ((s.crewLevelsGained || 0) > 0) {
        hints.push({
            label: 'CREW',
            text: `${s.crewName || 'Your crew'} leveled up — a higher level pays better contracts.`,
        });
    }
    if (s.promoted) {
        hints.push({
            label: 'RANK',
            text: `Promoted to ${s.repTitleAfter || `tier ${s.repTierAfter}`} — higher-tier contracts just unlocked.`,
        });
    }
    if (hints.length === 0) {
        hints.push({
            label: 'MISSION BOARD',
            text: 'Fly another contract — reputation only comes from finishing dispatches.',
        });
    }
    return hints.slice(0, Math.max(1, Math.floor(maxHints)));
}
