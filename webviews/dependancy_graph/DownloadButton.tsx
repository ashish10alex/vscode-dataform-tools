import { Loader2 } from 'lucide-react';
import React from 'react';

interface DownloadButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({ onClick, disabled, isLoading }) => {
  return (
    <button
      className="px-4 py-2 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center gap-2"
      onClick={onClick}
      disabled={disabled || isLoading}
      title="Download high-resolution PNG"
    >
      {isLoading ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          <span>Exporting...</span>
        </>
      ) : (
        'Export PNG'
      )}
    </button>
  );
};

export default DownloadButton;
