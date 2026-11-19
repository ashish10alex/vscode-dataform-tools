import type { PropertyGraph, Target } from '../../types';
import { mentions } from './impactSummary';
import { ColumnLink } from './types';

/*
 * Dataform property graphs as readers, as xf finds them (internal/impact/graphs.go). BigQuery lineage doesn't record
 * what CREATE PROPERTY GRAPH reads, so they come from the compile. Has no VS Code dependency.
 */

/** A property graph's node or edge table, as compiled: core 3.1 calls them nodes and edges, earlier cores entities and relationships */
interface CompiledGraphTable {
    name?: string;
    dataSource?: Target;
    keys?: string[];
    labels?: { fields?: { name: string; expression: string }[]; importAll?: boolean }[];
    source?: { edgeColumns?: string[]; relationshipColumns?: string[] };
    destination?: { edgeColumns?: string[]; relationshipColumns?: string[] };
}

/** A graph table as a reader sees it: the columns it names outside its properties, and what it exposes */
interface GraphTable {
    source: Target;
    /** The key, and an edge's source and destination columns */
    columns: string[];
    properties: { name: string; expression: string }[];
    /** Its node exposes every column of its table: PROPERTIES ALL COLUMNS */
    allColumns: boolean;
}

function graphTables(graph: PropertyGraph): GraphTable[] {
    const raw = graph as PropertyGraph & { nodes?: CompiledGraphTable[]; edges?: CompiledGraphTable[] };
    const nodes = (raw.nodes ?? raw.entities ?? []) as CompiledGraphTable[];
    const edges = (raw.edges ?? raw.relationships ?? []) as CompiledGraphTable[];
    const table = (compiled: CompiledGraphTable, edge: boolean): GraphTable | undefined => {
        if (!compiled.dataSource) {
            return undefined;
        }
        const ends = [compiled.source, compiled.destination].flatMap((end) => end?.edgeColumns ?? end?.relationshipColumns ?? []);
        const labels = compiled.labels ?? [];
        return {
            source: compiled.dataSource,
            columns: [...(compiled.keys ?? []), ...ends],
            properties: labels.flatMap((label) => label.fields ?? []),
            // A node with no labels has PROPERTIES ALL COLUMNS; an edge has NO PROPERTIES
            allColumns: (!edge && !labels.length) || labels.some((label) => label.importAll),
        };
    };
    return [...nodes.map((node) => table(node, false)), ...edges.map((edge) => table(edge, true))].filter((entry): entry is GraphTable => !!entry);
}

const unquote = (name: string) => name.replace(/`/g, '').toLowerCase();

/**
 * The property graphs of `graphs` that read `column` of `table`, or `table` itself when `column` is undefined.
 * `tableOf` is the table a graph table's source is compared with `table` as: its Prod Target, say.
 *
 * A graph reads a column that a property's expression names (as the property, an exact copy when the property is
 * the column itself), that its node exposes with PROPERTIES ALL COLUMNS (as a property of the same name), or that it
 * names as a key or an edge's source or destination column (with no column of its own). Either way the graph loses
 * what its queries read, and a key or a named property fails its rebuild.
 */
export function graphReaders(graphs: PropertyGraph[] | undefined, table: string, column: string | undefined, tableOf: (target: Target) => string): ColumnLink[] {
    const links: ColumnLink[] = [];
    for (const graph of graphs ?? []) {
        if (!graph.target) {
            continue;
        }
        const reader = `${graph.target.database}.${graph.target.schema}.${graph.target.name}`;
        let named = false;
        const found: ColumnLink[] = [];
        for (const graphTable of graphTables(graph)) {
            if (tableOf(graphTable.source) !== table) {
                continue;
            }
            if (column === undefined) {
                found.push({ table: reader, dependencyType: 'OTHER' });
                break;
            }
            for (const property of graphTable.properties) {
                if (unquote(property.expression) === column.toLowerCase()) {
                    found.push({ table: reader, column: property.name, dependencyType: 'EXACT_COPY' });
                } else if (mentions(property.expression, column)) {
                    found.push({ table: reader, column: property.name, dependencyType: 'OTHER' });
                }
            }
            if (graphTable.allColumns) {
                found.push({ table: reader, column, dependencyType: 'EXACT_COPY' });
            }
            named = named || graphTable.columns.some((name) => unquote(name) === column.toLowerCase());
        }
        if (named && !found.length) {
            found.push({ table: reader, dependencyType: 'OTHER' });
        }
        links.push(...found);
    }
    return links;
}
