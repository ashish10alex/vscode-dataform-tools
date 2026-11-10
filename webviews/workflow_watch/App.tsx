import { ReactNode, useEffect, useState } from 'react';
import clsx from 'clsx';
import { ExternalLink, Eye, Loader2, Square } from 'lucide-react';
import type { WatchHostMessage, WatchView } from '../../src/shared/panelContract';
import { formatDuration } from '../../src/shared/jobTiming';
import { vscode } from '../preview_compiled/utils/vscode';
import { WorkflowActionsTable, getStatusIcon, useTick } from '../preview_compiled/components/WorkflowActionsTable';

/*
 * The Dataform Workflow view: paste a workflow the extension did not start and see what each action's BigQuery job
 * cost. The host follows the workflow until it ends and sends each new look at it.
 */

const MUTED = 'text-[var(--vscode-descriptionForeground)]';
const BUTTON = 'inline-flex items-center gap-1 h-[24px] px-2 rounded text-xs border-0 cursor-pointer disabled:opacity-50 disabled:cursor-default';
const PRIMARY = 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]';
/** A line that says what is being waited for, with a spinner */
function Waiting({ children }: { children: ReactNode }) {
    return (
        <p className={clsx('m-0 px-3 py-1 flex items-center gap-1.5', MUTED)} role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
            <span className="min-w-0 break-words">{children}</span>
        </p>
    );
}

const SECONDARY = 'bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]';

/** How long the workflow took, or has taken so far while it is followed */
function elapsedMs(view: WatchView): number | undefined {
    const entry = view.entry;
    if (!entry?.invocationStartTime) { return undefined; }
    const end = entry.invocationEndTime ?? (view.watching ? Date.now() : undefined);
    return end === undefined ? undefined : end - entry.invocationStartTime;
}

export default function App() {
    const [view, setView] = useState<WatchView>({ watching: false, looking: false });
    const [input, setInput] = useState('');

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const message = event.data as WatchHostMessage | undefined;
            if (message?.type === 'watchState') { setView(message.view); }
        };
        window.addEventListener('message', onMessage);
        vscode.postMessage({ command: 'watch.ready' });
        return () => window.removeEventListener('message', onMessage);
    }, []);

    useTick(view.watching);

    const submit = (event: { preventDefault(): void }) => {
        event.preventDefault();
        if (input.trim() && !view.looking) {
            vscode.postMessage({ command: 'watch.submit', input });
        }
    };

    // While a paste is looked up, the workflow watched before is not shown as if it were the one asked for
    const entry = view.looking ? undefined : view.entry;
    const jobsLeft = view.jobsLeft ?? 0;
    const elapsed = elapsedMs(view);
    const summary = entry?.jobStatsSummary;

    return (
        <div className="h-full flex flex-col text-xs">
            <form onSubmit={submit} className="flex items-center gap-1.5 px-3 py-1.5">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Paste a workflow ID, or the URL of its page in the Cloud console"
                    aria-label="Workflow ID or URL"
                    spellCheck={false}
                    disabled={view.looking}
                    className="flex-1 min-w-0 h-[24px] px-2 rounded bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border,var(--vscode-widget-border))] text-xs font-mono text-[var(--vscode-input-foreground)] placeholder:text-[var(--vscode-input-placeholderForeground)] focus:outline-none focus:border-[var(--vscode-focusBorder)]"
                />
                <button type="submit" className={clsx(BUTTON, PRIMARY)} disabled={view.looking || !input.trim()} title="Follow this workflow until it ends, with the cost of each job">
                    <Eye className="w-3.5 h-3.5" />{view.looking ? 'Looking…' : 'Watch'}
                </button>
                {view.watching && (
                    <button type="button" className={clsx(BUTTON, SECONDARY)} onClick={() => vscode.postMessage({ command: 'watch.stop' })} title="Stop following it. The workflow is not cancelled: it carries on in GCP">
                        <Square className="w-3 h-3" />Stop watching
                    </button>
                )}
            </form>

            {view.looking && <Waiting>Looking up <span className="font-mono">{view.lookingFor}</span>…</Waiting>}
            {view.error && <p className="m-0 px-3 pb-1.5 text-[var(--vscode-errorForeground)] break-words">{view.error}</p>}

            {entry ? (
                <>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 px-3 pb-1.5">
                        {getStatusIcon(entry.state)}
                        <span>{entry.state || 'UNKNOWN'}</span>
                        <span className={MUTED}>·</span>
                        <span className="font-mono truncate max-w-[28rem]" title={entry.workflowInvocationId}>{entry.workflowInvocationId}</span>
                        <span className={MUTED} title="Repository, project and location">{entry.repositoryName} ({entry.projectId}, {entry.location})</span>
                        {elapsed !== undefined && <><span className={MUTED}>·</span><span>{formatDuration(elapsed)}</span></>}
                        {summary?.costLabel && <><span className={MUTED}>·</span><span title={summary.bytesBilledLabel ? `${summary.bytesBilledLabel} billed` : undefined}>{summary.costLabel}</span></>}
                        {entry.executionMode === 'external' && <span className={clsx('px-1.5 py-0.5 rounded text-[10px] border border-[var(--vscode-widget-border)]', MUTED)} title="A workflow this extension didn't start; watched read-only">external</span>}
                        {jobsLeft > 0 && (
                            <span className={clsx('inline-flex items-center gap-1', MUTED)} role="status">
                                <Loader2 className="w-3 h-3 animate-spin" />reading the cost of {jobsLeft} job{jobsLeft === 1 ? '' : 's'}
                            </span>
                        )}
                        {view.watching && <span className={MUTED}>watching, checks every 5s</span>}
                        {view.note && <span className={MUTED}>{view.note}</span>}
                        <span className="flex-1" />
                        {entry.url && (
                            <button type="button" className={clsx(BUTTON, 'bg-transparent text-[var(--vscode-textLink-foreground)] hover:underline px-0')} onClick={() => vscode.postMessage({ command: 'watch.openInConsole' })} title="Open the workflow in the Cloud console">
                                <ExternalLink className="w-3.5 h-3.5" />Open in console
                            </button>
                        )}
                    </div>
                    <div className="flex-1 min-h-0 flex flex-col">
                        {(entry.actions?.length ?? 0) > 0
                            ? <WorkflowActionsTable entry={entry} className="flex-1 min-h-0 overflow-auto" costsLoading={jobsLeft > 0} order="cost" />
                            : view.readingActions || !entry.actions
                                ? <Waiting>Reading the workflow's actions…</Waiting>
                                : <p className={clsx('m-0 px-3', MUTED)}>{view.watching ? 'No actions yet.' : 'The workflow has no actions.'}</p>}
                    </div>
                </>
            ) : !view.looking && !view.error && (
                <p className={clsx('m-0 px-3', MUTED)}>
                    Watch a workflow this extension didn't start (a scheduled one, a colleague's, one started from the console). It is added to the run history as
                    external, with what each action's BigQuery job cost; if it is still running, it is followed until it ends. Watching only reads: it never cancels anything.
                </p>
            )}
        </div>
    );
}
