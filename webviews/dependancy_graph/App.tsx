import React, {useCallback, useRef, useEffect, useState} from 'react';
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
  Edge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TableNode from './TableNode';
import { nodePositioning } from './nodePositioning';
import { getVsCodeApi } from './vscode';
import StyledSelect, { OptionType } from './components/StyledSelect';

const nodeTypes = {
  tableNode: TableNode,
};

// Get vscode API
// @ts-ignore
const vscode = getVsCodeApi();

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
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [uniqueTags, setUniqueTags] = useState<string[]>([]);
  const reactFlowInstance = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const [message, setMessage] = useState<string>('');
  const [datasetColorMap, setDatasetColorMap] = useState<Map<string, string>>(new Map());
  const [_, setIsReady] = useState<boolean>(false);

  // Send ready message when component mounts
  useEffect(() => {
    // Small delay to ensure React has fully rendered
    setTimeout(() => {
      setIsReady(true);
      vscode.postMessage({ type: 'webviewReady' });
    }, 50);
  }, []);

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      
      switch (message.type) {
        case 'testMessage':
          setMessage(message.value);
          break;
        case 'nodeMetadata':
          const { initialNodesStatic, initialEdgesStatic, datasetColorMap, currentActiveEditorIdx } = message.value;
          setFullNodes(initialNodesStatic);
          setFullEdges(initialEdgesStatic);
          const uniqueTags: string[] = Array.from(new Set(initialNodesStatic.flatMap((node: Node) => node.data.tags as string[])));
          setUniqueTags(uniqueTags);
          setDatasetColorMap(new Map(Object.entries(datasetColorMap)));
          const filteredEdges = initialEdgesStatic.filter((edge: Edge) => 
            edge.source === currentActiveEditorIdx || edge.target === currentActiveEditorIdx
          );
          const filteredNodes = initialNodesStatic.filter((node: Node) => 
            filteredEdges.some((edge: Edge) => edge.source === node.id || edge.target === node.id)
          );
          const { nodes: positionedNodes, edges: positionedEdges } = nodePositioning(
            filteredNodes,
            filteredEdges,
          );
          setNodes(positionedNodes);
          setEdges(positionedEdges);
          break;
        // Add more message types as needed
      }
    };

    window.addEventListener('message', messageHandler);

    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, []);

  const onConnect = useCallback(
    (params: any) => setEdges((eds: any[]) => addEdge(params, eds)),
    [setEdges]
  );

  // Update selectOptions to use fullNodes instead of nodes
  const selectOptions: OptionType[] = fullNodes.map((node) => ({
    value: node.id,
    label: node.data.modelName as string
  }));

  const tagOptions: OptionType[] = uniqueTags.map((tag) => ({
    value: tag,
    label: tag
  }));

  // Updated handler for table selection
  const handleTableSelect = (option: OptionType | null) => {
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

        if (reactFlowInstance.current) {
            reactFlowInstance.current?.fitView({
                padding: 0.2,
                duration: 800
            });
        }
    }, 50);
  };

  const handleTagSelect = (option: OptionType | null) => {
    if (!option) {
      return;
    }

    setNodes([]);
    setEdges([]);

    setTimeout(() => {
      console.log('option', option);
    }, 50);
    
    
  };

  // Add this new handler for node clicks
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    // get the dependent and dependecies of the clicked node
    const filteredEdges = fullEdges.filter((edge: Edge) => edge.source === node.id || edge.target === node.id);
    const filteredNodes = fullNodes.filter((n: Node) => filteredEdges.some((edge: Edge) => edge.source === n.id || edge.target === n.id));
    // add to the current nodes and edges the filtered nodes and edges
    setNodes([...nodes, ...filteredNodes]);
    setEdges([...edges, ...filteredEdges]);
    // recompute the positions of the nodes
    const filteredNodesWithPosition = nodePositioning(
      [...nodes, ...filteredNodes],
      [...edges, ...filteredEdges],
    );
    setNodes(filteredNodesWithPosition.nodes);
    setEdges(filteredNodesWithPosition.edges);
  }, [fullNodes, fullEdges, nodes, edges, setNodes, setEdges]);

  return (
    <div className="h-full">
      {/* Add message display */}
      {message && (
        <div className="p-4 bg-blue-100 text-blue-800 mb-4">
          Message from extension: {message}
        </div>
      )}
      
      {/* Add the Legend component here, before the search dropdown */}
      <div className="p-4">
        {datasetColorMap.size > 0 && (
          <Legend datasetColorMap={datasetColorMap} />
        )}
        
        <div className="flex gap-4">
          <StyledSelect
            options={selectOptions}
            onChange={handleTableSelect}
            isClearable
            placeholder="Search for a table..."
            width="w-72"
          />

          <StyledSelect
            options={tagOptions}
            onChange={handleTagSelect}
            isClearable
            placeholder="Search for a tag..."
            width="w-72"
          />
        </div>
      </div>
      
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
          fitView
        >
          <Controls />
          {/* @ts-ignore */}
          <Background variant="dots" gap={12} size={1} />
        </ReactFlow>
      ) : (
        <div className="flex items-center justify-center h-[80vh] text-gray-400">
          Select a table to view its dependencies
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <div className="p-4 min-h-screen">
      <h2 className="text-2xl font-bold text-white-600">Dataform dependency graph</h2>

      <div style={{ width: '100vw', height: '100vh' }}>
        <ReactFlowProvider>
          <Flow />
        </ReactFlowProvider>
      </div>
    </div>
  );
};

export default App;