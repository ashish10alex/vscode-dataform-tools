import * as assert from 'assert';
import { suite, test } from 'mocha';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LineageColumns, LineageLists } from '../../../webviews/preview_compiled/components/LineageColumns';
import { rememberTab } from '../../../webviews/preview_compiled/utils/rowLayout';

const target = (name: string, schema = 'ds') => ({ database: 'p', schema, name });

function render(dataplex?: { dependencies?: string[] }): string {
    return renderToStaticMarkup(createElement(LineageColumns, {
        reads: [target('source', 'raw'), target('own')],
        readBy: [target('report', 'marts'), 'p.checks.own_assertion'],
        own: [target('own'), 'p.checks.own_assertion'],
        dataplex,
        loadingDataplex: false,
        onLoadDataplex: () => undefined,
        onOpen: () => undefined,
    }));
}

suite('LineageColumns: what a file reads and what reads it', () => {
    test('has a tab for each list with its count, and shows what the file reads first', () => {
        const html = render();

        assert.ok(html.includes('← Reads from <span') && html.includes('Read by → <span'));
        assert.ok(html.includes('data-lineage="dependencies"'));
        assert.ok(html.includes('>source<') && !html.includes('>report<'), 'the list of the other tab is on show');
    });

    test('has a table on one line as project.dataset.table, with the project and dataset dimmer', () => {
        const html = render();

        assert.ok(/p\.raw\.<\/span><span class="flex-shrink-0[^"]*">source</.test(html), 'the table is not shown as project.dataset.table, with the name kept from being cut');
        assert.ok(html.includes('title="p.raw.source"'), 'the whole ID is not in the tooltip');
    });

    test('starts on the tab the user left on show, and on the first where that tab is not there', () => {
        const lists = (tab: string) => {
            rememberTab('Lineage', tab);
            return renderToStaticMarkup(createElement(LineageLists, { reads: [], readBy: [], tests: [], noneReadBy: 'Nothing' }));
        };
        try {
            assert.ok(lists('dependents').includes('data-lineage="dependents"'));
            assert.ok(lists('tests').includes('data-lineage="dependencies"'));
        } finally {
            rememberTab('Lineage', 'dependencies');
        }
    });

    test('marks what the file on show builds with a word', () => {
        const html = render();
        const own = html.slice(html.indexOf('>own<'));

        assert.ok(own.includes('>this file<'));
        assert.ok(!html.slice(html.indexOf('>source<'), html.indexOf('>own<')).includes('>this file<'));
    });

    test('counts what Dataplex knows of among what reads the file', () => {
        assert.ok(render().includes('Read by → <span class="text-[var(--vscode-descriptionForeground)]">2</span>'));
        assert.ok(render({ dependencies: ['p.marts.report', 'other.bi.extract'] }).includes('Read by → <span class="text-[var(--vscode-descriptionForeground)]">3</span>'));
    });

    test('has a tab for the tests of a file that has some, and none for what cannot be read', () => {
        const entry = (name: string) => ({ id: name, dataset: '', name, url: null });
        const html = renderToStaticMarkup(createElement(LineageLists, { reads: [entry('a')], readBy: [], tests: [entry('t')] }));

        assert.ok(html.includes('Tests <span'));
        assert.ok(!html.includes('Read by'));
    });
});
