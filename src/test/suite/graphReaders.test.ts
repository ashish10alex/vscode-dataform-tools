import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import { graphReaders } from '../../shared/columnLineage/graphReaders';
import { buildImpactSummary, impactMarkdown } from '../../shared/columnLineage/impactSummary';
import { ColumnLink, TraceSource } from '../../shared/columnLineage/types';
import { DataformCompiledJson, PropertyGraph, Target } from '../../types';
import { findProjectRoot } from './helper';

const libraryGraph = 'my-gcp-project.dataform.LibraryGraph';
const key = (target: Target) => `${target.database}.${target.schema}.${target.name}`;

/**
 * A real compile of definitions/graph.yaml with core 3.1.5, as xf tests with: Author with fields (UPPER(name),
 * address.country), Book with fields and metrics, Authorship and an external Shelf with ALL COLUMNS, and two edges on wrote
 */
function libraryGraphs(): PropertyGraph[] {
    const file = path.join(findProjectRoot(__dirname), 'src', 'test', 'fixtures', 'property_graph_3.1.5.json');
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as DataformCompiledJson).propertyGraphs ?? [];
}

const link = (column: string | undefined, dependencyType: ColumnLink['dependencyType']): ColumnLink => ({ table: libraryGraph, ...(column ? { column } : {}), dependencyType });
const byColumn = (links: ColumnLink[]) => [...links].sort((a, b) => (a.column ?? '').localeCompare(b.column ?? ''));

suite('Column impact: property graphs as readers', () => {
    test('finds the graphs that read a column, as xf does', () => {
        const graphs = libraryGraphs();
        const cases: [string, string | undefined, ColumnLink[]][] = [
            ['my-gcp-project.dataform.authors', 'name', [link('name', 'EXACT_COPY'), link('upper_name', 'OTHER')]],
            ['my-gcp-project.dataform.authors', 'NAME', [link('name', 'EXACT_COPY'), link('upper_name', 'OTHER')]],
            ['my-gcp-project.dataform.authors', 'address', [link('country', 'OTHER')]],
            ['my-gcp-project.dataform.authors', 'nickname', []],
            ['my-gcp-project.dataform.books', 'pages', [link('pages', 'EXACT_COPY'), link('total_pages', 'OTHER')]],
            // ALL COLUMNS exposes it; the edges' keys name it too
            ['my-gcp-project.dataform.wrote', 'book_id', [link('book_id', 'EXACT_COPY')]],
            ['my-gcp-project.dataform.wrote', 'note', [link('note', 'EXACT_COPY')]],
            // An external source: no dependency, still read
            ['my-gcp-project.raw.shelves', 'shelf_id', [link('shelf_id', 'EXACT_COPY')]],
            ['my-gcp-project.dataform.authors', undefined, [link(undefined, 'OTHER')]],
            ['my-gcp-project.dataform.author_books', undefined, []],
        ];
        for (const [table, column, want] of cases) {
            assert.deepStrictEqual(byColumn(graphReaders(graphs, table, column, key)), want, `${table}#${column}`);
        }
    });

    test('reads a key, or an edge\'s column, that no property exposes; an edge has no properties', () => {
        const graph = {
            target: { database: 'p', schema: 'g', name: 'G' },
            // As earlier cores compile them
            entities: [{ name: 'Book', dataSource: { database: 'p', schema: 'd', name: 'books' }, keys: ['id'], labels: [{ name: 'Book', fields: [{ name: 'title', expression: 'title' }] }] }],
            relationships: [{
                name: 'Wrote', dataSource: { database: 'p', schema: 'd', name: 'wrote' }, keys: ['author_id'], labels: [],
                source: { entity: 'Author', relationshipColumns: ['book_id'], entityColumns: ['id'] },
                destination: { entity: 'Book', relationshipColumns: ['book_id'], entityColumns: ['id'] },
            }],
        } as unknown as PropertyGraph;
        for (const [table, column] of [['p.d.books', 'id'], ['p.d.wrote', 'book_id']]) {
            assert.deepStrictEqual(graphReaders([graph], table, column, key), [{ table: 'p.g.G', dependencyType: 'OTHER' }], `${table}#${column}`);
        }
        assert.deepStrictEqual(graphReaders([graph], 'p.d.wrote', 'note', key), []);
    });

    test('lists a graph that reads a dropped column, even when the lineage lookup fails', async () => {
        const graphs = libraryGraphs();
        const failing: TraceSource = {
            kind: 'sample',
            async links() {
                throw new Error('No access to Data Lineage');
            },
        };
        const result = await buildImpactSummary([{
            table: 'my-gcp-project.dataform.books', type: 'table',
            prod: [{ name: 'id', type: 'INT64' }, { name: 'title', type: 'STRING' }],
            dev: [{ name: 'id', type: 'INT64' }],
        }], failing, {
            resolveFile: (table) => table === libraryGraph ? 'definitions/graph.yaml' : undefined,
            changed: new Set(),
            sqlOf: () => undefined,
            projectReaders: (table, column) => graphReaders(graphs, table, column, key),
            isGraph: (table) => table === libraryGraph,
        });
        const title = result!.atRisk[0].columns[0];
        assert.strictEqual(title.readersError, 'No access to Data Lineage');
        assert.deepStrictEqual(title.readers, [{ table: libraryGraph, column: 'title', dependencyType: 'EXACT_COPY', filePath: 'definitions/graph.yaml', graph: true }]);
        assert.ok(impactMarkdown({ status: 'ready', changedCount: 1, ...result! }).includes('Property graphs come from the compile'));
    });
});
