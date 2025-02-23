import React from 'react';
import { Handle, Position } from '@xyflow/react';

interface NodeData {
  modelName: string;
  datasetId: string;
  projectId: string;
  tags: string[];
  fileName: string;
  datasetColor: string;
  type: 'view' | 'table' | 'operation' | 'source' | 'assertion';
  onNodeClick: (nodeId: string) => void;
}

const TableNode: React.FC<{ data: NodeData; id: string }> = ({ data, id }) => {
  const { modelName, datasetId, projectId, tags, fileName, datasetColor, type, onNodeClick } = data;

  const handleClick = () => {
    if (onNodeClick) {
      onNodeClick(id);
    }
  };

  return (
    <div
      onClick={handleClick}
      style={{
        background: '#ffffff',
        borderRadius: '6px',
        padding: '8px 12px',
        minWidth: '120px',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
        fontFamily: 'Inter, sans-serif',
        border: `1px solid ${datasetColor}`,
        position: 'relative',
        cursor: 'pointer',
        transition: 'opacity 0.3s ease-in-out',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#555' }} />
      
      <div
        style={{
          fontSize: '12px',
          fontWeight: 'bold',
          color: '#333',
          marginBottom: '4px',
        }}
      >
        {modelName}
      </div>

      <div
        style={{
          color: datasetColor,
          fontSize: '9px',
          fontWeight: 'bold',
        }}
      >
        {datasetId}
      </div>

      <div
        style={{
          position: 'absolute',
          top: '-6px',
          right: '-6px',
          background: datasetColor,
          color: '#fff',
          fontSize: '8px',
          padding: '2px 4px',
          borderRadius: '3px',
          textTransform: 'uppercase',
        }}
      >
        {type}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: '#555' }} />
    </div>
  );
};

export default TableNode;
