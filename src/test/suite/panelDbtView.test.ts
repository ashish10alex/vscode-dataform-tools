import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import type { CompileError } from '../../backend';
import { DbtBackend } from '../../backend/dbt';
import { DbtManifest, buildDbtGraph } from '../../backend/dbt/graph';
import { CompileState, compileStatusSlice, dbtBlock, fileSlice, projectSlice } from '../../panel/slices';
import type { DbtBlock } from '../../shared/panelContract';
import type { DryRunResult } from '../../bigquery/dryRunService';
import { dbtDryRunOf, dbtView, incrementalCase } from '../../shared/panelDbtView';
import { PanelSlices, applyMessage, initialSlices } from '../../shared/panelState';
import { findProjectRoot } from './helper';

/*
The states of a dbt Project's panel (xf#52), each from the slices the host's own builders give for a recorded
manifest of the example Project.
*/

const manifests = path.join(findProjectRoot(__dirname), 'src', 'test', 'fixtures', 'dbt-manifests');
const manifest = (name: string): DbtManifest => JSON.parse(fs.readFileSync(path.join(manifests, `${name}.json`), 'utf8'));
const backend = new DbtBackend();
const V2: DbtBlock['dbt'] = { path: '/work/shop/.venv/bin/dbt', foundBy: "the Project's .venv", flavour: 'dbt v2', version: '2.0.6' };
const CORE: DbtBlock['dbt'] = { path: '/usr/local/bin/dbt', foundBy: 'PATH', flavour: 'dbt-core', version: '1.12.5' };
const MODEL = 'models/marts/dim_customers.sql';

const compiled = (errors: CompileError[] = [], notice?: string): CompileState => ({ inProject: true, errors, compiled: { compiledAt: 1000, durationMs: 2100, ...(notice ? { notice } : {}) } });

/** A manifest as dbt-core leaves it: SQL only on the actions of the files it was asked for */
function onlyCompiled(source: DbtManifest, files: string[]): DbtManifest {
    const copy: DbtManifest = JSON.parse(JSON.stringify(source));
    for (const node of Object.values(copy.nodes ?? {})) {
        if (!files.includes(node.original_file_path ?? '')) {
            node.compiled_code = null;
        }
    }
    return copy;
}

interface Scene {
    manifest?: DbtManifest;
    file: string;
    state: CompileState;
    dbt?: DbtBlock['dbt'] | null;
    looking?: boolean;
    parsedForHooks?: boolean;
}

/** The panel's slices after the host's four messages for a file, on top of what it had */
function after(scene: Scene, before: PanelSlices = initialSlices()): PanelSlices {
    const built = scene.manifest ? buildDbtGraph(scene.manifest) : undefined;
    const shown = fileSlice(built?.graph, backend, scene.file, 1);
    const tool = scene.dbt === null ? {} : { dbt: scene.dbt ?? V2 };
    const block = dbtBlock({ ...tool, looking: scene.looking, target: 'dev', profile: 'xf_example', parsedForHooks: scene.parsedForHooks, data: built?.dbt, graph: built?.graph, shown: shown.actions.map((action) => action.id), file: scene.file }, 1);
    return [
        { slice: 'project', value: projectSlice({ root: '/work/shop' }, backend, built?.graph, 1) },
        { slice: 'dbt', value: block },
        { slice: 'compile status', value: compileStatusSlice(scene.state, 1) },
        { slice: 'file', value: shown },
    ].reduce(applyMessage, before);
}

const v2 = manifest('dbt-v2');
const viewOf = (file: string) => dbtView(after({ manifest: v2, file, state: compiled() }));

suite('the dbt panel: a file with SQL', () => {
    test('a model is shown with its tests beneath it, three tabs, and a link to its table', () => {
        const view = viewOf(MODEL);
        assert.deepStrictEqual([view.page, view.file], ['panel', MODEL]);
        assert.deepStrictEqual(view.tabs, ['compiled', 'schema', 'project']);
        assert.deepStrictEqual(view.actions.map((action) => action.kind), ['table', 'test', 'test']);
        assert.strictEqual(view.actions[0].buildsTable, true);
        assert.deepStrictEqual(view.status, { kind: 'compiled', compiledAt: 1000, durationMs: 2100 });
        assert.deepStrictEqual([view.outdated, view.skeleton, view.parsedOnly, view.card, view.errors.length], [false, false, false, undefined, 0]);
        assert.deepStrictEqual(view.readsFrom.map((neighbour) => neighbour.target.name), ['stg_customers', 'stg_orders', 'stg_payments']);
    });

    test('an ephemeral model builds no table, so its card is no link', () => {
        const view = viewOf('models/intermediate/int_customer_countries.sql');
        const [model] = view.actions;
        assert.deepStrictEqual([model.kind, model.buildsTable], ['ephemeral', false]);
    });

    test('a test file is shown with the model it tests', () => {
        const view = viewOf('tests/assert_positive_order_totals.sql');
        assert.deepStrictEqual(view.actions.map((action) => action.kind), ['incremental', 'test', 'test', 'test', 'unit test']);
    });

    test('a Project of another warehouse has one notice and no Schema tab', () => {
        const snowflake: DbtManifest = { ...v2, metadata: { ...v2.metadata, adapter_type: 'snowflake' } };
        const view = dbtView(after({ manifest: snowflake, file: MODEL, state: compiled() }));
        assert.strictEqual(view.otherWarehouse, 'snowflake');
        assert.deepStrictEqual(view.tabs, ['compiled', 'project']);
        assert.strictEqual(view.actions.length, 3);
    });
});

suite('the dbt panel: a file with no SQL', () => {
    test('a seed: what it is, its Target and what uses it', () => {
        const view = viewOf('seeds/country_codes.csv');
        assert.deepStrictEqual([view.actions.length, view.tabs], [0, ['compiled', 'project']]);
        assert.strictEqual(view.card?.title, 'Seed: country_codes');
        assert.deepStrictEqual(view.card?.rows.find((row) => row.label === 'Used by'), { label: 'Used by', value: 'int_customer_countries' });
    });

    test('the sources of a YAML file, as a flat list under the names dbt gives them', () => {
        const view = viewOf('models/staging/_sources.yml');
        assert.strictEqual(view.card?.title, 'Sources defined in this file');
        assert.deepStrictEqual(view.card?.rows.map((row) => row.label), ['raw.customers', 'raw.orders', 'raw.payments', 'File']);
        assert.strictEqual(view.card?.rows[1].value, 'alex-personal-dev-01.raw.orders');
    });

    test('a macro file names its macros', () => {
        const view = viewOf('macros/audit.sql');
        assert.strictEqual(view.card?.title, 'Macros: create_cents_to_dollars_udf, record_run_in_audit_log');
    });

    test('dbt_project.yml: the Project, its profile and how many actions of each sort', () => {
        const view = viewOf('dbt_project.yml');
        assert.strictEqual(view.card?.title, 'dbt Project: xf_example');
        assert.deepStrictEqual(view.card?.rows.slice(2), [
            { label: 'Profile', value: 'xf_example' },
            { label: 'Actions', value: '10 models · 1 seed · 1 snapshot · 12 tests · 1 unit test · 3 sources · 1 exposure · 1 analysis' },
        ]);
    });

    test('the panel is never blank in a Project: a file dbt reads, and one it does not', () => {
        assert.strictEqual(viewOf('models/docs.md').card?.title, 'No action is defined in this file');
        assert.strictEqual(viewOf('README.md').card?.title, 'This file is not part of the compile');
        assert.strictEqual(viewOf('models/reporting/_exposures.yml').card?.title, 'Exposure: revenue_dashboard');
    });
});

suite('the dbt panel: Run', () => {
    const names = (view: ReturnType<typeof dbtView>) => view.run?.targets.map((target) => target.name);

    test("is offered for the file's own actions that a run can execute, and is free after a clean compile", () => {
        const model = viewOf('models/marts/fct_orders.sql');
        // The model alone: dbt build runs its tests after it
        assert.deepStrictEqual([names(model), model.run?.blocked], [['fct_orders'], undefined]);
        assert.deepStrictEqual(names(viewOf('seeds/country_codes.csv')), ['country_codes']);
        assert.deepStrictEqual(names(viewOf('tests/assert_positive_order_totals.sql')), ['assert_positive_order_totals']);
    });

    test('is not offered where nothing can be run: sources, exposures, analyses, ephemeral models, macros', () => {
        for (const file of ['models/staging/_sources.yml', 'models/reporting/_exposures.yml', 'analyses/revenue_by_country.sql', 'models/intermediate/int_customer_countries.sql', 'macros/audit.sql', 'dbt_project.yml']) {
            assert.strictEqual(viewOf(file).run, undefined, file);
        }
    });

    test('is not offered in a Project of another warehouse', () => {
        const snowflake: DbtManifest = { ...v2, metadata: { ...v2.metadata, adapter_type: 'snowflake' } };
        assert.strictEqual(dbtView(after({ manifest: snowflake, file: MODEL, state: compiled() })).run, undefined);
    });

    test('waits for a fresh compile: blocked while one runs, for a parsed Project, and with errors of the file', () => {
        const shown = after({ manifest: v2, file: MODEL, state: compiled() });
        const compiling = dbtView(after({ manifest: v2, file: MODEL, state: { ...compiled(), compiling: { showingPrevious: true, startedAt: 7, file: MODEL } } }, shown));
        assert.strictEqual(compiling.run?.blocked, 'Wait for the compile to end');
        const parsed = dbtView(after({ manifest: manifest('dbt-v2-hooks-parsed'), file: 'models/orders.sql', parsedForHooks: true, state: compiled([], 'hooks') }));
        assert.strictEqual(parsed.run?.blocked, 'The Project is not compiled');
        const broken = dbtView(after({ manifest: onlyCompiled(v2, []), file: MODEL, state: compiled([{ message: 'not found', fileName: MODEL }]) }));
        assert.ok(broken.run?.blocked);
        // Errors in other files do not stop a run of this one when its SQL was compiled
        const elsewhere = dbtView(after({ manifest: v2, file: MODEL, state: compiled([{ message: 'undefined', fileName: 'models/staging/stg_payments.sql' }]) }));
        assert.strictEqual(elsewhere.run?.blocked, undefined);
    });
});

suite('the dbt panel: what BigQuery said', () => {
    const shown = after({ manifest: v2, file: 'models/marts/fct_orders.sql', state: compiled() });
    const [model, dataTest] = shown.file!.actions;
    const result = (action: string, compile: number): DryRunResult => ({ action, script: 'query', incremental: false, sections: ['query'], compile, sql: 'select 1', bytes: 1024 });
    const bigquery = (fields: Partial<NonNullable<PanelSlices['bigquery']>>): PanelSlices =>
        applyMessage(shown, { slice: 'bigquery', value: { compile: 1, results: [], dryRunning: [], tables: {}, currencySymbol: '$', ...fields } });

    test('an action is out while its dry run is, and has its result when it is back', () => {
        const out = bigquery({ dryRunning: [{ action: model.id, script: 'query', incremental: false }], results: [result(dataTest.id, 1)] });
        assert.deepStrictEqual(dbtDryRunOf(out, model), { running: true });
        assert.deepStrictEqual(dbtDryRunOf(out, dataTest), { running: false, result: result(dataTest.id, 1) });
        // Nothing asked yet
        assert.deepStrictEqual(dbtDryRunOf(shown, model), { running: false });
    });

    test('what BigQuery said of another compile is not shown with this SQL', () => {
        const old = bigquery({ compile: 0, results: [result(model.id, 0)], dryRunning: [{ action: dataTest.id, script: 'query', incremental: false }] });
        assert.deepStrictEqual(dbtDryRunOf(old, model), { running: false });
        assert.deepStrictEqual(dbtDryRunOf(old, dataTest), { running: false });
    });

    test('which case of an incremental model dbt compiled is told by whether its table exists', () => {
        assert.strictEqual(incrementalCase(shown, model), undefined);
        assert.strictEqual(incrementalCase(bigquery({ tables: { [model.id]: { lastModified: 'today' } } }), model), 'incremental');
        assert.strictEqual(incrementalCase(bigquery({ tables: { [model.id]: { missing: true } } }), model), 'full build');
        // BigQuery answered, but not with either
        assert.strictEqual(incrementalCase(bigquery({ tables: { [model.id]: {} } }), model), undefined);
    });
});

suite('the dbt panel: while dbt works', () => {
    const core = manifest('dbt-core');

    test('before anything is known it waits, and says when dbt is being looked for', () => {
        const waiting = dbtView(after({ file: MODEL, state: { inProject: true, errors: [] }, dbt: null, looking: true }));
        assert.deepStrictEqual(waiting.status, { kind: 'waiting', text: 'Looking for dbt…' });
        assert.deepStrictEqual([waiting.actions.length, waiting.card], [0, undefined]);
    });

    test('the first compile of a Project shows placeholder lines', () => {
        const view = dbtView(after({ file: MODEL, state: { inProject: true, errors: [], compiling: { showingPrevious: false, startedAt: 5, file: MODEL } } }));
        assert.deepStrictEqual(view.status, { kind: 'first compile', text: 'Compiling the Project…', startedAt: 5 });
        assert.deepStrictEqual([view.skeleton, view.outdated, view.file], [true, false, MODEL]);
    });

    test('a compile after a save keeps the last SQL on show, marked outdated', () => {
        const shown = after({ manifest: v2, file: MODEL, state: compiled() });
        const view = dbtView(after({ manifest: v2, file: MODEL, state: { ...compiled(), compiling: { showingPrevious: true, startedAt: 7, file: MODEL } } }, shown));
        assert.strictEqual(view.status?.kind, 'recompiling');
        assert.deepStrictEqual([view.outdated, view.skeleton, view.actions.length], [true, false, 3]);
        // The tabs do not come and go with every save
        assert.deepStrictEqual(view.tabs, ['compiled', 'schema', 'project']);
    });

    test('on dbt-core, a file not compiled since the last save shows placeholder lines while it is', () => {
        const nothing = onlyCompiled(core, []);
        const macro = after({ manifest: nothing, file: 'macros/audit.sql', state: compiled(), dbt: CORE });
        const view = dbtView(after({ manifest: nothing, file: MODEL, state: { ...compiled(), compiling: { showingPrevious: true, startedAt: 9, file: MODEL } }, dbt: CORE }, macro));
        assert.deepStrictEqual(view.status, { kind: 'first compile', text: 'Compiling this file for the first time since the last save…', startedAt: 9 });
        assert.deepStrictEqual([view.skeleton, view.outdated, view.actions.length], [true, false, 0]);
    });

    test('on dbt v2 too, a file not compiled yet shows placeholder lines while it is', () => {
        const nothing = onlyCompiled(v2, []);
        const macro = after({ manifest: nothing, file: 'macros/audit.sql', state: compiled() });
        const view = dbtView(after({ manifest: nothing, file: MODEL, state: { ...compiled(), compiling: { showingPrevious: true, startedAt: 9, file: MODEL } } }, macro));
        assert.deepStrictEqual(view.status, { kind: 'first compile', text: 'Compiling this file for the first time since the last save…', startedAt: 9 });
        assert.deepStrictEqual([view.skeleton, view.outdated, view.actions.length], [true, false, 0]);
    });

    test('a Project parsed for its hooks keeps the SQL as written on show while it is parsed again', () => {
        const parsed = { manifest: manifest('dbt-v2-hooks-parsed'), file: 'models/orders.sql', parsedForHooks: true };
        const shown = after({ ...parsed, state: compiled([], 'SQL not compiled: hooks') });
        const view = dbtView(after({ ...parsed, state: { ...compiled([], 'SQL not compiled: hooks'), compiling: { showingPrevious: true, startedAt: 9, file: 'models/orders.sql' } } }, shown));
        assert.deepStrictEqual([view.skeleton, view.outdated, view.actions.length], [false, true, 1]);
    });

    test('while the compile for another file runs, the last file is not shown under the new name', () => {
        const macro = after({ manifest: v2, file: 'macros/audit.sql', state: compiled() });
        const next = applyMessage(macro, { slice: 'compile status', value: compileStatusSlice({ ...compiled(), compiling: { showingPrevious: true, startedAt: 9, file: MODEL } }, 1) });
        const view = dbtView(next);
        assert.deepStrictEqual([view.file, view.skeleton, view.card], [MODEL, true, undefined]);
    });

    test('a Project parsed for its hooks shows the SQL as written, the offer, and no Schema tab', () => {
        const view = dbtView(after({ manifest: manifest('dbt-v2-hooks-parsed'), file: 'models/orders.sql', parsedForHooks: true, state: compiled([], 'SQL not compiled: hooks') }));
        assert.strictEqual(view.parsedOnly, true);
        assert.deepStrictEqual(view.status, { kind: 'parsed', compiledAt: 1000 });
        assert.deepStrictEqual(view.tabs, ['compiled', 'project']);
        assert.deepStrictEqual(view.actions.map((action) => [action.kind, action.sqlPresent, action.sections[0].compiled]), [['view', false, false]]);
    });
});

suite('the dbt panel: when something is wrong', () => {
    const elsewhere: CompileError[] = [{ message: "'cents_to_dolars' is undefined", fileName: 'models/staging/stg_payments.sql', line: 3 }];

    test('dbt not found: the places looked in, and nothing else', () => {
        const lookedIn = ['the dbtExecutablePath setting (not set)', 'PATH'];
        const view = dbtView(after({ file: MODEL, dbt: null, state: { inProject: true, errors: [], missingTool: { tool: 'dbt', lookedIn } } }));
        assert.deepStrictEqual([view.page, view.lookedIn, view.tabs, view.status], ['tool missing', lookedIn, [], undefined]);
    });

    test('a dbt that is too old says so', () => {
        const view = dbtView(after({ file: MODEL, dbt: CORE, state: { inProject: true, errors: [], unsupportedVersion: { tool: 'dbt', version: '1.5.0', message: 'dbt-core 1.8 or later is needed' } } }));
        assert.deepStrictEqual([view.page, view.unsupported], ['unsupported', 'dbt-core 1.8 or later is needed']);
    });

    test('errors in other files leave the SQL on show, and are counted apart', () => {
        const view = dbtView(after({ manifest: v2, file: MODEL, state: compiled(elsewhere) }));
        assert.deepStrictEqual([view.errors.length, view.errorsElsewhere.length, view.actions.length, view.status?.kind], [0, 1, 3, 'compiled']);
    });

    test("the file's own error is a card above its SQL as written, with no Schema tab", () => {
        const own: CompileError = { message: "depends on a node named 'stg_customer' which was not found", fileName: MODEL, line: 2 };
        const view = dbtView(after({ manifest: onlyCompiled(v2, []), file: MODEL, state: compiled([own, ...elsewhere]) }));
        assert.deepStrictEqual([view.errors, view.errorsElsewhere], [[own], elsewhere]);
        assert.deepStrictEqual([view.status?.kind, view.tabs], ['parsed', ['compiled', 'project']]);
    });

    test('on dbt-core one error anywhere leaves no graph: the card stands alone', () => {
        const view = dbtView(after({ manifest: { metadata: {} }, file: MODEL, dbt: CORE, state: compiled(elsewhere) }));
        assert.deepStrictEqual([view.errors, view.errorsElsewhere, view.actions.length, view.card], [elsewhere, [], 0, undefined]);
        assert.deepStrictEqual(view.status, { kind: 'failed', text: 'Compile failed' });
    });

    test('a compile that gave nothing shows its error', () => {
        const error: CompileError = { message: "The profile 'shop' does not have a target named 'stagin'" };
        const view = dbtView(after({ file: MODEL, state: { inProject: true, errors: [error] } }));
        assert.deepStrictEqual([view.status?.kind, view.errors, view.tabs], ['failed', [error], ['compiled', 'project']]);
    });
});
