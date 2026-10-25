import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hubViewportMode, hubNavHeight, computeHubRects, rectsOverlap } from '../src/responsive.js';

describe('responsive hub layout', () => {
  it('classifies breakpoints', () => {
    assert.equal(hubViewportMode(1920), 'wide'); assert.equal(hubViewportMode(900), 'medium'); assert.equal(hubViewportMode(390), 'compact');
    assert.equal(hubNavHeight(390), 92); assert.equal(hubNavHeight(1200), 56);
  });
  for (const shellW of [1920, 1440, 1200, 1024, 900, 820, 720, 600, 480, 390, 320]) {
    it(`no column overlap and everything inside the shell at ${shellW}px`, () => {
      const r = computeHubRects({ shellW, bandH: 500 });
      const rects = [r.left, r.center, r.right];
      for (const a of rects) { assert.ok(a.x >= 0 && a.x + a.w <= shellW, `inside shell: ${JSON.stringify(a)}`); assert.ok(a.w >= 240 || shellW < 620, 'readable width'); }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++)
        assert.ok(!rectsOverlap(rects[i], rects[j]), `overlap at ${shellW}: ${i}/${j}`);
      assert.ok(r.contentH >= 500);
    });
  }
  it('compact stacks vertically so the band must scroll (content taller than a phone)', () => {
    const r = computeHubRects({ shellW: 390, bandH: 480 });
    assert.ok(r.contentH > 480 && r.left.y >= r.center.y + r.center.h && r.right.y >= r.left.y + r.left.h);
  });
  it('core gets a taller center on short wide screens instead of squashing', () => {
    const r = computeHubRects({ shellW: 1280, bandH: 420, activeTabId: 'core' });
    assert.ok(r.center.h >= 660 && r.contentH >= 660);
  });
});
