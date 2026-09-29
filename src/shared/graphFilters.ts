/**
 * Pure view logic for the dependency graph webview: which nodes and edges a
 * given view shows, and how the graph looks with assertion actions hidden.
 *
 * No I/O, no React Flow imports — shared by the webview and tests.
 */

export interface GraphNodeLike {
    id: string;
    data: Record<string, unknown>;
}

export interface GraphEdgeLike {
    id: string;
    source: string;
    target: string;
    tags?: unknown;
}

/**
 * Edge added in place of a path that ran through hidden assertions. `type`
 * names the webview's custom edge renderer; `data.via` lists the assertions.
 */
export interface BridgedEdge {
    id: string;
    source: string;
    target: string;
    tags: string[];
    type: "bridged";
    data: { via: string[] };
}

export type BaseView =
    | { kind: "full" }
    | { kind: "table" | "expandLeft" | "expandRight"; rootId: string }
    | { kind: "tag"; tag: string };

/** A base view plus the nodes clicked on top of it, in click order. */
export interface GraphView {
    base: BaseView;
    clicked: string[];
}

export const FULL_VIEW: GraphView = { base: { kind: "full" }, clicked: [] };

export function isAssertionNode(node: GraphNodeLike): boolean {
    return node.data.isAssertion === true;
}

function tagsOf(value: unknown): string[] {
    return Array.isArray(value) ? (value as string[]) : [];
}

function adjacency(edges: GraphEdgeLike[], direction: "upstream" | "downstream"): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const e of edges) {
        const [from, to] = direction === "downstream" ? [e.source, e.target] : [e.target, e.source];
        const list = map.get(from);
        if (list) { list.push(to); } else { map.set(from, [to]); }
    }
    return map;
}

/** Nearest nodes from `start` that aren't hidden, walking only through hidden nodes. */
function nearestVisible(start: string, adj: Map<string, string[]>, hidden: Set<string>): string[] {
    const found = new Set<string>();
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length > 0) {
        const current = stack.pop()!;
        for (const next of adj.get(current) ?? []) {
            if (seen.has(next)) { continue; }
            seen.add(next);
            if (hidden.has(next)) { stack.push(next); } else { found.add(next); }
        }
    }
    return Array.from(found);
}

function assertionIds(nodes: GraphNodeLike[]): Set<string> {
    return new Set(nodes.filter(isAssertionNode).map((n) => n.id));
}

/**
 * Drops assertion nodes and their edges, then bridges each path that ran
 * through them: every nearest visible upstream node is connected to every
 * nearest visible downstream node, unless a direct edge already exists.
 * Bridged edges carry the downstream node's tags, like regular edges do.
 */
export function hideAssertions<N extends GraphNodeLike, E extends GraphEdgeLike>(
    nodes: N[],
    edges: E[]
): { nodes: N[]; edges: Array<E | BridgedEdge>; hiddenCount: number } {
    const hidden = assertionIds(nodes);
    if (hidden.size === 0) {
        return { nodes, edges, hiddenCount: 0 };
    }

    const visibleNodes = nodes.filter((n) => !hidden.has(n.id));
    const visibleEdges: Array<E | BridgedEdge> = edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target));
    const existing = new Set(visibleEdges.map((e) => `${e.source}->${e.target}`));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const upstream = adjacency(edges, "upstream");
    const downstream = adjacency(edges, "downstream");
    const bridges = new Map<string, BridgedEdge>();

    for (const assertionId of hidden) {
        const parents = nearestVisible(assertionId, upstream, hidden);
        const children = nearestVisible(assertionId, downstream, hidden);
        const name = String(nodeById.get(assertionId)?.data.modelName ?? assertionId);
        for (const source of parents) {
            for (const target of children) {
                const key = `${source}->${target}`;
                if (source === target || existing.has(key)) { continue; }
                const bridge = bridges.get(key);
                if (bridge) {
                    if (!bridge.data.via.includes(name)) { bridge.data.via.push(name); }
                    continue;
                }
                bridges.set(key, {
                    id: `b${source}-${target}`,
                    source,
                    target,
                    tags: tagsOf(nodeById.get(target)?.data.tags),
                    type: "bridged",
                    data: { via: [name] },
                });
            }
        }
    }

    return { nodes: visibleNodes, edges: [...visibleEdges, ...bridges.values()], hiddenCount: hidden.size };
}

function neighbourhood(rootId: string, edges: GraphEdgeLike[], nodeIds: Set<string>, edgeIds: Set<string>) {
    nodeIds.add(rootId);
    for (const e of edges) {
        if (e.source === rootId || e.target === rootId) {
            edgeIds.add(e.id);
            nodeIds.add(e.source);
            nodeIds.add(e.target);
        }
    }
}

function walk(rootId: string, edges: GraphEdgeLike[], direction: "upstream" | "downstream", nodeIds: Set<string>, edgeIds: Set<string>) {
    const stack = [rootId];
    while (stack.length > 0) {
        const current = stack.pop()!;
        if (nodeIds.has(current)) { continue; }
        nodeIds.add(current);
        for (const e of edges) {
            const from = direction === "upstream" ? e.target : e.source;
            if (from !== current || edgeIds.has(e.id)) { continue; }
            edgeIds.add(e.id);
            stack.push(direction === "upstream" ? e.source : e.target);
        }
    }
}

/** The nodes and edges a view shows, in the order they appear in the graph. */
export function computeView<N extends GraphNodeLike, E extends GraphEdgeLike>(
    view: GraphView,
    nodes: N[],
    edges: E[]
): { nodes: N[]; edges: E[] } {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const { base } = view;

    switch (base.kind) {
        case "full":
            return { nodes, edges };
        case "table":
            neighbourhood(base.rootId, edges, nodeIds, edgeIds);
            break;
        case "expandLeft":
            walk(base.rootId, edges, "upstream", nodeIds, edgeIds);
            break;
        case "expandRight":
            walk(base.rootId, edges, "downstream", nodeIds, edgeIds);
            break;
        case "tag":
            // Edges carry the downstream model's tags, so this also pulls in
            // the upstream sources feeding a tagged model.
            for (const e of edges) {
                if (tagsOf(e.tags).includes(base.tag)) {
                    edgeIds.add(e.id);
                    nodeIds.add(e.source);
                    nodeIds.add(e.target);
                }
            }
            for (const n of nodes) {
                if (tagsOf(n.data.tags).includes(base.tag)) { nodeIds.add(n.id); }
            }
            break;
    }

    for (const clickedId of view.clicked) {
        neighbourhood(clickedId, edges, nodeIds, edgeIds);
    }

    return {
        nodes: nodes.filter((n) => nodeIds.has(n.id)),
        edges: edges.filter((e) => edgeIds.has(e.id)),
    };
}

/** The node that Expand to left/right starts from: the last click, else the view's root. */
export function viewRootId(view: GraphView): string | null {
    if (view.clicked.length > 0) { return view.clicked[view.clicked.length - 1]; }
    return "rootId" in view.base ? view.base.rootId : null;
}

/**
 * Rewrites a view so it still makes sense once assertions are hidden: clicked
 * assertions are dropped, and a view rooted on an assertion moves to the
 * assertion's upstream node when there is exactly one, else to the full graph.
 */
export function adjustViewForHiddenAssertions(view: GraphView, nodes: GraphNodeLike[], edges: GraphEdgeLike[]): GraphView {
    const hidden = assertionIds(nodes);
    const clicked = view.clicked.filter((id) => !hidden.has(id));
    const { base } = view;

    if (!("rootId" in base) || !hidden.has(base.rootId)) {
        return { base, clicked };
    }
    const parents = nearestVisible(base.rootId, adjacency(edges, "upstream"), hidden);
    if (parents.length === 1) {
        return { base: { ...base, rootId: parents[0] }, clicked };
    }
    return { base: { kind: "full" }, clicked };
}
