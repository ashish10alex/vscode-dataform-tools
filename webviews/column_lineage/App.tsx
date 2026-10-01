import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controls, Edge, Node, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import type { TraceState } from '../../src/shared/columnLineage/types';
import { expandDirection, focusNodeId, pathToFocus } from '../../src/shared/columnLineage/traceGraph';
import { Bridge, createBridge } from './bridge';
import { layoutTrace, laneLabel, NODE_WIDTH } from './layout';
import { LaneNode, LaneNodeData, LineageNode, LineageNodeData } from './LineageNode';
import { LineageEdge, LineageEdgeData } from './LineageEdge';

const nodeTypes = { lineage: LineageNode, lane: LaneNode };
const SOURCE_LABELS: Record<TraceState['sourceKind'], string> = {
    sample: 'Sample data',
    graph: 'Dependency graph · guessed columns',
    dataplex: 'Dataplex run history · last 30 days',
};
const edgeTypes = { lineage: LineageEdge };

function useNow(intervalMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);
    return now;
}

function formatAgo(fetchedAt: number | undefined, now: number): string {
    if (!fetchedAt) {
        return 'not fetched yet';
    }
    const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
    if (seconds < 10) {
        return 'updated just now';
    }
    if (seconds < 90) {
        return `updated ${seconds} s ago`;
    }
    return `updated ${Math.round(seconds / 60)} min ago`;
}

function Legend() {
    const line = (kind: string, label: string) => (
        <span className="ln-legend-item">
            <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" className={`ln-edge ln-edge-${kind}`} /></svg>
            {label}
        </span>
    );
    return (
        <div className="ln-legend" aria-label="Edge legend">
            {line('copy', 'copy')}
            {line('xform', 'transformed')}
            {line('table', 'table-level only')}
        </div>
    );
}

function Trace({ state, bridge }: { state: TraceState; bridge: Bridge }) {
    const [hovered, setHovered] = useState<string | undefined>();
    const { fitView } = useReactFlow();
    const seenEdges = useRef(new Set<string>());
    const now = useNow(15000);

    const { positions, lanes } = useMemo(() => layoutTrace(state), [state]);
    const highlight = useMemo(() => (hovered ? pathToFocus(state, hovered) : undefined), [state, hovered]);

    const onExpand = useCallback((nodeId: string) => bridge.post({ type: 'expand', nodeId }), [bridge]);
    const onOpenFile = useCallback((nodeId: string) => bridge.post({ type: 'openFile', nodeId }), [bridge]);

    const nodes: Node[] = useMemo(() => {
        const laneNodes: Node<LaneNodeData>[] = lanes.map((lane) => ({
            id: `lane:${lane.hop}`,
            type: 'lane',
            position: { x: lane.x, y: lane.top },
            data: { label: laneLabel(lane.hop), width: NODE_WIDTH + 52, height: lane.height, focus: lane.hop === 0 },
            selectable: false,
            draggable: false,
            focusable: false,
            zIndex: -1,
            style: { pointerEvents: 'none' },
        }));
        const traceNodes: Node<LineageNodeData>[] = state.nodes.map((node) => {
            const direction = expandDirection(node);
            const hasNext = state.edges.some((edge) => (direction === 'downstream' ? edge.source === node.id : edge.target === node.id));
            return {
                id: node.id,
                type: 'lineage',
                position: positions.get(node.id) ?? { x: 0, y: 0 },
                data: {
                    node,
                    change: node.kind === 'focus' ? state.focus.change : undefined,
                    endOfLine: node.expanded && !hasNext,
                    dimmed: !!highlight && !highlight.nodes.has(node.id),
                    highlighted: !!highlight?.nodes.has(node.id) && hovered !== undefined,
                    onExpand,
                    onOpenFile,
                },
                draggable: false,
                selectable: false,
            };
        });
        return [...laneNodes, ...traceNodes];
    }, [state, positions, lanes, highlight, hovered, onExpand, onOpenFile]);

    const edges: Edge<LineageEdgeData>[] = useMemo(() => state.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'lineage',
        data: {
            dependencyType: edge.dependencyType,
            dimmed: !!highlight && !highlight.edges.has(edge.id),
            highlighted: !!highlight?.edges.has(edge.id),
            entering: !seenEdges.current.has(edge.id),
        },
    })), [state, highlight]);

    useEffect(() => {
        state.edges.forEach((edge) => seenEdges.current.add(edge.id));
    }, [state]);

    // Refit when a lane appears or disappears, not on every hop inside an existing lane
    useEffect(() => {
        const timer = setTimeout(() => fitView({ padding: 0.18, duration: 350, maxZoom: 1.1 }), 30);
        return () => clearTimeout(timer);
    }, [lanes.length, fitView]);

    const focus = state.nodes.find((node) => node.id === focusNodeId(state));
    const noReaders = !!focus?.expanded && !state.edges.some((edge) => edge.source === focus.id);

    return (
        <div className="ln-canvas">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                minZoom={0.3}
                maxZoom={1.6}
                proOptions={{ hideAttribution: true }}
                // Hover handlers also make React Flow give non-selectable nodes pointer events, so their buttons work
                onNodeMouseEnter={(_, node) => setHovered(node.type === 'lineage' ? node.id : undefined)}
                onNodeMouseLeave={() => setHovered(undefined)}
                fitView
            >
                <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
            {noReaders && (
                <div className="ln-empty" role="status">
                    <strong>No downstream readers found.</strong>
                    <span>Dataplex keeps 30 days of run history and can't see BI tools or notebooks, so this doesn't prove the column is unused.</span>
                </div>
            )}
            <footer className="ln-footer">
                <Legend />
                <span className="ln-grow" />
                <span>{SOURCE_LABELS[state.sourceKind]}</span>
                <span aria-hidden="true">·</span>
                <span>{state.lookups} lookup{state.lookups === 1 ? '' : 's'}</span>
                <span aria-hidden="true">·</span>
                <span>{formatAgo(state.fetchedAt, now)}</span>
            </footer>
        </div>
    );
}

function Toolbar({ state, bridge }: { state: TraceState; bridge: Bridge }) {
    const { focus, upstreamShown } = state;
    const parts = focus.table.split('.');
    return (
        <header className="ln-toolbar">
            <div className="ln-title">
                <span className="ln-eyebrow">Column trace</span>
                <div className="ln-title-row">
                    <h1 className="ln-title-col">{focus.column}</h1>
                    {focus.change && (
                        <span className="ln-chip ln-chip-warn">
                            {focus.change.kind === 'dropped' ? 'dropped on this branch' : `${focus.change.from} → ${focus.change.to} on this branch`}
                        </span>
                    )}
                </div>
                <span className="ln-title-table">
                    <span className="ln-dataset">{parts.slice(0, -1).join('.')}.</span>{parts[parts.length - 1]}
                </span>
            </div>
            <div className="ln-actions">
                <button
                    type="button"
                    role="switch"
                    aria-checked={upstreamShown}
                    className="ln-switch"
                    onClick={() => bridge.post({ type: 'setUpstream', on: !upstreamShown })}
                >
                    <span className="ln-switch-track" aria-hidden="true"><span className="ln-switch-thumb" /></span>
                    Show upstream
                </button>
                <button type="button" className="ln-button" onClick={() => bridge.post({ type: 'refresh' })}>Refresh</button>
            </div>
        </header>
    );
}

export default function App() {
    const [bridge, setBridge] = useState<Bridge>();
    const [state, setState] = useState<TraceState>();

    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        let cancelled = false;
        createBridge().then((created) => {
            if (cancelled) {
                return;
            }
            unsubscribe = created.subscribe((message) => {
                if (message.type === 'trace') {
                    setState(message.state);
                }
            });
            setBridge(created);
            created.post({ type: 'webviewReady' });
        });
        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, []);

    if (!bridge || !state) {
        return <div className="ln-loading" role="status">Loading column trace…</div>;
    }

    return (
        <div className="ln-app">
            <Toolbar state={state} bridge={bridge} />
            {state.sourceKind === 'sample' && (
                <div className="ln-banner" role="note">
                    <strong>Sample data.</strong> Dataplex records no column lineage for tables that Dataform workflows build, because they run as
                    multi-statement scripts. This panel shows an example project until real data is available.
                </div>
            )}
            {state.sourceKind === 'graph' && (
                <div className="ln-banner" role="note">
                    <strong>Guessed column links.</strong> Readers and sources come from this project's dependency graph, but the column links are
                    matched by name against each table's schema. Dataplex has no column lineage for Dataform-built tables yet.
                </div>
            )}
            <ReactFlowProvider>
                <Trace state={state} bridge={bridge} />
            </ReactFlowProvider>
        </div>
    );
}
