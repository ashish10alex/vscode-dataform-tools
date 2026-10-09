import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import { buildDbtGraph } from '../../backend/dbt/graph';
import { runnableInFile, testsOfFile } from '../../project/dbtCommands';
import { findProjectRoot } from './helper';

const root = findProjectRoot(__dirname);
const { graph } = buildDbtGraph(JSON.parse(fs.readFileSync(path.join(root, 'src', 'test', 'fixtures', 'dbt-manifests', 'dbt-v2.json'), 'utf8')));
const names = (actions: Array<{ target: { name: string } }>) => actions.map((action) => action.target.name).sort();

suite('dbt commands: what a file runs', () => {
    test('"run current file" runs what the file defines that a run can execute', () => {
        assert.deepStrictEqual(names(runnableInFile(graph, 'models/marts/fct_orders.sql')), ['fct_orders']);
        assert.deepStrictEqual(names(runnableInFile(graph, 'seeds/country_codes.csv')), ['country_codes']);
        assert.deepStrictEqual(names(runnableInFile(graph, 'tests/assert_positive_order_totals.sql')), ['assert_positive_order_totals']);
        // Sources, an ephemeral model, an analysis and a macro file run nothing
        for (const file of ['models/staging/_sources.yml', 'models/intermediate/int_customer_countries.sql', 'analyses/revenue_by_country.sql', 'macros/audit.sql']) {
            assert.deepStrictEqual(runnableInFile(graph, file), [], file);
        }
    });

    test('"run assertions / tests in the current model" runs the tests attached to the model, and not the model', () => {
        assert.deepStrictEqual(names(testsOfFile(graph, 'models/marts/fct_orders.sql')), ['assert_positive_order_totals', 'not_null_fct_orders_order_id', 'test_fct_orders_sums_payments', 'unique_fct_orders_order_id']);
        assert.deepStrictEqual(names(testsOfFile(graph, 'models/marts/dim_customers.sql')), ['not_null_dim_customers_customer_id', 'unique_dim_customers_customer_id']);
        // A file that defines only tests has no model of its own to take tests from
        assert.deepStrictEqual(testsOfFile(graph, 'tests/assert_positive_order_totals.sql'), []);
        assert.deepStrictEqual(testsOfFile(graph, 'seeds/country_codes.csv'), []);
    });
});

suite('the commands of the manifest, by Backend (xf#63)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).contributes;
    const PREFIX = 'vscode-dataform-tools.';
    const commands: Array<{ command: string; category: string; title: string }> = manifest.commands;
    const palette = new Map<string, string>(manifest.menus.commandPalette.map((entry: { command: string; when: string }) => [entry.command.slice(PREFIX.length), entry.when]));
    const hiddenInDbt = (name: string) => (palette.get(name) ?? '').includes('vscode-dataform-tools.backend != dbt');
    const shared = commands.filter((command) => command.category === 'Dataform/dbt').map((command) => command.command.slice(PREFIX.length));

    test('the nineteen that work in a dbt Project, and the Project picker, are in the category of both', () => {
        assert.deepStrictEqual(shared.sort(), [
            'cancelQuery', 'clearExtensionCache', 'dependencyGraphPanel', 'rerunLastExecution', 'runAssertions', 'runChangedActions', 'runCurrentFile', 'runCurrentFileWtDeps',
            'runCurrentFileWtDownstreamDeps', 'runFilesTagsWtOptions', 'runQuery', 'runTag', 'runTagWtDeps', 'runTagWtDownstreamDeps',
            'searchTableColumns', 'selectWorkspaceFolder', 'showCompiledQueryInWebView', 'showCompiledQueryWtDryRun', 'snoozeCompilation', 'stopSnoozeCompilation',
        ]);
        assert.ok(shared.every((name) => !hiddenInDbt(name)));
    });

    test('every other command is Dataform\'s, and is not listed while the active Project is a dbt one', () => {
        const others = commands.filter((command) => command.category !== 'Dataform/dbt');
        assert.strictEqual(others.length, 25);
        for (const command of others) {
            assert.strictEqual(command.category, 'Dataform', command.command);
            assert.ok(hiddenInDbt(command.command.slice(PREFIX.length)), `${command.command} is listed in a dbt Project`);
        }
    });

    test('the conditions a command already had are kept', () => {
        assert.strictEqual(palette.get('runTests'), '!vscode-dataform-tools.remoteMode && vscode-dataform-tools.backend != dbt');
        assert.strictEqual(palette.get('compileRemotely'), 'vscode-dataform-tools.remoteMode && vscode-dataform-tools.backend != dbt');
        assert.strictEqual(palette.get('selectWorkspaceFolder'), 'vscode-dataform-tools.multipleProjects');
    });

    test('the editor buttons for running and for the panel show on any file of a dbt Project; Format does not', () => {
        const title = new Map<string, string>(manifest.menus['editor/title'].map((entry: { command: string; when: string }) => [entry.command.slice(PREFIX.length), entry.when]));
        assert.ok(title.get('runCurrentFile')?.endsWith('|| vscode-dataform-tools.backend == dbt'));
        assert.ok(title.get('showCompiledQueryWtDryRun')?.endsWith('|| vscode-dataform-tools.backend == dbt'));
        assert.ok(title.get('formatDocument')?.endsWith('&& vscode-dataform-tools.backend != dbt'));
    });

    test('the six settings added for dbt are contributed under the one prefix, each for a folder of its own', () => {
        const all = Array.isArray(manifest.configuration) ? Object.assign({}, ...manifest.configuration.map((section: { properties: object }) => section.properties)) : manifest.configuration.properties;
        for (const name of ['dbtExecutablePath', 'dbtTarget', 'dbtVars', 'dbtProfilesDir', 'dbtCompileWithHooks', 'backend']) {
            const setting = all[PREFIX + name];
            assert.ok(setting, `${name} is not contributed`);
            assert.strictEqual(setting.scope, 'resource', name);
            assert.ok(setting.markdownDescription?.length > 40, name);
        }
        assert.deepStrictEqual(all[`${PREFIX}backend`].enum, ['dataform', 'dbt', null]);
    });
});
