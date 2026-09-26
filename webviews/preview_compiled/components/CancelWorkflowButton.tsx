import { CircleStop } from 'lucide-react';
import { WorkflowUrlEntry } from '../types';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';

/** Stop button for an invocation that is still running; renders nothing once it can no longer be cancelled. */
export function CancelWorkflowButton({ entry }: { entry: WorkflowUrlEntry }) {
    const cancellable = !!entry.workflowInvocationId
        && entry.state !== 'CANCELING'
        && !(entry.state && TERMINAL_WORKFLOW_STATES.has(entry.state));
    if (!cancellable) { return null; }
    return (
        <button
            onClick={() => vscode.postMessage({ command: 'cancelWorkflowInvocation', value: { workflowInvocationId: entry.workflowInvocationId } })}
            className="text-[var(--vscode-errorForeground)] p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] inline-flex items-center justify-center transition-colors"
            title="Cancel workflow invocation"
            aria-label="Cancel workflow invocation"
        >
            <CircleStop className="w-3.5 h-3.5" />
        </button>
    );
}
