import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectJsFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.git') continue;
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) collectJsFiles(path, out);
        else if (entry.endsWith('.js')) out.push(path);
    }
    return out;
}

describe('source syntax', () => {
    it('all source modules parse as JavaScript', () => {
        const failures = [];
        for (const file of collectJsFiles('src')) {
            const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
            if (result.status !== 0) {
                failures.push(`${file}\n${result.stderr || result.stdout}`);
            }
        }

        assert.deepEqual(failures, []);
    });
});
