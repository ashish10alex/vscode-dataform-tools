import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { LastRunView } from '../types';
import { vscode } from '../utils/vscode';

function formatAgo(timestamp: number, now: number): string {
    const minutes = Math.floor(Math.max(0, now - timestamp) / 60000);
    if (minutes < 1) { return 'just now'; }
    if (minutes < 60) { return `${minutes}m ago`; }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) { return `${hours}h ago`; }
    return `${Math.floor(hours / 24)}d ago`;
}

export function LastRunCard({ lastRun, disabled }: { lastRun?: LastRunView | null; disabled?: boolean }) {
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(interval);
    }, []);

    if (!lastRun) { return null; }

    return (
        <div
            className="mt-3 flex items-center gap-2 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] p-2.5 text-xs"
            title={lastRun.detail}
        >
            <RotateCcw className="w-3.5 h-3.5 shrink-0 text-[var(--vscode-descriptionForeground)]" />
            <span className="min-w-0 truncate font-mono text-[var(--vscode-foreground)]">Last run: {lastRun.label}</span>
            <span
                className="shrink-0 text-[var(--vscode-descriptionForeground)]"
                title={new Date(lastRun.timestamp).toLocaleString()}
            >
                · {formatAgo(lastRun.timestamp, now)}
            </span>
            <button
                onClick={() => vscode.postMessage({ command: 'rerunLastExecution' })}
                disabled={disabled}
                className="ml-auto shrink-0 flex items-center px-3 py-1 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded disabled:opacity-50"
                title={lastRun.fullRefresh ? 'Run again (asks for confirmation because of full refresh)' : 'Run again with the same options'}
            >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Run again
            </button>
        </div>
    );
}
