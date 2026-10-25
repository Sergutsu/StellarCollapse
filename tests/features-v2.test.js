import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MetaState } from '../src/meta-state.js';
import { ClickerState, STATION_SURGES } from '../src/clicker-state.js';
import { evaluateInterview, CREW_TRAITS, INTERVIEW_SCENARIOS } from '../src/crew.js';
import { getAllNodes } from '../src/research.js';
import { generateStarSystem } from '../src/procedural-star-system.js';

describe('features v2: mission recovery and asset freeing', () => {
  it('settleActiveMission frees ship and crew to Standby and Available even if job record was orphaned', () => {
    const meta = new MetaState();
    const ship = meta.fleetSnapshot()[0];
    const crew = meta.crewSnapshot()[0];

    // Mark them on mission
    meta.setShipStatus(ship.id, 'On Mission');
    meta.setCrewStatus(crew.id, 'On Mission');

    // Settle with an unknown job ID, but supplying settlement shipId/crewId
    meta.settleActiveMission('orphan-job-999', {
      shipId: ship.id,
      crewId: crew.id,
      credits: 200,
      ores: { red: 5 },
    });

    assert.equal(meta.fleetSnapshot().find(s => s.id === ship.id).status, 'Standby');
    assert.equal(meta.crewSnapshot().find(c => c.id === crew.id).status, 'Available');
  });
});

describe('features v2: stellar core surges and prestige bounty', () => {
  it('surges trigger periodically and report remaining duration', () => {
    let t = 1_000_000;
    const g = new ClickerState(null, { now: () => t, rng: () => 0.1 });
    assert.equal(g.getActiveSurge(), null);

    const surge = g.triggerSurge('quantum');
    assert.equal(surge.id, 'quantum');
    assert.equal(g.getActiveSurge().id, 'quantum');
    assert.equal(g.getActiveSurge().remainingSec, 45);

    // Fast forward 50s -> expires
    t += 50_000;
    g.tick(1);
    assert.equal(g.getActiveSurge(), null);
  });

  it('supernova grants Dark Matter and awards a huge prestige resource windfall into station wallet', () => {
    const g = new ClickerState({ stardust: 500_000, runStardust: 500_000, credits: 1000, minerals: 200, warp: 5, rep: 50 }, { now: () => 1_000_000, rng: () => 0.5 });
    const dm = g.supernova();
    assert.ok(dm >= 2, `expected at least 2 DM, got ${dm}`);
    assert.ok(g.s.credits > 10000, `credits should include massive prestige windfall, got ${g.s.credits}`);
    assert.ok(g.s.minerals > 2000, `minerals should include massive prestige windfall, got ${g.s.minerals}`);
    assert.ok(g.s.warp >= 6, `warp should include prestige cells, got ${g.s.warp}`);
  });
});

describe('features v2: research 10x faster and celestial naming', () => {
  it('research durations are 10x faster than original specifications', () => {
    const nodes = getAllNodes();
    const ion = nodes.find(n => n.id === 'ion-thrusters');
    assert.ok(ion);
    assert.equal(ion.durationSec, 1800); // was 18000 (5h), now 30 min (1800s)

    const warpCoils = nodes.find(n => n.id === 'warp-coils');
    assert.ok(warpCoils);
    assert.equal(warpCoils.durationSec, 1350); // was 13500 (3h 45m), now 22m 30s (1350s)
  });

  it('procedural star system generates evocative sci-fi celestial names', () => {
    const system = generateStarSystem('alpha-centauri');
    assert.ok(system.star.name);
    assert.ok(!system.star.name.startsWith('Star-'), `Star name should be thematic, got: ${system.star.name}`);
    const planets = system.pois.filter(p => p.poiType === 'planet');
    assert.ok(planets.length > 0);
    for (const p of planets) {
      assert.ok(!p.name.includes('-A') && !p.name.includes('-B'), `Planet name should be thematic, got: ${p.name}`);
    }
  });
});

describe('features v2: crew assessment and traits', () => {
  it('interview evaluates role alignment, trait assignment, and hire discounts', () => {
    const engineer = { id: 'c-test', name: 'K. Tanaka', role: 'Engineer', level: 1 };
    const res = evaluateInterview(engineer, 'anomaly', 'scan');
    assert.equal(res.matched, true);
    assert.equal(res.discount, 0.25);
    assert.equal(res.trait.id, 'lucky_seam');
    assert.ok(res.xpBonus >= 100);
  });
});
