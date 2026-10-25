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

  it('heals corrupted save with ghost recovery jobs and locked ships/crew on load', () => {
    // Construct corrupted save matching the user screenshot
    const corruptedSave = {
      fleet: [
        { id: 'ship-1', name: 'Nyx-I', className: 'Scout', hull: 100, status: 'On Mission' },
        { id: 'ship-2', name: 'Aegis-Delta', className: 'Defense', hull: 95, status: 'On Mission' },
        { id: 'ship-3', name: 'Prospector', className: 'Resource', hull: 93, status: 'On Mission' },
        { id: 'ship-4', name: 'Gaia-Line', className: 'Terraform', hull: 97, status: 'On Mission' },
        { id: 'ship-5', name: 'Mercury Arc', className: 'Trade', hull: 94, status: 'On Mission' },
        { id: 'ship-built-1', name: 'Scout-01', className: 'Scout', hull: 100, status: 'Standby' },
        { id: 'ship-built-2', name: 'Defender-02', className: 'Defense', hull: 100, status: 'Standby' },
      ],
      crew: [
        { id: 'crew-1', name: 'V. Draeven', role: 'Captain', level: 4, status: 'On Mission' },
        { id: 'crew-2', name: 'T. Halveri', role: 'Engineer', level: 3, status: 'On Mission' },
        { id: 'crew-3', name: 'K. Saros', role: 'Navigator', level: 2, status: 'On Mission' },
        { id: 'crew-4', name: 'L. Marrow', role: 'Tactician', level: 3, status: 'On Mission' },
        { id: 'crew-5', name: 'I. Nadir', role: 'Quartermaster', level: 2, status: 'On Mission' },
      ],
      activeMissions: [
        { id: 'dispatch-recovered-1', offerId: 'recovered-assignment', title: 'Recovered Idle Assignment', type: 'recovery', shipId: 'ship-5', crewId: 'crew-5', claimed: false },
        { id: 'dispatch-recovered-2', offerId: 'recovered-assignment', title: 'Recovered Idle Assignment', type: 'recovery', shipId: 'ship-4', crewId: 'crew-4', claimed: false },
        { id: 'dispatch-recovered-3', offerId: 'recovered-assignment', title: 'Recovered Idle Assignment', type: 'recovery', shipId: 'ship-3', crewId: 'crew-3', claimed: false },
        { id: 'dispatch-recovered-4', offerId: 'recovered-assignment', title: 'Recovered Idle Assignment', type: 'recovery', shipId: 'ship-1', crewId: 'crew-2', claimed: false },
        { id: 'dispatch-recovered-5', offerId: 'recovered-assignment', title: 'Recovered Idle Assignment', type: 'recovery', shipId: 'ship-2', crewId: 'crew-1', claimed: false },
      ],
    };

    const healedMeta = new MetaState(corruptedSave);

    // Ghost recovery jobs must be completely purged
    assert.equal(healedMeta.activeMissionsSnapshot().length, 0, 'all ghost recovery jobs purged');

    // All ships and crew must be free
    const fleet = healedMeta.fleetSnapshot();
    for (const ship of fleet) {
      assert.equal(ship.status, 'Standby', `Ship ${ship.name} should be Standby, got ${ship.status}`);
    }

    const crew = healedMeta.crewSnapshot();
    for (const member of crew) {
      assert.equal(member.status, 'Available', `Crew ${member.name} should be Available, got ${member.status}`);
    }
  });

  it('allows repeated dispatch, claim, and immediate re-dispatch without asset leaks', () => {
    const meta = new MetaState();
    const ship = meta.fleetSnapshot()[0];
    const crew = meta.crewSnapshot()[0];

    for (let cycle = 1; cycle <= 5; cycle++) {
      // 1. Dispatch
      const jobId = `job-cycle-${cycle}`;
      meta.addActiveMission({
        id: jobId,
        title: `Mining Run ${cycle}`,
        shipId: ship.id,
        crewId: crew.id,
        rewardCredits: 500,
        startedAt: Date.now(),
        etaSec: 10,
        endsAt: Date.now() + 10000,
      });

      assert.equal(meta.fleetSnapshot().find(s => s.id === ship.id).status, 'On Mission');
      assert.equal(meta.crewSnapshot().find(c => c.id === crew.id).status, 'On Mission');
      assert.equal(meta.activeMissionsSnapshot().length, 1);

      // 2. Claim / Settle
      meta.settleActiveMission(jobId, {
        shipId: ship.id,
        crewId: crew.id,
        credits: 500,
        ores: { red: 2 },
      });

      assert.equal(meta.activeMissionsSnapshot().length, 0);
      assert.equal(meta.fleetSnapshot().find(s => s.id === ship.id).status, 'Standby');
      assert.equal(meta.crewSnapshot().find(c => c.id === crew.id).status, 'Available');
    }
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

describe('features v2: research snappy durations, tree expansion, and celestial naming', () => {
  it('research durations are fast and snappy for idle-clicker pacing', () => {
    const nodes = getAllNodes();
    assert.equal(nodes.length, 20, 'tech tree should have 20 nodes total');

    const ion = nodes.find(n => n.id === 'ion-thrusters');
    assert.ok(ion);
    assert.equal(ion.durationSec, 90, 'Tier 3 should take 90s');

    const warpCoils = nodes.find(n => n.id === 'warp-coils');
    assert.ok(warpCoils);
    assert.equal(warpCoils.durationSec, 45, 'Tier 2 should take 45s');

    const fuelCell = nodes.find(n => n.id === 'fuel-cell');
    assert.ok(fuelCell);
    assert.equal(fuelCell.durationSec, 20, 'Tier 1 should take 20s');
  });

  it('all 4 branches have immediate Tier 1 entry points with 0 prerequisites', () => {
    const nodes = getAllNodes();
    const t1Nodes = nodes.filter(n => n.level === 1);
    assert.equal(t1Nodes.length, 4, 'should have 4 tier 1 entry points');
    for (const t1 of t1Nodes) {
      assert.equal(t1.durationSec, 20);
    }
  });

  it('metaState auto-completes finished research projects on tick or check', () => {
    const meta = new MetaState();
    meta.startResearch('fuel-cell');
    assert.equal(meta.getResearchState().activeResearches.length, 1);

    // Fast-forward 25 seconds
    const completed = meta.checkResearchCompletions(Date.now() + 25000);
    assert.deepEqual(completed, ['fuel-cell']);
    assert.equal(meta.getResearchState().activeResearches.length, 0);
    assert.ok(meta.getResearchState().completed.includes('fuel-cell'));
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
