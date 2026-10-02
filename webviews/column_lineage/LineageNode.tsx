import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { ColumnChange, DependencyType, TraceNode } from '../../src/shared/columnLineage/types';
import { canExpand, expandDirection } from '../../src/shared/columnLineage/traceGraph';
import { cardSummary, TraceCard } from '../../src/shared/columnLineage/traceCards';

export interface CardNodeData extends Record<string, unknown> {
    card: TraceCard;
    /** The lane's card width, set by its longest table name */
    width: number;
    open: boolean;
    /** The focus column's change against prod, shown on the focus card */
    change?: ColumnChange;
    /** Node ids on the hovered path; undefined when nothing is hovered */
    highlight?: Set<string>;
    /** Rows with links further from the focus, so an expanded row without them shows it found nothing */
    hasNext: Set<string>;
    onToggle: (cardId: string) => void;
    onExpand: (nodeIds: string[]) => void;
    onOpenFile: (nodeId: string) => void;
    /** A card id when the header is hovered, a node id for a row */
    onHover: (id: string) => void;
}

export interface LaneNodeData extends Record<string, unknown> {
    label: string;
    width: number;
    height: number;
    focus: boolean;
}

const RELATION: Record<DependencyType, { label: string; className: string }> = {
    EXACT_COPY: { label: 'copy', className: 'ln-rel-copy' },
    OTHER: { label: 'derived', className: 'ln-rel-xform' },
    TABLE_ONLY: { label: 'may read', className: 'ln-rel-table' },
};

function splitTable(table: string): { dataset: string; name: string } {
    const parts = table.split('.');
    return { dataset: parts.length > 2 ? parts[parts.length - 2] : '', name: parts[parts.length - 1] };
}

function ChangeChip({ change }: { change: ColumnChange }) {
    return change.kind === 'dropped'
        ? <span className="ln-chip ln-chip-warn">dropped</span>
        : <span className="ln-chip ln-chip-warn">{change.from} → {change.to}</span>;
}

function hopLabel(node: TraceNode, count?: number): string {
    // A table-level reader expands to the tables that read it, not to columns
    const arrow = node.kind === 'tableOnly' ? 'readers →' : expandDirection(node) === 'upstream' ? '← hop' : 'hop →';
    return count === undefined ? arrow : `${arrow} (${count})`;
}

/** Rows a hop button can load more for. The focus loads through the toolbar and lists. */
function expandable(row: TraceNode): boolean {
    return row.kind !== 'focus' && canExpand(row);
}

function expandLabel(row: TraceNode): string {
    if (row.kind === 'tableOnly') {
        return `Show the tables that read ${row.table}`;
    }
    return `Show ${expandDirection(row) === 'upstream' ? 'sources' : 'readers'} of ${row.column}`;
}

function Row({ row, data }: { row: TraceNode; data: CardNodeData }) {
    const { card, change, highlight, hasNext, onExpand, onHover } = data;
    const relation = card.relation.get(row.id);
    const direction = expandDirection(row);
    const endOfLine = row.expanded && !hasNext.has(row.id) && row.kind !== 'focus';
    return (
        <div
            className={['ln-card-row', highlight && !highlight.has(row.id) ? 'is-dim' : ''].join(' ')}
            onMouseEnter={() => onHover(row.id)}
            title={row.error}
        >
            <Handle type="target" position={Position.Left} id={`in:${row.id}`} isConnectable={false} className="ln-handle" />
            <span className="ln-row-col" title={row.column ? `${row.table}.${row.column}` : row.table}>
                {row.column ?? <span className="ln-cell-none">no column detail</span>}
                {card.assertions && <span className="ln-row-table">{splitTable(row.table).name}</span>}
            </span>
            {row.kind === 'focus' && change && <ChangeChip change={change} />}
            {relation && <span className={`ln-rel ${RELATION[relation].className}`}>{RELATION[relation].label}</span>}
            {row.error && <span className="ln-row-error" role="alert" aria-label={row.error}>!</span>}
            {row.loading && <span className="ln-spinner" role="status" aria-label="Looking up lineage" />}
            {expandable(row) && (
                <button
                    type="button"
                    className="ln-hop nodrag nopan"
                    onClick={() => onExpand([row.id])}
                    aria-label={expandLabel(row)}
                >
                    {hopLabel(row)}
                </button>
            )}
            {endOfLine && <span className="ln-end">{direction === 'upstream' ? 'no sources' : 'no readers'}</span>}
            <Handle type="source" position={Position.Right} id={`out:${row.id}`} isConnectable={false} className="ln-handle" />
        </div>
    );
}

/** One table on one hop, its columns as rows. Collapsed it's the header only, and edges meet the header. */
export const CardNode: React.FC<{ data: CardNodeData }> = ({ data }) => {
    const { card, width, open, highlight, onToggle, onExpand, onOpenFile, onHover } = data;
    const focus = card.hop === 0;
    const { dataset, name } = card.table ? splitTable(card.table) : { dataset: '', name: 'Assertions' };
    const fileName = card.filePath?.split('/').pop();
    const toExpand = card.rows.filter(expandable);
    const loading = card.rows.some((row) => row.loading);
    const onPath = !!highlight && card.rows.some((row) => highlight.has(row.id));

    return (
        <div
            className={[
                'ln-card',
                focus ? 'ln-card-focus' : '',
                card.assertions ? 'ln-card-assertions' : '',
                highlight && !onPath ? 'is-dim' : '',
                onPath ? 'is-hl' : '',
            ].join(' ')}
            style={{ width }}
        >
            <div className="ln-card-head" onMouseEnter={() => onHover(card.id)}>
                <Handle type="target" position={Position.Left} id="in" isConnectable={false} className="ln-handle" />
                {focus ? (
                    <div className="ln-card-title">
                        <span className="ln-table" title={card.table}>{dataset && <span className="ln-dataset">{dataset}.</span>}{name}</span>
                    </div>
                ) : (
                    // The whole title toggles, so the target isn't just the chevron when the graph is zoomed out
                    <button
                        type="button"
                        className="ln-card-title ln-card-toggle nodrag nopan"
                        aria-expanded={open}
                        title={`${open ? 'Collapse' : 'Expand'} · ${card.table ?? 'assertions that read this column'}`}
                        onClick={() => onToggle(card.id)}
                    >
                        <span className="ln-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
                        <span className="ln-table">{card.project && <span className="ln-dataset">{card.project}.</span>}{dataset && <span className="ln-dataset">{dataset}.</span>}{name}</span>
                    </button>
                )}
                <div className="ln-card-meta">
                    {card.assertions ? null : fileName
                        ? <button type="button" className="ln-file nodrag nopan" title={`Open ${card.filePath}`} onClick={() => onOpenFile(card.rows[0].id)}>{fileName}</button>
                        : <span className="ln-outside">outside project</span>}
                    {!focus && <span className="ln-card-summary">{cardSummary(card)}</span>}
                    <span className="ln-grow" />
                    {!open && loading && <span className="ln-spinner" role="status" aria-label="Looking up lineage" />}
                    {!open && toExpand.length > 0 && (
                        <button
                            type="button"
                            className="ln-hop nodrag nopan"
                            onClick={() => onExpand(toExpand.map((row) => row.id))}
                            aria-label={`Show the next hop for ${toExpand.length} column${toExpand.length === 1 ? '' : 's'} of ${name}`}
                        >
                            {hopLabel(toExpand[0], toExpand.length)}
                        </button>
                    )}
                </div>
                <Handle type="source" position={Position.Right} id="out" isConnectable={false} className="ln-handle" />
            </div>
            {open && (
                <div className="ln-card-rows">
                    {card.rows.map((row) => <Row key={row.id} row={row} data={data} />)}
                </div>
            )}
        </div>
    );
};

export const LaneNode: React.FC<{ data: LaneNodeData }> = ({ data }) => (
    <div className={`ln-lane ${data.focus ? 'ln-lane-focus' : ''}`} style={{ width: data.width, height: data.height }}>
        <div className="ln-lane-label">{data.label}</div>
    </div>
);
