import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { getVsCodeApi } from './vscode';

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
  const { modelName, datasetId, projectId, datasetColor, type, onNodeClick, isExternalSource, fullTableName, fileName } = data;
  const [isHovered, setIsHovered] = React.useState(false);

  const handleClick = () => {
    if (onNodeClick) {
      onNodeClick(id);
    }
  };

  const getUrlToNavigateToTableInBigQuery = (gcpProjectId:string, datasetId:string, tableName:string) => {
    return `https://console.cloud.google.com/bigquery?project=${gcpProjectId}&ws=!1m5!1m4!4m3!1s${gcpProjectId}!2s${datasetId}!3s${tableName}`;
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

      <button
        onClick={(e) => {
          e.stopPropagation();
          getVsCodeApi().postMessage({
            type: 'nodeFileName',
            value: {
              modelName: modelName,
              filePath: fileName,
              type: type,
            }
          });
          // if (goToNodeFile) {goToNodeFile(id);}
        }}
        className="absolute bottom-1 right-1 p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors duration-200 shadow-sm group"
        title="Open File"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3.5 w-3.5 text-gray-600 group-hover:text-gray-800"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      </button>

      <button
        onClick={(e) => {
            e.stopPropagation();


          getVsCodeApi().postMessage({
            type: 'goToBigQuery',
            value: {
              url: getUrlToNavigateToTableInBigQuery(projectId, datasetId, modelName)
            }
          });


        }}
      style={{
          backgroundColor: "#f44336", // bright red
          color: "white",
          fontWeight: "bold",
          border: "2px solid #222",
          borderRadius: "6px",
          padding: "8px 16px",
          cursor: "pointer",
          boxShadow: "0px 2px 6px rgba(0,0,0,0.3)",
        }}
        title="Go to bigQuery"
      >
      </button>


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
