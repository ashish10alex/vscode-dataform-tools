import * as assert from 'assert';
import { suite, test } from 'mocha';
import { filterGraphByAssertionVisibility } from '../../../webviews/dependancy_graph/graphVisibility';

suite('dependency graph assertion visibility', () => {
    const tableA = { id: 'table-a', data: { type: 'table', modelName: 'table_a' } };
    const assertion = { id: 'check-a', data: { type: 'assertion', modelName: 'check_a' } };
    const tableB = { id: 'table-b', data: { type: 'view', modelName: 'table_b' } };
    const nodes = [tableA, assertion, tableB];
    const edges = [
        { id: 'table-to-assertion', source: 'table-a', target: 'check-a' },
        { id: 'assertion-to-table', source: 'check-a', target: 'table-b' },
        { id: 'table-lineage', source: 'table-a', target: 'table-b' },
    ];

    test('removes assertion nodes', () => {
        const filtered = filterGraphByAssertionVisibility(nodes, edges, false);

        assert.deepStrictEqual(filtered.nodes, [tableA, tableB]);
    });

    test('removes every edge connected to an assertion', () => {
        const filtered = filterGraphByAssertionVisibility(nodes, edges, false);

        assert.deepStrictEqual(filtered.edges, [edges[2]]);
    });

    test('leaves non-assertion lineage unchanged', () => {
        const filtered = filterGraphByAssertionVisibility(nodes, edges, false);

        assert.strictEqual(filtered.nodes[0], tableA);
        assert.strictEqual(filtered.nodes[1], tableB);
        assert.strictEqual(filtered.edges[0], edges[2]);
    });

    test('restores the complete source graph when visibility is enabled', () => {
        const hidden = filterGraphByAssertionVisibility(nodes, edges, false);
        const restored = filterGraphByAssertionVisibility(nodes, edges, true);

        assert.strictEqual(restored.nodes, nodes);
        assert.strictEqual(restored.edges, edges);
        assert.strictEqual(hidden.nodes.includes(assertion), false);
        assert.deepStrictEqual(restored.nodes, nodes);
        assert.deepStrictEqual(restored.edges, edges);
    });
});
