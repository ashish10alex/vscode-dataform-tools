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
  const [showNotification, setShowNotification] = React.useState(false);

  const handleClick = () => {
    if (onNodeClick) {
      onNodeClick(id);
    }
  };


  const handleCopy = (e:any) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fullTableName).then(() => {
      setShowNotification(true);
      setTimeout(() => setShowNotification(false), 2000); // Hide notification after 2 seconds
    });
  };

  const getUrlToNavigateToTableInBigQuery = (gcpProjectId:string, datasetId:string, tableName:string) => {
    return `https://console.cloud.google.com/bigquery?project=${gcpProjectId}&ws=!1m5!1m4!4m3!1s${gcpProjectId}!2s${datasetId}!3s${tableName}`;
  };

  const nodeStyle = {
    background: isExternalSource ? datasetColor : '#ffffff',
    border: `1px solid ${datasetColor}`,
    borderLeft: type === 'assertions' ? '4px solid rgba(255, 0, 0, 0.6)' : undefined,
    position: 'relative' as const,
    height: 80
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
        }}
        className="absolute bottom-1 right-1 p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors duration-200 shadow-sm group"
        title="Open model in editor"
      >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 2H6C5.44772 2 5 2.44772 5 3V21C5 21.5523 5.44772 22 6 22H18C18.5523 22 19 21.5523 19 21V8L14 2Z" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M14 2V8H19" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
        className="absolute bottom-1 right-20 p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors duration-200 shadow-sm group"
        title="Open in BigQuery"
      >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 13a5.001 5.001 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M14 11a5.001 5.001 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      </button>


      <button
        onClick={handleCopy}
        className="absolute bottom-1 right-10 p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors duration-200 shadow-sm group"
        title="Copy table name"
      >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 4H16C17.1 4 18 4.9 18 6V14C18 15.1 17.1 16 16 16H8C6.9 16 6 15.1 6 14V6C6 4.9 6.9 4 8 4Z" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M16 16V18C16 19.1 15.1 20 14 20H6C4.9 20 4 19.1 4 18V10C4 8.9 4.9 8 6 8H8" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      </button>

      { showNotification && (
        <div 
          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-green-800 text-white px-2 py-1 rounded text-xs whitespace-nowrap z-10"
        >
          Copied {fullTableName} to clipboard
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
