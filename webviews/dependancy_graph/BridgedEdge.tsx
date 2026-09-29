import React from 'react';
import { BaseEdge, EdgeProps, getBezierPath } from '@xyflow/react';

// An edge standing in for a path through hidden assertions: dashed, with the
// assertions it runs through in a hover tooltip.
const BridgedEdge: React.FC<EdgeProps> = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}) => {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const via = (data?.via as string[] | undefined) ?? [];

  return (
    <g>
      <title>{`via ${via.join(', ')}`}</title>
      <BaseEdge path={path} markerEnd={markerEnd} style={{ ...style, strokeDasharray: '6 4' }} />
    </g>
  );
};

export default BridgedEdge;
