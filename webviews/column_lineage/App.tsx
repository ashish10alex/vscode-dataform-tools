import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controls, Edge, Node, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import type { ColumnsView, TraceState } from '../../src/shared/columnLineage/types';
import type { ImpactView } from '../../src/shared/columnLineage/impactSummary';
import { ImpactSummary } from './ImpactSummary';
import { ColumnBar } from './ColumnBar';
import { copiesOnly, focusNodeId, pathToFocus } from '../../src/shared/columnLineage/traceGraph';
import { cardLinks, linkKind, linkLabel, opensByDefault, traceCards } from '../../src/shared/columnLineage/traceCards';
import { Bridge, createBridge } from './bridge';
import { layoutCards, laneLabel } from './layout';
import { CardNode, CardNodeData, LaneNode, LaneNodeData } from './LineageNode';
import { LineageEdge, LineageEdgeData } from './LineageEdge';
import { LineageList } from './LineageList';

const nodeTypes = { card: CardNode, lane: LaneNode };
const SOURCE_LABELS: Record<TraceState['sourceKind'], string> = {
    sample: 'Sample data',
    graph: 'Dependency graph · guessed columns',
    dataplex: 'Dataplex · last 30 days of runs, about 2 h behind',
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
            {line('xform', 'derived or filtered')}
            {line('table', 'table-level only')}
        </div>
    );
}

/** How long the highlight stays after the pointer leaves a card, so crossing the gap to the next one doesn't flash */
const HOVER_LINGER_MS = 120;

function Trace({ state: fullState, bridge, onlyCopies }: { state: TraceState; bridge: Bridge; onlyCopies: boolean }) {
    const [hovered, setHovered] = useState<string | undefined>();
    const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const state = useMemo(() => (onlyCopies ? copiesOnly(fullState) : fullState), [fullState, onlyCopies]);
    const { fitView } = useReactFlow();
    const now = useNow(15000);

    // Cards the user toggled; the rest keep the state they started in, fixed when they first appeared
    const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
    const defaults = useRef(new Map<string, boolean>());
    const cards = useMemo(() => traceCards(state), [state]);
    cards.filter((card) => !defaults.current.has(card.id)).forEach((card) => defaults.current.set(card.id, opensByDefault(card)));
    const isOpen = useCallback((cardId: string) => toggled.get(cardId) ?? defaults.current.get(cardId) ?? false, [toggled]);

    const links = useMemo(() => cardLinks(state, isOpen), [state, isOpen]);
    const { positions, lanes } = useMemo(() => layoutCards(cards, links, isOpen), [cards, links, isOpen]);

    const highlight = useMemo(() => {
        if (!hovered) {
            return undefined;
        }
        const ids = cards.find((card) => card.id === hovered)?.rows.map((row) => row.id) ?? [hovered];
        const nodes = new Set<string>();
        const edges = new Set<string>();
        for (const id of ids) {
            const path = pathToFocus(state, id);
            path.nodes.forEach((node) => nodes.add(node));
            path.edges.forEach((edge) => edges.add(edge));
        }
        return { nodes, edges };
    }, [state, cards, hovered]);

    const onExpand = useCallback((nodeIds: string[]) => nodeIds.forEach((nodeId) => bridge.post({ type: 'expand', nodeId })), [bridge]);
    const onOpenFile = useCallback((nodeId: string) => bridge.post({ type: 'openFile', nodeId }), [bridge]);
    const onToggle = useCallback((cardId: string) => setToggled((current) => new Map(current).set(cardId, !isOpen(cardId))), [isOpen]);
    const onHover = useCallback((id: string) => {
        clearTimeout(leaveTimer.current);
        setHovered(id);
    }, []);
    const onLeave = useCallback(() => {
        clearTimeout(leaveTimer.current);
        leaveTimer.current = setTimeout(() => setHovered(undefined), HOVER_LINGER_MS);
    }, []);
    useEffect(() => () => clearTimeout(leaveTimer.current), []);

    const hasNext = useMemo(() => {
        const byId = new Map(state.nodes.map((node) => [node.id, node]));
        const ids = new Set<string>();
        for (const edge of state.edges) {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            // Away from the focus: downstream from the source, upstream from the target
            if (source && source.hop >= 0) {
                ids.add(source.id);
            }
            if (target && target.hop <= 0) {
                ids.add(target.id);
            }
        }
        return ids;
    }, [state]);

    const nodes: Node[] = useMemo(() => {
        const laneNodes: Node<LaneNodeData>[] = lanes.map((lane) => ({
            id: `lane:${lane.hop}`,
            type: 'lane',
            position: { x: lane.x, y: lane.top },
            data: { label: laneLabel(lane.hop), width: lane.cardWidth + 52, height: lane.height, focus: lane.hop === 0 },
            selectable: false,
            draggable: false,
            focusable: false,
            zIndex: -1,
            style: { pointerEvents: 'none' },
        }));
        const laneWidths = new Map(lanes.map((lane) => [lane.hop, lane.cardWidth]));
        const cardNodes: Node<CardNodeData>[] = cards.map((card) => ({
            id: card.id,
            type: 'card',
            position: positions.get(card.id) ?? { x: 0, y: 0 },
            data: {
                card,
                width: laneWidths.get(card.hop) ?? 288,
                open: isOpen(card.id),
                change: card.hop === 0 ? state.focus.change : undefined,
                highlight: highlight?.nodes,
                hasNext,
                onToggle,
                onExpand,
                onOpenFile,
                onHover,
            },
            draggable: false,
            selectable: false,
        }));
        return [...laneNodes, ...cardNodes];
    }, [lanes, cards, positions, isOpen, state.focus.change, highlight, hasNext, onToggle, onExpand, onOpenFile, onHover]);

    const edges: Edge<LineageEdgeData>[] = useMemo(() => links.map((link) => {
        const onPath = !!highlight && link.edgeIds.some((id) => highlight.edges.has(id));
        return {
            id: link.id,
            source: link.source,
            target: link.target,
            sourceHandle: link.sourceRow ? `out:${link.sourceRow}` : 'out',
            targetHandle: link.targetRow ? `in:${link.targetRow}` : 'in',
            type: 'lineage',
            data: {
                dependencyType: linkKind(link),
                label: linkLabel(link),
                count: link.edgeIds.length,
                toCard: !link.targetRow,
                dimmed: !!highlight && !onPath,
                highlighted: onPath,
            },
        };
    }), [links, highlight]);

    // Refit when a lane appears or disappears, not on every hop inside an existing lane
    useEffect(() => {
        const timer = setTimeout(() => fitView({ padding: 0.18, duration: 350, maxZoom: 1.1 }), 30);
        return () => clearTimeout(timer);
    }, [lanes.length, fitView]);

    const focus = fullState.nodes.find((node) => node.id === focusNodeId(fullState));
    const noReaders = !!focus?.expanded && !fullState.edges.some((edge) => edge.source === focus.id);
    const hiddenByFilter = fullState.nodes.length - state.nodes.length;

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
                // Hover handlers also make React Flow give non-selectable nodes pointer events, so their buttons work.
                // Cards and their rows report what's hovered; leaving a card only clears it after a moment.
                onNodeMouseEnter={() => clearTimeout(leaveTimer.current)}
                onNodeMouseLeave={onLeave}
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
            {onlyCopies && hiddenByFilter > 0 && (
                <div className="ln-filter-note" role="status">
                    Hiding {hiddenByFilter} column{hiddenByFilter === 1 ? '' : 's'} linked only as derived or filtered
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

function Switch({ checked, onChange, label, title }: { checked: boolean; onChange: () => void; label: string; title?: string }) {
    return (
        <button type="button" role="switch" aria-checked={checked} className="ln-switch" title={title} onClick={onChange}>
            <span className="ln-switch-track" aria-hidden="true"><span className="ln-switch-thumb" /></span>
            {label}
        </button>
    );
}

type View = 'list' | 'graph';

function ViewSwitch({ view, setView }: { view: View; setView: (view: View) => void }) {
    return (
        <div className="ln-segment" role="radiogroup" aria-label="Show as">
            {(['list', 'graph'] as View[]).map((option) => (
                <button key={option} type="button" role="radio" aria-checked={view === option} className={view === option ? 'is-on' : ''} onClick={() => setView(option)}>
                    {option === 'list' ? 'List' : 'Graph'}
                </button>
            ))}
        </div>
    );
}

/** `showTable`: off under the column picker, which already names the table. `onBack`: back to the column impact summary. */
function Toolbar({ state, bridge, onlyCopies, setOnlyCopies, view, setView, showTable, onBack }: {
    state: TraceState; bridge: Bridge; onlyCopies: boolean; setOnlyCopies: (on: boolean) => void; view: View; setView: (view: View) => void; showTable: boolean; onBack?: () => void;
}) {
    const { focus, upstreamShown } = state;
    const parts = focus.table.split('.');
    return (
        <header className="ln-toolbar">
            <div className="ln-title">
                {onBack && <button type="button" className="ln-link ln-back" onClick={onBack}>← Column impact</button>}
                <span className="ln-eyebrow">Column trace</span>
                <div className="ln-title-row">
                    <h1 className="ln-title-col">{focus.column}</h1>
                    {focus.change && (
                        <span className="ln-chip ln-chip-warn">
                            {focus.change.kind === 'dropped' ? 'dropped on this branch' : `${focus.change.from} → ${focus.change.to} on this branch`}
                        </span>
                    )}
                </div>
                {showTable && (
                    <span className="ln-title-table">
                        <span className="ln-dataset">{parts.slice(0, -1).join('.')}.</span>{parts[parts.length - 1]}
                    </span>
                )}
            </div>
            <div className="ln-actions">
                <ViewSwitch view={view} setView={setView} />
                <Switch checked={upstreamShown} onChange={() => bridge.post({ type: 'setUpstream', on: !upstreamShown })} label="Show upstream" />
                <Switch
                    checked={onlyCopies}
                    onChange={() => setOnlyCopies(!onlyCopies)}
                    label="Copies only"
                    title="Hide derived or filtered links. Dataplex reports columns used in filters and joins the same way as real transformations."
                />
                <button type="button" className="ln-button" onClick={() => bridge.post({ type: 'refresh' })}>Refresh</button>
            </div>
        </header>
    );
}

function emptyMainText(columns: ColumnsView | null): string {
    if (!columns) {
        return 'Loading column trace…';
    }
    if (columns.status === 'loading') {
        return 'Reading columns and comparing with prod…';
    }
    if (columns.status === 'error') {
        return 'The columns could not be read.';
    }
    return columns.entries.some((entry) => !entry.isNew) ? 'Pick a column to trace its lineage.' : 'Nothing to trace.';
}

export default function App() {
    const [bridge, setBridge] = useState<Bridge>();
    const [state, setState] = useState<TraceState | null>(null);
    const [columns, setColumns] = useState<ColumnsView | null>(null);
    const [impact, setImpact] = useState<ImpactView | null>(null);
    const [onlyCopies, setOnlyCopies] = useState(false);
    const [view, setView] = useState<View>('list');
    const now = useNow(15000);
    const listState = useMemo(() => (state && onlyCopies ? copiesOnly(state) : state), [state, onlyCopies]);

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
                } else if (message.type === 'columns') {
                    setColumns(message.columns);
                } else if (message.type === 'impact') {
                    setImpact(message.impact);
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

    if (!bridge) {
        return <div className="ln-loading" role="status">Loading column trace…</div>;
    }

    const main = state ? (
        <>
            <Toolbar
                state={state}
                bridge={bridge}
                onlyCopies={onlyCopies}
                setOnlyCopies={setOnlyCopies}
                view={view}
                setView={setView}
                showTable={!columns}
                onBack={impact ? () => bridge.post({ type: 'closeImpactTrace' }) : undefined}
            />
            {state.sourceKind === 'sample' && (
                <div className="ln-banner" role="note">
                    <strong>Sample data.</strong> This is a made-up project for previewing the panel. Run the trace from a
                    .sqlx file in VS Code to see your own lineage.
                </div>
            )}
            {state.sourceKind === 'graph' && (
                <div className="ln-banner" role="note">
                    <strong>Guessed column links.</strong> Readers and sources come from this project's dependency graph, but the column links are
                    matched by name against each table's schema. Use “Show Column Lineage and Impact” for real lineage from Dataplex.
                </div>
            )}
            {view === 'list' && listState
                ? <LineageList state={listState} bridge={bridge} hidden={state.nodes.length - listState.nodes.length} onShowAll={() => setOnlyCopies(false)} />
                : (
                    <ReactFlowProvider>
                        {/* Keyed by the focus column, so each column's cards start in their default state */}
                        <Trace key={`${state.focus.table}#${state.focus.column}`} state={state} bridge={bridge} onlyCopies={onlyCopies} />
                    </ReactFlowProvider>
                )}
        </>
    ) : (
        <div className="ln-main-empty" role="status">{emptyMainText(columns)}</div>
    );

    if (impact && !state) {
        return <div className="ln-app"><ImpactSummary impact={impact} bridge={bridge} now={now} /></div>;
    }

    return (
        <div className="ln-app">
            {columns ? (
                <div className="ln-stack">
                    <ColumnBar columns={columns} bridge={bridge} now={now} />
                    <div className="ln-main">{main}</div>
                </div>
            ) : main}
        </div>
    );
}
