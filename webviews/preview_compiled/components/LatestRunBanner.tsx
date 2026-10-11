import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ExternalLink, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { PanelState, ActionCounts } from '../types';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';
import { formatDuration } from '../../../src/shared/jobTiming';
import { CancelWorkflowButton } from './CancelWorkflowButton';
import { SHOW_RUN_DETAILS_EVENT } from './RunStatusPill';
import { IncludedTargetsList } from './IncludedTargetsList';
import { RunViaTag, WorkflowActionsTable, getStatusIcon } from './WorkflowActionsTable';
import { RunStartSummary } from './RunStages';

interface LatestRunBannerProps {
    state: PanelState;
    submittingSince?: number | null;
}


const MUTED = 'text-[var(--vscode-descriptionForeground)]';
const ICON_BUTTON = 'grid place-items-center w-[22px] h-[22px] flex-shrink-0 rounded border-0 bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]';

/** How far a run has come, where its actions are not known one by one */
function countsLine(counts: ActionCounts | undefined, what: string): string | null {
    if (!counts || counts.total === 0) { return null; }
    const parts = [
        counts.running > 0 && `${counts.running} running`,
        counts.succeeded > 0 && `${counts.succeeded} succeeded`,
        counts.failed > 0 && `${counts.failed} failed`,
        counts.pending > 0 && `${counts.pending} pending`,
        counts.skipped > 0 && `${counts.skipped} skipped`,
    ].filter(Boolean);
    return `${counts.total} ${what}: ${parts.join(' · ')}`;
}

/**
 * What the open Last run row shows: one line on how the run was started, then its actions. The row itself says what
 * was run, how it ended and what it came to, so none of that is said again here.
 */
export function LatestRunBanner({ state, submittingSince }: LatestRunBannerProps) {
    // Full width covers the whole panel with the run details, giving the list room.
    const [fullWidth, setFullWidth] = useState(false);
    const items = state.dataform.workflowUrls || [];
    const latest = items.slice().sort((a, b) => b.timestamp - a.timestamp)[0];

    // The pill in the header asks for the details from wherever the panel is scrolled to
    const banner = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const show = () => banner.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        window.addEventListener(SHOW_RUN_DETAILS_EVENT, show);
        return () => window.removeEventListener(SHOW_RUN_DETAILS_EVENT, show);
    }, []);

    useEffect(() => {
        if (!fullWidth) { return; }
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFullWidth(false); } };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [fullWidth]);

    const isSubmitting = submittingSince !== null && submittingSince !== undefined && (!latest || latest.timestamp <= submittingSince);

    if (isSubmitting) {
        return (
            <div className={clsx('flex items-center gap-2 text-xs', MUTED)}>
                <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-[var(--vscode-textLink-foreground)]" />
                <span>Compiling and triggering on GCP. This usually takes 2-10 seconds.</span>
            </div>
        );
    }

    if (!latest) { return null; }

    const isTerminal = !!latest.state && TERMINAL_WORKFLOW_STATES.has(latest.state);
    const isCli = latest.executionMode === 'cli';
    const hasActions = (latest.actions?.length ?? 0) > 0;
    const manyTargets = !latest.includedTags?.length && (latest.includedTargets?.length ?? 0) > 1;
    const slotMs = latest.jobStatsSummary?.totalSlotMs;
    const counts = hasActions ? null : countsLine(latest.actionCounts, isCli ? 'BigQuery jobs' : 'actions');
    const tools = (
        <>
            {latest.url && (
                <button onClick={() => vscode.postMessage({ command: 'openExternal', url: latest.url })} className={ICON_BUTTON} title="Open in GCP" aria-label="Open in GCP">
                    <ExternalLink className="w-3.5 h-3.5" />
                </button>
            )}
            <button
                onClick={() => setFullWidth(v => !v)}
                className={ICON_BUTTON}
                title={fullWidth ? 'Exit full width (Esc)' : 'Show run details full width'}
                aria-label={fullWidth ? 'Exit full width' : 'Show run details full width'}
                aria-pressed={fullWidth}
            >
                {fullWidth ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
        </>
    );

    return (
        <div ref={banner} className={fullWidth ? 'fixed inset-0 z-50 flex flex-col overflow-auto bg-[var(--vscode-editor-background)] pt-3' : 'flex flex-col'}>
            <div className={clsx('flex flex-col gap-0.5 pb-1.5 text-[11.5px]', MUTED, fullWidth && 'px-3')}>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    {/* Full width covers the row, which has how the run ended and the button that stops it */}
                    {fullWidth && <>{getStatusIcon(latest.state)}<span className="text-[var(--vscode-foreground)]">{latest.state || 'UNKNOWN'}</span><CancelWorkflowButton entry={latest} /><span>·</span></>}
                    <span title={new Date(latest.timestamp).toISOString()}>started {new Date(latest.timestamp).toLocaleString()}</span>
                    <span>·</span>
                    <RunViaTag entry={latest} />
                    <span>
                        {[
                            isCli ? null : `${latest.executionMode === 'api_workspace' ? 'workspace' : 'git commit'} ${latest.workspace || 'unknown'}`,
                            latest.includeDependencies ? '+deps' : null,
                            latest.includeDependents ? '+dependents' : null,
                            latest.fullRefresh ? 'full refresh' : null,
                            isTerminal && slotMs !== undefined ? `slot time ${formatDuration(slotMs)}` : null,
                        ].filter(Boolean).join(' · ')}
                    </span>
                    {!hasActions && <span className="ml-auto flex items-center gap-1">{tools}</span>}
                </div>
                <RunStartSummary entry={latest} />
                {manyTargets && <IncludedTargetsList targets={latest.includedTargets!} typeCounts={latest.includedTargetTypes} />}
                {counts && <div>{counts}</div>}
                {latest.jobsNote && <div>{latest.jobsNote}</div>}
            </div>
            {/* The list runs from edge to edge of the row, as the rows of the panel do */}
            <div className={fullWidth ? 'flex-1 min-h-0 flex flex-col' : '-mx-3'}>
                <WorkflowActionsTable entry={latest} tools={tools} className={fullWidth ? 'flex-1 min-h-[12rem] overflow-auto' : 'max-h-[28rem] overflow-auto'} />
            </div>
        </div>
    );
}
