import React from 'react';

interface DownloadButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({ onClick, disabled }) => {
  return (
    <button
      className="px-4 py-2 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      onClick={onClick}
      disabled={disabled}
      title="Download high-resolution PNG"
    >
      Export PNG
    </button>
  );
};

export default DownloadButton;
