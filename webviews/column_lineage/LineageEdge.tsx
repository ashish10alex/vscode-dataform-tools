import React from 'react';
import { EdgeLabelRenderer, EdgeProps, getBezierPath } from '@xyflow/react';
import type { DependencyType } from '../../src/shared/columnLineage/types';

export interface LineageEdgeData extends Record<string, unknown> {
    dependencyType: DependencyType;
    dimmed: boolean;
    highlighted: boolean;
    /** Drawn for the first time, so it animates in */
    entering: boolean;
}

const LABELS: Record<DependencyType, string | undefined> = {
    EXACT_COPY: 'copy',
    OTHER: 'transformed',
    TABLE_ONLY: undefined,
};

export const LineageEdge: React.FC<EdgeProps> = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) => {
    const { dependencyType, dimmed, highlighted, entering } = data as LineageEdgeData;
    const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.35 });
    // Curve midpoints bunch up near a column with many readers; just before the target the edge is level and alone
    const labelX = targetX - 44;
    const labelY = targetY;
    const label = LABELS[dependencyType];
    const kind = dependencyType === 'EXACT_COPY' ? 'copy' : dependencyType === 'OTHER' ? 'xform' : 'table';
    const classes = [
        'ln-edge',
        `ln-edge-${kind}`,
        dimmed ? 'is-dim' : '',
        highlighted ? 'is-hl' : '',
        entering && kind !== 'table' ? 'ln-edge-enter' : '',
    ].join(' ');

    return (
        <>
            {/* pathLength lets the draw-in animation use a dash of length 1; dashed table-level edges keep real lengths */}
            <path id={id} d={path} className={classes} pathLength={kind === 'table' ? undefined : 1} fill="none" />
            {label && (
                <EdgeLabelRenderer>
                    <div
                        className={`ln-edge-label ln-edge-label-${kind} ${dimmed ? 'is-dim' : ''} ${highlighted ? 'is-hl' : ''}`}
                        style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
                    >
                        {label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
};
