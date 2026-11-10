import { useState } from 'react';
import clsx from 'clsx';
import { Cloud, GitBranch, Play } from 'lucide-react';
import { vscode } from '../preview_compiled/utils/vscode';
import { ROW_LABEL, ROW_PRIMARY_BUTTON } from '../preview_compiled/components/SummaryRow';
import { ApiRunGitChip } from '../preview_compiled/components/ApiRunGitChip';
import { API_COLOR } from '../preview_compiled/components/RunBackendSwitch';
import { ApiRunGitState, describeApiRunGitState } from '../../src/shared/apiRunGitState';

/*
 * The API run row of the Runs view: whether a run through the Dataform API runs the committed code of the git remote
 * or the local files synced to a GCP workspace, what that would use, and the button that asks for files or tags.
 */

type RunSource = "git" | "workspace";
const RUN_SOURCES = [
    { source: "git", label: "Git commit", Icon: GitBranch, title: "Run the committed code of your active git branch, as it is on the git remote" },
    { source: "workspace", label: "Workspace", Icon: Cloud, title: "Run your local files, by syncing them to the remote GCP Dataform workspace. Useful for testing without a commit" },
] as const;

/** What a run from the git remote would use, in a sentence. The chip beside it has what it would leave out */
export function gitRunLine(state: ApiRunGitState | undefined): string {
    if (!state || state.kind === "unavailable") {
        return "Runs the committed code of your active git branch, as it is on the git remote";
    }
    if (state.kind === "noUpstream") {
        return "Push the branch first: the Dataform API runs it as it is on the git remote";
    }
    const leftOut = state.uncommitted.length > 0 || state.unpushedFiles.length > 0;
    const behind = state.behind > 0 ? `, which has ${state.behind} commit${state.behind === 1 ? "" : "s"} you don't have locally` : "";
    return leftOut ? `Runs ${state.upstream}, not your local files${behind}` : `Runs ${state.upstream}${behind || ", which matches your local files"}`;
}

export function ApiRunRow({ gitState }: { gitState: ApiRunGitState | undefined }) {
    const handleRunApi = () => {
        vscode.postMessage({ command: 'dataform.runWithOptions', workspace: false });
    };

    /** Where the next run through the API comes from: the switch chooses, and one line says what that one would use */
    const [source, setSource] = useState<RunSource>("git");
    const gitSummary = describeApiRunGitState(gitState);
    // The workspace a run syncs to has the name of the branch
    const localBranch = gitState && gitState.kind !== "unavailable" ? gitState.branch : undefined;

    const handleRunWorkspace = () => {
        vscode.postMessage({ command: 'dataform.runWithOptions', workspace: true });
    };

    return (
        <div className="border-b border-[var(--vscode-widget-border)] text-[12.5px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-h-[30px] px-3 py-[3px]">
                <span className={ROW_LABEL}>API run</span>
                <div role="radiogroup" aria-label="Run from" className="inline-flex items-center h-6 p-[2px] rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] flex-shrink-0">
                    {RUN_SOURCES.map(({ source: option, label, Icon, title }) => (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={option === source}
                            onClick={() => setSource(option)}
                            title={title}
                            // In the colour the Dataform API has in the Run row of the compiled query
                            style={option === source ? { background: `color-mix(in srgb, ${API_COLOR} 50%, transparent)` } : undefined}
                            className={clsx(
                                "flex items-center gap-1 h-full px-1.5 rounded-sm border-0 text-xs whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]",
                                option === source
                                    ? "text-[var(--vscode-foreground)] font-medium"
                                    : "bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
                            )}
                        >
                            <Icon className="w-3 h-3" /> {label}
                        </button>
                    ))}
                </div>
                <span className="flex-1" />
                <button
                    onClick={source === "git" ? handleRunApi : handleRunWorkspace}
                    className={ROW_PRIMARY_BUTTON}
                    title={source === "git" ? "Choose files or tags, and run them from the branch on the git remote" : "Choose files or tags, and run them from your local files, synced to the GCP workspace"}
                >
                    <Play className="w-3 h-3" /> Run…
                </button>
            </div>
            {/* What the chosen run would use: one line, of the one that is chosen */}
            <div data-run-source={source} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 pb-1.5 min-[520px]:pl-[82px] text-xs text-[var(--vscode-descriptionForeground)]">
                {source === "git" ? (
                    <>
                        {gitSummary && gitSummary.tone !== "muted" && <ApiRunGitChip state={gitState} />}
                        <span title={gitSummary?.tooltip}>{gitRunLine(gitState)}</span>
                    </>
                ) : (
                    <span>
                        Runs your local files, uncommitted changes included, synced to the GCP workspace
                        {localBranch ? <> <span className="font-mono text-[var(--vscode-foreground)]">{localBranch}</span></> : " named after your git branch"}
                    </span>
                )}
            </div>
        </div>
    );
}
