import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { ExecutionMode, LastRunView } from '../types';
import { vscode } from '../utils/vscode';

function formatAgo(timestamp: number, now: number): string {
    const minutes = Math.floor(Math.max(0, now - timestamp) / 60000);
    if (minutes < 1) { return 'just now'; }
    if (minutes < 60) { return `${minutes}m ago`; }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) { return `${hours}h ago`; }
    return `${Math.floor(hours / 24)}d ago`;
}

interface LastRunCardProps {
    lastRun?: LastRunView | null;
    disabled?: boolean;
    /** Called once the extension has recorded the rerun, i.e. it is about to be dispatched. */
    onRerunDispatched?: (executionMode: ExecutionMode) => void;
}

/**
 * Shows "Starting…" from the click until the extension records the rerun (the last run timestamp changes),
 * reports that it was aborted (cancelled confirmation, missing files, ...), or a safety timeout passes.
 */
export function LastRunCard({ lastRun, disabled, onRerunDispatched }: LastRunCardProps) {
    const [now, setNow] = useState(Date.now());
    const [rerunFromTimestamp, setRerunFromTimestamp] = useState<number | null>(null);

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (rerunFromTimestamp === null || !lastRun) { return; }
        if (lastRun.timestamp !== rerunFromTimestamp) {
            setRerunFromTimestamp(null);
            onRerunDispatched?.(lastRun.executionMode);
            return;
        }
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.rerunAborted) {
                setRerunFromTimestamp(null);
            }
        };
        window.addEventListener('message', handleMessage);
        const timeoutId = setTimeout(() => setRerunFromTimestamp(null), 60000);
        return () => {
            window.removeEventListener('message', handleMessage);
            clearTimeout(timeoutId);
        };
    }, [rerunFromTimestamp, lastRun, onRerunDispatched]);

    if (!lastRun) { return null; }

    const starting = rerunFromTimestamp !== null;
    const handleRerun = () => {
        setRerunFromTimestamp(lastRun.timestamp);
        vscode.postMessage({ command: 'rerunLastExecution' });
    };

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
                onClick={handleRerun}
                disabled={disabled || starting}
                className="ml-auto shrink-0 flex items-center px-3 py-1 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded disabled:opacity-50"
                title={lastRun.fullRefresh ? 'Run again (asks for confirmation because of full refresh)' : 'Run again with the same options'}
            >
                {starting
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Starting…</>
                    : <><RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Run again</>}
            </button>
        </div>
    );
}
