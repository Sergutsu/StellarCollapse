// The HOW TO PLAY manual is pure data; assert its shape so a broken
// page (missing heading, empty body) fails CI instead of rendering an
// empty overlay.
import test from 'node:test';
import assert from 'node:assert/strict';

import { HELP_PAGES, HELP_FIRST_RUN_CTA } from '../src/help-content.js';

test('every help page renders something', () => {
    assert.ok(HELP_PAGES.length >= 4, 'at least four pages');
    for (const page of HELP_PAGES) {
        assert.ok(page.id && page.title, `page ${page.id} has id + title`);
        assert.ok(page.blocks.length >= 2, `page ${page.id} has content blocks`);
        for (const block of page.blocks) {
            assert.ok(block.heading, `page ${page.id}: block heading`);
            assert.ok(block.body && block.body.length > 20, `page ${page.id}: block body is a sentence`);
        }
    }
});

test('the manual covers the whole loop', () => {
    const ids = HELP_PAGES.map((p) => p.id);
    assert.deepEqual(ids, ['loop', 'dispatch', 'minigames', 'station', 'controls']);
    const all = HELP_PAGES.flatMap((p) => p.blocks.map((b) => `${b.heading} ${b.body}`)).join(' ');
    for (const keyword of ['DISPATCH', 'MINER', 'DEFENSE', 'MARKET', 'REPUTATION', 'ESC']) {
        assert.ok(all.includes(keyword), `the manual mentions ${keyword}`);
    }
});

test('the first-run CTA exists', () => {
    assert.equal(typeof HELP_FIRST_RUN_CTA, 'string');
    assert.ok(HELP_FIRST_RUN_CTA.length > 0);
});

test('pages are frozen (no scene can mutate the manual)', () => {
    assert.ok(Object.isFrozen(HELP_PAGES));
    assert.ok(Object.isFrozen(HELP_PAGES[0]));
    assert.ok(Object.isFrozen(HELP_PAGES[0].blocks[0]));
});
