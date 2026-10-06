import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';
import { ExecutionMode, LastRunView, WorkflowUrlEntry } from '../types';
import { vscode } from '../utils/vscode';

const SUCCESS_COLOR = 'var(--vscode-testing-iconPassed, #4ec9b0)';
const ERROR_COLOR = 'var(--vscode-testing-iconFailed, #f14c4c)';

type RunStatus = 'starting' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

/**
 * Only API runs have a tracked outcome. The run is recorded just before it is dispatched, so its
 * invocation is the latest one created at or after that moment; CLI runs live in the terminal.
 */
function resolveStatus(lastRun: LastRunView, latestApiRun: WorkflowUrlEntry | undefined): RunStatus {
    if (lastRun.executionMode === 'cli' || !latestApiRun || latestApiRun.timestamp < lastRun.timestamp) {
        return 'unknown';
    }
    switch (latestApiRun.state) {
        case 'SUCCEEDED': return 'succeeded';
        case 'FAILED': return 'failed';
        case 'CANCELLED': return 'cancelled';
        default: return 'running';
    }
}

function StatusIndicator({ status }: { status: RunStatus }) {
    switch (status) {
        case 'starting':
        case 'running':
            return (
                <span className="shrink-0 flex items-center gap-1 text-[var(--vscode-textLink-foreground)]">
                    <Loader2 className="w-3 h-3 animate-spin" /> {status === 'starting' ? 'Starting' : 'Running'}
                </span>
            );
        case 'succeeded':
            return (
                <span className="shrink-0 flex items-center gap-1.5" style={{ color: SUCCESS_COLOR }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: SUCCESS_COLOR }} /> Succeeded
                </span>
            );
        case 'failed':
        case 'cancelled':
            return (
                <span className="shrink-0 flex items-center gap-1" style={{ color: ERROR_COLOR }}>
                    <X className="w-3 h-3" /> {status === 'failed' ? 'Failed' : 'Cancelled'}
                </span>
            );
        default:
            return <span className="shrink-0 w-2 h-2 rounded-full bg-[var(--vscode-descriptionForeground)] opacity-60" aria-hidden="true" />;
    }
}

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
    /** Most recent Dataform API invocation, used for the status of an API last run. */
    latestApiRun?: WorkflowUrlEntry;
    disabled?: boolean;
    /** Called once the extension has recorded the rerun, i.e. it is about to be dispatched. */
    onRerunDispatched?: (executionMode: ExecutionMode) => void;
}

/**
 * Shows "Starting…" from the click until the extension records the rerun (the last run timestamp changes),
 * reports that it was aborted (cancelled confirmation, missing files, ...), or a safety timeout passes.
 */
export function LastRunCard({ lastRun, latestApiRun, disabled, onRerunDispatched }: LastRunCardProps) {
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
        vscode.postMessage({ command: 'repeatLastRun' });
    };

    const status = starting ? 'starting' : resolveStatus(lastRun, latestApiRun);

    return (
        <div
            className="flex items-center gap-2 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] px-3 py-2 text-xs"
            title={lastRun.detail}
        >
            <StatusIndicator status={status} />
            <span className="min-w-0 truncate text-[var(--vscode-foreground)]">
                <span className="text-[var(--vscode-descriptionForeground)]">Last run </span>
                <span
                    className="text-[var(--vscode-descriptionForeground)]"
                    title={new Date(lastRun.timestamp).toLocaleString()}
                >
                    {formatAgo(lastRun.timestamp, now)} ·{' '}
                </span>
                <span className="font-mono">{lastRun.label}</span>
            </span>
            <button
                onClick={handleRerun}
                disabled={disabled || starting}
                className="ml-auto shrink-0 flex items-center px-2.5 py-1 bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-textLink-foreground)] rounded border border-[var(--vscode-textLink-foreground)] disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--vscode-focusBorder)]"
                title={lastRun.fullRefresh ? 'Run again (asks for confirmation because of full refresh)' : 'Run again with the same options'}
            >
                {starting
                    ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Starting…</>
                    : <><RotateCcw className="w-3 h-3 mr-1" /> Run again</>}
            </button>
        </div>
    );
}
