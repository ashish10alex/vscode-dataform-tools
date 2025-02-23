import React, {useCallback, useRef, useEffect, useState} from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  ReactFlowProvider,
  ReactFlowInstance
} from '@xyflow/react';
import Select from 'react-select';
import '@xyflow/react/dist/style.css';
import TableNode from './TableNode';
import { initialNodesStatic } from './initialNodes';
import { initialEdgesStatic } from './initialEdges';
import { nodePositioning } from './nodePositioning';

const nodeTypes = {
  tableNode: TableNode,
};

const { nodes: initialNodes, edges: initialEdges } = nodePositioning(
  initialNodesStatic,
  initialEdgesStatic,
  'TB'
);

interface OptionType {
  value: string;
  label: string;
}

// Get vscode API
// @ts-ignore
const vscode = acquireVsCodeApi();

const Flow: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const [message, setMessage] = useState<string>(''); // Add state for message

  // Add effect to listen for messages
  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      
      // Handle different message types
      switch (message.type) {
        case 'testMessage':
          setMessage(message.value);
          break;
        case 'nodeMetadata':
          const { initialNodesStatic, initialEdgesStatic } = message.value;
          const { nodes: initialNodes, edges: initialEdges } = nodePositioning(
            initialNodesStatic,
            initialEdgesStatic,
            'LR'
          );
          setNodes(initialNodes);
          setEdges(initialEdges);
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
    (params: any) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // Convert nodes to options format for react-select
  const selectOptions: OptionType[] = nodes.map((node) => ({
    value: node.id,
    label: node.data.modelName as string
  }));

  // Function to handle table selection
  const handleTableSelect = (option: OptionType | null) => {
    if (!option) return;
    
    const node = nodes.find((n) => n.id === option.value);
    
    if (node && reactFlowInstance.current) {
      reactFlowInstance.current.setCenter(
        node.position.x + 100, 
        node.position.y + 100, 
        { duration: 800 }
      );
    }
  };

  const sendMessageToExtension = () => {
    vscode.postMessage({
      type: 'fromWebview',
      value: 'Hello from React webview!'
    });
  };

  return (
    <div className="h-full">
      {/* Add message display */}
      {message && (
        <div className="p-4 bg-blue-100 text-blue-800 mb-4">
          Message from extension: {message}
        </div>
      )}
      
      {/* Add test button */}
      <button 
        onClick={sendMessageToExtension}
        className="mb-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Send Message to Extension
      </button>

      <div className="p-4">
        <Select
          options={selectOptions}
          onChange={handleTableSelect}
          isClearable
          placeholder="Search for a table..."
          className="w-full"
          classNamePrefix="react-select"
          styles={{
            control: (base) => ({
              ...base,
              borderRadius: '0.375rem',
              borderColor: '#e2e8f0',
              '&:hover': {
                borderColor: '#3b82f6'
              }
            }),
            option: (base, state) => ({
              ...base,
              backgroundColor: state.isFocused ? '#e2e8f0' : 'white',
              color: 'black',
              '&:hover': {
                backgroundColor: '#e2e8f0'
              }
            }),
            singleValue: (base) => ({
              ...base,
              color: 'black'
            })
          }}
        />
      </div>
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => {
          reactFlowInstance.current = instance;
        }}
        fitView
      >
        <Controls />
        {/* @ts-ignore */}
        <Background variant="dots" gap={12} size={1} />
      </ReactFlow>
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