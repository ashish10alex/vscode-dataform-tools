import * as assert from 'assert';
import { suite, test } from 'mocha';
import { firstChoice, isRowLabel, isTabChoice, withRow, withTab } from '../../shared/rowLayout';

suite('panel: the rows the user left open', () => {
    test('a row the user has not chosen for starts as it is made to: closed unless it is open by default', () => {
        assert.strictEqual(firstChoice({ left: undefined, problem: false }), null);
        assert.strictEqual(firstChoice({ left: undefined, defaultOpen: true, problem: false }), true);
    });

    test('a row starts as the user left it, whatever its default', () => {
        assert.strictEqual(firstChoice({ left: false, defaultOpen: true, problem: false }), false);
        assert.strictEqual(firstChoice({ left: true, problem: false }), true);
    });

    test('a row left closed still opens on a problem it has when drawn, and a row left open stays open', () => {
        assert.strictEqual(firstChoice({ left: false, defaultOpen: true, problem: true }), null);
        assert.strictEqual(firstChoice({ left: true, problem: true }), true);
    });

    test('a row that stays closed starts closed, though the user left it open', () => {
        assert.strictEqual(firstChoice({ left: true, problem: false, staysClosed: true }), null);
    });

    test('a choice changes only its own row', () => {
        const layout = withRow({ Lineage: true }, 'Compile', false);
        assert.deepStrictEqual(layout, { Lineage: true, Compile: false });
        assert.deepStrictEqual(withRow(layout, 'Compile', true), { Lineage: true, Compile: true });
    });

    test('the host keeps only labels the panel could have sent', () => {
        assert.ok(isRowLabel('Last run'));
        assert.ok(![undefined, 3, '', 'x'.repeat(41)].some(isRowLabel));
    });

    test('a tab chosen changes only its own group, and the host keeps only what the panel could have sent', () => {
        assert.deepStrictEqual(withTab({ Lineage: 'dependencies', Other: 'a' }, 'Lineage', 'dependents'), { Lineage: 'dependents', Other: 'a' });
        assert.ok(isTabChoice('Lineage', 'dependents'));
        assert.ok(![[undefined, 'a'], ['Lineage', 3], ['Lineage', '']].some(([group, tab]) => isTabChoice(group, tab)));
    });
});
