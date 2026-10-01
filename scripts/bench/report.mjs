#!/usr/bin/env node
// Prints a `just bench` results file, or a before/after comparison of two.
//
//   node scripts/bench/report.mjs bench-results/<a>.json
//   node scripts/bench/report.mjs bench-results/<before>.json bench-results/<after>.json

import fs from 'fs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath) {
    console.error('usage: report.mjs <results.json> [<after.json>]');
    process.exit(1);
}
const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const runs = afterPath ? [load(beforePath), load(afterPath)] : [load(beforePath)];

function rows(r) {
    const out = [];
    const add = (label, value, unit, times) => out.push({ label, value, unit, times });
    add('bundle size', r.bundle?.bundleBytes !== undefined ? r.bundle.bundleBytes / 1024 / 1024 : undefined, 'MB');
    add('bundle evaluation', r.bundle?.bundleEvalMs, 'ms');
    add('activate()', r.activation?.activateMs, 'ms');
    add(`startup compile (${r.activation?.startupCompileSource ?? '?'})`, r.activation?.startupCompileMs, 'ms');
    for (const [key, label] of [['save', 'save -> preview'], ['switch', 'switch -> preview']]) {
        const section = r[key];
        if (!section) {
            continue;
        }
        add(`${label} median`, section.medianMs, 'ms');
        add(`${label} p90`, section.p90Ms, 'ms');
        for (const [phase, ms] of Object.entries(section.phaseMediansMs ?? {})) {
            add(`  ${key} phase: ${phase}`, ms, 'ms', section.phaseCountMedians?.[phase]);
        }
        for (const [counter, count] of Object.entries(section.counterMedians ?? {})) {
            add(`  ${key} per run: ${counter}`, count, '');
        }
    }
    return out;
}

const fmt = (row, unit = row?.unit) => {
    const value = row?.value;
    const text = value === undefined ? '-' : unit === 'MB' ? value.toFixed(2) + ' MB' : unit === 'ms' ? Math.round(value) + ' ms' : String(value);
    return row?.times > 1 ? `${text} (${row.times}x)` : text;
};

for (const r of runs) {
    const m = r.meta;
    console.log(`${m.version} @ ${m.commit}  ${m.date}  ${m.actions} actions, core ${m.coreVersion}, ${m.iterations} iterations${m.placeholderProject ? ', placeholder GCP project (dry runs are not real BigQuery latency)' : ''}`);
}
console.log(`Save/switch timings exclude the ${runs[0].meta.debounceMsExcluded} ms debounce.\n`);

const tables = runs.map(rows);
const labels = [...new Set(tables.flatMap((table) => table.map((row) => row.label)))];
const width = Math.max(...labels.map((label) => label.length)) + 2;
for (const label of labels) {
    const [a, b] = tables.map((table) => table.find((row) => row.label === label));
    let line = label.padEnd(width) + fmt(a, a?.unit ?? b?.unit).padStart(16);
    if (runs.length === 2) {
        line += fmt(b, b?.unit ?? a?.unit).padStart(16);
        if (a?.value !== undefined && b?.value !== undefined && a.value !== 0) {
            const change = ((b.value - a.value) / a.value) * 100;
            line += `${change > 0 ? '+' : ''}${change.toFixed(0)}%`.padStart(8);
        }
    }
    console.log(line);
}
