import { Component, ErrorInfo, ReactNode } from 'react';
import { vscode } from '../utils/vscode';

/**
 * Shows what went wrong when the panel fails while it draws, and offers to load it again. Without it React takes
 * the whole panel down, and it stays empty until it is closed and opened again.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The Compiled Query panel failed while it drew', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <div className="p-4 text-[var(--vscode-foreground)]">
        <p className="m-0 mb-2">The Compiled Query panel ran into an error.</p>
        <pre className="m-0 mb-3 p-2 text-xs whitespace-pre-wrap rounded border border-[var(--vscode-widget-border)] text-[var(--vscode-errorForeground)]">{error.message}</pre>
        <button
          className="px-3 py-1 rounded-sm text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)]"
          onClick={() => vscode.postMessage({ command: 'reloadPage' })}
        >
          Reload panel
        </button>
      </div>
    );
  }
}
