import { ColumnLink, LineageDirection } from './types';

// Builds sample column lineage from a project's compiled dependency graph. The table-level links are real; the
// column links are guessed by matching column names, since there is no real column lineage to read yet.

export interface GraphAction {
    /** `project.dataset.table` */
    fqn: string;
    /** Compiled action type, e.g. table, view, incremental, operations, declaration */
    type: string;
    fileName?: string;
    dependsOn: string[];
}

export interface SchemaColumn {
    name: string;
    type: string;
}

interface CompiledTarget {
    database?: string;
    schema?: string;
    name?: string;
}

interface CompiledAction {
    type?: string;
    target?: CompiledTarget;
    fileName?: string;
    dependencyTargets?: CompiledTarget[];
}

interface CompiledGraph {
    tables?: CompiledAction[];
    operations?: CompiledAction[];
    declarations?: CompiledAction[];
}

export function targetFqn(target: CompiledTarget): string {
    return `${target.database}.${target.schema}.${target.name}`;
}

/** Tables, operations and declarations by fully qualified name. Assertions are left out: they read whole tables. */
export function indexGraph(graph: CompiledGraph): Map<string, GraphAction> {
    const index = new Map<string, GraphAction>();
    const add = (action: CompiledAction, fallbackType: string) => {
        if (!action?.target) {
            return;
        }
        const fqn = targetFqn(action.target);
        index.set(fqn, {
            fqn,
            type: action.type ?? fallbackType,
            fileName: action.fileName,
            dependsOn: (action.dependencyTargets ?? []).map(targetFqn),
        });
    };
    (graph.tables ?? []).forEach((action) => add(action, 'table'));
    (graph.operations ?? []).forEach((action) => add(action, 'operations'));
    (graph.declarations ?? []).forEach((action) => add(action, 'declaration'));
    return index;
}

export function graphNeighbours(index: Map<string, GraphAction>, fqn: string, direction: LineageDirection): GraphAction[] {
    if (direction === 'upstream') {
        return (index.get(fqn)?.dependsOn ?? []).map((dependency) => index.get(dependency) ?? { fqn: dependency, type: 'declaration', dependsOn: [] });
    }
    return [...index.values()].filter((action) => action.dependsOn.includes(fqn));
}

/** Readers that Dataplex never records column lineage for, because they run as scripts */
function runsAsScript(action: GraphAction): boolean {
    return action.type === 'incremental' || action.type === 'operations' || action.type === 'operation';
}

/**
 * One link per neighbour that has a column of the same name: a copy when the type matches, otherwise a
 * transformation. A neighbour whose schema is unknown, or that runs as a script, gets a table-level link.
 * Neighbours with a known schema but no such column are taken not to use it.
 */
export function guessColumnLinks(
    column: SchemaColumn,
    neighbours: { action: GraphAction; columns?: SchemaColumn[] }[],
    direction: LineageDirection,
): ColumnLink[] {
    const links: ColumnLink[] = [];
    for (const { action, columns } of neighbours) {
        if (!columns || (direction === 'downstream' && runsAsScript(action))) {
            links.push({ table: action.fqn, dependencyType: 'TABLE_ONLY' });
            continue;
        }
        const match = columns.find((candidate) => candidate.name.toLowerCase() === column.name.toLowerCase());
        if (match) {
            links.push({
                table: action.fqn,
                column: match.name,
                dependencyType: !column.type || match.type === column.type ? 'EXACT_COPY' : 'OTHER',
            });
        }
    }
    return links;
}
