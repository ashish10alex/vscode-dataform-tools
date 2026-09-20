import React, { createContext, useContext, useMemo } from "react";
import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import dagre from "dagre";
import { ChevronDown, ChevronRight, KeyRound, Loader2, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { BigQueryTableLink } from "../../components/BigQueryTableLink";

export type SchemaState = "idle" | "loading" | "loaded" | "error";

export interface GraphElementView {
  kind: "entity" | "relationship";
  name: string;
  backingTable: string;
  keys: string[];
  importAll: boolean;
  mappedFields: { name: string; expression: string }[];
  /** Property names the user can pick from, growing once a backing schema has been read. */
  availableProperties: string[];
  schemaState: SchemaState;
  schemaError?: string;
}

export interface PropertyGraphDiagramProps {
  entities: GraphElementView[];
  edges: { relationship: GraphElementView; source: string; destination: string }[];
  expanded: Record<string, boolean>;
  selection: Record<string, string[]>;
  onToggleExpand: (elementName: string) => void;
  onToggleProperty: (elementName: string, property: string) => void;
  /** Reveal a relationship's detail card, since an edge has nowhere to expand into. */
  onSelectRelationship: (relationshipName: string) => void;
}

const NODE_WIDTH = 280;
const COLLAPSED_HEIGHT = 96;


export const PropertyList: React.FC<{
  element: GraphElementView;
  selected: string[];
  onToggleProperty: (elementName: string, property: string) => void;
}> = ({ element, selected, onToggleProperty }) => {
  const expressionByName = new Map(element.mappedFields.map((field) => [field.name, field.expression]));

  if (element.schemaState === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--vscode-descriptionForeground)] py-2">
        <Loader2 className="w-3 h-3 animate-spin" /> Reading {element.backingTable}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {element.schemaState === "error" && (
        <div className="flex items-start gap-1.5 text-[11px] text-[var(--vscode-errorForeground)] pb-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>{element.schemaError}</span>
        </div>
      )}
      {element.availableProperties.length === 0 && element.schemaState !== "error" && (
        <div className="text-[11px] text-[var(--vscode-descriptionForeground)]">
          No properties exposed by this element.
        </div>
      )}
      {element.availableProperties.map((property) => {
        const isKey = element.keys.includes(property);
        const expression = expressionByName.get(property);
        return (
          <label
            key={property}
            className="flex items-center gap-2 text-[11px] font-mono cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded px-1 py-0.5"
          >
            <input
              type="checkbox"
              className="accent-[var(--vscode-button-background)] w-3 h-3 flex-shrink-0"
              checked={selected.includes(property)}
              onChange={() => onToggleProperty(element.name, property)}
            />
            {isKey && <KeyRound className="w-3 h-3 flex-shrink-0 text-[var(--vscode-charts-yellow)]" />}
            <span className="truncate text-[var(--vscode-foreground)]">{property}</span>
            {expression && expression !== property && (
              <span className="truncate opacity-50">&larr; {expression}</span>
            )}
          </label>
        );
      })}
    </div>
  );
};

/**
 * Live diagram data is delivered through context rather than through `node.data`.
 *
 * React Flow rebuilds its internal node bookkeeping — measurements, handle bounds — whenever the
 * `nodes` prop hands it new objects, and an endpoint without handle bounds means the edge is
 * silently not drawn. Keeping the node array referentially stable and reading everything that
 * changes (expansion, selection, callbacks) from context keeps that bookkeeping intact.
 */
interface DiagramContextValue {
  elementByName: Record<string, GraphElementView>;
  relationshipByName: Record<string, GraphElementView>;
  expanded: Record<string, boolean>;
  selection: Record<string, string[]>;
  onToggleExpand: (elementName: string) => void;
  onToggleProperty: (elementName: string, property: string) => void;
  onSelectRelationship: (relationshipName: string) => void;
}

const DiagramContext = createContext<DiagramContextValue | null>(null);

const useDiagramContext = () => {
  const value = useContext(DiagramContext);
  if (!value) {
    throw new Error("Property graph diagram nodes must render inside DiagramContext");
  }
  return value;
};

type ElementNodeData = { name: string };

const ElementNode: React.FC<NodeProps> = ({ data }) => {
  const { name } = data as unknown as ElementNodeData;
  const { elementByName, expanded, selection, onToggleExpand, onToggleProperty } = useDiagramContext();
  const element = elementByName[name];
  if (!element) {
    return null;
  }
  const isExpanded = expanded[name] === true;
  const selected = selection[name] ?? [];

  return (
    <div
      className="rounded-lg border border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)] shadow-sm"
      style={{ width: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Left} className="!bg-[var(--vscode-charts-blue)]" />
      <button
        type="button"
        onClick={() => onToggleExpand(element.name)}
        className="nodrag w-full text-left px-3 py-2 flex items-start gap-1.5 hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded-t-lg"
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 opacity-60" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 opacity-60" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--vscode-foreground)] truncate">{element.name}</div>
          <div className="text-[10px] uppercase tracking-wider opacity-50">
            {element.importAll ? "all columns" : `${element.mappedFields.length} properties`}
            {" · "}
            {selected.length} in query
          </div>
        </div>
      </button>
      <div className="nodrag px-3 pb-2 text-[10px]">
        <BigQueryTableLink id={element.backingTable} className="font-mono text-[var(--vscode-textLink-foreground)] hover:underline break-all" />
      </div>
      {isExpanded && (
        <div className="px-3 pb-3 max-h-64 overflow-auto border-t border-[var(--vscode-widget-border)]/60 pt-2 nodrag nowheel">
          <PropertyList element={element} selected={selected} onToggleProperty={onToggleProperty} />
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-[var(--vscode-charts-blue)]" />
    </div>
  );
};

const EDGE_LABEL_WIDTH = 220;
const EDGE_LABEL_HEIGHT = 64;
const SELF_LOOP_HEIGHT = 110;

type RelationshipEdgeData = { name: string };

/**
 * The relationship's backing table is named on the edge itself. Without it a reader counts
 * three tables in their yaml, two boxes in the diagram, and has no way to see that the third
 * table became the arrow — which is the one idea the whole property graph model rests on.
 */
const RelationshipEdge: React.FC<EdgeProps> = ({
  id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data,
}) => {
  const { name } = data as unknown as RelationshipEdgeData;
  const { relationshipByName, selection, onSelectRelationship } = useDiagramContext();
  const relationship = relationshipByName[name];

  // A relationship may start and end at the same entity. The built in path helpers collapse to
  // nothing in that case, which would drop the relationship from the diagram entirely, so a
  // loop is drawn over the node instead.
  const isSelfLoop = source === target;
  const loopApexY = sourceY - SELF_LOOP_HEIGHT;
  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 8,
  });
  const edgePath = isSelfLoop
    ? `M ${sourceX},${sourceY} C ${sourceX + 70},${loopApexY} ${targetX - 70},${loopApexY} ${targetX},${targetY}`
    : smoothPath;
  const labelX = isSelfLoop ? (sourceX + targetX) / 2 : smoothLabelX;
  const labelY = isSelfLoop ? loopApexY + SELF_LOOP_HEIGHT / 3 : smoothLabelY;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={{ stroke: "var(--vscode-charts-blue)", strokeWidth: 1.5 }} />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => onSelectRelationship(name)}
          title={`Show the ${name} relationship`}
          className="nodrag nopan absolute rounded-md border border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)] px-2 py-1 text-center hover:bg-[var(--vscode-toolbar-hoverBackground)]"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            maxWidth: EDGE_LABEL_WIDTH,
            pointerEvents: "all",
          }}
        >
          <div className="text-xs font-semibold text-[var(--vscode-foreground)] truncate">{name}</div>
          <div className="text-[10px] font-mono text-[var(--vscode-descriptionForeground)] truncate">
            {relationship ? (relationship.backingTable.split(".").pop() ?? relationship.backingTable) : ""}
          </div>
          <div className="text-[10px] uppercase tracking-wider opacity-50 truncate">
            {relationship && (relationship.importAll ? "all columns" : `${relationship.mappedFields.length} properties`)}
            {" · "}
            {(selection[name] ?? []).length} in query
          </div>
        </button>
      </EdgeLabelRenderer>
    </>
  );
};

const nodeTypes = { graphElement: ElementNode };
const edgeTypes = { relationship: RelationshipEdge };

export const PropertyGraphDiagram: React.FC<PropertyGraphDiagramProps> = ({
  entities,
  edges,
  expanded,
  selection,
  onToggleExpand,
  onToggleProperty,
  onSelectRelationship,
}) => {
  // The set of boxes and arrows, as opposed to what they currently display. Only a change here
  // may rebuild the node and edge objects; everything else reaches them through context.
  const structureKey = useMemo(
    () => [
      entities.map((entity) => entity.name).join("|"),
      edges.map((edge) => `${edge.source}>${edge.relationship.name}>${edge.destination}`).join("|"),
    ].join("::"),
    [entities, edges],
  );

  const layoutById = useMemo(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: "LR", nodesep: 120, ranksep: 220, marginx: 16, marginy: 16 });

    entities.forEach((entity) => {
      graph.setNode(entity.name, { width: NODE_WIDTH, height: COLLAPSED_HEIGHT });
    });
    edges.forEach((edge) => {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.destination)) {
        graph.setEdge(edge.source, edge.destination, { width: EDGE_LABEL_WIDTH, height: EDGE_LABEL_HEIGHT });
      }
    });
    dagre.layout(graph);

    const positions: Record<string, { x: number; y: number }> = {};
    entities.forEach((entity) => {
      const laid = graph.node(entity.name);
      positions[entity.name] = {
        x: (laid?.x ?? 0) - NODE_WIDTH / 2,
        y: (laid?.y ?? 0) - COLLAPSED_HEIGHT / 2,
      };
    });
    return positions;
    // Positions depend only on which boxes and arrows exist, never on what they display, so
    // that reading a backing schema cannot shuffle the diagram under the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  const builtNodes = useMemo<Node[]>(() => entities.map((entity) => ({
    id: entity.name,
    type: "graphElement",
    position: layoutById[entity.name] ?? { x: 0, y: 0 },
    data: { name: entity.name },
  })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structureKey, layoutById]);

  const builtEdges = useMemo<Edge[]>(() => edges.map((edge) => ({
    id: `${edge.source}--${edge.relationship.name}--${edge.destination}`,
    source: edge.source,
    target: edge.destination,
    type: "relationship",
    animated: false,
    markerEnd: { type: "arrowclosed" as const, color: "var(--vscode-charts-blue)" },
    data: { name: edge.relationship.name },
  })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structureKey]);


  const contextValue = useMemo<DiagramContextValue>(() => ({
    elementByName: Object.fromEntries(entities.map((entity) => [entity.name, entity])),
    relationshipByName: Object.fromEntries(edges.map((edge) => [edge.relationship.name, edge.relationship])),
    expanded,
    selection,
    onToggleExpand,
    onToggleProperty,
    onSelectRelationship,
  }), [entities, edges, expanded, selection, onToggleExpand, onToggleProperty, onSelectRelationship]);

  if (entities.length === 0) {
    return (
      <div className="text-xs text-[var(--vscode-descriptionForeground)] px-3 py-6 text-center">
        This graph declares no entities.
      </div>
    );
  }

  return (
    <DiagramContext.Provider value={contextValue}>
      <div className={clsx("h-[380px] w-full rounded-lg border border-[var(--vscode-widget-border)]/60 overflow-hidden")}>
        <ReactFlow
          nodes={builtNodes}
          edges={builtEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
        >
          <Background color="var(--vscode-widget-border)" gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </DiagramContext.Provider>
  );
};
