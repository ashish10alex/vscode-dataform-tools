import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { ColumnChange, TraceNode } from '../../src/shared/columnLineage/types';
import { canExpand, expandDirection } from '../../src/shared/columnLineage/traceGraph';

export interface LineageNodeData extends Record<string, unknown> {
    node: TraceNode;
    change?: ColumnChange;
    /** Expanded, but nothing was found further out */
    endOfLine: boolean;
    dimmed: boolean;
    highlighted: boolean;
    onExpand: (id: string) => void;
    onOpenFile: (id: string) => void;
}

export interface LaneNodeData extends Record<string, unknown> {
    label: string;
    width: number;
    height: number;
    focus: boolean;
}

function splitTable(table: string): { dataset: string; name: string } {
    const parts = table.split('.');
    return { dataset: parts.length > 2 ? parts[parts.length - 2] : '', name: parts[parts.length - 1] };
}

function ChangeChip({ change }: { change: ColumnChange }) {
    return change.kind === 'dropped'
        ? <span className="ln-chip ln-chip-warn">dropped</span>
        : <span className="ln-chip ln-chip-warn">{change.from} → {change.to}</span>;
}

export const LineageNode: React.FC<{ id: string; data: LineageNodeData }> = ({ id, data }) => {
    const { node, change, endOfLine, dimmed, highlighted, onExpand, onOpenFile } = data;
    const { dataset, name } = splitTable(node.table);
    const direction = expandDirection(node);
    const expandable = node.kind === 'column' && canExpand(node);
    const fileName = node.filePath?.split('/').pop();

    return (
        <div
            className={[
                'ln-node',
                `ln-${node.kind}`,
                dimmed ? 'is-dim' : '',
                highlighted ? 'is-hl' : '',
            ].join(' ')}
        >
            <Handle type="target" position={Position.Left} isConnectable={false} className="ln-handle" />

            <div className="ln-table" title={node.table}>
                {dataset && <span className="ln-dataset">{dataset}.</span>}{name}
            </div>
            {node.kind === 'tableOnly'
                ? <div className="ln-col ln-col-unknown" title="Dataplex has a table-level link to this table but no column lineage for it, so it may read this column">May read it · no column detail</div>
                : <div className="ln-col" title={node.column}>{node.column}</div>}

            <div className="ln-foot">
                {fileName
                    ? <button type="button" className="ln-file nodrag nopan" title={`Open ${node.filePath}`} onClick={() => onOpenFile(id)}>{fileName}</button>
                    : <span className="ln-outside">outside project</span>}
                <span className="ln-grow" />
                {change && <ChangeChip change={change} />}
                {node.loading && <span className="ln-spinner" role="status" aria-label="Looking up lineage" />}
                {expandable && (
                    <button
                        type="button"
                        className="ln-hop nodrag nopan"
                        onClick={() => onExpand(id)}
                        aria-label={`Show ${direction === 'upstream' ? 'sources' : 'readers'} of ${node.column}`}
                    >
                        {direction === 'upstream' ? '← hop' : 'hop →'}
                    </button>
                )}
                {endOfLine && node.kind !== 'focus' && (
                    <span className="ln-end">{direction === 'upstream' ? 'no sources' : 'no readers'}</span>
                )}
            </div>
            {node.error && <div className="ln-error" role="alert">{node.error}</div>}

            <Handle type="source" position={Position.Right} isConnectable={false} className="ln-handle" />
        </div>
    );
};

export const LaneNode: React.FC<{ data: LaneNodeData }> = ({ data }) => (
    <div className={`ln-lane ${data.focus ? 'ln-lane-focus' : ''}`} style={{ width: data.width, height: data.height }}>
        <div className="ln-lane-label">{data.label}</div>
    </div>
);
