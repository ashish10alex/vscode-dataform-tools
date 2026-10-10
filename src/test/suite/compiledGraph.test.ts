import * as assert from 'assert';
import { suite, test } from 'mocha';
import {
    Action,
    Kind,
    KINDS,
    SqlSection,
    Target,
    actionsInFile,
    buildCompiledGraph,
    buildsTable,
    dependenciesOf,
    dependentsOf,
    dryRunScripts,
    hasIncrementalVariant,
    homeAction,
    isMadeUpTarget,
    isRunnable,
    joinScript,
    kindHasTable,
    madeUpTarget,
    positionInSection,
    sectionsFor,
    siblingsOf,
    slashPath,
    targetId,
    titledSections,
} from '../../shared/compiledGraph';

const target = (name: string, schema = 'ds'): Target => ({ database: 'proj', schema, name });

function action(kind: Kind, name: string, rest: Partial<Action> & { deps?: string[] } = {}): Action {
    const { deps = [], ...fields } = rest;
    const actionTarget = fields.target ?? target(name);
    return {
        id: targetId(actionTarget),
        target: actionTarget,
        kind,
        fileName: `models/${name}.sql`,
        tags: [],
        sections: [],
        sqlPresent: true,
        dependencyTargets: deps.map((dep) => target(dep)),
        ...fields,
    };
}

const names = (actions: Action[]) => actions.map((a) => a.target.name);
const COMPILED = { compiled: true, dryRun: ['query'] };

suite('compiled graph: targets and kinds', () => {
    test('an ID is database.schema.name, as the Dataform CLI writes a target', () => {
        assert.strictEqual(targetId({ database: 'proj', schema: 'ds', name: 'tbl' }), 'proj.ds.tbl');
        assert.strictEqual(targetId({ database: '', schema: 'ds', name: 'tbl' }), 'ds.tbl');
    });

    test('a made-up Target is named after its Kind and is recognisable', () => {
        const made = madeUpTarget('unit test', 'orders_total');
        assert.strictEqual(targetId(made), 'unit test.orders_total');
        assert.strictEqual(isMadeUpTarget(made), true);
        assert.strictEqual(isMadeUpTarget(target('orders')), false);
    });

    test('the Kinds are the seventeen of xf plus "unit test", each listed once', () => {
        assert.strictEqual(KINDS.length, 18);
        assert.strictEqual(new Set(KINDS).size, 18);
        assert.ok(KINDS.indexOf('unit test') === KINDS.indexOf('test') + 1);
    });

    test('which Kinds build a table of their own name', () => {
        const withTable = KINDS.filter(kindHasTable);
        assert.deepStrictEqual(withTable, ['table', 'view', 'incremental', 'materialized view', 'seed', 'snapshot', 'assertion', 'declaration', 'source']);
    });

    test('an operation builds a table only when it has output; a made-up Target never does', () => {
        assert.strictEqual(buildsTable(action('operation', 'op')), false);
        assert.strictEqual(buildsTable(action('operation', 'op', { hasOutput: true })), true);
        assert.strictEqual(buildsTable(action('table', 't')), true);
        assert.strictEqual(buildsTable(action('unit test', 'u', { target: madeUpTarget('unit test', 'u') })), false);
    });

    test('what a run can execute', () => {
        const runnable = KINDS.filter((kind) => isRunnable(action(kind, 'a')));
        assert.deepStrictEqual(runnable, ['table', 'view', 'incremental', 'materialized view', 'seed', 'snapshot', 'operation', 'assertion', 'test', 'unit test', 'notebook', 'property graph']);
        assert.strictEqual(isRunnable(action('operation', 'on_run_start', { noRun: true })), false);
    });

    test('paths are written with forward slashes', () => {
        assert.strictEqual(slashPath('definitions\\staging\\orders.sqlx'), 'definitions/staging/orders.sqlx');
        assert.strictEqual(slashPath('definitions/orders.sqlx'), 'definitions/orders.sqlx');
    });
});

suite('compiled graph: buildCompiledGraph', () => {
    test('dependencies and dependents are linked both ways and sorted by schema.name', () => {
        const graph = buildCompiledGraph([
            action('table', 'orders', { dependencyTargets: [target('alpha', 'zz'), target('zeta'), target('alpha', 'zz')] }),
            action('view', 'zeta'),
            action('view', 'alpha', { target: target('alpha', 'zz') }),
            action('table', 'report', { deps: ['zeta'] }),
            action('table', 'audit', { deps: ['zeta'] }),
        ]);
        // ds.zeta sorts before zz.alpha, and the repeated dependency is kept once
        assert.deepStrictEqual(graph.dependencies['proj.ds.orders'], ['proj.ds.zeta', 'proj.zz.alpha']);
        assert.deepStrictEqual(names(dependenciesOf(graph, 'proj.ds.orders')), ['zeta', 'alpha']);
        assert.deepStrictEqual(names(dependentsOf(graph, 'proj.ds.zeta')), ['audit', 'orders', 'report']);
        assert.deepStrictEqual(dependenciesOf(graph, 'proj.ds.zeta'), []);
        assert.deepStrictEqual(dependentsOf(graph, 'no.such.action'), []);
    });

    test('a dependency no action defines gets an "unknown" placeholder', () => {
        const graph = buildCompiledGraph([action('table', 'orders', { deps: ['missing'] })]);
        const placeholder = graph.actions['proj.ds.missing'];
        assert.strictEqual(placeholder.kind, 'unknown');
        assert.deepStrictEqual(placeholder.target, target('missing'));
        assert.deepStrictEqual(names(dependentsOf(graph, placeholder.id)), ['orders']);
        assert.strictEqual(isRunnable(placeholder), false);
        assert.deepStrictEqual(Object.keys(graph.files), ['models/orders.sql']);
    });

    test('the first action with an ID wins', () => {
        const graph = buildCompiledGraph([action('table', 'orders', { tags: ['first'] }), action('view', 'orders', { tags: ['second'] })]);
        assert.strictEqual(graph.actions['proj.ds.orders'].kind, 'table');
        assert.deepStrictEqual(graph.files['models/orders.sql'], ['proj.ds.orders']);
    });

    test('the graph survives being sent as JSON', () => {
        const graph = buildCompiledGraph([
            action('table', 'orders', { deps: ['raw'], sections: titledSections('query', ['select 1'], COMPILED), parent: target('raw') }),
            action('declaration', 'raw', { fileName: 'models/sources.yml' }),
        ]);
        const copy = JSON.parse(JSON.stringify(graph));
        assert.deepStrictEqual(copy, graph);
        assert.deepStrictEqual(names(dependenciesOf(copy, 'proj.ds.orders')), ['raw']);
    });
});

suite('compiled graph: actions shown together', () => {
    const file = 'definitions/orders.sqlx';

    test('a file lists its main action before the assertions generated from it', () => {
        const graph = buildCompiledGraph([
            action('assertion', 'orders_assertions_uniqueKey_0', { fileName: file, deps: ['orders'], parent: target('orders') }),
            action('assertion', 'orders_assertions_rowConditions', { fileName: file, deps: ['orders'], parent: target('orders') }),
            action('incremental', 'orders', { fileName: file }),
            action('table', 'other'),
        ]);
        assert.deepStrictEqual(names(actionsInFile(graph, file)), ['orders', 'orders_assertions_rowConditions', 'orders_assertions_uniqueKey_0']);
        assert.deepStrictEqual(actionsInFile(graph, 'definitions/none.sqlx'), []);
        assert.deepStrictEqual(names(siblingsOf(graph, graph.actions['proj.ds.orders'])), ['orders', 'orders_assertions_rowConditions', 'orders_assertions_uniqueKey_0']);
    });

    const dbtGraph = () =>
        buildCompiledGraph([
            action('table', 'orders', { deps: ['stg_orders', 'raw_orders'] }),
            action('view', 'stg_orders'),
            action('source', 'raw_orders', { fileName: 'models/sources.yml' }),
            // A generic test attached to orders, defined in YAML
            action('test', 'not_null_orders_id', { fileName: 'models/schema.yml', deps: ['orders'], parent: target('orders') }),
            // A singular test that reads one model and a source
            action('test', 'assert_positive_totals', { fileName: 'tests/assert_positive_totals.sql', deps: ['orders', 'raw_orders'] }),
            // A relationships test reads two models, and is attached to one
            action('test', 'relationships_orders_stg', { fileName: 'models/schema.yml', deps: ['orders', 'stg_orders'], parent: target('stg_orders') }),
            // A singular test that reads two models and is attached to neither
            action('test', 'assert_orders_match', { fileName: 'tests/assert_orders_match.sql', deps: ['orders', 'stg_orders'] }),
            action('unit test', 'orders_total', {
                target: madeUpTarget('unit test', 'orders_total'),
                fileName: 'models/unit_tests.yml',
                deps: ['orders'],
                parent: target('orders'),
            }),
        ]);

    test('a model is shown with every test that reads it, tests before unit tests', () => {
        const graph = dbtGraph();
        assert.deepStrictEqual(names(siblingsOf(graph, graph.actions['proj.ds.orders'])), [
            'orders',
            'assert_orders_match',
            'assert_positive_totals',
            'not_null_orders_id',
            'relationships_orders_stg',
            'orders_total',
        ]);
        assert.deepStrictEqual(names(siblingsOf(graph, graph.actions['proj.ds.stg_orders'])), ['stg_orders', 'assert_orders_match', 'relationships_orders_stg']);
    });

    test("a test's home is the action it is attached to, else the only one it reads that the Project builds", () => {
        const graph = dbtGraph();
        const home = (id: string) => homeAction(graph, graph.actions[id])?.target.name;
        assert.strictEqual(home('proj.ds.not_null_orders_id'), 'orders');
        assert.strictEqual(home('proj.ds.assert_positive_totals'), 'orders');
        assert.strictEqual(home('proj.ds.relationships_orders_stg'), 'stg_orders');
        assert.strictEqual(home('proj.ds.assert_orders_match'), undefined);
        assert.strictEqual(home('unit test.orders_total'), 'orders');
        assert.strictEqual(home('proj.ds.orders'), undefined);
    });

    test('a test is shown with its home action; without one, with its own file', () => {
        const graph = dbtGraph();
        assert.deepStrictEqual(names(siblingsOf(graph, graph.actions['unit test.orders_total'])), names(siblingsOf(graph, graph.actions['proj.ds.orders'])));
        assert.deepStrictEqual(names(siblingsOf(graph, graph.actions['proj.ds.assert_orders_match'])), ['assert_orders_match']);
    });

    test('an action with no file is alone', () => {
        const graph = buildCompiledGraph([action('exposure', 'dashboard', { fileName: '', deps: ['orders'] }), action('table', 'orders')]);
        assert.deepStrictEqual(names(siblingsOf(graph, graph.actions['proj.ds.dashboard'])), ['dashboard']);
    });
});

suite('compiled graph: SQL sections', () => {
    test('several statements are numbered, a single one is not, and empty ones are skipped', () => {
        assert.deepStrictEqual(titledSections('query', ['\n\nselect 1\n'], COMPILED), [{ title: 'query', sql: 'select 1', ...COMPILED }]);
        assert.deepStrictEqual(
            titledSections('pre_operations', ['declare x int64', '  \n', undefined, '  set x = 1'], COMPILED).map((s) => [s.title, s.sql]),
            [
                ['pre_operations 1/4', 'declare x int64'],
                ['pre_operations 4/4', '  set x = 1'],
            ]
        );
        assert.deepStrictEqual(titledSections('query', [''], COMPILED), []);
    });

    // What the Dataform Backend will build for an incremental table with pre- and post-operations
    const incrementalTable = () => {
        const pre = { compiled: true, dryRun: ['query', 'post_operations'] };
        const post = { compiled: true, dryRun: ['post_operations'] };
        return action('incremental', 'orders', {
            sections: [
                ...titledSections('pre_operations', ['  declare d date'], pre),
                ...titledSections('query', ['\nselect 1 as id'], COMPILED),
                ...titledSections('post_operations', ['grant select on t to x'], post),
                ...titledSections('incremental pre_operations', ['declare d date default current_date()'], { ...pre, incremental: true }),
                ...titledSections('incremental query', ['select 1 as id where day > d'], { ...COMPILED, incremental: true }),
                ...titledSections('incremental post_operations', ['grant select on t to x'], { ...post, incremental: true }),
            ],
        });
    };
    const titles = (sections: SqlSection[]) => sections.map((s) => s.title);

    test('an incremental variant is selected only where the action has one', () => {
        const table = incrementalTable();
        assert.strictEqual(hasIncrementalVariant(table), true);
        assert.deepStrictEqual(titles(sectionsFor(table, false)), ['pre_operations', 'query', 'post_operations']);
        assert.deepStrictEqual(titles(sectionsFor(table, true)), ['incremental pre_operations', 'incremental query', 'incremental post_operations']);

        const dbtModel = action('incremental', 'events', { sections: titledSections('query', ['select 1'], COMPILED) });
        assert.strictEqual(hasIncrementalVariant(dbtModel), false);
        assert.deepStrictEqual(titles(sectionsFor(dbtModel, true)), ['query']);
    });

    test('section titles are unique within an action', () => {
        const all = titles(incrementalTable().sections);
        assert.strictEqual(new Set(all).size, all.length);
    });

    test('each variant of an incremental table has a script for its query and one for its post-operations', () => {
        const scripts = dryRunScripts(incrementalTable());
        assert.deepStrictEqual(
            scripts.map((s) => [s.name, s.incremental, s.sql]),
            [
                ['query', false, 'declare d date;\nselect 1 as id;'],
                ['post_operations', false, 'declare d date;\ngrant select on t to x;'],
                ['query', true, 'declare d date default current_date();\nselect 1 as id where day > d;'],
                ['post_operations', true, 'declare d date default current_date();\ngrant select on t to x;'],
            ]
        );
        assert.deepStrictEqual(scripts[0].parts, [
            { source: 'pre_operations', start: 0, origin: -2 },
            { source: 'query', start: 16, origin: 16 },
        ]);
    });

    test('a position in a script is found in the section it came from', () => {
        const table = action('table', 't', {
            sections: [
                ...titledSections('pre_operations', ['  declare d date', 'set d =\n  current_date()'], { compiled: true, dryRun: ['query'] }),
                ...titledSections('query', ['\n\nselect id,\n  nope\nfrom t'], COMPILED),
            ],
        });
        const [script] = dryRunScripts(table);
        assert.strictEqual(script.sql, 'declare d date;\nset d =\n  current_date();\nselect id,\n  nope\nfrom t;');
        // The section keeps its own leading spaces, which the script dropped
        assert.deepStrictEqual(positionInSection(table, script, 1, 9), { section: 'pre_operations 1/2', line: 1, column: 11 });
        assert.deepStrictEqual(positionInSection(table, script, 3, 3), { section: 'pre_operations 2/2', line: 2, column: 3 });
        assert.deepStrictEqual(positionInSection(table, script, 5, 3), { section: 'query', line: 2, column: 3 });
        assert.deepStrictEqual(positionInSection(table, script, 6, 1), { section: 'query', line: 3, column: 1 });
        // On the semicolon the script added: the end of the section
        assert.deepStrictEqual(positionInSection(table, script, 6, 7), { section: 'query', line: 3, column: 7 });
        assert.strictEqual(positionInSection(table, script, 9, 1), undefined);
        assert.strictEqual(positionInSection(table, script, 0, 1), undefined);
    });

    test('an action with one variant and one script', () => {
        const view = action('view', 'v', { sections: titledSections('query', ['select 1'], COMPILED) });
        assert.deepStrictEqual(dryRunScripts(view), [{ name: 'query', incremental: false, sql: 'select 1', parts: [{ source: 'query', start: 0, origin: 0 }] }]);
    });

    test('hooks shown as written are not dry-run, and an action with nothing marked has no script', () => {
        const model = action('table', 'm', {
            sections: [
                ...titledSections('pre-hook', ['{{ log("start") }}'], { compiled: false, dryRun: [] }),
                ...titledSections('query', ['select 1'], COMPILED),
            ],
        });
        assert.deepStrictEqual(
            dryRunScripts(model).map((s) => s.sql),
            ['select 1']
        );
        assert.deepStrictEqual(dryRunScripts(action('seed', 's')), []);
        const parsedOnly = action('table', 'p', { sqlPresent: false, sections: titledSections('query', ['select {{ x }}'], { compiled: false, dryRun: [] }) });
        assert.deepStrictEqual(dryRunScripts(parsedOnly), []);
    });
});

suite('compiled graph: joinScript', () => {
    test('statements are joined one per line, each ending in a semicolon', () => {
        const statements = ['  DECLARE x INT64 \n', '', '\n\tSELECT x;', 'SELECT 2'];
        const { sql, parts } = joinScript(statements);
        assert.strictEqual(sql, 'DECLARE x INT64;\nSELECT x;\nSELECT 2;');
        assert.deepStrictEqual(
            parts.map((part) => part.source),
            [0, 2, 3]
        );
        // An offset in the script maps back into the untrimmed statement
        for (const part of parts) {
            const word: string = sql.startsWith('DECLARE', part.start) ? 'DECLARE' : 'SELECT';
            const offset: number = sql.indexOf(word, part.start) - part.origin;
            assert.strictEqual(statements[part.source].slice(offset, offset + word.length), word);
        }
    });

    test('a single statement is returned as it is, trimmed', () => {
        assert.strictEqual(joinScript(['  SELECT 1  ']).sql, 'SELECT 1');
        assert.deepStrictEqual(joinScript(['', ' ']), { sql: '', parts: [] });
    });
});
