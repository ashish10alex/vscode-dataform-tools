#!/usr/bin/env node
// Copies the compiled query panel, the query results view and the dependency inspector, as `vite build` left them in dist/, to
// website/public/demo/bundle: the two entries, the chunks they import and their stylesheets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(repo, 'dist');
const out = path.join(repo, 'website', 'public', 'demo', 'bundle');

const wanted = new Set();
function take(file) {
    if (wanted.has(file)) {
        return;
    }
    wanted.add(file);
    const code = fs.readFileSync(path.join(dist, file), 'utf8');
    for (const [, imported] of code.matchAll(/(?:from|import)\s*\(?\s*["']\.\/([\w.-]+\.js)["']/g)) {
        take(imported);
    }
}
take('preview_compiled.js');
take('query_results.js');
take('dependency-inspector.js');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
// StyledSelect.css is the chunk that has the styles of the inspector's graph
for (const file of [...wanted, 'preview_compiled.css', 'query_results.css', 'dependency-inspector.css', 'StyledSelect.css']) {
    // The source maps stay behind: nothing on the website reads them
    const content = fs.readFileSync(path.join(dist, file), 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
    fs.writeFileSync(path.join(out, file), content);
}
const bytes = fs.readdirSync(out).reduce((sum, file) => sum + fs.statSync(path.join(out, file)).size, 0);
console.log(`${wanted.size + 4} files, ${(bytes / 1024).toFixed(0)} KB, copied to ${path.relative(repo, out)}`);
