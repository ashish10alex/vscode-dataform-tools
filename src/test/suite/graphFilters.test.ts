import * as assert from 'assert';
import { suite, test } from 'mocha';
import { buildDependencyGraph } from '../../shared/buildDependencyGraph';
import { GraphView, adjustViewForHiddenAssertions, computeView, hideAssertions, viewRootId } from '../../shared/graphFilters';
import { DataformCompiledJson } from '../../types';

function target(name: string) {
    return { database: 'proj', schema: 'ds', name };
}

function action(name: string, deps: string[] = [], tags: string[] = []) {
    return { fileName: `definitions/${name}.sqlx`, target: target(name), dependencyTargets: deps.map(target), tags };
}

function graph(parts: { tables?: unknown[]; assertions?: unknown[]; operations?: unknown[] }) {
    const compiled = { tables: [], assertions: [], operations: [], declarations: [], ...parts } as unknown as DataformCompiledJson;
    const { nodes, edges } = buildDependencyGraph(compiled);
    const nameOf = new Map(nodes.map((n) => [n.id, n.data.modelName]));
    const idOf = (name: string) => nodes.find((n) => n.data.modelName === name)!.id;
    return { nodes, edges, nameOf, idOf };
}

type Built = ReturnType<typeof graph>;

function edgeNames(g: Built, edges: Array<{ source: string; target: string }>) {
    return edges.map((e) => `${g.nameOf.get(e.source)}->${g.nameOf.get(e.target)}`).sort();
}

suite('graphFilters.hideAssertions', () => {
    test('drops a leaf assertion without adding edges', () => {
        const g = graph({
            tables: [{ type: 'table', ...action('orders') }],
            assertions: [action('orders_uniqueKey', ['orders'])],
        });
        const result = hideAssertions(g.nodes, g.edges);
        assert.deepStrictEqual(result.nodes.map((n) => n.data.modelName), ['orders']);
        assert.deepStrictEqual(result.edges, []);
        assert.strictEqual(result.hiddenCount, 1);
    });

    test('recognises assertions that carry a compiled type (newer @dataform/core)', () => {
        const g = graph({
            tables: [{ type: 'table', ...action('orders') }],
            assertions: [{ type: 'assertion', ...action('orders_rowConditions', ['orders']) }],
        });
        assert.deepStrictEqual(hideAssertions(g.nodes, g.edges).nodes.map((n) => n.data.modelName), ['orders']);
    });

    test('does not bridge when the direct dependency already exists', () => {
        const g = graph({
            tables: [{ type: 'table', ...action('orders') }, { type: 'table', ...action('orders_agg', ['orders', 'orders_check']) }],
            assertions: [action('orders_check', ['orders'])],
        });
        assert.deepStrictEqual(edgeNames(g, hideAssertions(g.nodes, g.edges).edges), ['orders->orders_agg']);
    });

    test('bridges a node that depends only on an assertion', () => {
        const g = graph({
            tables: [{ type: 'table', ...action('orders') }],
            assertions: [action('orders_check', ['orders'])],
            operations: [{ type: 'operations', ...action('notify', ['orders_check'], ['daily']) }],
        });
        const [bridge] = hideAssertions(g.nodes, g.edges).edges;
        assert.deepStrictEqual(
            { ...bridge, source: g.nameOf.get(bridge.source), target: g.nameOf.get(bridge.target) },
            { id: `b${g.idOf('orders')}-${g.idOf('notify')}`, source: 'orders', target: 'notify', tags: ['daily'], type: 'bridged', data: { via: ['orders_check'] } }
        );
    });

    test('bridges every parent to every child through assertion chains, once per pair', () => {
        const g = graph({
            tables: [
                { type: 'table', ...action('a') },
                { type: 'table', ...action('b') },
                { type: 'table', ...action('c', ['a2']) },
                { type: 'table', ...action('d', ['a2', 'a']) },
            ],
            assertions: [action('a1', ['a', 'b']), action('a2', ['a1'])],
        });
        const { edges } = hideAssertions(g.nodes, g.edges);
        assert.deepStrictEqual(edgeNames(g, edges), ['a->c', 'a->d', 'b->c', 'b->d']);
        const bridged = edges.filter((e) => 'type' in e && e.type === 'bridged');
        assert.strictEqual(bridged.length, 3);
        for (const e of bridged) {
            assert.deepStrictEqual((e as { data: { via: string[] } }).data.via, ['a1', 'a2']);
        }
    });

    test('returns the graph untouched when there are no assertions', () => {
        const g = graph({ tables: [{ type: 'table', ...action('orders') }] });
        const result = hideAssertions(g.nodes, g.edges);
        assert.strictEqual(result.nodes, g.nodes);
        assert.strictEqual(result.hiddenCount, 0);
    });
});

suite('graphFilters.adjustViewForHiddenAssertions', () => {
    const g = graph({
        tables: [{ type: 'table', ...action('orders') }, { type: 'table', ...action('customers') }],
        assertions: [action('orders_check', ['orders']), action('join_check', ['orders', 'customers']), action('standalone')],
    });
    const tableView = (name: string): GraphView => ({ base: { kind: 'table', rootId: g.idOf(name) }, clicked: [] });

    test('re-roots on the single upstream node', () => {
        assert.deepStrictEqual(adjustViewForHiddenAssertions(tableView('orders_check'), g.nodes, g.edges), tableView('orders'));
    });

    test('keeps the view kind when re-rooting an expand view', () => {
        const view: GraphView = { base: { kind: 'expandRight', rootId: g.idOf('orders_check') }, clicked: [] };
        assert.deepStrictEqual(adjustViewForHiddenAssertions(view, g.nodes, g.edges).base, { kind: 'expandRight', rootId: g.idOf('orders') });
    });

    test('falls back to the full graph with several or no upstream nodes', () => {
        assert.deepStrictEqual(adjustViewForHiddenAssertions(tableView('join_check'), g.nodes, g.edges).base, { kind: 'full' });
        assert.deepStrictEqual(adjustViewForHiddenAssertions(tableView('standalone'), g.nodes, g.edges).base, { kind: 'full' });
    });

    test('drops clicked assertions and leaves other views alone', () => {
        const view: GraphView = { base: { kind: 'tag', tag: 'daily' }, clicked: [g.idOf('orders_check'), g.idOf('customers')] };
        assert.deepStrictEqual(adjustViewForHiddenAssertions(view, g.nodes, g.edges), { base: view.base, clicked: [g.idOf('customers')] });
    });
});

suite('graphFilters.computeView', () => {
    const g = graph({
        tables: [
            { type: 'table', ...action('raw') },
            { type: 'table', ...action('orders', ['raw']) },
            { type: 'table', ...action('customers') },
            { type: 'table', ...action('report', ['orders', 'customers'], ['daily']) },
        ],
        assertions: [action('orders_check', ['orders'])],
        operations: [{ type: 'operations', ...action('notify', ['orders_check']) }],
    });
    const hidden = hideAssertions(g.nodes, g.edges);
    const names = (nodes: Array<{ data: Record<string, unknown> }>) => nodes.map((n) => n.data.modelName).sort();

    test('expands downstream through bridged edges', () => {
        const view: GraphView = { base: { kind: 'expandRight', rootId: g.idOf('orders') }, clicked: [] };
        assert.deepStrictEqual(names(computeView(view, hidden.nodes, hidden.edges).nodes), ['notify', 'orders', 'report']);
    });

    test('expands upstream', () => {
        const view: GraphView = { base: { kind: 'expandLeft', rootId: g.idOf('report') }, clicked: [] };
        assert.deepStrictEqual(names(computeView(view, hidden.nodes, hidden.edges).nodes), ['customers', 'orders', 'raw', 'report']);
    });

    test('shows a tag with the sources feeding it', () => {
        const view: GraphView = { base: { kind: 'tag', tag: 'daily' }, clicked: [] };
        assert.deepStrictEqual(names(computeView(view, hidden.nodes, hidden.edges).nodes), ['customers', 'orders', 'report']);
    });

    test('adds the neighbourhood of each clicked node to the base view', () => {
        const view: GraphView = { base: { kind: 'table', rootId: g.idOf('raw') }, clicked: [g.idOf('orders')] };
        const result = computeView(view, hidden.nodes, hidden.edges);
        assert.deepStrictEqual(names(result.nodes), ['notify', 'orders', 'raw', 'report']);
        assert.deepStrictEqual(edgeNames(g, result.edges), ['orders->notify', 'orders->report', 'raw->orders']);
        assert.strictEqual(viewRootId(view), g.idOf('orders'));
    });
});
