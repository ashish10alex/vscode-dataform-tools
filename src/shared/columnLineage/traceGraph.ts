import { ColumnLink, LineageDirection, TraceFocus, TraceNode, TraceSource, TraceState } from './types';

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

export function canExpand(node: TraceNode): boolean {
    return node.kind !== 'tableOnly' && !node.expanded && !node.loading;
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

/**
 * Adds the links found one hop from `fromId`. A column already in the trace keeps its place and only gains the
 * edge, so a column reached by two paths shows once.
 */
export function addHop(
    state: TraceState,
    fromId: string,
    direction: LineageDirection,
    links: ColumnLink[],
    resolveFile: (table: string) => string | undefined = () => undefined,
): TraceState {
    const from = state.nodes.find((node) => node.id === fromId);
    if (!from) {
        return state;
    }
    const nodes = [...state.nodes];
    const edges = [...state.edges];
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edgeIds = new Set(edges.map((edge) => edge.id));
    const hop = from.hop + (direction === 'downstream' ? 1 : -1);

    for (const link of links) {
        const id = traceNodeId(link.table, link.column);
        if (!nodeIds.has(id)) {
            nodeIds.add(id);
            nodes.push({
                id,
                table: link.table,
                column: link.column,
                hop,
                kind: link.column ? 'column' : 'tableOnly',
                expanded: false,
                loading: false,
                filePath: resolveFile(link.table),
            });
        }
        const [source, target] = direction === 'downstream' ? [fromId, id] : [id, fromId];
        const edgeId = `${source}->${target}`;
        if (!edgeIds.has(edgeId)) {
            edgeIds.add(edgeId);
            edges.push({ id: edgeId, source, target, dependencyType: link.dependencyType });
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
