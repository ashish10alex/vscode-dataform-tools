import * as assert from 'assert';
import { suite, test } from 'mocha';
import { Backend, BackendRequest, CompileFiles, affectsCompile, backendParts } from '../../backend';
import { buildCompiledGraph } from '../../shared/compiledGraph';

// The two specs xf watches by, which the Dataform and dbt Backends will carry
const dataformFiles: CompileFiles = {
    directories: ['definitions', 'includes'],
    extensions: ['.sqlx', '.js', '.sql', '.json', '.yaml', '.yml', '.ipynb'],
    rootFiles: ['workflow_settings.yaml', 'dataform.json'],
};
const dbtFiles: CompileFiles = {
    skip: ['target', 'logs'],
    extensions: ['.sql', '.yml', '.yaml', '.csv', '.py', '.md', '.jinja', '.jinja2'],
    rootFiles: ['dbt_project.yml', 'packages.yml', 'dependencies.yml', 'selectors.yml', 'profiles.yml'],
};

suite('backend: which files affect a compile', () => {
    test('named directories: files of a listed type under them, at any depth', () => {
        assert.strictEqual(affectsCompile(dataformFiles, 'definitions/orders.sqlx'), true);
        assert.strictEqual(affectsCompile(dataformFiles, 'definitions/staging/deep/orders.SQLX'), true);
        assert.strictEqual(affectsCompile(dataformFiles, 'includes/constants.js'), true);
        assert.strictEqual(affectsCompile(dataformFiles, 'definitions/notes.md'), false);
        assert.strictEqual(affectsCompile(dataformFiles, 'definitions/Makefile'), false);
        assert.strictEqual(affectsCompile(dataformFiles, 'scripts/load.js'), false);
    });

    test('a file directly in the root counts only when it is named', () => {
        assert.strictEqual(affectsCompile(dataformFiles, 'workflow_settings.yaml'), true);
        assert.strictEqual(affectsCompile(dataformFiles, 'dataform.json'), true);
        assert.strictEqual(affectsCompile(dataformFiles, 'package.json'), false);
        assert.strictEqual(affectsCompile(dbtFiles, 'dbt_project.yml'), true);
        assert.strictEqual(affectsCompile(dbtFiles, 'README.md'), false);
    });

    test('no named directories: every directory at the root except the skipped ones', () => {
        assert.strictEqual(affectsCompile(dbtFiles, 'models/marts/orders.sql'), true);
        assert.strictEqual(affectsCompile(dbtFiles, 'macros/cents.sql'), true);
        assert.strictEqual(affectsCompile(dbtFiles, 'seeds/countries.csv'), true);
        assert.strictEqual(affectsCompile(dbtFiles, 'target/compiled/shop/models/orders.sql'), false);
        assert.strictEqual(affectsCompile(dbtFiles, 'logs/dbt.log'), false);
        // Only a directory at the root is skipped
        assert.strictEqual(affectsCompile(dbtFiles, 'models/target/orders.sql'), true);
    });

    test('nothing under node_modules or a dot directory counts, nor a dot file, nor a file outside the root', () => {
        assert.strictEqual(affectsCompile(dataformFiles, 'definitions/node_modules/pkg/index.js'), false);
        assert.strictEqual(affectsCompile(dbtFiles, '.venv/lib/site.py'), false);
        assert.strictEqual(affectsCompile(dbtFiles, 'models/.orders.sql'), false);
        assert.strictEqual(affectsCompile(dbtFiles, '../other/models/orders.sql'), false);
    });
});

suite('backend: the interface', () => {
    type Options = { suffix: string };
    const logged: string[] = [];
    const request = (signal = new AbortController().signal): BackendRequest<Options> => ({
        root: '/work/shop',
        options: { suffix: 'dev' },
        logger: { info: (m) => logged.push(m), debug: (m) => logged.push(m), error: (m) => logged.push(m) },
        signal,
    });

    // The least a Backend can be
    const compileOnly: Backend<Options> = {
        name: 'dbt',
        compileFiles: dbtFiles,
        async compile({ root, options, logger, signal }) {
            signal.throwIfAborted();
            logger.debug(`compiling ${root}`);
            return {
                graph: buildCompiledGraph([]),
                errors: [{ fileName: 'models/orders.sql', message: `no relation orders_${options.suffix}`, line: 3 }],
                notice: 'parsed only',
            };
        },
    };

    test('a compile returns the graph and its errors together, with a notice', async () => {
        const result = await compileOnly.compile(request());
        assert.deepStrictEqual(result.graph.actions, {});
        assert.deepStrictEqual(result.errors, [{ fileName: 'models/orders.sql', message: 'no relation orders_dev', line: 3 }]);
        assert.strictEqual(result.notice, 'parsed only');
        assert.deepStrictEqual(logged, ['compiling /work/shop']);
    });

    test('a cancelled compile rejects with the reason it was cancelled for', async () => {
        const controller = new AbortController();
        controller.abort(new Error('superseded'));
        await assert.rejects(compileOnly.compile(request(controller.signal)), /superseded/);
    });

    test('optional parts are told by their presence', () => {
        assert.deepStrictEqual(backendParts(compileOnly), { runner: false, changes: false });
        const withRunner: Backend<Options> = {
            ...compileOnly,
            runner: { command: ({ run, options }) => `tool run ${run.actions.join(' ')} --suffix ${options.suffix}` },
        };
        assert.deepStrictEqual(backendParts(withRunner), { runner: true, changes: false });
        const run = { actions: ['proj.ds.orders'], tags: [], includeDependencies: false, includeDependents: false, fullRefresh: false };
        assert.strictEqual(withRunner.runner!.command({ root: '/work/shop', options: { suffix: 'dev' }, run }), 'tool run proj.ds.orders --suffix dev');
    });
});
