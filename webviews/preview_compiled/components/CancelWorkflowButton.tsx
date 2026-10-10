import { useEffect, useState } from 'react';
import type { HostEvent } from "../../../src/shared/panelContract";
import { CircleStop, Loader2 } from 'lucide-react';
import { WorkflowUrlEntry } from '../types';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';

/**
 * Labelled stop button for an invocation that is still running; renders nothing once it can no longer be cancelled.
 * Placed beside the run's status rather than among the view icons, so it is hard to hit by accident.
 * Shows "Stopping…" from the click until the entry reaches CANCELING, or reverts if the request fails.
 */
export function CancelWorkflowButton({ entry }: { entry: WorkflowUrlEntry }) {
    const [requested, setRequested] = useState(false);

    useEffect(() => {
        if (!requested) { return; }
        const handleMessage = (event: MessageEvent) => {
            const sent = event.data as HostEvent | undefined;
            if (sent?.event === 'workflow cancel failed' && sent.workflowInvocationId === entry.workflowInvocationId) {
                setRequested(false);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [requested, entry.workflowInvocationId]);

    const cancellable = !!entry.workflowInvocationId
        && entry.state !== 'CANCELING'
        && !(entry.state && TERMINAL_WORKFLOW_STATES.has(entry.state));
    if (!cancellable) { return null; }

    if (requested) {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--vscode-descriptionForeground)]" role="status">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Stopping…
            </span>
        );
    }

    return (
        <button
            onClick={() => {
                setRequested(true);
                if (entry.workflowInvocationId) {
                    vscode.postMessage({ command: 'dataform.cancelWorkflowInvocation', workflowInvocationId: entry.workflowInvocationId });
                }
            }}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-[var(--vscode-errorForeground)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--vscode-errorForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors"
            title={entry.executionMode === 'cli'
                ? 'Stop the run: its running BigQuery jobs are cancelled, and those it starts until it ends (asks first)'
                : 'Stop the run: running actions are cancelled and pending ones skipped (cancels the Dataform workflow invocation)'}
            aria-label="Stop workflow run"
        >
            <CircleStop className="w-3 h-3" />
            Stop run
        </button>
    );
}
