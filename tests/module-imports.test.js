import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

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

function resolveRelativeImport(fromFile, specifier) {
    const base = resolve(dirname(fromFile), specifier);
    if (extname(base)) return base;
    return `${base}.js`;
}

describe('module graph', () => {
    it('all relative ESM imports point at files in the repo', () => {
        const files = collectJsFiles('src');
        const missing = [];
        const importPattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]|import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            for (const match of source.matchAll(importPattern)) {
                const specifier = match[1] || match[2];
                const target = resolveRelativeImport(file, specifier);
                if (!existsSync(target)) missing.push(`${file} -> ${specifier}`);
            }
        }

        assert.deepEqual(missing, []);
    });
});
