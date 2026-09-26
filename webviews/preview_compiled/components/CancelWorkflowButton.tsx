import { useEffect, useState } from 'react';
import { CircleStop, Loader2 } from 'lucide-react';
import { WorkflowUrlEntry } from '../types';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';

/**
 * Stop button for an invocation that is still running; renders nothing once it can no longer be cancelled.
 * Shows "Cancelling…" from the click until the entry reaches CANCELING, or reverts if the request fails.
 */
export function CancelWorkflowButton({ entry }: { entry: WorkflowUrlEntry }) {
    const [requested, setRequested] = useState(false);

    useEffect(() => {
        if (!requested) { return; }
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.cancelWorkflowInvocationFailed === entry.workflowInvocationId) {
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
                Cancelling…
            </span>
        );
    }

    return (
        <button
            onClick={() => {
                setRequested(true);
                vscode.postMessage({ command: 'cancelWorkflowInvocation', value: { workflowInvocationId: entry.workflowInvocationId } });
            }}
            className="text-[var(--vscode-errorForeground)] p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] inline-flex items-center justify-center transition-colors"
            title="Cancel workflow invocation"
            aria-label="Cancel workflow invocation"
        >
            <CircleStop className="w-3.5 h-3.5" />
        </button>
    );
}
