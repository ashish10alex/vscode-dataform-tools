import React, { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
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
}

const NODE_WIDTH = 280;
const COLLAPSED_HEIGHT = 96;

function nodeHeight(element: GraphElementView, isExpanded: boolean): number {
  if (!isExpanded) {
    return COLLAPSED_HEIGHT;
  }
  const rows = Math.max(element.availableProperties.length, 1);
  return Math.min(COLLAPSED_HEIGHT + 44 + rows * 24, 380);
}

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

type ElementNodeData = {
  element: GraphElementView;
  isExpanded: boolean;
  selected: string[];
  onToggleExpand: (elementName: string) => void;
  onToggleProperty: (elementName: string, property: string) => void;
};

const ElementNode: React.FC<NodeProps> = ({ data }) => {
  const { element, isExpanded, selected, onToggleExpand, onToggleProperty } = data as unknown as ElementNodeData;

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

const nodeTypes = { graphElement: ElementNode };

export const PropertyGraphDiagram: React.FC<PropertyGraphDiagramProps> = ({
  entities,
  edges,
  expanded,
  selection,
  onToggleExpand,
  onToggleProperty,
}) => {
  const { flowNodes, flowEdges } = useMemo(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 140, marginx: 16, marginy: 16 });

    entities.forEach((entity) => {
      graph.setNode(entity.name, {
        width: NODE_WIDTH,
        height: nodeHeight(entity, expanded[entity.name] === true),
      });
    });
    edges.forEach((edge) => {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.destination)) {
        graph.setEdge(edge.source, edge.destination);
      }
    });

    dagre.layout(graph);

    const flowNodes: Node[] = entities.map((entity) => {
      const position = graph.node(entity.name);
      const height = nodeHeight(entity, expanded[entity.name] === true);
      return {
        id: entity.name,
        type: "graphElement",
        position: {
          x: (position?.x ?? 0) - NODE_WIDTH / 2,
          y: (position?.y ?? 0) - height / 2,
        },
        data: {
          element: entity,
          isExpanded: expanded[entity.name] === true,
          selected: selection[entity.name] ?? [],
          onToggleExpand,
          onToggleProperty,
        },
      };
    });

    const flowEdges: Edge[] = edges.map((edge) => ({
      id: `${edge.source}--${edge.relationship.name}--${edge.destination}`,
      source: edge.source,
      target: edge.destination,
      label: edge.relationship.name,
      animated: false,
      style: { stroke: "var(--vscode-charts-blue)", strokeWidth: 1.5 },
      labelStyle: { fill: "var(--vscode-foreground)", fontSize: 11 },
      labelBgStyle: { fill: "var(--vscode-sideBar-background)" },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: { type: "arrowclosed" as const, color: "var(--vscode-charts-blue)" },
    }));

    return { flowNodes, flowEdges };
  }, [entities, edges, expanded, selection, onToggleExpand, onToggleProperty]);

  if (entities.length === 0) {
    return (
      <div className="text-xs text-[var(--vscode-descriptionForeground)] px-3 py-6 text-center">
        This graph declares no entities.
      </div>
    );
  }

  return (
    <div className={clsx("h-[380px] w-full rounded-lg border border-[var(--vscode-widget-border)]/60 overflow-hidden")}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
      >
        <Background color="var(--vscode-widget-border)" gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};
