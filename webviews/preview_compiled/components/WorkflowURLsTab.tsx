import { useEffect } from 'react';
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

    const handleRefreshStatuses = () => {
        vscode.postMessage({ command: 'refreshWorkflowStatuses' });
    };

    const getStatusIcon = (status?: string | null) => {
        if (!status) return <CircleDashed className="w-3.5 h-3.5 text-zinc-400" />;
        switch (status) {
            case 'SUCCEEDED':
                return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
            case 'FAILED':
            case 'CANCELLED':
                return <XCircle className="w-3.5 h-3.5 text-red-500" />;
            case 'RUNNING':
                return <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
            default:
                return <Clock className="w-3.5 h-3.5 text-amber-500" />;
        }
    };

    const getStatusLabel = (status?: string | null) => {
        if (!status) return 'UNKNOWN';
        return status;
    };

    return (
        <div className="flex flex-col space-y-4">
            <div className="flex flex-col gap-3 bg-white dark:bg-zinc-800/80 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700/80 shadow-sm">
                <div className="text-sm">
                    <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Trigger Execution via API</h3>
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs text-balance">
                        Run file(s) or tag(s) by triggering an execution in GCP using your Dataform API.
                    </p>
                </div>
                
                <div className="flex gap-4 mt-1">
                    <div className="flex-1 flex flex-col gap-2">
                        <button
                            onClick={handleRunApi}
                            className="flex items-center justify-center space-x-1.5 py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 rounded transition-colors text-xs font-medium"
                            title="Run execution using git branch"
                        >
                            <Play className="w-3.5 h-3.5" />
                            <span>Run from Git Commit</span>
                        </button>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                            Executes the committed code of your active git branch. Changes must be committed and pushed to the remote repository.
                        </p>
                    </div>

                    <div className="flex-1 flex flex-col gap-2">
                        <button
                            onClick={handleRunWorkspace}
                            className="flex items-center justify-center space-x-1.5 py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 rounded transition-colors text-xs font-medium"
                            title="Run execution using workspace code"
                        >
                            <Play className="w-3.5 h-3.5" />
                            <span>Run from GCP Workspace</span>
                        </button>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                            Executes local changes by syncing them to the remote GCP Dataform workspace. Useful for testing without needing to commit.
                        </p>
                    </div>
                </div>
            </div>

            {urls.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center bg-zinc-50 dark:bg-zinc-800 p-3 rounded-md border border-zinc-200 dark:border-zinc-700">
                        <span className="font-medium text-sm">Recent Executions ({urls.length})</span>
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={handleRefreshStatuses}
                                className="flex items-center space-x-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                title="Refresh execution statuses"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Refresh Status</span>
                            </button>
                            <button
                                onClick={handleClearUrls}
                                className="flex items-center space-x-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors border-l border-zinc-200 dark:border-zinc-700 pl-3"
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
                <div className="flex flex-col items-center justify-center p-8 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-md bg-zinc-50/50 dark:bg-zinc-800/20">
                    <p>No workflow executions found.</p>
                    <p className="text-sm mt-2">URLs from new executions will appear here.</p>
                </div>
            ) : (
                <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-md">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400 w-1/4">Time</th>
                                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Target Workspace</th>
                                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Tags</th>
                                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Files</th>
                                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Execution Mode</th>
                                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Status</th>
                                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Execution Options</th>
                                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400 w-16">Link</th>
                            </tr>
                        </thead>
                        <tbody>
                            {urls.slice().reverse().map((item) => {
                                return (
                                <tr key={item.timestamp} className="border-b border-zinc-200 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300 whitespace-nowrap text-xs">
                                        {new Date(item.timestamp).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100 truncate max-w-sm">
                                        <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs font-mono">
                                            {item.workspace || 'unknown'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">
                                        {item.includedTags && item.includedTags.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                                {item.includedTags.map((tag: string, i: number) => (
                                                    <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-zinc-400 dark:text-zinc-500 text-[10px] italic">No tags</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">
                                        {item.includedTargets && item.includedTargets.length > 0 ? (
                                            item.includedTargets.length > 2 ? (
                                                <div className="relative group">
                                                    <span className="text-xs cursor-help underline decoration-dotted text-blue-600 dark:text-blue-400">
                                                        {item.includedTargets.length} files
                                                    </span>
                                                    <div className="absolute z-10 hidden group-hover:block bottom-full mb-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg rounded-md p-2 w-max max-w-xs overflow-hidden">
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
                                                        <span key={i} className="truncate max-w-[150px]" title={`${t.database}.${t.schema}.${t.name}`}>
                                                            {t.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )
                                        ) : (
                                            <span className="text-zinc-400 dark:text-zinc-500 text-[10px] italic">No files</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300 whitespace-nowrap text-xs">
                                        {item.executionMode === 'api_workspace' ? 'GCP Workspace' : 'gitCommitish'}
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="flex items-center space-x-1.5" title={`Status: ${item.state || 'UNKNOWN'}`}>
                                            {getStatusIcon(item.state)}
                                              <span className="text-xs font-mono text-zinc-600 dark:text-zinc-300">
                                                {getStatusLabel(item.state)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="flex flex-wrap gap-1.5">
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                                    item.fullRefresh
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800/50 dark:text-emerald-400'
                                                        : 'bg-zinc-50 border-zinc-200 text-zinc-500 dark:bg-zinc-800/50 dark:border-zinc-700/50 dark:text-zinc-500'
                                                }`}
                                            >
                                                Full Refresh
                                            </span>
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                                    item.includeDependencies
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800/50 dark:text-emerald-400'
                                                        : 'bg-zinc-50 border-zinc-200 text-zinc-500 dark:bg-zinc-800/50 dark:border-zinc-700/50 dark:text-zinc-500'
                                                }`}
                                            >
                                                +Deps
                                            </span>
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                                    item.includeDependents
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800/50 dark:text-emerald-400'
                                                        : 'bg-zinc-50 border-zinc-200 text-zinc-500 dark:bg-zinc-800/50 dark:border-zinc-700/50 dark:text-zinc-500'
                                                }`}
                                            >
                                                +Dependents
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <button
                                            onClick={() => vscode.postMessage({ command: 'openExternal', url: item.url })}
                                            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 inline-flex items-center justify-center transition-colors"
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
