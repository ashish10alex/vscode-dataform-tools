export interface GraphNodeWithActionType {
  id: string;
  data: {
    type?: unknown;
  };
}

export interface GraphEdgeWithEndpoints {
  source: string;
  target: string;
}

export function filterGraphByAssertionVisibility<
  TNode extends GraphNodeWithActionType,
  TEdge extends GraphEdgeWithEndpoints,
>(nodes: TNode[], edges: TEdge[], showAssertions: boolean): { nodes: TNode[]; edges: TEdge[] } {
  if (showAssertions) {
    return { nodes, edges };
  }

  const visibleNodes = nodes.filter((node) => node.data.type !== 'assertion');
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  );

  return { nodes: visibleNodes, edges: visibleEdges };
}
