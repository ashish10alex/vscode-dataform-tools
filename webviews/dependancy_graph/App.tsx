import React, {useCallback, useRef, useEffect, useState, useMemo} from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  ReactFlowProvider,
  ReactFlowInstance,
  Node,
  Edge,
  MarkerType,
  getNodesBounds,
  getViewportForBounds,
  Panel
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import '@xyflow/react/dist/style.css';
import { DataTable } from '../components/ui/data-table';
import { ColumnDef } from '@tanstack/react-table';
import TableNode from './TableNode';
import { nodePositioning } from './nodePositioning';
import { getTransport } from './transport';
import StyledSelect, { OptionType } from './components/StyledSelect';
import DownloadButton from './DownloadButton';
import SchemaModal, { SchemaModalState } from './SchemaModal';
import { ChevronRight, ChevronLeft } from 'lucide-react';

const nodeTypes = {
  tableNode: TableNode,
};

const transport = getTransport();
// PNG export round-trips through the VS Code host's "Save As" dialog; outside
// the extension (CLI / standalone browser) there's nothing on the other end.
const SHOW_EXPORT_BUTTON = transport.mode === 'vscode';

interface ModelData {
  id: string;
  modelName: string;
  datasetId: string;
  type: string;
  tags: string[];
}

// Add this new Legend component at the top of the file, before the Flow component
const Legend: React.FC<{ datasetColorMap: Map<string, string> }> = ({ datasetColorMap }) => {
  return (
    <div className="mb-4 p-2 border border-[var(--vscode-widget-border)] rounded-md">
      <h3 className="text-sm font-semibold text-[var(--vscode-foreground)] mb-2">Datasets</h3>
      <div className="flex flex-wrap gap-2">
        {Array.from(datasetColorMap.entries()).map(([dataset, color]) => (
          <div 
            key={dataset}
            className="flex items-center border border-[var(--vscode-widget-border)] rounded-md px-2 py-1"
          >
            <div 
              className="w-3 h-3 rounded-full mr-2" 
              style={{ backgroundColor: color }}
            />
            <span className="text-sm text-[var(--vscode-foreground)]">{dataset}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const Flow: React.FC = () => {
  const [fullNodes, setFullNodes] = useState<Node[]>([]);
  const [fullEdges, setFullEdges] = useState<Edge[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [__, setUniqueTags] = useState<string[]>([]);
  const reactFlowInstance = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const [message, setMessage] = useState<string>('');
  const [datasetColorMap, setDatasetColorMap] = useState<Map<string, string>>(new Map());
  const [_, setIsReady] = useState<boolean>(false);
  const [tableOptions, setTableOptions] = useState<OptionType[]>([]);
  const [tagOptions, setTagOptions] = useState<OptionType[]>([]);
  const [selectedTable, setSelectedTable] = useState<OptionType | null>(null);
  const [selectedTag, setSelectedTag] = useState<OptionType | null>(null);
  const [rootNodeId, setRootNodeId] = useState<string | null>(null);
  const [isTableCollapsed, setIsTableCollapsed] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [schemaModal, setSchemaModal] = useState<SchemaModalState | null>(null);

  // Send ready message when component mounts
  useEffect(() => {
    // Small delay to ensure React has fully rendered
    setTimeout(() => {
      setIsReady(true);
      transport.postMessage({ type: 'webviewReady' });
    }, 50);
  }, []);

  // Listen for "show schema" requests dispatched by node buttons. We fetch via
  // the transport and update modal state by `fullTableName` so a quick second
  // click on another node doesn't get clobbered by a stale response.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        projectId: string;
        datasetId: string;
        tableId: string;
        fullTableName: string;
      };
      setSchemaModal({ status: 'loading', ...detail });
      transport
        .request<{ fields: any[]; lastModifiedTime?: string }>('getSchema', {
          projectId: detail.projectId,
          datasetId: detail.datasetId,
          tableId: detail.tableId,
        })
        .then((result) => {
          setSchemaModal((prev) =>
            prev && prev.fullTableName === detail.fullTableName
              ? {
                  status: 'loaded',
                  ...detail,
                  fields: result.fields ?? [],
                  lastModifiedTime: result.lastModifiedTime,
                }
              : prev
          );
        })
        .catch((err: any) => {
          const message =
            (err && typeof err.message === 'string' && err.message) ||
            (err && typeof err === 'object' ? JSON.stringify(err) : String(err));
          setSchemaModal((prev) =>
            prev && prev.fullTableName === detail.fullTableName
              ? { status: 'error', ...detail, error: message }
              : prev
          );
        });
    };
    window.addEventListener('dataform-graph:show-schema', handler as EventListener);
    return () => window.removeEventListener('dataform-graph:show-schema', handler as EventListener);
  }, []);

  // Esc closes the schema modal.
  useEffect(() => {
    if (!schemaModal) {return;}
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {setSchemaModal(null);}
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [schemaModal]);

  useEffect(() => {
    const messageHandler = (message: any) => {
      switch (message.type) {
        case 'testMessage':
          setMessage(message.value);
          break;
        case 'nodeMetadata':
          const { initialNodesStatic, initialEdgesStatic, datasetColorMap, currentActiveEditorIdx, initialTag } = message.value;
          setFullNodes(initialNodesStatic);
          setFullEdges(initialEdgesStatic);
          const uniqueTags: string[] = Array.from(new Set(initialNodesStatic.flatMap((node: Node) => node.data.tags as string[])));
          setUniqueTags(uniqueTags);
          setDatasetColorMap(new Map(Object.entries(datasetColorMap)));

          // Three possible initial states, in priority order:
          //   1. initialTag — host requested a tag-filtered view (CLI --tag).
          //   2. currentActiveEditorIdx — host pointed at a specific node (extension active editor / CLI --model).
          //   3. neither — show the full graph.
          const hasTag = !!initialTag && uniqueTags.includes(initialTag);
          const hasFocus = !hasTag && !!currentActiveEditorIdx && initialNodesStatic.some((n: Node) => n.id === currentActiveEditorIdx);
          let initialNodes: Node[];
          let initialEdges: Edge[];
          let initialTableOpts = initialNodesStatic;

          if (hasTag) {
            const tagEdges = initialEdgesStatic.filter((edge: Edge) =>
              Array.isArray((edge as any).tags) && (edge as any).tags.includes(initialTag)
            );
            const includedIds = new Set<string>();
            for (const e of tagEdges) { includedIds.add(e.source as string); includedIds.add(e.target as string); }
            for (const n of initialNodesStatic) {
              if (((n.data?.tags as string[] | undefined) ?? []).includes(initialTag)) { includedIds.add(n.id); }
            }
            initialNodes = initialNodesStatic.filter((n: Node) => includedIds.has(n.id));
            initialEdges = tagEdges;
            initialTableOpts = initialNodes;
          } else if (hasFocus) {
            initialEdges = initialEdgesStatic.filter((edge: Edge) =>
              edge.source === currentActiveEditorIdx || edge.target === currentActiveEditorIdx
            );
            initialNodes = initialNodesStatic.filter((node: Node) =>
              initialEdges.some((edge: Edge) => edge.source === node.id || edge.target === node.id)
            );
          } else {
            initialEdges = initialEdgesStatic;
            initialNodes = initialNodesStatic;
          }

          const { nodes: positionedNodes, edges: positionedEdges } = nodePositioning(
            initialNodes,
            initialEdges,
          );
          setNodes(positionedNodes);
          setEdges(positionedEdges);

          if (hasFocus) {
            setRootNodeId(currentActiveEditorIdx);
          }
          if (hasTag) {
            setSelectedTag({ value: initialTag, label: initialTag });
          }

          // Initial fitView
          setTimeout(() => {
            if (reactFlowInstance.current) {
              reactFlowInstance.current.fitView({
                maxZoom: 2.5,
              });
            }
          }, 100);

          setTableOptions(initialTableOpts.map((node: any) => ({
            value: node.id,
            label: node.data.modelName as string
          })));

          setTagOptions(uniqueTags.map((tag) => ({
            value: tag,
            label: tag
          })));
          break;
        // Add more message types as needed
      }
    };

    const unsubscribe = transport.onMessage(messageHandler);

    return () => {
      unsubscribe();
    };
  }, []);

  const onConnect = useCallback(
    (params: any) => setEdges((eds: any[]) => addEdge(params, eds)),
    [setEdges]
  );

  const handleTableSelect = (option: OptionType | null) => {
    // Picking (or clearing) a table is mutually exclusive with the tag filter —
    // clear the tag chip so the UI only advertises one active filter at a time.
    setSelectedTable(option);
    setSelectedTag(null);
    // Restore the full table options too, in case they were narrowed by a tag filter.
    setTableOptions(fullNodes.map((n) => ({ value: n.id, label: n.data.modelName as string })));

    // clear the nodes and edges in the existing graph
    setNodes([]);
    setEdges([]);

    if (!option) {
        return;
    }
    
    // Small delay to ensure the clear operation is complete before adding new nodes
    setTimeout(() => {
        const filteredEdges = fullEdges.filter((edge: Edge) => 
            edge.source === option.value || edge.target === option.value
        );
        const filteredNodes = fullNodes.filter((node: Node) => 
            node.id === option.value || // Include selected node
            filteredEdges.some((edge: Edge) => 
                edge.source === node.id || edge.target === node.id
            )
        );
        
        // Compute new positions for the filtered nodes
        const { nodes: positionedNodes, edges: positionedEdges } = nodePositioning(
            filteredNodes,
            filteredEdges,
        );

        setNodes(positionedNodes);
        setEdges(positionedEdges);
        setRootNodeId(option.value);

        if (reactFlowInstance.current) {
            reactFlowInstance.current?.fitView({
                padding: 0.2,
                duration: 800
            });
        }
    }, 50);
  };

  const handleTagSelect = (option: OptionType | null) => {
    setSelectedTag(option);
    // Picking (or clearing) a tag is mutually exclusive with the table filter.
    setSelectedTable(null);

    if (!option) {
      // When the tag is cleared, restore the full table-dropdown options so it
      // doesn't stay scoped to the just-cleared tag.
      setTableOptions(fullNodes.map((n) => ({ value: n.id, label: n.data.modelName as string })));
      return;
    }

    setNodes([]);
    setEdges([]);

    setTimeout(() => {
      // Edges carry the downstream model's tags, so an edge with the tag
      // means the consumer has it.
      const tagEdges = fullEdges.filter((edge: any) =>
        Array.isArray(edge?.tags) && edge.tags.includes(option.value)
      );

      // Include every node that either (a) has the tag itself, or (b) sits on
      // a tag-tagged edge (covers upstream sources feeding a tagged model).
      const includedIds = new Set<string>();
      for (const e of tagEdges) {
        includedIds.add(e.source as string);
        includedIds.add(e.target as string);
      }
      for (const n of fullNodes) {
        const nodeTags = (n.data?.tags as string[] | undefined) ?? [];
        if (nodeTags.includes(option.value)) {
          includedIds.add(n.id);
        }
      }
      const filteredNodes = fullNodes.filter((n: Node) => includedIds.has(n.id));

      setTableOptions(filteredNodes.map((node: any) => ({
        value: node.id,
        label: node.data.modelName as string
      })));

      const { nodes: positionedNodes, edges: positionedEdges } = nodePositioning(
        filteredNodes,
        tagEdges,
      );
      setNodes(positionedNodes);
      setEdges(positionedEdges);
      // Tag view has no single root, so Expand-left/right buttons are inapplicable.
      setRootNodeId(null);

      if (reactFlowInstance.current) {
        reactFlowInstance.current?.fitView({
            padding: 0.2,
            duration: 800
        });
      }
    }, 50);

  };

  // Add this new handler for node clicks
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    // get the dependent and dependecies of the clicked node
    const filteredEdges = fullEdges.filter((edge: Edge) => edge.source === node.id || edge.target === node.id);
    const filteredNodes = fullNodes.filter((n: Node) => filteredEdges.some((edge: Edge) => edge.source === n.id || edge.target === n.id));
    
    // add to the current nodes and edges the filtered nodes and edges, preventing duplicates
    const combinedNodes = [...nodes];
    filteredNodes.forEach(fn => {
      if (!combinedNodes.some(n => n.id === fn.id)) {
        combinedNodes.push(fn);
      }
    });

    const combinedEdges = [...edges];
    filteredEdges.forEach(fe => {
      if (!combinedEdges.some(e => e.id === fe.id)) {
        combinedEdges.push(fe);
      }
    });

    // recompute the positions of the nodes
    const filteredNodesWithPosition = nodePositioning(
      combinedNodes,
      combinedEdges,
    );
    setNodes(filteredNodesWithPosition.nodes);
    setEdges(filteredNodesWithPosition.edges);
    setRootNodeId(node.id);

    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({
        nodes: [{ id: node.id }],
        duration: 800,
        maxZoom: 0.8,
        padding: 0.2,
      });
    }
  }, [fullNodes, fullEdges, nodes, edges, setNodes, setEdges]);

  const expandToLeft = () => {
    if (!rootNodeId) {return;}

    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    const stack = [rootNodeId];

    while (stack.length > 0) {
      const currentNodeId = stack.pop()!;
      if (visitedNodes.has(currentNodeId)) {continue;}
      visitedNodes.add(currentNodeId);

      const upstreamEdges = fullEdges.filter(edge => edge.target === currentNodeId);
      upstreamEdges.forEach(edge => {
        if (!visitedEdges.has(edge.id)) {
          visitedEdges.add(edge.id);
          stack.push(edge.source);
        }
      });
    }

    const filteredNodes = fullNodes.filter(node => visitedNodes.has(node.id));
    const filteredEdges = fullEdges.filter(edge => visitedEdges.has(edge.id));

    const { nodes: positionedNodes, edges: positionedEdges } = nodePositioning(filteredNodes, filteredEdges);
    setNodes(positionedNodes);
    setEdges(positionedEdges);

    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({
        nodes: [{ id: rootNodeId }],
        duration: 800,
        maxZoom: 0.8,
        padding: 0.2,
      });
    }
  };

  const expandToRight = () => {
    if (!rootNodeId) {return;}

    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    const stack = [rootNodeId];

    while (stack.length > 0) {
      const currentNodeId = stack.pop()!;
      if (visitedNodes.has(currentNodeId)) {continue;}
      visitedNodes.add(currentNodeId);

      const downstreamEdges = fullEdges.filter(edge => edge.source === currentNodeId);
      downstreamEdges.forEach(edge => {
        if (!visitedEdges.has(edge.id)) {
          visitedEdges.add(edge.id);
          stack.push(edge.target);
        }
      });
    }

    const filteredNodes = fullNodes.filter(node => visitedNodes.has(node.id));
    const filteredEdges = fullEdges.filter(edge => visitedEdges.has(edge.id));

    const { nodes: positionedNodes, edges: positionedEdges } = nodePositioning(filteredNodes, filteredEdges);
    setNodes(positionedNodes);
    setEdges(positionedEdges);

    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({
        nodes: [{ id: rootNodeId }],
        duration: 800,
        maxZoom: 1.0,
        padding: 0.2,
      });
    }
  };

  const showFullGraph = () => {
    if (fullNodes.length === 0) {return;}

    const { nodes: positionedNodes, edges: positionedEdges } = nodePositioning(fullNodes, fullEdges);
    setNodes(positionedNodes);
    setEdges(positionedEdges);
    setRootNodeId(null);
    // Reset both filter chips and the table-dropdown options to their full state.
    setSelectedTag(null);
    setSelectedTable(null);
    setTableOptions(fullNodes.map((n) => ({ value: n.id, label: n.data.modelName as string })));

    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({
        duration: 800,
        padding: 0.2,
      });
    }
  };

  const handleDownload = () => {
    if (nodes.length === 0) {return;}
    setIsDownloading(true);

    // Use setTimeout to allow React to render the loading state before the heavy processing begins
    setTimeout(() => {
      const nodesBounds = getNodesBounds(nodes);
      const padding = 50;
      const imageWidth = nodesBounds.width + (padding * 2);
      const imageHeight = nodesBounds.height + (padding * 2);

      const transform = getViewportForBounds(
        nodesBounds,
        imageWidth,
        imageHeight,
        0.5,
        2,
        0.2
      );

      const targetElement = document.querySelector('.react-flow') as HTMLElement;
      if (!targetElement) {
        setIsDownloading(false);
        return;
      };

      const viewport = targetElement.querySelector('.react-flow__viewport') as HTMLElement;
      const legend = targetElement.querySelector('.export-legend') as HTMLElement;
      
      const originalViewportStyle = viewport?.style.cssText;
      const originalLegendDisplay = legend?.style.display;

      if (viewport) {
        viewport.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`;
      }
      if (legend) {
        legend.classList.remove('hidden');
        legend.style.display = 'block';
      }

      const computedBackground = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim() || '#ffffff';

      toPng(targetElement, {
        backgroundColor: computedBackground,
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
        },
        pixelRatio: 3,
        filter: (node: HTMLElement) => {
          // Filter out controls and other UI elements that shouldn't be in the export
          const exclusionClasses = ['react-flow__controls', 'react-flow__attribution'];
          return !exclusionClasses.some(className => node.classList?.contains(className));
        },
      }).then((dataUrl) => {
        transport.postMessage({
          type: 'saveGraphImage',
          value: {
            dataUrl,
            format: 'png',
          }
        });
        
        // Revert styles
        if (viewport) {
          viewport.style.cssText = originalViewportStyle;
        }
        if (legend) {
          legend.classList.add('hidden');
          legend.style.display = originalLegendDisplay || 'none';
        }
        setIsDownloading(false);
      }).catch((err) => {
        console.error('Failed to download image', err);
        // Revert styles on error too
        if (viewport) {
          viewport.style.cssText = originalViewportStyle;
        }
        if (legend) {
          legend.classList.add('hidden');
          legend.style.display = originalLegendDisplay || 'none';
        }
        setIsDownloading(false);
      });
    }, 0);
  };

  const handleRowClick = useCallback((model: ModelData) => {
    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({
        nodes: [{ id: model.id }],
        duration: 800,
        maxZoom: 0.8,
        padding: 0.2,
      });
    }
  }, []);

  const activeDatasets = new Set(nodes.map((node: any) => node.data?.datasetId as string).filter(Boolean));
  const activeDatasetColorMap = new Map(
    Array.from(datasetColorMap.entries()).filter(([dataset]) => activeDatasets.has(dataset))
  );

  const tableData = useMemo<ModelData[]>(() => {
    return nodes.map(node => ({
      id: node.id,
      modelName: node.data.modelName as string,
      datasetId: node.data.datasetId as string,
      type: node.data.type as string,
      tags: node.data.tags as string[],
    }));
  }, [nodes]);

  const columns = useMemo<ColumnDef<ModelData>[]>(() => [
    {
      accessorKey: "modelName",
      header: "Model Name",
      size: 300,
    },
  ], []);

  return (
    <div className="flex flex-col h-full bg-[var(--vscode-editor-background)]">
      {/* Add message display */}
      {message && (
        <div className="p-4 bg-blue-100 text-blue-800 mb-4 mx-4 mt-4 rounded">
          Message from extension: {message}
        </div>
      )}
      
      {/* Search and Legend Section */}
      <div className="p-4 border-b border-[var(--vscode-widget-border)]">
        {activeDatasetColorMap.size > 0 && (
          <Legend datasetColorMap={activeDatasetColorMap} />
        )}
        
        <div className="flex gap-4 items-center">
          <StyledSelect
            options={tagOptions}
            value={selectedTag}
            onChange={handleTagSelect}
            isClearable
            placeholder="Search for a tag..."
            width="w-1/6"
          />

          <StyledSelect
            options={tableOptions}
            value={selectedTable}
            onChange={handleTableSelect}
            isClearable
            placeholder="Search for a table..."
            width="w-1/3"
          />

          <div className="flex gap-2">
            <button
              onClick={expandToLeft}
              disabled={!rootNodeId}
              className="px-4 py-2 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              Expand to left
            </button>
            <button
              onClick={expandToRight}
              disabled={!rootNodeId}
              className="px-4 py-2 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              Expand to right
            </button>
            <button
              onClick={showFullGraph}
              disabled={fullNodes.length === 0}
              className="px-4 py-2 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              Show full graph
            </button>
            {SHOW_EXPORT_BUTTON && (
              <DownloadButton onClick={handleDownload} disabled={nodes.length === 0} isLoading={isDownloading} />
            )}
          </div>
        </div>
      </div>
      
      {/* Main Content Area: Side-by-Side Layout */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left Side: Dependency Graph */}
        <div className="flex-1 relative border-r border-[var(--vscode-widget-border)]">
          {nodes.length > 0 ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onInit={(instance) => {
                reactFlowInstance.current = instance;
              }}
              defaultEdgeOptions={{
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: '#b1b1b7',
                },
                style: {
                  strokeWidth: 2,
                  stroke: '#b1b1b7',
                },
              }}
              fitView
              minZoom={0.1}
              maxZoom={4}
            >
              <Controls />
              {/* @ts-ignore */}
              <Background variant="dots" gap={12} size={1} />
              {activeDatasetColorMap.size > 0 && (
                <Panel position="top-right" className="export-legend hidden">
                  <Legend datasetColorMap={activeDatasetColorMap} />
                </Panel>
              )}
            </ReactFlow>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-medium">
              Select a table to view its dependencies
            </div>
          )}
        </div>

        {/* Right Side: Active Models Table */}
        {nodes.length > 0 && (
          <div className={`${isTableCollapsed ? 'w-10' : 'w-96'} flex flex-col bg-[var(--vscode-sideBar-background)] overflow-hidden transition-all duration-300 ease-in-out border-l border-[var(--vscode-widget-border)]`}>
            <div className={`p-3 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBarSectionHeader-background)] flex items-center ${isTableCollapsed ? 'justify-center p-2' : 'justify-between'}`}>
              {!isTableCollapsed && (
                <h3 className="text-sm font-bold text-[var(--vscode-foreground)] uppercase tracking-wider truncate mr-2">
                  Active Models ({nodes.length})
                </h3>
              )}
              <button
                onClick={() => setIsTableCollapsed(!isTableCollapsed)}
                className="p-1 hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors text-[var(--vscode-foreground)]"
                title={isTableCollapsed ? "Expand section" : "Collapse section"}
              >
                {isTableCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              </button>
            </div>
            {!isTableCollapsed && (
              <div className="flex-1 overflow-hidden p-2">
                <DataTable
                  columns={columns}
                  data={tableData}
                  searchPlaceholder="Filter models..."
                  onRowClick={handleRowClick}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {schemaModal && <SchemaModal state={schemaModal} onClose={() => setSchemaModal(null)} />}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <div className="h-screen flex flex-col">
      <div className="px-6 py-4 bg-[var(--vscode-sideBarSectionHeader-background)] border-b border-[var(--vscode-widget-border)]">
        <h2 className="text-xl font-bold text-[var(--vscode-foreground)]">Dataform Dependency Graph</h2>
      </div>

      <div className="flex-1 overflow-hidden">
        <ReactFlowProvider>
          <Flow />
        </ReactFlowProvider>
      </div>
    </div>
  );
};

export default App;