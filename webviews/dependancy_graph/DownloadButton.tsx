import { useReactFlow, Panel, getNodesBounds, getViewportForBounds } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { getVsCodeApi } from './vscode';

// @ts-ignore
const vscode = getVsCodeApi();

const DownloadButton = () => {
  const { getNodes } = useReactFlow();

  const handleDownload = () => {
    // Select the viewport element directly
    const nodes = getNodes();
    if (nodes.length === 0) return;

    const nodesBounds = getNodesBounds(nodes);
    // Add padding to the bounds
    const imageWidth = nodesBounds.width + 100;
    const imageHeight = nodesBounds.height + 100;

    const transform = getViewportForBounds(
      nodesBounds,
      imageWidth,
      imageHeight,
      0.5,
      2,
      0.2 // padding
    );

    const targetElement = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!targetElement) return;

    // Remove max-width/max-height constraints temporarily
    const originalStyle = targetElement.style.cssText;

    const exportFn = toPng;

    exportFn(targetElement, {
      backgroundColor: '#ffffff',
      width: imageWidth,
      height: imageHeight,
      style: {
        width: `${imageWidth}px`,
        height: `${imageHeight}px`,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
        // Fix for missing edges: explicitly set stroke styles for SVGs
        'stroke': '#b1b1b7',
        strokeWidth: '2px',
      },
      pixelRatio: 3, // High resolution for better pixel density
    }).then((dataUrl) => {
      vscode.postMessage({
        type: 'saveGraphImage',
        value: {
          dataUrl,
          format: 'png',
        }
      });
      targetElement.style.cssText = originalStyle;
    }).catch((err) => {
      console.error('Failed to download image', err);
      targetElement.style.cssText = originalStyle;
    });
  };

  return (
    <Panel position="top-right" className="flex gap-2 p-2 mr-4 mt-2">
      <button 
        className="px-3 py-1 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded border border-[var(--vscode-widget-border)] text-sm cursor-pointer shadow-md"
        onClick={() => handleDownload()}
        title="Download high-resolution PNG"
      >
        Export PNG
      </button>
    </Panel>
  );
};

export default DownloadButton;
