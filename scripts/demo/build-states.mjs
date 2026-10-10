#!/usr/bin/env node
// Makes the states of the website's live demo (website/public/demo/states) of what `just website-demo-capture`
// recorded, and checks that nothing of the machine or the Google Cloud project it was recorded on is left in them.
//
//   node scripts/demo/build-states.mjs <capture dir> <real GCP project>
//
// The capture dir has out-dataform/ and out-dbt/ (src/demoCapture), rows.json (the model's rows, from `bq query`)
// and terminal-dataform.txt / terminal-dbt.txt (what a run prints). Strings that must never be published and that
// this script cannot know of go in scripts/demo/deny.local.json, a JSON list that git ignores.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [captureDir, realProject] = process.argv.slice(2);
if (!captureDir || !realProject) {
    console.error('usage: build-states.mjs <capture dir> <real GCP project>');
    process.exit(2);
}
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(repo, 'website', 'public', 'demo', 'states');

const DEMO_PROJECT = 'football-analytics-dev';
const DEMO_HOME = '/Users/you';
const DEMO_EMAIL = 'you@example.com';
const home = os.homedir();
const user = os.userInfo().username;

const tryRun = (command, args) => {
    try {
        return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return '';
    }
};
const emails = [...new Set([tryRun('git', ['config', 'user.email']), tryRun('git', ['config', '--global', 'user.email']), tryRun('gcloud', ['config', 'get-value', 'account'])].filter(Boolean))];

/** In order: a longer string that holds a shorter one comes first */
function renames(workspace, demoRoot) {
    return [
        [fs.realpathSync(workspace), demoRoot],
        [workspace, demoRoot],
        [realProject, DEMO_PROJECT],
        ...emails.map((email) => [email, DEMO_EMAIL]),
        [home, DEMO_HOME],
        [user, 'you'],
    ];
}

function renamed(value, pairs) {
    let text = JSON.stringify(value);
    for (const [from, to] of pairs) {
        // As the string is inside JSON, where a path's or a name's characters need no escape but `"` and `\`
        text = text.split(JSON.stringify(from).slice(1, -1)).join(to);
    }
    return JSON.parse(text);
}

const read = (...parts) => JSON.parse(fs.readFileSync(path.join(captureDir, ...parts), 'utf8'));
const slicesOnly = (timed) => timed.filter(({ message }) => 'slice' in message);

/** The earliest epoch ms in a value: what a state's times are moved from, to the moment the demo shows it */
function earliestTime(value) {
    let earliest = Infinity;
    JSON.stringify(value, (_key, item) => {
        if (typeof item === 'number' && item > 1.5e12 && item < 2.5e12) {
            earliest = Math.min(earliest, item);
        }
        return item;
    });
    return earliest;
}

/** What a run prints in the terminal, a line at a time. `at` is ms after the command was sent */
function terminal(file, command, pairs, totalMs) {
    const lines = renamed(fs.readFileSync(path.join(captureDir, file), 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((line) => !/New version available/.test(line)), pairs);
    while (lines.length && !lines[lines.length - 1].trim()) {
        lines.pop();
    }
    return { command, lines: lines.map((text, index) => ({ at: Math.round(600 + (totalMs - 600) * (index / Math.max(1, lines.length - 1))), text })) };
}

/** The rows `bq query --format=json` gave, as the extension's BigQuery client gives them: numbers as numbers */
function resultRows(schema) {
    const numeric = new Set(schema.fields.filter((field) => ['INTEGER', 'FLOAT', 'NUMERIC'].includes(field.type)).map((field) => field.name));
    return read('rows.json').map((row) => Object.fromEntries(schema.fields.map(({ name }) => [name, numeric.has(name) && row[name] !== null ? Number(row[name]) : row[name]])));
}

function preview(bigquery, sql) {
    const schema = bigquery.results.find((result) => result.schema).schema;
    const results = resultRows(schema);
    return {
        loadingMs: 1400,
        payload: {
            results,
            columns: schema.fields.map(({ name }) => ({ title: name, field: name })),
            jobStats: { bigQueryJobEndTime: null, bigQueryJobId: `${DEMO_PROJECT}:europe-west2.job_Kq3vT8mXw2Lr9ZpB4nYc`, jobCostMeta: '269.00 MiB' },
            query: sql,
            type: 'table',
            incrementalCheckBox: false,
            queryLimit: 1000,
            bigQueryJobId: `${DEMO_PROJECT}:europe-west2.job_Kq3vT8mXw2Lr9ZpB4nYc`,
        },
    };
}

function lastOf(timed, slice) {
    return timed.filter(({ message }) => message.slice === slice).pop()?.message.value;
}

// ---- Dataform

function dataform() {
    const workspace = path.join(captureDir, 'football');
    const pairs = renames(workspace, `${DEMO_HOME}/football`);
    const initial = renamed(slicesOnly(read('out-dataform', 'compiled.json')), pairs);
    const info = renamed(slicesOnly(read('out-dataform', 'project-info.json')), pairs);
    const cli = renamed(slicesOnly(read('out-dataform', 'run.json')), pairs);
    const bigquery = lastOf(initial, 'bigquery');
    const compile = lastOf(initial, 'compile status').compile;

    // A run through the Dataform API is not recorded: it needs a Dataform repository on Google Cloud with the
    // Project pushed to its git remote. It is composed here of the recorded CLI run, whose job did the same work.
    const cliEntry = cli.filter(({ message }) => message.value.workflowUrls?.length).pop().message.value.workflowUrls[0];
    const cliLastRun = cli.filter(({ message }) => message.value.lastRun).pop().message.value.lastRun;
    const t0 = cliEntry.stages.invokedAt;
    const invocation = '1760131921-7f3c2a9e-4b1d-4c6e-9a55-2d8e0b7c41fa';
    const action = cliEntry.actions[0];
    const job = { ...action.jobStats, startTime: t0 + 6200, endTime: t0 + 6200 + action.jobStats.durationMs };
    const entry = (state, more) => ({
        url: `https://console.cloud.google.com/bigquery/dataform/locations/europe-west2/repositories/football/workflows/${invocation}?project=${DEMO_PROJECT}`,
        timestamp: t0 + 1700,
        // A run of the pushed branch is listed under the branch's name
        workspace: 'main',
        includeDependencies: false,
        includeDependents: false,
        fullRefresh: false,
        executionMode: 'api',
        workflowInvocationId: invocation,
        projectId: DEMO_PROJECT,
        location: cliEntry.location,
        repositoryName: 'football',
        state,
        stages: { invokedAt: t0, preparedAt: t0 + 350, sentAt: t0 + 1700 },
        invocationStartTime: t0 + 1700,
        includedTargets: cliEntry.includedTargets,
        includedTargetTypes: cliEntry.includedTargetTypes,
        ...more,
    });
    const counts = (running, succeeded) => ({ total: 1, pending: 0, running, succeeded, failed: 0, cancelled: 0, skipped: 0 });
    const api = {
        // Sent of the host's own accord, `at` ms after the click
        start: [
            { at: 0, message: { slice: 'dataform', touched: ['pendingRun'], value: { compile, pendingRun: { via: 'api', stages: { invokedAt: t0 } } } } },
            { at: 350, message: { slice: 'dataform', touched: ['pendingRun', 'lastRun'], value: { compile, pendingRun: { via: 'api', stages: { invokedAt: t0, preparedAt: t0 + 350 } }, lastRun: { ...cliLastRun, label: cliLastRun.label.replace('CLI', 'API'), detail: cliLastRun.detail.replace('Mode: CLI', 'Mode: API'), executionMode: 'api' } } } },
            { at: 1700, entry: entry('RUNNING', { actionCounts: counts(1, 0), actions: [{ target: action.target, state: 'RUNNING', startTime: t0 + 6200 }] }) },
        ],
        // The run's end, which the host comes to know of by asking the API
        end: { at: 8300, entry: entry('SUCCEEDED', { actionCounts: counts(0, 1), actions: [{ target: action.target, state: 'SUCCEEDED', jobId: `${DEMO_PROJECT}:europe-west2.dataform-gcp-0d5b7c1e-83f2-47a9-b6d4-5e9a2c3f1b70`, startTime: t0 + 6200, jobStats: job }], jobStatsSummary: cliEntry.jobStatsSummary, invocationEndTime: t0 + 8300 }) },
        // The branch as the API runs it: pushed, with nothing left out
        gitState: { kind: 'tracking', branch: 'main', upstream: 'origin/main', uncommitted: [], unpushedCommits: 0, unpushedFiles: [], behind: 0 },
    };
    const sql = bigquery.results[0].sql;
    return {
        backend: 'dataform',
        compile,
        capturedAt: earliestTime(initial),
        initial: initial.map(({ message }) => message),
        projectInfo: info.pop().message,
        run: { startedAt: t0, messages: cli },
        api,
        terminal: terminal('terminal-dataform.txt', `dataform run ${DEMO_HOME}/football --actions "${DEMO_PROJECT}.analytics.fct_player_transfers"`, pairs, cliEntry.invocationEndTime - cliEntry.stages.sentAt - 400),
        preview: preview(bigquery, sql),
    };
}

// ---- dbt

function dbt() {
    const workspace = path.join(captureDir, 'football-dbt');
    const pairs = renames(workspace, `${DEMO_HOME}/football-dbt`);
    const initial = renamed(slicesOnly(read('out-dbt', 'compiled.json')), pairs);
    const info = renamed(slicesOnly(read('out-dbt', 'project-info.json')), pairs);
    const run = renamed(slicesOnly(read('out-dbt', 'run.json')), pairs);
    const bigquery = lastOf(initial, 'bigquery');
    const lastRun = lastOf(run, 'run status').lastRun;
    return {
        backend: 'dbt',
        compile: lastOf(initial, 'compile status').compile,
        capturedAt: earliestTime(initial),
        initial: initial.map(({ message }) => message),
        projectInfo: info.pop().message,
        // The host tells the panel of a dbt run as soon as its command is in the terminal
        run: { startedAt: lastRun.startedAt, messages: run.map(({ message }) => ({ at: 150, message })) },
        terminal: terminal('terminal-dbt.txt', lastRun.command, pairs, 5600),
        preview: preview(bigquery, bigquery.results[0].sql),
    };
}

// ---- Write, then check for leaks

fs.mkdirSync(outDir, { recursive: true });
for (const state of [dataform(), dbt()]) {
    fs.writeFileSync(path.join(outDir, `${state.backend}.json`), JSON.stringify(state) + '\n');
}

const localDeny = path.join(repo, 'scripts', 'demo', 'deny.local.json');
const denied = [...new Set([realProject, home, user, os.hostname(), ...emails, ...emails.map((email) => email.split('@')[0]), path.resolve(captureDir), ...(fs.existsSync(localDeny) ? JSON.parse(fs.readFileSync(localDeny, 'utf8')) : [])])].filter((text) => text && text.length > 2);

function filesUnder(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? (['node_modules', 'target', 'logs'].includes(entry.name) ? [] : filesUnder(file)) : [file];
    });
}

const leaks = [];
for (const dir of [path.join(repo, 'website', 'public', 'demo'), path.join(repo, 'website', 'demo')]) {
    for (const file of filesUnder(dir)) {
        const text = fs.readFileSync(file, 'latin1').toLowerCase();
        for (const word of denied) {
            if (text.includes(word.toLowerCase())) {
                leaks.push(`${path.relative(repo, file)}: holds a denied string of ${word.length} characters starting "${word.slice(0, 2)}…"`);
            }
        }
    }
}
if (leaks.length) {
    console.error(`Leak check failed:\n  ${leaks.join('\n  ')}`);
    process.exit(1);
}
console.log(`states written to ${path.relative(repo, outDir)}; leak check passed (${denied.length} denied strings, none found)`);
