import React from 'react';

export interface FindWidgetProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchTerm: string;
  matchCount: number;
  currentMatchIndex: number;
  onSearchTermChange: (term: string) => void;
  onClose: () => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
}

export function FindWidget({
  searchInputRef,
  searchTerm,
  matchCount,
  currentMatchIndex,
  onSearchTermChange,
  onClose,
  onNextMatch,
  onPrevMatch
}: FindWidgetProps) {
  return (
    <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-[var(--vscode-editorWidget-background)] border border-[var(--vscode-editorWidget-border)] rounded shadow-md">
      <input
        ref={searchInputRef}
        type="text"
        value={searchTerm}
        onChange={(e) => onSearchTermChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose();
          } else if (e.key === 'Enter') {
            e.shiftKey ? onPrevMatch() : onNextMatch();
          }
        }}
        placeholder="Find in results..."
        aria-label="Find in results"
        className="flex-1 bg-transparent text-sm outline-none text-[var(--vscode-editor-foreground)] placeholder:text-[var(--vscode-input-placeholderForeground)] min-w-0"
      />
      <span className="sr-only" role="status" aria-live="polite">
        {searchTerm ? (matchCount === 0 ? 'No results found' : `${((currentMatchIndex % matchCount) + matchCount) % matchCount + 1} of ${matchCount} matches found`) : ''}
      </span>
      {searchTerm && (
        <span aria-hidden="true" className="text-xs text-[var(--vscode-descriptionForeground)] whitespace-nowrap">
          {matchCount === 0 ? 'No results' : `${((currentMatchIndex % matchCount) + matchCount) % matchCount + 1} of ${matchCount}`}
        </span>
      )}
      <button
        onClick={onPrevMatch}
        disabled={matchCount === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        className="text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] disabled:opacity-30 text-sm px-1 leading-none"
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        onClick={onNextMatch}
        disabled={matchCount === 0}
        title="Next match (Enter)"
        aria-label="Next match"
        className="text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] disabled:opacity-30 text-sm px-1 leading-none"
      >
        <span aria-hidden="true">↓</span>
      </button>
      <button
        onClick={onClose}
        title="Close"
        aria-label="Close"
        className="text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] text-xs px-1"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
