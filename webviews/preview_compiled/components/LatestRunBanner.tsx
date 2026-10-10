import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, ExternalLink, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { PanelState, ActionCounts } from '../types';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';
import { formatDuration } from '../../../src/shared/jobTiming';
import { CancelWorkflowButton } from './CancelWorkflowButton';
import { SHOW_RUN_DETAILS_EVENT } from './RunStatusPill';
import { IncludedTargetsList } from './IncludedTargetsList';
import { RunViaTag, WorkflowActionsTable, executionModeLabel, useTick, getStatusIcon, workflowDurationMs } from './WorkflowActionsTable';

interface LatestRunBannerProps {
    state: PanelState;
    submittingSince?: number | null;
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

function CountBadgeText({ label, value }: { label: string; value?: string }) {
    if (!value) { return null; }
    return (
        <span className="px-1.5 py-0.5 rounded font-medium border border-[var(--vscode-widget-border)]">
            {label}: {value}
        </span>
    );
}

function renderCountBadges(counts: ActionCounts | undefined, what: string) {
    if (!counts || counts.total === 0) { return null; }
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-[var(--vscode-descriptionForeground)]">{what} ({counts.total}):</span>
            {counts.running > 0 && <CountBadge tone="link" label="Running" count={counts.running} />}
            {counts.succeeded > 0 && <CountBadge tone="success" label="Succeeded" count={counts.succeeded} />}
            {counts.failed > 0 && <CountBadge tone="error" label="Failed" count={counts.failed} />}
            {counts.pending > 0 && <CountBadge tone="muted" label="Pending" count={counts.pending} />}
            {counts.skipped > 0 && <CountBadge tone="muted" label="Skipped" count={counts.skipped} />}
        </div>
    );
}


export function LatestRunBanner({ state, submittingSince }: LatestRunBannerProps) {
    const [expanded, setExpanded] = useState(false);
    // Full width covers the whole panel with the run details, giving the actions table room.
    const [fullWidth, setFullWidth] = useState(false);
    const showDetails = expanded || fullWidth;
    const items = state.dataform.workflowUrls || [];
    const latest = items.slice().sort((a, b) => b.timestamp - a.timestamp)[0];
    const totalDurationMs = workflowDurationMs(latest);
    // A CLI run's entry is sent only when its jobs change, so the time it has run for is counted here
    useTick(latest?.executionMode === 'cli' && !(latest.state && TERMINAL_WORKFLOW_STATES.has(latest.state)));

    // The pill in the header asks for the details from wherever the panel is scrolled to
    const banner = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const show = () => {
            setExpanded(true);
            banner.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        window.addEventListener(SHOW_RUN_DETAILS_EVENT, show);
        return () => window.removeEventListener(SHOW_RUN_DETAILS_EVENT, show);
    }, []);

    useEffect(() => {
        if (!fullWidth) { return; }
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFullWidth(false); } };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [fullWidth]);

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
    const isCli = latest.executionMode === 'cli';
    const elapsedSec = Math.max(0, Math.floor((Date.now() - latest.timestamp) / 1000));

    return (
        <div ref={banner} className={fullWidth
            ? 'fixed inset-0 z-50 flex flex-col gap-2 overflow-auto bg-[var(--vscode-editor-background)] p-4'
            : 'mt-3 flex flex-col gap-2 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] p-2.5'}>
            <div className="flex items-center gap-2 text-xs">
                {!fullWidth && <button
                    onClick={() => setExpanded(v => !v)}
                    className="p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)]"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide run details' : 'Show run details'}
                    title={expanded ? 'Hide run details' : 'Show run details'}
                >
                    {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>}
                {getStatusIcon(latest.state)}
                <span className="font-mono text-[var(--vscode-foreground)]">
                    Latest run: {isCli ? '' : `${latest.workspace || '(unknown workspace)'} · `}{latest.state || 'UNKNOWN'}
                </span>
                <RunViaTag entry={latest} />
                <span
                    className="text-[var(--vscode-descriptionForeground)]"
                    title={new Date(latest.timestamp).toISOString()}
                >
                    · started {new Date(latest.timestamp).toLocaleString()}
                </span>
                {!isTerminal && (
                    <span className="text-[var(--vscode-descriptionForeground)]">· {elapsedSec}s elapsed</span>
                )}
                <CancelWorkflowButton entry={latest} />
                <span className="ml-auto" />
                {latest.url && <button
                    onClick={() => vscode.postMessage({ command: 'openExternal', url: latest.url })}
                    className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] inline-flex items-center gap-1 p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                    title="Open in GCP"
                    aria-label="Open in GCP"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                </button>}
                <button
                    onClick={() => setFullWidth(v => !v)}
                    className="text-[var(--vscode-foreground)] p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                    title={fullWidth ? 'Exit full width (Esc)' : 'Show run details full width'}
                    aria-label={fullWidth ? 'Exit full width' : 'Show run details full width'}
                    aria-pressed={fullWidth}
                >
                    {fullWidth ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
            </div>

            {renderCountBadges(latest.actionCounts, isCli ? 'BigQuery jobs' : 'Actions')}

            {latest.jobsNote && (
                <div className="text-[11px] text-[var(--vscode-descriptionForeground)]">{latest.jobsNote}</div>
            )}

            {isTerminal && (latest.jobStatsSummary || totalDurationMs !== undefined) && (
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--vscode-descriptionForeground)]">
                    <CountBadgeText label="Duration" value={totalDurationMs === undefined ? undefined : formatDuration(totalDurationMs)} />
                    {latest.jobStatsSummary && (
                        <>
                            <span>BigQuery:</span>
                            <CountBadgeText label="Slot time" value={latest.jobStatsSummary.totalSlotMs === undefined ? undefined : formatDuration(latest.jobStatsSummary.totalSlotMs)} />
                            <CountBadgeText label="Billed" value={latest.jobStatsSummary.bytesBilledLabel} />
                            <CountBadgeText label="Est. cost" value={latest.jobStatsSummary.costLabel} />
                        </>
                    )}
                </div>
            )}

            {showDetails && (
                <div className={`flex flex-col gap-3 mt-1 pt-2 border-t border-[var(--vscode-widget-border)] ${fullWidth ? 'flex-1 min-h-0' : ''}`}>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                        <span className="text-[var(--vscode-descriptionForeground)]">Time</span>
                        <span className="text-[var(--vscode-foreground)]">{new Date(latest.timestamp).toLocaleString()}</span>

                        {!isCli && <>
                            <span className="text-[var(--vscode-descriptionForeground)]">Target Workspace</span>
                            <span>
                                <span className="px-2 py-0.5 rounded-full bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] text-xs font-mono">
                                    {latest.workspace || 'unknown'}
                                </span>
                            </span>
                        </>}

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
                                <IncludedTargetsList targets={latest.includedTargets} typeCounts={latest.includedTargetTypes} />
                            ) : (
                                <span className="text-[var(--vscode-descriptionForeground)] opacity-60 italic">Full workspace</span>
                            )}
                        </span>

                        <span className="text-[var(--vscode-descriptionForeground)]">Execution Mode</span>
                        <span className="text-[var(--vscode-foreground)]">
                            {executionModeLabel(latest)}
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

                    <div className={`flex flex-col gap-1 ${fullWidth ? 'flex-1 min-h-0' : ''}`}>
                        <WorkflowActionsTable entry={latest} className={fullWidth ? 'flex-1 min-h-[12rem] overflow-auto' : 'max-h-[28rem] overflow-auto'} />
                    </div>
                </div>
            )}
        </div>
    );
}
