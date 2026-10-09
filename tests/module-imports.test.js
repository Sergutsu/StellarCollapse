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

    // Named imports from local modules are invisible to the test suite for
    // view code (nothing mounts Pixi in node), so a typo there only shows
    // up as a blank screen in the browser. Statically check that every
    // `import { x } from './y.js'` really is exported by y.js.
    it('every named import from a local module exists in that module', () => {
        const files = collectJsFiles('src');
        // `[^{}]*` (not `[\s\S]*?`) keeps one match inside one import
        // statement, so a bare-specifier import above can't lend its names
        // to the local specifier below.
        const namedImportPattern = /import\s*\{([^{}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g;
        const problems = [];

        const exportNames = (source) => {
            const names = new Set();
            const declPattern = /export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z0-9_$]+)/g;
            for (const m of source.matchAll(declPattern)) names.add(m[1]);
            const listPattern = /export\s*\{([^{}]*)\}(?:\s*from\s*['"][^'"]+['"])?/g;
            for (const m of source.matchAll(listPattern)) {
                for (const part of m[1].split(',')) {
                    const name = part.trim();
                    if (!name) continue;
                    const asMatch = name.match(/\bas\s+([A-Za-z0-9_$]+)$/);
                    names.add(asMatch ? asMatch[1] : name.split(/\s+/)[0]);
                }
            }
            if (/export\s+default/.test(source)) names.add('default');
            return names;
        };

        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            for (const match of source.matchAll(namedImportPattern)) {
                const target = resolveRelativeImport(file, match[2]);
                if (!existsSync(target)) continue; // covered by the test above
                const exported = exportNames(readFileSync(target, 'utf8'));
                for (const raw of match[1].split(',')) {
                    const name = raw.trim();
                    if (!name) continue;
                    const local = name.split(/\s+/)[0];
                    if (!exported.has(local)) problems.push(`${file} imports '${local}' from ${match[2]}`);
                }
            }
        }

        assert.deepEqual(problems, []);
    });
});

describe('cross-module call sites', () => {
    // A scene can call a pure module's function only if it imported it. A
    // missing import is a runtime ReferenceError that `node --check` and the
    // unit suite both miss, because no scene ever executes under node --test.
    // This caught idle dispatch: hub-scene called buildIdleMissions() without
    // importing it, so every IDLE dispatch threw.
    it('never calls a sibling module export it did not import', () => {
        const files = collectJsFiles('src');
        const importPattern = /import\s*\{([^{}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g;
        const problems = [];

        const exportNames = (source) => {
            const names = new Set();
            for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z0-9_$]+)/g)) {
                names.add(m[1]);
            }
            for (const m of source.matchAll(/export\s*\{([^{}]*)\}(?:\s*from\s*['"][^'"]+['"])?/g)) {
                for (const part of m[1].split(',')) {
                    const name = part.trim();
                    if (!name) continue;
                    const as = name.match(/\bas\s+([A-Za-z0-9_$]+)$/);
                    names.add(as ? as[1] : name.split(/\s+/)[0]);
                }
            }
            return names;
        };

        // Anything the file declares itself can shadow a sibling export.
        const localNames = (source) => {
            const names = new Set();
            const patterns = [
                /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/g,
                /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)/g,
                /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)/g,
                /(?:^|\n)\s{4}(?:async\s+)?([A-Za-z0-9_$]*)\s*\(/g,          // class methods
                /(?:^|\n)\s*(?:const|let|var)\s*\{([^}]*)\}/g,               // destructuring
                /\(\s*\{([^}]*)\}\s*(?:=|,|\))/g,                            // destructured params
                /\(([^()]*)\)\s*(?:=>|\{)/g,                                 // plain params
            ];
            for (const re of patterns) {
                for (const m of source.matchAll(re)) {
                    for (const part of String(m[1] ?? '').split(',')) {
                        const name = part.trim().split(/[\s:=]/)[0];
                        if (name) names.add(name);
                    }
                }
            }
            return names;
        };

        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            const declared = localNames(source);
            const imported = new Set();
            const siblings = [];
            for (const m of source.matchAll(importPattern)) {
                for (const part of m[1].split(',')) {
                    const name = part.trim();
                    if (!name) continue;
                    imported.add(name.split(/\s+as\s+/)[0]);
                }
                const target = resolveRelativeImport(file, m[2]);
                if (existsSync(target)) siblings.push({ target, targetFile: target });
            }
            if (siblings.length === 0) continue;

            const callable = new Set();
            for (const m of source.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) callable.add(m[1]);

            for (const { targetFile } of siblings) {
                for (const name of exportNames(readFileSync(targetFile, 'utf8'))) {
                    if (!callable.has(name)) continue;
                    if (imported.has(name) || declared.has(name)) continue;
                    problems.push(`${file} calls ${name}() without importing it`);
                }
            }
        }

        assert.deepEqual(problems, []);
    });
});
