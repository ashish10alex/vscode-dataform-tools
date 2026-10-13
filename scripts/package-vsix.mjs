#!/usr/bin/env node
// Packages the extension with a README that has only the dark pictures. GitHub shows one picture of each
// #gh-dark-mode-only / #gh-light-mode-only pair; the marketplaces and VS Code know nothing of the two and show both.
// README.md is put back as it was when vsce is done. Arguments go to `vsce package` as they are.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = path.join(repo, 'README.md');

const original = fs.readFileSync(readme, 'utf8');
const lines = original.split('\n');
const kept = lines.filter((line) => !line.includes('#gh-light-mode-only'));
const light = lines.length - kept.length;
const dark = kept.filter((line) => line.includes('#gh-dark-mode-only')).length;
if (light === 0 || light !== dark) {
    console.error(`error: README.md has ${light} light and ${dark} dark pictures; each picture must have one line of each`);
    process.exit(1);
}

let status = 1;
try {
    fs.writeFileSync(readme, kept.join('\n'));
    const vsce = spawnSync('npx', ['--yes', '@vscode/vsce@3', 'package', ...process.argv.slice(2)], {
        cwd: repo,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    status = vsce.status ?? 1;
} finally {
    fs.writeFileSync(readme, original);
}
process.exit(status);
