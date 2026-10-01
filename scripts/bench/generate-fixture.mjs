#!/usr/bin/env node
// Generates a deterministic, synthetic Dataform project for `just bench`.
//
//   node scripts/bench/generate-fixture.mjs --actions 1500 [--out <dir>] [--core-version 3.0.39]
//
// The project is a layered DAG: declarations -> staging -> intermediate -> marts, plus JS files that publish
// many actions, includes with JSDoc helpers, pre_operations, incremental tables and assertions. It is
// committed to a fresh git repository so git-dependent code paths run as they do for real users.
// `defaultProject` comes from $BENCH_GCP_PROJECT; without it dry runs fail fast against a placeholder project.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

function parseArgs(argv) {
    const args = { actions: 1500, out: undefined, coreVersion: '3.0.39' };
    for (let i = 0; i < argv.length; i++) {
        const [key, value] = [argv[i], argv[i + 1]];
        if (key === '--actions') { args.actions = Number(value); i++; }
        else if (key === '--out') { args.out = value; i++; }
        else if (key === '--core-version') { args.coreVersion = value; i++; }
        else { throw new Error(`Unknown argument: ${key}`); }
    }
    if (!Number.isInteger(args.actions) || args.actions < 100) {
        throw new Error('--actions must be an integer >= 100');
    }
    args.out ??= path.join(os.tmpdir(), `dataform-tools-bench-${args.actions}`);
    return args;
}

// mulberry32: small seeded PRNG so every run generates the same project
function rng(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pad = (n) => String(n).padStart(4, '0');

function write(root, relativePath, content) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function generate({ actions, out, coreVersion }) {
    const random = rng(42);
    const pick = (list) => list[Math.floor(random() * list.length)];
    const pickSome = (list, min, max) => {
        const count = Math.min(list.length, min + Math.floor(random() * (max - min + 1)));
        const chosen = new Set();
        while (chosen.size < count) { chosen.add(pick(list)); }
        return [...chosen];
    };
    const project = process.env.BENCH_GCP_PROJECT || 'dataform-tools-bench-placeholder';

    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });

    write(out, 'workflow_settings.yaml', [
        `dataformCoreVersion: ${coreVersion}`,
        `defaultProject: ${project}`,
        'defaultLocation: US',
        'defaultDataset: bench',
        'defaultAssertionDataset: bench_assertions',
        '',
    ].join('\n'));

    write(out, 'includes/helpers.js', `/**
 * Casts a column to a nullable INT64.
 * @param {string} column - column to cast
 * @returns {string} SQL expression
 */
function safeInt(column) {
    return \`SAFE_CAST(\${column} AS INT64)\`;
}

/**
 * Keeps the latest row per key.
 * @param {string} key - partition key
 * @param {string} orderBy - ordering column
 * @returns {string} QUALIFY clause
 */
function latestBy(key, orderBy) {
    return \`QUALIFY ROW_NUMBER() OVER (PARTITION BY \${key} ORDER BY \${orderBy} DESC) = 1\`;
}

module.exports = { safeInt, latestBy };
`);
    write(out, 'includes/constants.js', `const START_DATE = "'2020-01-01'";
const REGIONS = ["EU", "US", "APAC"];

module.exports = { START_DATE, REGIONS };
`);

    // Action budget: declarations, JS-published actions, and .sqlx files for the rest
    const declarationCount = Math.max(20, Math.round(actions * 0.07));
    const jsFileCount = actions >= 300 ? 3 : 1;
    const actionsPerJsFile = 20;
    const sqlxCount = actions - declarationCount - jsFileCount * actionsPerJsFile;

    const sourceSchemas = ['raw_sales', 'raw_crm', 'raw_events', 'raw_finance', 'raw_ops'];
    const declarations = [];
    let sourcesJs = '';
    for (let i = 0; i < declarationCount; i++) {
        const name = `SRC_${pad(i)}`;
        const schema = sourceSchemas[i % sourceSchemas.length];
        declarations.push(name);
        sourcesJs += `declare({\n    database: '${project}',\n    schema: '${schema}',\n    name: '${name}',\n});\n\n`;
    }
    write(out, 'definitions/sources.js', sourcesJs);

    const layers = [
        { name: 'staging', share: 0.35, upstream: () => declarations },
        { name: 'intermediate', share: 0.35, upstream: () => layerNames.staging },
        { name: 'marts', share: 0.30, upstream: () => [...layerNames.intermediate, ...layerNames.staging] },
    ];
    const layerNames = { staging: [], intermediate: [], marts: [] };
    const files = { staging: [], intermediate: [], marts: [] };
    const tags = ['daily', 'hourly', 'finance', 'sales', 'pii', 'core'];

    let remaining = sqlxCount;
    layers.forEach((layer, layerIndex) => {
        const count = layerIndex === layers.length - 1 ? remaining : Math.round(sqlxCount * layer.share);
        remaining -= count;
        for (let i = 0; i < count; i++) {
            const name = `${layer.name.toUpperCase().slice(0, 3)}_${pad(i)}`;
            const upstream = pickSome(layer.upstream(), 1, 4);
            const roll = random();
            const incremental = roll < 0.10;
            const preOps = !incremental && roll < 0.25;
            const withAssertions = random() < 0.10;
            const description = `Synthetic ${layer.name} model ${i}`;

            const config = [
                `  type: "${incremental ? 'incremental' : (random() < 0.2 ? 'view' : 'table')}",`,
                `  schema: "bench_${layer.name}",`,
                `  description: "${description}",`,
                `  tags: ["${pick(tags)}", "${layer.name}"],`,
            ];
            if (incremental) { config.push('  uniqueKey: ["id"],'); }
            if (withAssertions) { config.push('  assertions: {\n    nonNull: ["id"],\n    uniqueKey: ["id"]\n  },'); }

            const ctes = upstream.map((ref, j) => `${j === 0 ? 'WITH' : ','} u${j} AS (\n  SELECT id, ${helpersCall(j)} AS value_${j}, updated_at\n  FROM \${ref("${ref}")}\n  WHERE updated_at >= \${constants.START_DATE}\n)`);
            const joins = upstream.slice(1).map((_, j) => `LEFT JOIN u${j + 1} USING (id)`).join('\n');
            const valueColumns = upstream.map((_, j) => `value_${j}`).join(', ');

            let body = `config {\n${config.join('\n')}\n}\n\n`;
            if (preOps) {
                body += `pre_operations {\n  SET @@query_label = "layer:${layer.name}";\n}\n\n`;
            }
            if (incremental) {
                body += `pre_operations {\n  DECLARE checkpoint DEFAULT (\n    \${when(incremental(), \`SELECT MAX(updated_at) FROM \${self()}\`, \`SELECT TIMESTAMP("2020-01-01")\`)}\n  );\n}\n\n`;
            }
            body += `${ctes.join('\n')}\n\nSELECT u0.id, ${valueColumns}, u0.updated_at\nFROM u0\n${joins}\n`;
            if (incremental) {
                body += `WHERE u0.updated_at > checkpoint\n`;
            }
            body += `\${helpers.latestBy("id", "updated_at")}\n`;

            const relativePath = `definitions/${layer.name}/${name}.sqlx`;
            write(out, relativePath, body);
            layerNames[layer.name].push(name);
            files[layer.name].push(relativePath);
        }
    });

    for (let f = 0; f < jsFileCount; f++) {
        let js = '';
        for (let i = 0; i < actionsPerJsFile; i++) {
            const name = `JS_${f}_${pad(i)}`;
            const ref = pick(layerNames.intermediate);
            js += `publish("${name}", { type: "table", schema: "bench_js", tags: ["js"] }).query(ctx => \`\n  SELECT id, value_0 FROM \${ctx.ref("${ref}")}\n\`);\n\n`;
        }
        write(out, `definitions/js/generated_${f}.js`, js);
    }

    // Files the bench edits and switches between: mid-layer models with several upstream refs
    const manifest = {
        actions,
        coreVersion,
        project,
        placeholderProject: !process.env.BENCH_GCP_PROJECT,
        saveFile: files.intermediate[Math.floor(files.intermediate.length / 2)],
        switchFiles: [files.marts[Math.floor(files.marts.length / 3)], files.staging[Math.floor(files.staging.length / 2)]],
    };
    write(out, 'bench-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    write(out, '.gitignore', 'node_modules/\n.df-cache/\n');

    const git = (...args) => execFileSync('git', args, { cwd: out, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.name=bench', '-c', 'user.email=bench@example.com', 'commit', '-q', '-m', 'Synthetic bench project');

    return manifest;
}

function helpersCall(j) {
    return j % 2 === 0 ? `\${helpers.safeInt("value")}` : 'value';
}

const args = parseArgs(process.argv.slice(2));
const manifest = generate(args);
console.log(`Generated ${manifest.actions}-action bench project at ${args.out}`);
if (manifest.placeholderProject) {
    console.log('BENCH_GCP_PROJECT is not set: dry runs hit a placeholder project and measure plumbing, not BigQuery latency');
}
