import * as assert from 'assert';
import { suite, test } from 'mocha';
import { CompiledGraphDiff } from '../../utils/compiledGraphDiff';
import { hasRenameCandidates, pairRenames, parseRenames } from '../../utils/renames';
import { displayReasons, renamedFromLabels } from '../../shared/changeComparison';
import { ChangedActionsResult, toChangedActionsView } from '../../changedActions';

const target = { database: 'p', schema: 'ds', name: 'x' };

function added(name: string, fileName: string, type = 'table') {
    return { target: name, targetObj: target, fileName, type, reasons: ['new' as const] };
}

suite('renames', () => {
    test('reads renamed files from git diff --name-status -z, skipping other entries', () => {
        const renames = parseRenames('R100\0a.js\0a_new.js\0M\0c.sqlx\0R087\0b.sqlx\0b_new.sqlx\0');
        assert.deepStrictEqual([...renames], [['a_new.js', { from: 'a.js', score: 100 }], ['b_new.sqlx', { from: 'b.sqlx', score: 87 }]]);
    });

    test('pairs a renamed file only when it has one new action and its old path one deleted action', () => {
        const diff: CompiledGraphDiff = {
            changed: [
                added('ds.a1', 'a_new.js'), added('ds.a2', 'a_new.js'),
                added('ds.b_new', 'b_new.sqlx'),
                added('ds.b_new_assertions_uniqueKey_0', 'b_new.sqlx', 'assertion'),
            ],
            deleted: [
                { target: 'ds.a', fileName: 'a.js', type: 'table' },
                { target: 'ds.b', fileName: 'b.sqlx', type: 'table' },
                { target: 'ds.b_assertions_uniqueKey_0', fileName: 'b.sqlx', type: 'assertion' },
            ],
        };
        pairRenames(diff, parseRenames('R100\0a.js\0a_new.js\0M\0c.sqlx\0R087\0b.sqlx\0b_new.sqlx\0'));
        assert.deepStrictEqual(diff.changed.map((action) => [action.target, action.renamedFrom]), [
            ['ds.a1', undefined], ['ds.a2', undefined], ['ds.b_new', 'ds.b'], ['ds.b_new_assertions_uniqueKey_0', undefined],
        ]);
        assert.strictEqual(diff.changed[2].similarity, 87);
        assert.strictEqual(diff.changed[2].renamedFromFile, 'b.sqlx');
        assert.deepStrictEqual(diff.deleted.map((action) => action.renamedTo), [undefined, 'ds.b_new', undefined]);
    });

    test('pairs a file that kept its path but moved its action to another schema, without git', () => {
        const diff: CompiledGraphDiff = {
            changed: [added('crm.customers', 'customers.sqlx'), { ...added('ds.orders', 'orders.sqlx'), reasons: ['sql'] }],
            deleted: [{ target: 'marts.customers', fileName: 'customers.sqlx', type: 'table' }],
        };
        assert.strictEqual(hasRenameCandidates(diff), true);
        pairRenames(diff);
        assert.deepStrictEqual([diff.changed[0].renamedFrom, diff.changed[0].renamedFromFile, diff.changed[0].similarity], ['marts.customers', 'customers.sqlx', 0]);
        assert.strictEqual(diff.deleted[0].renamedTo, 'crm.customers');
        assert.strictEqual(diff.changed[1].renamedFrom, undefined);
    });

    test('pairs a renamed file with its old path, not with a new action now at that old path', () => {
        const diff: CompiledGraphDiff = {
            changed: [added('ds.b', 'b_new.sqlx'), added('ds.other', 'b.sqlx')],
            deleted: [{ target: 'ds.b_old', fileName: 'b.sqlx', type: 'table' }],
        };
        pairRenames(diff, parseRenames('R090\0b.sqlx\0b_new.sqlx\0'));
        assert.deepStrictEqual(diff.changed.map((action) => action.renamedFrom), ['ds.b_old', undefined]);
        assert.strictEqual(diff.deleted[0].renamedTo, 'ds.b');
    });

    test('lists a renamed action as renamed, under what its file was', () => {
        const actions = [
            { fileName: 'definitions/customers.sqlx', reasons: ['new', 'sql'], renamedFrom: 'p.marts.customers', renamedFromFile: 'definitions/customers.sqlx', similarity: 0 },
            { fileName: 'definitions/orders_v2.sqlx', reasons: ['new'], renamedFrom: 'p.marts.orders', renamedFromFile: 'definitions/orders.sqlx', similarity: 95 },
            { fileName: 'definitions/sales/daily.sqlx', reasons: ['new'], renamedFrom: 'p.marts.daily', renamedFromFile: 'definitions/daily.sqlx', similarity: 80 },
            { fileName: 'definitions/fresh.sqlx', reasons: ['new'] },
        ];
        assert.deepStrictEqual(actions.map(displayReasons), [['renamed', 'sql'], ['renamed'], ['renamed'], ['new']]);
        assert.deepStrictEqual([...renamedFromLabels(actions)], [
            ['definitions/customers.sqlx', '← marts.customers'],
            ['definitions/orders_v2.sqlx', '← orders.sqlx (95%)'],
            ['definitions/sales/daily.sqlx', '← definitions/daily.sqlx (80%)'],
        ]);
    });

    test('carries renames into the Run Changed view', () => {
        const result = {
            baseRef: 'origin/main', mergeBaseSha: 'abc', headLabel: 'working tree', headRef: 'feat', defaultBranch: 'main', onDefaultBranch: false,
            changed: [{ ...added('crm.customers', 'customers.sqlx'), renamedFrom: 'marts.customers', renamedFromFile: 'customers.sqlx', similarity: 0 }, added('ds.fresh', 'fresh.sqlx')],
            deleted: [{ target: 'marts.customers', fileName: 'customers.sqlx', type: 'table', renamedTo: 'crm.customers' }],
        } as ChangedActionsResult;
        const view = toChangedActionsView(result);
        assert.deepStrictEqual(view.changed, [
            { target: 'crm.customers', fileName: 'customers.sqlx', type: 'table', reasons: ['new'], renamedFrom: 'marts.customers', renamedFromFile: 'customers.sqlx', similarity: 0 },
            { target: 'ds.fresh', fileName: 'fresh.sqlx', type: 'table', reasons: ['new'] },
        ]);
        assert.strictEqual(view.deleted?.[0].renamedTo, 'crm.customers');
    });
});
