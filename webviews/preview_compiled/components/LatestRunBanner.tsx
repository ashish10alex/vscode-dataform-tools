import { useMemo, useState } from 'react';
import { CircleDashed, CheckCircle2, XCircle, RefreshCw, Clock, ChevronRight, ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { ColumnDef } from '@tanstack/react-table';
import { WebviewState, ActionCounts, WorkflowAction } from '../types';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';
import { DataTable } from '../../components/ui/data-table';

interface LatestRunBannerProps {
    state: WebviewState;
    submittingSince?: number | null;
}

function getStatusIcon(status?: string | null) {
    if (!status) { return <CircleDashed className="w-3.5 h-3.5 text-[var(--vscode-descriptionForeground)]" />; }
    switch (status) {
        case 'SUCCEEDED':
            return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--vscode-extensionIcon-preReleaseForeground)]" />;
        case 'FAILED':
        case 'CANCELLED':
            return <XCircle className="w-3.5 h-3.5 text-[var(--vscode-errorForeground)]" />;
        case 'RUNNING':
            return <RefreshCw className="w-3.5 h-3.5 text-[var(--vscode-textLink-foreground)] animate-spin" />;
        default:
            return <Clock className="w-3.5 h-3.5 text-[var(--vscode-editorMarkerNavigationWarning-foreground)]" />;
    }
}

type BadgeTone = 'link' | 'success' | 'error' | 'muted';

function CountBadge({ tone, label, count }: { tone: BadgeTone; label: string; count: number }) {
    const toneClass =
        tone === 'success' ? 'text-[var(--vscode-extensionIcon-preReleaseForeground)] border-[var(--vscode-extensionIcon-preReleaseForeground)]' :
        tone === 'error' ? 'text-[var(--vscode-errorForeground)] border-[var(--vscode-errorForeground)]' :
        tone === 'link' ? 'text-[var(--vscode-textLink-foreground)] border-[var(--vscode-textLink-foreground)]' :
        'text-[var(--vscode-descriptionForeground)] border-[var(--vscode-widget-border)]';
    return (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${toneClass}`}>
            {label}: {count}
        </span>
    );
}

function renderCountBadges(counts: ActionCounts | undefined) {
    if (!counts || counts.total === 0) { return null; }
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-[var(--vscode-descriptionForeground)]">Actions ({counts.total}):</span>
            {counts.running > 0 && <CountBadge tone="link" label="Running" count={counts.running} />}
            {counts.succeeded > 0 && <CountBadge tone="success" label="Succeeded" count={counts.succeeded} />}
            {counts.failed > 0 && <CountBadge tone="error" label="Failed" count={counts.failed} />}
            {counts.pending > 0 && <CountBadge tone="muted" label="Pending" count={counts.pending} />}
            {counts.skipped > 0 && <CountBadge tone="muted" label="Skipped" count={counts.skipped} />}
        </div>
    );
}

const actionColumns: ColumnDef<WorkflowAction>[] = [
    {
        accessorKey: 'target',
        header: 'Target',
        size: 320,
        cell: ({ row }) => (
            <span className="font-mono text-xs text-[var(--vscode-foreground)] break-all">{row.original.target}</span>
        ),
    },
    {
        accessorKey: 'state',
        header: 'State',
        size: 140,
        cell: ({ row }) => (
            <span className="inline-flex items-center gap-1">
                {getStatusIcon(row.original.state)}
                <span className="font-mono text-[10px] text-[var(--vscode-descriptionForeground)]">{row.original.state}</span>
            </span>
        ),
    },
    {
        accessorKey: 'failureReason',
        header: 'Failure Reason',
        cell: ({ row }) => (
            <span className="text-[var(--vscode-errorForeground)] whitespace-pre-wrap break-words text-xs">
                {row.original.failureReason || ''}
            </span>
        ),
    },
];

export function LatestRunBanner({ state, submittingSince }: LatestRunBannerProps) {
    const [expanded, setExpanded] = useState(false);
    const items = state.workflowUrls || [];
    const latest = items.slice().sort((a, b) => b.timestamp - a.timestamp)[0];
    const actionRows = useMemo<WorkflowAction[]>(() => latest?.actions ?? [], [latest?.actions]);

    const isSubmitting = submittingSince != null && (!latest || latest.timestamp <= submittingSince);

    if (isSubmitting) {
        return (
            <div className="mt-3 flex items-center gap-2 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] p-2.5 text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--vscode-textLink-foreground)]" />
                <span className="text-[var(--vscode-foreground)]">Submitting workflow invocation…</span>
                <span className="text-[var(--vscode-descriptionForeground)]">Compiling and triggering on GCP. This usually takes 2-10 seconds.</span>
            </div>
        );
    }

    if (!latest) { return null; }

    const isTerminal = !!latest.state && TERMINAL_WORKFLOW_STATES.has(latest.state);
    const elapsedSec = Math.max(0, Math.floor((Date.now() - latest.timestamp) / 1000));

    return (
        <div className="mt-3 flex flex-col gap-2 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] p-2.5">
            <div className="flex items-center gap-2 text-xs">
                <button
                    onClick={() => setExpanded(v => !v)}
                    className="p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)]"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide run details' : 'Show run details'}
                    title={expanded ? 'Hide run details' : 'Show run details'}
                >
                    {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                {getStatusIcon(latest.state)}
                <span className="font-mono text-[var(--vscode-foreground)]">
                    Latest API run: {latest.workspace || '(unknown workspace)'} · {latest.state || 'UNKNOWN'}
                </span>
                <span
                    className="text-[var(--vscode-descriptionForeground)]"
                    title={new Date(latest.timestamp).toISOString()}
                >
                    · started {new Date(latest.timestamp).toLocaleString()}
                </span>
                {!isTerminal && (
                    <span className="text-[var(--vscode-descriptionForeground)]">· {elapsedSec}s elapsed</span>
                )}
                <button
                    onClick={() => vscode.postMessage({ command: 'openExternal', url: latest.url })}
                    className="ml-auto text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] inline-flex items-center gap-1 p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                    title="Open in GCP"
                    aria-label="Open in GCP"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                </button>
            </div>

            {renderCountBadges(latest.actionCounts)}

            {expanded && (
                <div className="flex flex-col gap-3 mt-1 pt-2 border-t border-[var(--vscode-widget-border)]">
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                        <span className="text-[var(--vscode-descriptionForeground)]">Time</span>
                        <span className="text-[var(--vscode-foreground)]">{new Date(latest.timestamp).toLocaleString()}</span>

                        <span className="text-[var(--vscode-descriptionForeground)]">Target Workspace</span>
                        <span>
                            <span className="px-2 py-0.5 rounded-full bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] text-xs font-mono">
                                {latest.workspace || 'unknown'}
                            </span>
                        </span>

                        <span className="text-[var(--vscode-descriptionForeground)]">Action</span>
                        <span className="text-[var(--vscode-foreground)]">
                            {latest.includedTags && latest.includedTags.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                    {latest.includedTags.map((tag, i) => (
                                        <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border border-[var(--vscode-widget-border)]">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            ) : latest.includedTargets && latest.includedTargets.length > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                    {latest.includedTargets.map((t: any, i: number) => (
                                        <span key={i} className="break-all" title={`${t.database}.${t.schema}.${t.name}`}>
                                            {t.schema}.{t.name}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <span className="text-[var(--vscode-descriptionForeground)] opacity-60 italic">Full workspace</span>
                            )}
                        </span>

                        <span className="text-[var(--vscode-descriptionForeground)]">Execution Mode</span>
                        <span className="text-[var(--vscode-foreground)]">
                            {latest.executionMode === 'api_workspace' ? 'GCP Workspace' : 'gitCommitish'}
                        </span>

                        <span className="text-[var(--vscode-descriptionForeground)]">Execution Options</span>
                        <span>
                            <div className="flex flex-wrap gap-1.5">
                                <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                        latest.fullRefresh
                                            ? 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] border-[var(--vscode-badge-background)]'
                                            : 'bg-[var(--vscode-sideBar-background)] border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
                                    }`}
                                >
                                    Full Refresh
                                </span>
                                <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                        latest.includeDependencies
                                            ? 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] border-[var(--vscode-badge-background)]'
                                            : 'bg-[var(--vscode-sideBar-background)] border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
                                    }`}
                                >
                                    +Deps
                                </span>
                                <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                        latest.includeDependents
                                            ? 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] border-[var(--vscode-badge-background)]'
                                            : 'bg-[var(--vscode-sideBar-background)] border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
                                    }`}
                                >
                                    +Dependents
                                </span>
                            </div>
                        </span>
                    </div>

                    {actionRows.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <div className="text-xs font-medium text-[var(--vscode-foreground)]">
                                Actions ({actionRows.length})
                            </div>
                            <div className="max-h-[28rem] overflow-auto">
                                <DataTable
                                    columns={actionColumns}
                                    data={actionRows}
                                    paginated={false}
                                    autoFocusColumnId="target"
                                    initialSorting={[{ id: 'state', desc: false }]}
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
