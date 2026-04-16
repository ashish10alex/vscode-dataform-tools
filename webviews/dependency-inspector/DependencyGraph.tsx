import { useEffect, useRef } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Controls,
    Background,
    BackgroundVariant,
    MiniMap,
    useNodesState,
    useEdgesState,
    MarkerType,
    Handle,
    Position,
    type Node,
    type Edge,
    type NodeProps,
    type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { DependencyRow, GraphEdge, ModelResult } from './types';
import { vscode } from './vscode';

function buildBqLink(jobId: string | undefined): string | undefined {
    if (!jobId) { return undefined; }
    const parts = jobId.split(':');
    if (parts.length < 2) { return undefined; }
    const projectId = parts[0];
    const restId = parts[1].replace('.', ':');
    return `https://console.cloud.google.com/bigquery?project=${projectId}&j=bq:${restId}&page=queryresults`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────────────────
const NODE_W = 280;
const NODE_H = 72;

// ─────────────────────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────────────────────
type RS = ModelResult['status'];

function statusAccentColor(status: RS | undefined): string {
    if (!status || status === 'idle') { return ''; }
    if (status === 'dry-run-loading' || status === 'query-loading') {
        return 'var(--vscode-progressBar-background)';
    }
    if (status === 'dry-run-success' || status === 'query-success') {
        return 'var(--vscode-testing-iconPassed)';
    }
    return 'var(--vscode-testing-iconFailed)';
}

function statusLabel(status: RS | undefined): string {
    const map: Partial<Record<RS, string>> = {
        'dry-run-loading': 'Dry running…',
        'query-loading':   'Running…',
        'dry-run-success': 'Dry run OK',
        'query-success':   'Done',
        'dry-run-error':   'Dry run error',
        'query-error':     'Error',
    };
    return status ? (map[status] ?? '') : '';
}

function isLoading(status: RS | undefined) {
    return status === 'dry-run-loading' || status === 'query-loading';
}

function hasResult(status: RS | undefined) {
    return !!status && status !== 'idle';
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom node
// ─────────────────────────────────────────────────────────────────────────────
type DepNodeData = {
    fullTableId: string;
    depth: number;
    isRoot: boolean;
    enabled: boolean;
    onToggle: (id: string) => void;
    resultStatus?: RS;
    bytes?: string;
    cost?: string;
    errorMessage?: string;
    bqLink?: string;
    isZeroRows?: boolean;
};

function DepNode({ id, data }: NodeProps) {
    const d = data as DepNodeData;
    const parts = d.fullTableId.split('.');
    const modelName = parts[parts.length - 1];
    const prefix = parts.slice(0, -1).join('.');
    const { isRoot, enabled, resultStatus, bqLink, isZeroRows } = d;

    const accent = isZeroRows
        ? 'var(--vscode-editorWarning-foreground)'
        : statusAccentColor(resultStatus);
    const isErr = resultStatus === 'dry-run-error' || resultStatus === 'query-error';
    const isSucc = (resultStatus === 'dry-run-success' || resultStatus === 'query-success') && !isZeroRows;
    const isLoad = isLoading(resultStatus);
    const showStatus = hasResult(resultStatus);

    const leftBarColor = accent || (isRoot
        ? 'var(--vscode-button-hoverBackground)'
        : 'var(--vscode-focusBorder)');

    const bgTint = isZeroRows
        ? 'var(--vscode-inputValidation-warningBackground)'
        : isErr
            ? 'var(--vscode-inputValidation-errorBackground)'
            : isSucc
                ? 'var(--vscode-diffEditor-insertedTextBackground)'
                : isRoot
                    ? 'var(--vscode-button-background)'
                    : 'var(--vscode-editorWidget-background)';

    return (
        <div
            className={isLoad ? 'animate-pulse' : ''}
            style={{
                width: NODE_W,
                height: NODE_H,
                borderRadius: 8,
                padding: '8px 14px 8px 16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 3,
                boxSizing: 'border-box' as const,
                position: 'relative' as const,
                background: bgTint,
                borderLeft: `4px solid ${leftBarColor}`,
                border: isRoot ? undefined : `1px solid ${isErr
                    ? 'var(--vscode-inputValidation-errorBorder)'
                    : isZeroRows
                        ? 'var(--vscode-inputValidation-warningBorder)'
                        : isSucc
                            ? 'var(--vscode-testing-iconPassed)'
                            : 'var(--vscode-panel-border)'}`,
                borderLeftWidth: 4,
                boxShadow: isErr
                    ? '0 2px 8px rgba(0,0,0,0.25), 0 0 0 1px var(--vscode-inputValidation-errorBorder)'
                    : isZeroRows
                        ? '0 2px 8px rgba(0,0,0,0.25), 0 0 0 1px var(--vscode-inputValidation-warningBorder)'
                    : '0 2px 8px rgba(0,0,0,0.25)',
                opacity: enabled ? 1 : 0.4,
                transition: 'opacity 0.15s ease, border-color 0.2s ease, box-shadow 0.2s ease',
            }}
        >
            <Handle
                type="target"
                position={Position.Left}
                style={{
                    background: isRoot ? 'var(--vscode-button-foreground)' : leftBarColor,
                    width: 10, height: 10, left: -5,
                    border: '2px solid var(--vscode-editor-background)',
                }}
            />

            {/* Checkbox — top-left */}
            <button
                title={enabled ? 'Deselect this node' : 'Select this node'}
                onClick={(e) => { e.stopPropagation(); d.onToggle(id); }}
                style={{
                    position: 'absolute',
                    top: 8,
                    left: 10,
                    width: 15,
                    height: 15,
                    borderRadius: 3,
                    border: `1.5px solid ${isRoot
                        ? 'rgba(255,255,255,0.6)'
                        : 'var(--vscode-checkbox-border, var(--vscode-focusBorder))'}`,
                    background: enabled
                        ? (isRoot ? 'rgba(255,255,255,0.25)' : 'var(--vscode-checkbox-background)')
                        : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    flexShrink: 0,
                }}
            >
                {enabled && (
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                        <path
                            d="M1.5 5L3.8 7.5L8.5 2.5"
                            stroke={isRoot ? 'white' : 'var(--vscode-foreground)'}
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                )}
            </button>

            {/* Depth / root badge */}
            <span style={{
                position: 'absolute',
                top: -8,
                right: 10,
                fontSize: 9,
                fontFamily: 'var(--vscode-editor-font-family, monospace)',
                fontWeight: 600,
                background: isRoot ? 'var(--vscode-button-background)' : 'var(--vscode-badge-background)',
                color: isRoot ? 'var(--vscode-button-foreground)' : 'var(--vscode-badge-foreground)',
                padding: '1px 6px',
                borderRadius: 4,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.06em',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }}>
                {isRoot ? 'root' : `dep · ${d.depth}`}
            </span>

            {/* Model name */}
            <div style={{
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'var(--vscode-editor-font-family, monospace)',
                color: isRoot ? 'var(--vscode-button-foreground)' : 'var(--vscode-editor-foreground)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1.3,
                paddingLeft: 22,
            }}>
                {modelName}
            </div>

            {/* project.dataset prefix OR status row — mutually exclusive to save vertical space */}
            {showStatus ? (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    paddingLeft: 22,
                    paddingRight: 4,
                    minWidth: 0,
                }}>
                    {/* Coloured status dot */}
                    <span style={{
                        display: 'inline-block',
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: accent,
                        flexShrink: 0,
                        boxShadow: `0 0 4px ${accent}`,
                    }} />
                    <span style={{
                        fontSize: 10,
                        fontFamily: 'var(--vscode-editor-font-family, monospace)',
                        color: isErr
                            ? 'var(--vscode-inputValidation-errorForeground)'
                            : isZeroRows
                                ? 'var(--vscode-inputValidation-warningForeground)'
                                : isRoot ? 'rgba(255,255,255,0.9)' : 'var(--vscode-foreground)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        minWidth: 0,
                    }}>
                        {isZeroRows ? 'No rows returned' : statusLabel(resultStatus)}
                        {isSucc && d.bytes ? ` · ${d.bytes}` : ''}
                        {isSucc && d.cost  ? ` · ${d.cost}`  : ''}
                        {isErr && d.errorMessage
                            ? ` · ${d.errorMessage.slice(0, 40)}${d.errorMessage.length > 40 ? '…' : ''}`
                            : ''}
                    </span>
                    {/* BQ job link — shown when a job ID is available */}
                    {bqLink && (
                        <button
                            title="View job in BigQuery"
                            onClick={(e) => { e.stopPropagation(); vscode.postMessage({ command: 'openExternal', value: bqLink }); }}
                            style={{
                                flexShrink: 0,
                                fontSize: 10,
                                fontFamily: 'sans-serif',
                                background: 'transparent',
                                border: 'none',
                                padding: '1px 3px',
                                cursor: 'pointer',
                                color: 'var(--vscode-textLink-foreground)',
                                borderRadius: 3,
                                lineHeight: 1,
                            }}
                        >
                            ↗
                        </button>
                    )}
                </div>
            ) : prefix ? (
                <div style={{
                    fontSize: 10,
                    fontFamily: 'var(--vscode-editor-font-family, monospace)',
                    color: isRoot ? 'rgba(255,255,255,0.75)' : 'var(--vscode-descriptionForeground)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.2,
                    paddingLeft: 22,
                }}>
                    {prefix}
                </div>
            ) : null}

            <Handle
                type="source"
                position={Position.Right}
                style={{
                    background: isRoot ? 'var(--vscode-button-foreground)' : leftBarColor,
                    width: 10, height: 10, right: -5,
                    border: '2px solid var(--vscode-editor-background)',
                }}
            />
        </div>
    );
}

const nodeTypes = { depNode: DepNode };

// ─────────────────────────────────────────────────────────────────────────────
// Dagre layout
// ─────────────────────────────────────────────────────────────────────────────
function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 160 });
    nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
    edges.forEach(e => {
        if (g.hasNode(e.source) && g.hasNode(e.target)) {
            g.setEdge(e.source, e.target);
        }
    });
    dagre.layout(g);
    return nodes.map((n, i) => {
        const pos = g.node(n.id);
        if (!pos || pos.x === undefined) {
            return { ...n, position: { x: i * (NODE_W + 40), y: 0 } };
        }
        return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner component
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
    dependencies: DependencyRow[];
    graphEdges: GraphEdge[];
    onToggleNode: (id: string) => void;
    results: Record<string, ModelResult>;
}

function GraphInner({ dependencies, graphEdges, onToggleNode, results }: Props) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const rfInstance = useRef<ReactFlowInstance<Node, Edge> | null>(null);

    const onToggleRef = useRef(onToggleNode);
    onToggleRef.current = onToggleNode;

    const prevNodeIdsRef = useRef('');

    // ── Structural rebuild (new dep set or graphEdges change) ──────────────────
    useEffect(() => {
        if (dependencies.length === 0) {
            setNodes([]);
            setEdges([]);
            prevNodeIdsRef.current = '';
            return;
        }

        const newIds = dependencies.map(d => d.id).join('\0');
        const isStructural = newIds !== prevNodeIdsRef.current;
        prevNodeIdsRef.current = newIds;

        const stableToggle = (nodeId: string) => onToggleRef.current(nodeId);

        const buildData = (dep: DependencyRow): DepNodeData => {
            const res = results[dep.id];
            return {
                fullTableId: dep.fullTableId,
                depth: dep.depth,
                isRoot: dep.isSelectedModel ?? false,
                enabled: dep.enabled,
                onToggle: stableToggle,
                resultStatus: res?.status,
                bytes: res?.bytes,
                cost: res?.cost,
                errorMessage: res?.error,
                bqLink: buildBqLink(res?.jobStats?.bigQueryJobId),
                isZeroRows: res?.status === 'query-success' && (!res.results || res.results.length === 0),
            };
        };

        if (isStructural) {
            const rawNodes: Node[] = dependencies.map(dep => ({
                id: dep.id,
                type: 'depNode',
                position: { x: 0, y: 0 },
                data: buildData(dep),
            }));

            const edgeColor = 'var(--vscode-foreground)';
            const rawEdges: Edge[] = graphEdges.map((e, i) => ({
                id: `e-${i}`,
                source: e.source,
                target: e.target,
                markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor, width: 14, height: 14 },
                style: { stroke: edgeColor, strokeWidth: 1.5, opacity: 0.55 },
            }));

            const laid = layoutGraph(rawNodes, rawEdges);
            setNodes(laid);
            setEdges(rawEdges);
            setTimeout(() => rfInstance.current?.fitView({ padding: 0.2, maxZoom: 1.5 }), 100);
        } else {
            // Only enabled state changed — patch in-place, no relayout
            setNodes(prev => prev.map(n => {
                const dep = dependencies.find(d => d.id === n.id);
                if (!dep) { return n; }
                return { ...n, data: buildData(dep) };
            }));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dependencies, graphEdges, setNodes, setEdges]);

    // ── Results update (dry-run / query results arrive) ────────────────────────
    useEffect(() => {
        setNodes(prev => {
            if (prev.length === 0) { return prev; }
            return prev.map(n => {
                const res = results[n.id];
                const cur = n.data as DepNodeData;
                const nextStatus = res?.status;
                const nextBqLink = buildBqLink(res?.jobStats?.bigQueryJobId);
                const nextIsZeroRows = res?.status === 'query-success' && (!res.results || res.results.length === 0);
                // Skip update if nothing changed
                if (cur.resultStatus === nextStatus
                    && cur.bytes === res?.bytes
                    && cur.cost === res?.cost
                    && cur.errorMessage === res?.error
                    && cur.bqLink === nextBqLink
                    && cur.isZeroRows === nextIsZeroRows) {
                    return n;
                }
                return {
                    ...n,
                    data: {
                        ...cur,
                        resultStatus: nextStatus,
                        bytes: res?.bytes,
                        cost: res?.cost,
                        errorMessage: res?.error,
                        bqLink: nextBqLink,
                        isZeroRows: nextIsZeroRows,
                    },
                };
            });
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [results, setNodes]);

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onInit={(instance) => { rfInstance.current = instance; }}
            fitView
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            style={{ background: 'var(--vscode-editor-background)' }}
        >
            <Controls
                style={{
                    background: 'var(--vscode-editorWidget-background)',
                    border: '1px solid var(--vscode-panel-border)',
                    borderRadius: 6,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                }}
            />
            <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1.5}
                color="var(--vscode-editorIndentGuide-background)"
            />
            <MiniMap
                style={{
                    background: 'var(--vscode-editorWidget-background)',
                    border: '1px solid var(--vscode-panel-border)',
                    borderRadius: 6,
                }}
                nodeColor={n => {
                    const d = n.data as DepNodeData;
                    const accent = statusAccentColor(d.resultStatus);
                    if (accent) { return accent; }
                    return d.isRoot
                        ? 'var(--vscode-button-background)'
                        : 'var(--vscode-focusBorder)';
                }}
                maskColor="rgba(0,0,0,0.08)"
            />
        </ReactFlow>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────────────────────
export default function DependencyGraph(props: Props) {
    if (props.dependencies.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-sm text-[var(--vscode-descriptionForeground)]">
                Fetch dependencies to see the graph.
            </div>
        );
    }

    return (
        <div style={{
            width: '100%',
            height: 'max(600px, calc(100vh - 260px))',
            border: '1px solid var(--vscode-panel-border)',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        }}>
            <ReactFlowProvider>
                <GraphInner {...props} />
            </ReactFlowProvider>
        </div>
    );
}
