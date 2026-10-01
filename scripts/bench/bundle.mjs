#!/usr/bin/env node
// Measures the production extension bundle for `just bench`: size, the biggest packages in it, and how
// long Node takes to evaluate it (the part of activation that happens before `activate()` runs).
//
//   node scripts/bench/bundle.mjs [--json <out.json>]
//
// Builds with the same options as `node esbuild.js --production`, into a temp dir so `dist/` is untouched.

import esbuild from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVAL_RUNS = 5;

function packageOf(input) {
    const marker = 'node_modules/';
    const index = input.lastIndexOf(marker);
    if (index === -1) {
        return input.startsWith('src/') ? '(extension src)' : input;
    }
    const parts = input.slice(index + marker.length).split('/');
    return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

// A `vscode` module where every property, call and construction returns another stub, so the bundle's
// top-level code (output channels, class declarations extending vscode types) can run outside VS Code.
// `import * as vscode` copies the module's own keys, so the top level has one key per exported API name.
function vscodeStub() {
    const typings = fs.readFileSync(path.join(root, 'node_modules', '@types', 'vscode', 'index.d.ts'), 'utf8');
    const names = [...new Set([...typings.matchAll(/^\t?export (?:namespace|class|enum|const|function|let) (\w+)/gm)].map((match) => match[1]))];
    return `
const Module = require('module');
const stub = () => new Proxy(function () {}, {
    get: (_target, prop) => prop === 'then' || typeof prop === 'symbol' ? undefined : stub(),
    apply: () => stub(),
    construct: () => stub(),
});
const vscode = {};
for (const name of ${JSON.stringify(names)}) { vscode[name] = stub(); }
const load = Module._load;
Module._load = function (request, ...rest) {
    return request === 'vscode' ? vscode : load.call(this, request, ...rest);
};
`;
}

async function main() {
    const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : undefined;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dataform-tools-bundle-'));
    const outfile = path.join(dir, 'extension.js');

    const result = await esbuild.build({
        absWorkingDir: root,
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: true,
        sourcemap: false,
        platform: 'node',
        outfile,
        external: ['vscode'],
        logLevel: 'silent',
        metafile: true,
    });

    const bytesByPackage = {};
    const [output] = Object.values(result.metafile.outputs); // a single entry point and no sourcemap: one output
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
        const name = packageOf(input);
        bytesByPackage[name] = (bytesByPackage[name] ?? 0) + bytesInOutput;
    }
    const topPackages = Object.entries(bytesByPackage).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, bytes]) => ({ name, bytes }));
    const bundleBytes = fs.statSync(outfile).size;

    const preload = path.join(dir, 'vscode-stub.cjs');
    fs.writeFileSync(preload, vscodeStub());
    const evalMs = [];
    for (let i = 0; i < EVAL_RUNS; i++) {
        const out = execFileSync(process.execPath, ['-r', preload, '-e', `const t = performance.now(); require(${JSON.stringify(outfile)}); console.log(performance.now() - t);`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
        evalMs.push(Number(out.trim().split('\n').pop()));
    }
    evalMs.sort((a, b) => a - b);

    const report = { bundleBytes, bundleEvalMs: evalMs[Math.floor(evalMs.length / 2)], bundleEvalRunsMs: evalMs, topPackages };
    fs.rmSync(dir, { recursive: true, force: true });

    console.log(`Production bundle: ${(bundleBytes / 1024 / 1024).toFixed(2)} MB, evaluates in ${report.bundleEvalMs.toFixed(0)} ms (median of ${EVAL_RUNS})`);
    for (const { name, bytes } of topPackages) {
        console.log(`  ${(bytes / 1024).toFixed(0).padStart(6)} KB  ${name}`);
    }
    if (jsonOut) {
        fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
        fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
