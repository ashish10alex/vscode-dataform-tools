import React from 'react';
import { EdgeLabelRenderer, EdgeProps, getBezierPath } from '@xyflow/react';
import type { DependencyType } from '../../src/shared/columnLineage/types';

export interface LineageEdgeData extends Record<string, unknown> {
    dependencyType: DependencyType;
    /** e.g. "copy", or "12 derived · 2 copies" for a bundle */
    label?: string;
    /** Trace edges it stands for; a bundle is drawn thicker */
    count: number;
    /** Ends on a collapsed card, where several bundles can meet, so the label goes mid-edge */
    toCard: boolean;
    dimmed: boolean;
    highlighted: boolean;
}

export const LineageEdge: React.FC<EdgeProps> = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) => {
    const { dependencyType, label, count, toCard, dimmed, highlighted } = data as LineageEdgeData;
    const [path, midX, midY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.35 });
    // Into a row, just before the target the edge is level and alone; into a card, bundles from several sources meet
    const [labelX, labelY] = toCard ? [midX, midY] : [targetX - 56, targetY];
    const kind = dependencyType === 'EXACT_COPY' ? 'copy' : dependencyType === 'OTHER' ? 'xform' : 'table';
    const classes = ['ln-edge', `ln-edge-${kind}`, dimmed ? 'is-dim' : '', highlighted ? 'is-hl' : ''].join(' ');
    const width = 1.5 + Math.min(3, Math.log2(count));

    return (
        <>
            <path id={id} d={path} className={classes} style={{ strokeWidth: highlighted ? width + 0.6 : width }} fill="none" />
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
