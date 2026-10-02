import { ColumnLink, DependencyType, LineageDirection, TraceFocus, TraceNode, TraceSource, TraceState } from './types';

// Pure state transitions for a column trace. The trace grows outward from the focus column one hop at a time.

export function traceNodeId(table: string, column?: string): string {
    return `${table}#${column ?? ''}`;
}

export function initialTraceState(focus: TraceFocus, sourceKind: TraceSource['kind']): TraceState {
    return {
        focus,
        nodes: [{
            id: traceNodeId(focus.table, focus.column),
            table: focus.table,
            column: focus.column,
            hop: 0,
            kind: 'focus',
            expanded: false,
            loading: false,
        }],
        edges: [],
        upstreamShown: false,
        sourceKind,
        lookups: 0,
    };
}

export function focusNodeId(state: TraceState): string {
    return traceNodeId(state.focus.table, state.focus.column);
}

/** The direction a node expands in: away from the focus. The focus itself expands downstream. */
export function expandDirection(node: TraceNode): LineageDirection {
    return node.hop < 0 ? 'upstream' : 'downstream';
}

/** A table-level reader expands too, to the tables that read it, but only when asked: see {@link frontier} */
export function canExpand(node: TraceNode): boolean {
    return !node.expanded && !node.loading;
}

function updateNode(state: TraceState, nodeId: string, update: Partial<TraceNode>): TraceState {
    return { ...state, nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, ...update } : node)) };
}

export function setNodeLoading(state: TraceState, nodeId: string, loading: boolean): TraceState {
    return updateNode(state, nodeId, loading ? { loading, error: undefined } : { loading });
}

export function setNodeError(state: TraceState, nodeId: string, error: string): TraceState {
    return updateNode(state, nodeId, { error, loading: false });
}

/** Marks the lookup of a node's table-level readers as running, or as finished (with `error` when it failed) */
export function setNodeCheckingReaders(state: TraceState, nodeId: string, checking: boolean, error?: string): TraceState {
    return updateNode(state, nodeId, { checkingReaders: checking, readersError: error });
}

const STRENGTH: Record<DependencyType, number> = { EXACT_COPY: 0, OTHER: 1, TABLE_ONLY: 2 };

const asIs = (table: string) => table;

/**
 * Links with dev runs folded into their action's Prod Target (see {@link TraceSource.toProd}): one per table and
 * column, keeping the strongest link
 */
export function foldLinks(links: ColumnLink[], toProd: (table: string) => string = asIs): ColumnLink[] {
    const folded = new Map<string, ColumnLink>();
    for (const link of links) {
        const table = toProd(link.table);
        const id = traceNodeId(table, link.column);
        const seen = folded.get(id);
        if (!seen || STRENGTH[link.dependencyType] < STRENGTH[seen.dependencyType]) {
            folded.set(id, { ...link, table });
        }
    }
    return [...folded.values()];
}

/**
 * Adds the links found one hop from `fromId`. A column already in the trace keeps its place and only gains the
 * edge, so a column reached by two paths shows once. Dev runs fold into their action's Prod Target through
 * `toProd`, so a column the prod run and a dev run of one action both read shows once too.
 */
export function addHop(
    state: TraceState,
    fromId: string,
    direction: LineageDirection,
    links: ColumnLink[],
    resolveFile: (table: string) => string | undefined = () => undefined,
    toProd: (table: string) => string = asIs,
): TraceState {
    const from = state.nodes.find((node) => node.id === fromId);
    if (!from) {
        return state;
    }
    const nodes = [...state.nodes];
    const edges = [...state.edges];
    const nodeAt = new Map(nodes.map((node, i) => [node.id, i]));
    const edgeAt = new Map(edges.map((edge, i) => [edge.id, i]));
    const hop = from.hop + (direction === 'downstream' ? 1 : -1);

    for (const link of links) {
        const table = toProd(link.table);
        const id = traceNodeId(table, link.column);
        if (id === fromId) {
            // e.g. an incremental table reading itself, or a dev run reading its own prod table: not a hop further out
            continue;
        }
        const devRun = link.table !== table;
        const at = nodeAt.get(id);
        if (at === undefined) {
            nodeAt.set(id, nodes.length);
            nodes.push({
                id,
                table,
                column: link.column,
                hop,
                kind: link.column ? 'column' : 'tableOnly',
                expanded: false,
                loading: false,
                filePath: resolveFile(table),
                ...(devRun ? { lineageTable: link.table } : {}),
                ...(link.assertion ? { assertion: true } : {}),
            });
        } else if (!devRun && nodes[at].lineageTable && !nodes[at].expanded && !nodes[at].loading) {
            // The prod run turned up too: its lineage is the one to follow
            nodes[at] = { ...nodes[at], lineageTable: undefined };
        }
        const [source, target] = direction === 'downstream' ? [fromId, id] : [id, fromId];
        const edgeId = `${source}->${target}`;
        const edgeIndex = edgeAt.get(edgeId);
        if (edgeIndex === undefined) {
            edgeAt.set(edgeId, edges.length);
            edges.push({ id: edgeId, source, target, dependencyType: link.dependencyType });
        } else if (STRENGTH[link.dependencyType] < STRENGTH[edges[edgeIndex].dependencyType]) {
            // A dev run and the prod run can link differently, e.g. one with column lineage and one without
            edges[edgeIndex] = { ...edges[edgeIndex], dependencyType: link.dependencyType };
        }
    }

    const expanded: Partial<TraceNode> = from.kind === 'focus' && direction === 'upstream' ? {} : { expanded: true };
    return {
        ...updateNode({ ...state, nodes, edges }, fromId, { ...expanded, loading: false, error: undefined }),
        lookups: state.lookups + 1,
        fetchedAt: Date.now(),
    };
}

/** Drops everything upstream of the focus */
export function removeUpstream(state: TraceState): TraceState {
    const kept = new Set(state.nodes.filter((node) => node.hop >= 0).map((node) => node.id));
    return {
        ...state,
        nodes: state.nodes.filter((node) => kept.has(node.id)),
        edges: state.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
        upstreamShown: false,
    };
}

/** The nodes and edges on the path between `nodeId` and the focus, for highlighting */
export function pathToFocus(state: TraceState, nodeId: string): { nodes: Set<string>; edges: Set<string> } {
    const nodes = new Set<string>([nodeId]);
    const edges = new Set<string>();
    const node = state.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.hop === 0) {
        return { nodes, edges };
    }
    // Downstream nodes walk back along incoming edges, upstream nodes forward along outgoing ones
    const towardFocus = node.hop > 0
        ? (id: string) => state.edges.filter((edge) => edge.target === id).map((edge) => ({ edge, next: edge.source }))
        : (id: string) => state.edges.filter((edge) => edge.source === id).map((edge) => ({ edge, next: edge.target }));
    const focusId = focusNodeId(state);
    const queue = [nodeId];
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === focusId) {
            // The path ends at the focus; walking on would light up the other side of the trace
            continue;
        }
        for (const { edge, next } of towardFocus(current)) {
            edges.add(edge.id);
            if (!nodes.has(next)) {
                nodes.add(next);
                queue.push(next);
            }
        }
    }
    return { nodes, edges };
}

/**
 * The trace with only straight-copy links (and table-level "may read" links), keeping the columns still
 * connected to the focus. Dataplex reports filter and join columns as OTHER, the same as real
 * transformations, so this is the way to see where a column's values are copied from and to.
 */
export function copiesOnly(state: TraceState): TraceState {
    const edges = state.edges.filter((edge) => edge.dependencyType !== 'OTHER');
    const focusId = focusNodeId(state);
    const kept = new Set([focusId]);
    const queue = [focusId];
    while (queue.length > 0) {
        const current = queue.shift()!;
        const hop = state.nodes.find((node) => node.id === current)?.hop ?? 0;
        // Walk away from the focus: downstream along outgoing edges, upstream along incoming ones
        const next = [
            ...(hop >= 0 ? edges.filter((edge) => edge.source === current).map((edge) => edge.target) : []),
            ...(hop <= 0 ? edges.filter((edge) => edge.target === current).map((edge) => edge.source) : []),
        ];
        for (const id of next) {
            if (!kept.has(id)) {
                kept.add(id);
                queue.push(id);
            }
        }
    }
    return {
        ...state,
        nodes: state.nodes.filter((node) => kept.has(node.id)),
        edges: edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
    };
}

/**
 * Columns on the outermost hop of one side that can still be expanded: what "load next hop" would fetch. Readers
 * known only at table level are left out: their own readers can fan out to dozens of tables, so they load only
 * when the reader is expanded by itself.
 */
export function frontier(state: TraceState, direction: LineageDirection): TraceNode[] {
    const side = state.nodes.filter((node) => (direction === 'downstream' ? node.hop > 0 : node.hop < 0));
    if (side.length === 0) {
        return [];
    }
    const outer = direction === 'downstream' ? Math.max(...side.map((node) => node.hop)) : Math.min(...side.map((node) => node.hop));
    return side.filter((node) => node.hop === outer && node.kind !== 'tableOnly' && canExpand(node));
}

export interface TraceRow {
    node: TraceNode;
    /** How the column is linked to the one it comes through: the strongest link when there are several */
    dependencyType: DependencyType;
    /** The columns one hop closer to the focus that it links to */
    via: TraceNode[];
}

/** One row per column on a side, by hop, then copies first, then table and column name */
export function traceRows(state: TraceState, direction: LineageDirection): TraceRow[] {
    const byId = new Map(state.nodes.map((node) => [node.id, node]));
    const rows: TraceRow[] = [];
    for (const node of state.nodes) {
        if (direction === 'downstream' ? node.hop <= 0 : node.hop >= 0) {
            continue;
        }
        const closer = direction === 'downstream'
            ? state.edges.filter((edge) => edge.target === node.id && byId.get(edge.source)?.hop === node.hop - 1).map((edge) => ({ edge, via: byId.get(edge.source)! }))
            : state.edges.filter((edge) => edge.source === node.id && byId.get(edge.target)?.hop === node.hop + 1).map((edge) => ({ edge, via: byId.get(edge.target)! }));
        if (closer.length === 0) {
            continue;
        }
        const dependencyType = closer.map(({ edge }) => edge.dependencyType).sort((a, b) => STRENGTH[a] - STRENGTH[b])[0];
        rows.push({ node, dependencyType, via: closer.map(({ via }) => via) });
    }
    return rows.sort((a, b) => Math.abs(a.node.hop) - Math.abs(b.node.hop)
        || STRENGTH[a.dependencyType] - STRENGTH[b.dependencyType]
        || `${a.node.table}.${a.node.column ?? ''}`.localeCompare(`${b.node.table}.${b.node.column ?? ''}`));
}
