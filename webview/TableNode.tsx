import React from 'react';
import { Handle, Position } from '@xyflow/react';

interface NodeData {
  modelName: string;
  datasetId: string;
  projectId: string;
  tags: string[];
  fileName: string;
  datasetColor: string;
  type: 'view' | 'table' | 'operation' | 'source' | 'assertions';
  onNodeClick: (nodeId: string) => void;
  isExternalSource: boolean;
  fullTableName: string;
}

const TableNode: React.FC<{ data: NodeData; id: string }> = ({ data, id }) => {
  const { modelName, datasetId, datasetColor, type, onNodeClick, isExternalSource, fullTableName } = data;
  const [isHovered, setIsHovered] = React.useState(false);

  const handleClick = () => {
    if (onNodeClick) {
      onNodeClick(id);
    }
  };

  const nodeStyle = {
    background: isExternalSource ? datasetColor : '#ffffff',
    border: `1px solid ${datasetColor}`,
    borderLeft: type === 'assertions' ? '4px solid rgba(255, 0, 0, 0.6)' : undefined,
    position: 'relative' as const,
  };

  const typeStyle = {
    background: isExternalSource ? '#fff' : datasetColor,
    color: isExternalSource ? '#000' : '#fff',
    border: type === 'view' ? '2px solid yellow' : undefined,
  };

  const arrowColors = {
    '--arrow-color': isExternalSource ? '#fff' : datasetColor,
  } as React.CSSProperties;

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="table-node min-w-[120px] rounded-md p-3 shadow-sm font-inter cursor-pointer transition-all duration-300"
      style={{ ...nodeStyle, ...arrowColors }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#555' }} />
      
      <div className="text-xs font-bold text-gray-800 mb-1">
        {modelName}
      </div>

      <div
        className="text-[9px] font-bold"
        style={{ color: isExternalSource ? '#fff' : datasetColor }}
      >
        {datasetId}
      </div>

      <div
        className="absolute -top-2 -right-1.5 text-[8px] px-0.5 rounded uppercase"
        style={typeStyle}
      >
        {type}
      </div>

      {isHovered && (
        <div 
          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-2 py-1 rounded text-xs whitespace-nowrap z-10"
        >
          {fullTableName}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: '#555' }} />

      <style>
        {`
          .table-node::before {
            border-color: transparent var(--arrow-color) transparent transparent;
          }
          .table-node::after {
            border-color: transparent transparent transparent var(--arrow-color);
          }
        `}
      </style>
    </div>
  );
};

export default TableNode;
