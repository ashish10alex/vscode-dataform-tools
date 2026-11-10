import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Eye, RefreshCw, Trash2 } from 'lucide-react';
import type { RunsHostMessage, RunsView } from '../../src/shared/panelContract';
import { runKey } from '../../src/shared/runPolling';
import { vscode } from '../preview_compiled/utils/vscode';
import { ROW_BUTTON } from '../preview_compiled/components/SummaryRow';
import { ApiRunRow } from './ApiRunRow';
import { RunDetail, Waiting } from './RunDetail';
import { RunList } from './RunList';

/*
 * The Runs view at the bottom: the runs of the workspace, newest first, beside the jobs of the one chosen. Runs
 * through the Dataform API start from its toolbar, and a workflow the extension did not start is watched from it.
 * The host keeps the runs current and sends them all whenever anything changes.
 */

const MUTED = 'text-[var(--vscode-descriptionForeground)]';
const BUTTON = 'inline-flex items-center gap-1 h-[24px] px-2 rounded text-xs border-0 cursor-pointer disabled:opacity-50 disabled:cursor-default';
const PRIMARY = 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]';
/** Below this width the list is above the run's jobs, not beside them */
const STACK_BELOW_PX = 560;

const EMPTY: RunsView = { history: [], progress: {}, problems: {}, watch: { looking: false }, backend: '' };

/** The view's width, as it changes */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(1000);
    useEffect(() => {
        const element = ref.current;
        if (!element) { return; }
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [ref, width];
}

export default function App() {
    const [view, setView] = useState<RunsView>(EMPTY);
    const [input, setInput] = useState('');
    const [ref, width] = useWidth();

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const message = event.data as RunsHostMessage | undefined;
            if (message?.type === 'runsState') { setView(message.view); }
        };
        window.addEventListener('message', onMessage);
        vscode.postMessage({ command: 'runs.ready' });
        return () => window.removeEventListener('message', onMessage);
    }, []);

    const dbt = view.backend === 'dbt';
    const watch = view.watch;
    const submit = (event: { preventDefault(): void }) => {
        event.preventDefault();
        if (input.trim() && !watch.looking) {
            vscode.postMessage({ command: 'watch.submit', input });
        }
    };

    const runs = view.history.slice().sort((a, b) => b.timestamp - a.timestamp);
    const chosen = runs.find((entry) => runKey(entry) === view.selected);
    const live = chosen ? view.progress[runKey(chosen)] : undefined;
    const stacked = width < STACK_BELOW_PX;

    return (
        <div ref={ref} className="h-full flex flex-col text-xs">
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--vscode-widget-border)]">
                {!dbt ? (
                    <form onSubmit={submit} className="flex-1 min-w-0 flex items-center gap-1.5">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Watch a workflow: paste its ID, or the URL of its page in the Cloud console"
                            aria-label="Workflow ID or URL"
                            spellCheck={false}
                            disabled={watch.looking}
                            className="flex-1 min-w-0 h-[24px] px-2 rounded bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border,var(--vscode-widget-border))] text-xs font-mono text-[var(--vscode-input-foreground)] placeholder:text-[var(--vscode-input-placeholderForeground)] focus:outline-none focus:border-[var(--vscode-focusBorder)]"
                        />
                        <button type="submit" className={clsx(BUTTON, PRIMARY)} disabled={watch.looking || !input.trim()} title="Follow this workflow until it ends, with the cost of each job. It is never cancelled">
                            <Eye className="w-3.5 h-3.5" />{watch.looking ? 'Looking…' : 'Watch'}
                        </button>
                    </form>
                ) : <span className={clsx('flex-1 min-w-0 truncate', MUTED)}>Runs with dbt build, with their BigQuery jobs</span>}
                {runs.length > 0 && (
                    <>
                        {!dbt && (
                            <button onClick={() => vscode.postMessage({ command: 'dataform.refreshWorkflowStatuses' })} className={ROW_BUTTON} title="Ask the Dataform API about every run again">
                                <RefreshCw className="w-3 h-3" /> Refresh
                            </button>
                        )}
                        <button onClick={() => vscode.postMessage({ command: 'dataform.clearWorkflowUrls' })} className={ROW_BUTTON} title="Clear the runs">
                            <Trash2 className="w-3 h-3" /> Clear
                        </button>
                    </>
                )}
            </div>
            {!dbt && <ApiRunRow gitState={view.apiRunGitState} />}

            {watch.looking && <Waiting>Looking up <span className="font-mono">{watch.lookingFor}</span>…</Waiting>}
            {watch.error && <p className="m-0 px-3 py-1 text-[var(--vscode-errorForeground)] break-words">{watch.error}</p>}
            {watch.note && <p className={clsx('m-0 px-3 py-1', MUTED)}>{watch.note}</p>}

            {runs.length === 0 ? (
                <p className={clsx('m-0 px-3 py-2', MUTED)}>
                    {dbt
                        ? 'No runs yet. Runs with dbt build appear here, with their BigQuery jobs.'
                        : 'No runs yet. Runs through the CLI and the Dataform API appear here, with what each BigQuery job cost. '
                            + 'A workflow this extension didn\'t start (a scheduled one, a colleague\'s) can be watched too: paste its ID above.'}
                </p>
            ) : (
                <div className={clsx('flex-1 min-h-0 flex', stacked ? 'flex-col' : 'flex-row')}>
                    <RunList
                        runs={runs}
                        selected={view.selected}
                        onSelect={(key) => vscode.postMessage({ command: 'runs.select', key })}
                        className={clsx(
                            'overflow-auto flex-shrink-0 border-[var(--vscode-widget-border)]',
                            stacked ? 'max-h-[40%] border-b' : 'w-[clamp(220px,32%,380px)] border-r',
                        )}
                    />
                    <div className="flex-1 min-w-0 min-h-0">
                        {chosen && (
                            <RunDetail
                                key={runKey(chosen)}
                                entry={live?.entry ?? chosen}
                                jobsLeft={live?.jobsLeft}
                                problem={view.problems[runKey(chosen)]}
                                cliRunHint={view.cliRunHint}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
