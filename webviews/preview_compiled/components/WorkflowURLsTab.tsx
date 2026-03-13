import { useEffect, useState } from 'react';
import { WebviewState } from '../types';
import { ExternalLink, Trash2, Play, RefreshCw, CircleDashed, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { vscode } from '../utils/vscode';

interface WorkflowURLsTabProps {
    state: WebviewState;
}

export function WorkflowURLsTab({ state }: WorkflowURLsTabProps) {
    useEffect(() => {
        vscode.postMessage({ command: 'getWorkflowUrls' });
    }, []);

    const urls = state.workflowUrls || [];

    const handleClearUrls = () => {
        vscode.postMessage({ command: 'clearWorkflowUrls' });
    };

    const handleRunApi = () => {
        vscode.postMessage({ command: 'runFilesTagsWtOptionsApi' });
    };

    const handleRunWorkspace = () => {
        vscode.postMessage({ command: 'runFilesTagsWtOptionsInRemoteWorkspace' });
    };

    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefreshStatuses = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'refreshWorkflowStatuses' });
        setTimeout(() => setIsRefreshing(false), 1000);
    };

    const getStatusIcon = (status?: string | null) => {
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
    };

    const getStatusLabel = (status?: string | null) => {
        if (!status) { return 'UNKNOWN'; }
        return status;
    };

    return (
        <div className="flex flex-col space-y-4">
            <div className="flex flex-col gap-3 bg-[var(--vscode-sideBar-background)] p-4 rounded-lg border border-[var(--vscode-widget-border)] shadow-sm">
                <div className="text-sm">
                    <h3 className="font-semibold text-[var(--vscode-foreground)] mb-1">Trigger Execution via API</h3>
                    <p className="text-[var(--vscode-descriptionForeground)] text-xs text-balance">
                        Run file(s) or tag(s) by triggering an execution in GCP using your Dataform API.
                    </p>
                </div>
                
                <div className="flex gap-4 mt-1">
                    <div className="flex-1 flex flex-col gap-2">
                        <button
                            onClick={handleRunApi}
                            className="flex items-center justify-center space-x-1.5 py-1.5 px-3 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] disabled:opacity-50 rounded transition-colors text-xs font-medium"
                            title="Run execution using git branch"
                        >
                            <Play className="w-3.5 h-3.5" />
                            <span>Run from Git Commit</span>
                        </button>
                        <p className="text-[11px] text-[var(--vscode-descriptionForeground)] leading-relaxed">
                            Executes the committed code of your active git branch. Changes must be committed and pushed to the remote repository.
                        </p>
                    </div>

                    <div className="flex-1 flex flex-col gap-2">
                        <button
                            onClick={handleRunWorkspace}
                            className="flex items-center justify-center space-x-1.5 py-1.5 px-3 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] disabled:opacity-50 rounded transition-colors text-xs font-medium"
                            title="Run execution using workspace code"
                        >
                            <Play className="w-3.5 h-3.5" />
                            <span>Run from GCP Workspace</span>
                        </button>
                        <p className="text-[11px] text-[var(--vscode-descriptionForeground)] leading-relaxed">
                            Executes local changes by syncing them to the remote GCP Dataform workspace. Useful for testing without needing to commit.
                        </p>
                    </div>
                </div>
            </div>

            {urls.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center bg-[var(--vscode-sideBar-background)] p-3 rounded-md border border-[var(--vscode-widget-border)]">
                        <span className="font-medium text-sm text-[var(--vscode-foreground)]">Recent Executions ({urls.length})</span>
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={handleRefreshStatuses}
                                className="flex items-center space-x-1 px-2 py-1 text-xs text-[var(--vscode-textLink-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors"
                                title="Refresh execution statuses"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                                <span>Refresh Status</span>
                            </button>
                            <button
                                onClick={handleClearUrls}
                                className="flex items-center space-x-1 px-2 py-1 text-xs text-[var(--vscode-errorForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors border-l border-[var(--vscode-widget-border)] pl-3"
                                title="Clear execution history"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Clear History</span>
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {urls.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-[var(--vscode-descriptionForeground)] border border-[var(--vscode-widget-border)] rounded-md bg-[var(--vscode-sideBar-background)]">
                    <p>No workflow executions found.</p>
                    <p className="text-sm mt-2 text-[var(--vscode-descriptionForeground)]">URLs from new executions will appear here.</p>
                </div>
            ) : (
                <div className="overflow-x-auto border border-[var(--vscode-widget-border)] rounded-md">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="bg-[var(--vscode-sideBar-background)] border-b border-[var(--vscode-widget-border)]">
                                <th className="px-4 py-2 text-left font-medium text-[var(--vscode-descriptionForeground)] w-1/4">Time</th>
                                <th className="px-4 py-2 text-left font-medium text-[var(--vscode-descriptionForeground)]">Target Workspace</th>
                                <th className="px-4 py-2 text-left font-medium text-[var(--vscode-descriptionForeground)]">Action</th>
                                <th className="px-4 py-2 text-left font-medium text-[var(--vscode-descriptionForeground)]">Execution Mode</th>
                                <th className="px-4 py-2 text-left font-medium text-[var(--vscode-descriptionForeground)]">Status</th>
                                <th className="px-4 py-2 text-left font-medium text-[var(--vscode-descriptionForeground)]">Execution Options</th>
                                <th className="px-4 py-2 text-left font-medium text-[var(--vscode-descriptionForeground)] w-16">Link</th>
                            </tr>
                        </thead>
                        <tbody>
                            {urls.slice().reverse().map((item) => {
                                return (
                                <tr key={item.timestamp} className="border-b border-[var(--vscode-widget-border)] last:border-0 hover:bg-[var(--vscode-toolbar-hoverBackground)]">
                                    <td className="px-4 py-2 text-[var(--vscode-descriptionForeground)] whitespace-nowrap text-xs">
                                        {new Date(item.timestamp).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-2 text-[var(--vscode-foreground)] truncate max-w-sm">
                                        <span className="px-2 py-0.5 rounded-full bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] text-xs font-mono">
                                            {item.workspace || 'unknown'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2 text-[var(--vscode-descriptionForeground)]">
                                        {item.includedTags && item.includedTags.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                                {item.includedTags.map((tag: string, i: number) => (
                                                    <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border border-[var(--vscode-widget-border)]">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : item.includedTargets && item.includedTargets.length > 0 ? (
                                            item.includedTargets.length > 2 ? (
                                                <div className="relative group">
                                                    <span className="text-xs cursor-help underline decoration-dotted text-[var(--vscode-textLink-foreground)]">
                                                        {item.includedTargets.length} files
                                                    </span>
                                                    <div className="absolute z-10 hidden group-hover:block bottom-full mb-2 bg-[var(--vscode-sideBar-background)] border border-[var(--vscode-widget-border)] shadow-lg rounded-md p-2 w-max max-w-xs overflow-hidden">
                                                        <div className="max-h-48 overflow-y-auto pr-2">
                                                            <ul className="text-xs space-y-1">
                                                                {item.includedTargets.map((t: any, i: number) => (
                                                                    <li key={i} className="truncate" title={`${t.database}.${t.schema}.${t.name}`}>
                                                                        {t.schema}.{t.name}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-1 text-xs">
                                                    {item.includedTargets.map((t: any, i: number) => (
                                                        <span key={i} className="break-all" title={`${t.database}.${t.schema}.${t.name}`}>
                                                            {t.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )
                                        ) : (
                                            <span className="text-[var(--vscode-descriptionForeground)] opacity-60 text-[10px] italic">Full workspace</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2 text-[var(--vscode-descriptionForeground)] whitespace-nowrap text-xs">
                                        {item.executionMode === 'api_workspace' ? 'GCP Workspace' : 'gitCommitish'}
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="flex items-center space-x-1.5" title={`Status: ${item.state || 'UNKNOWN'}`}>
                                            {getStatusIcon(item.state)}
                                              <span className="text-xs font-mono text-[var(--vscode-descriptionForeground)]">
                                                {getStatusLabel(item.state)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="flex flex-wrap gap-1.5">
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                                    item.fullRefresh
                                                        ? 'bg-[var(--vscode-extensionIcon-preReleaseForeground)] opacity-30 border-[var(--vscode-extensionIcon-preReleaseForeground)] text-[var(--vscode-foreground)]'
                                                        : 'bg-[var(--vscode-sideBar-background)] border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
                                                }`}
                                            >
                                                Full Refresh
                                            </span>
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                                    item.includeDependencies
                                                        ? 'bg-[var(--vscode-extensionIcon-preReleaseForeground)] opacity-30 border-[var(--vscode-extensionIcon-preReleaseForeground)] text-[var(--vscode-foreground)]'
                                                        : 'bg-[var(--vscode-sideBar-background)] border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
                                                }`}
                                            >
                                                +Deps
                                            </span>
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                                    item.includeDependents
                                                        ? 'bg-[var(--vscode-extensionIcon-preReleaseForeground)] opacity-30 border-[var(--vscode-extensionIcon-preReleaseForeground)] text-[var(--vscode-foreground)]'
                                                        : 'bg-[var(--vscode-sideBar-background)] border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
                                                }`}
                                            >
                                                +Dependents
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <button
                                            onClick={() => vscode.postMessage({ command: 'openExternal', url: item.url })}
                                            className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] inline-flex items-center justify-center transition-colors"
                                            title="Open execution in GCP"
                                            aria-label="Open execution in GCP"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
