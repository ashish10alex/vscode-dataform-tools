import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { CompileStatus, HostMessage, PanelCommand, PanelMessage, SliceName } from '../../shared/panelContract';

/*
 * The contract is types only, so these are checks the compiler makes: each `Record` below must name every member of
 * its union, and no other. Adding a slice, a status or a message without listing it here fails the type-check.
 */
suite('panel contract', () => {
    test('the compile status is one of seven values', () => {
        const statuses: Record<CompileStatus['status'], true> = {
            'no project': true,
            'tool not found': true,
            'version unsupported': true,
            'compiling': true,
            'compiled': true,
            'parsed only': true,
            'failed': true,
        };
        assert.strictEqual(Object.keys(statuses).length, 7);
    });

    test('there are six neutral slices and a block for each Backend', () => {
        const slices: Record<SliceName, 'neutral' | 'backend'> = {
            'project': 'neutral',
            'file': 'neutral',
            'compile status': 'neutral',
            'bigquery': 'neutral',
            'run status': 'neutral',
            'project info': 'neutral',
            'dataform': 'backend',
            'dbt': 'backend',
        };
        assert.deepStrictEqual(Object.entries(slices).filter(([, kind]) => kind === 'backend').map(([name]) => name), ['dataform', 'dbt']);
    });

    test("a Backend's own messages carry its name, and the shared ones carry none", () => {
        // Every one of the 44 messages the panel sends today has a place here, see the pull request of piece 4.1
        const commands: Record<PanelCommand, true> = {
            'ready': true, 'openAction': true, 'openFile': true, 'preview': true, 'run': true, 'runTags': true, 'repeatLastRun': true, 'copyToClipboard': true,
            'exportSchema': true, 'selectProject': true, 'showDependencyGraph': true, 'formatFile': true, 'lintFile': true,
            'showLogs': true, 'openExternal': true, 'projectInfoShown': true, 'projectInfoHidden': true, 'refreshProjectInfo': true, 'followInfoLink': true,
            'dataform.updateCompilerOptions': true, 'dataform.switchCompilationMode': true, 'dataform.compileRemotely': true,
            'dataform.startSnooze': true, 'dataform.stopSnooze': true, 'dataform.runTests': true, 'dataform.runApi': true,
            'dataform.runTagsApi': true, 'dataform.runWithOptions': true, 'dataform.setRunBackend': true, 'dataform.toggleDeferToProd': true,
            'dataform.deferToProdActions': true, 'dataform.openDeferToProdSettings': true, 'dataform.retryDeferral': true,
            'dataform.removeProxyViews': true, 'dataform.computeChangedActions': true, 'dataform.runChangedActions': true,
            'dataform.estimateTagCost': true, 'dataform.exportTagCostCsv': true, 'dataform.loadWorkflowUrls': true,
            'dataform.clearWorkflowUrls': true, 'dataform.refreshWorkflowStatuses': true, 'dataform.cancelWorkflowInvocation': true,
            'dataform.loadWorkflowJobStats': true, 'dataform.exportWorkflowActionsCsv': true, 'dataform.openExecutedSql': true,
            'dataform.openBigQueryJob': true, 'dataform.showDependencyInspector': true, 'dataform.showColumnLineage': true,
            'dataform.loadLineage': true, 'dataform.loadPropertyGraphElementSchema': true, 'dataform.runGeneratedQuery': true,
            'dbt.setTarget': true, 'dbt.compileWithHooks': true, 'dbt.chooseExecutable': true, 'dbt.lookForDbtAgain': true,
            'dbt.computeChangedActions': true, 'dbt.runChangedActions': true,
        };
        const names = Object.keys(commands);
        assert.strictEqual(names.filter((name) => !name.includes('.')).length, 19);
        assert.strictEqual(names.filter((name) => name.startsWith('dataform.')).length, 32);
        assert.strictEqual(names.filter((name) => name.startsWith('dbt.')).length, 6);
    });

    test('a message names an action by its Target, and a slice names its compile', () => {
        const preview: PanelMessage = { command: 'preview', action: { database: 'p', schema: 'ds', name: 'orders' }, section: 'query' };
        const status: HostMessage = { slice: 'compile status', value: { compile: 3, status: 'compiling', showingPrevious: true, startedAt: 0 } };
        // Survives being posted between host and panel
        assert.deepStrictEqual(JSON.parse(JSON.stringify([preview, status])), [preview, status]);
        assert.strictEqual(status.value.compile, 3);
    });
});
