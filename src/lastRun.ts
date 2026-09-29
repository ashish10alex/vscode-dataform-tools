import * as vscode from 'vscode';
import * as path from 'path';
import { ExecutionMode, LastRunRequest, LastRunView } from './types';
import { describeComparison } from './shared/changeComparison';

const LAST_RUN_STATE_KEY = 'dataform_last_run_request';

let extensionContext: vscode.ExtensionContext | undefined;
const lastRunChanged = new vscode.EventEmitter<void>();
export const onDidChangeLastRun = lastRunChanged.event;

export function initLastRun(context: vscode.ExtensionContext) {
    extensionContext = context;
    context.subscriptions.push(lastRunChanged);
}

/** Remembers a run so it can be repeated. Called through `beginRun` by every Dataform run path just before it executes. */
export async function recordLastRun(request: Omit<LastRunRequest, 'timestamp'>) {
    if (!extensionContext) {
        return;
    }
    await extensionContext.workspaceState.update(LAST_RUN_STATE_KEY, { ...request, timestamp: Date.now() });
    lastRunChanged.fire();
}

/** The extension context, for code that replays runs outside a command handler */
export function getLastRunContext(): vscode.ExtensionContext | undefined {
    return extensionContext;
}

export function getLastRun(): LastRunRequest | undefined {
    return extensionContext?.workspaceState.get<LastRunRequest>(LAST_RUN_STATE_KEY);
}

export function summarizeItems(items: string[], max = 2): string {
    const shown = items.slice(0, max).join(', ');
    return items.length > max ? `${shown} +${items.length - max} more` : shown;
}

export function modeLabel(mode: ExecutionMode): string {
    switch (mode) {
        case 'cli': return 'CLI';
        case 'api': return 'API';
        case 'api_workspace': return 'API (remote workspace)';
    }
}

/** A CLI run replays through the API when remote mode is on, the same way a fresh CLI run would. */
export function resolveReplayMode(recordedMode: ExecutionMode, remoteMode: boolean): ExecutionMode {
    return recordedMode === 'cli' && remoteMode ? 'api' : recordedMode;
}

function flagLabels(request: LastRunRequest): string[] {
    const flags: string[] = [];
    if (request.includeDependencies) { flags.push('+dependencies'); }
    if (request.includeDependents) { flags.push('+dependents'); }
    if (request.fullRefresh) { flags.push('full refresh'); }
    if (request.deferToProd) { flags.push('deferred to prod'); }
    return flags;
}

function selectionLabel(request: LastRunRequest, items: string[]): string {
    const plural = request.items.length === 1 ? '' : 's';
    switch (request.kind) {
        case 'currentFile': return `file ${items[0] ?? ''}`;
        case 'files': return `${request.items.length} file${plural}: ${summarizeItems(items)}`;
        case 'tags': return `tag${plural} ${summarizeItems(items)}`;
        case 'changed': return `${request.items.length} changed action${plural} ${describeComparison(request.headRef, request.baseRef ?? 'default branch')}`;
    }
}

export function describeOverrides(compilerOptions: typeof globalThis.compilerOptionsMap | undefined): string | undefined {
    if (!compilerOptions) {
        return undefined;
    }
    const parts: string[] = [];
    for (const [key, value] of Object.entries(compilerOptions)) {
        if (value === undefined || value === null || value === '') {
            continue;
        }
        if (key === 'vars' && typeof value === 'object') {
            const vars = Object.entries(value).map(([name, varValue]) => `${name}=${varValue}`);
            if (vars.length > 0) {
                parts.push(`vars: ${vars.join(', ')}`);
            }
        } else if (typeof value !== 'object') {
            parts.push(`${key}=${value}`);
        }
    }
    return parts.length > 0 ? parts.join('; ') : undefined;
}

export function summarizeLastRun(request: LastRunRequest, replayMode: ExecutionMode, overrides?: string): { label: string; detail: string } {
    const baseNames = request.kind === 'tags' || request.kind === 'changed' ? request.items : request.items.map((item) => path.basename(item));
    const label = [selectionLabel(request, baseNames), ...flagLabels(request), modeLabel(replayMode)].join(' · ');

    const itemLine = request.kind === 'changed'
        ? `Last ran ${request.items.length} action${request.items.length === 1 ? '' : 's'}: ${request.items.join(', ')} (recomputed on rerun)`
        : `${request.kind === 'tags' ? 'Tags' : 'Files'}: ${request.items.join(', ')}`;
    const detailLines = [
        itemLine,
        `Dependencies: ${request.includeDependencies ? 'yes' : 'no'}`,
        `Dependents: ${request.includeDependents ? 'yes' : 'no'}`,
        `Full refresh: ${request.fullRefresh ? 'yes' : 'no'}`,
        `Defer to prod: ${request.deferToProd ? 'yes' : 'no'}`,
        `Mode: ${modeLabel(replayMode)}`,
    ];
    if (request.workspaceFolder) {
        detailLines.push(`Folder: ${request.workspaceFolder}`);
    }
    if (overrides) {
        detailLines.push(`Compiler overrides: ${overrides}`);
    }
    return { label, detail: detailLines.join('\n') };
}

/**
 * Items of the recorded run that no longer exist. `knownTags` is undefined when the project could not be
 * compiled, in which case tags are left for the runner to report.
 */
export function findMissingItems(request: LastRunRequest, knownTags: string[] | undefined, fileExists: (relativePath: string) => boolean): string[] {
    if (request.kind === 'tags') {
        return knownTags === undefined ? [] : request.items.filter((tag) => !knownTags.includes(tag));
    }
    if (request.kind === 'changed') {
        return [];
    }
    return request.items.filter((item) => !fileExists(item));
}

/** The recorded run's paths are relative to its folder, so it must not be replayed against another Dataform folder. */
export function isFromOtherFolder(request: LastRunRequest, currentFolder: string): boolean {
    return !!request.workspaceFolder && path.resolve(request.workspaceFolder) !== path.resolve(currentFolder);
}

export type ReplayRunner = 'currentFile' | 'files' | 'tagsCli' | 'tagsApi' | 'changed';

export interface ReplayPlan {
    runner: ReplayRunner;
    items: string[];
    includeDependencies: boolean;
    includeDependents: boolean;
    fullRefresh: boolean;
    executionMode: ExecutionMode;
}

export function planReplay(request: LastRunRequest, remoteMode: boolean): ReplayPlan {
    const executionMode = resolveReplayMode(request.executionMode, remoteMode);
    let runner: ReplayRunner;
    if (request.kind === 'tags') {
        runner = executionMode === 'cli' ? 'tagsCli' : 'tagsApi';
    } else {
        runner = request.kind;
    }
    return {
        runner,
        items: request.items,
        includeDependencies: request.includeDependencies,
        includeDependents: request.includeDependents,
        fullRefresh: request.fullRefresh,
        executionMode,
    };
}

export function buildLastRunView(request: LastRunRequest | undefined, remoteMode: boolean, compilerOptions: typeof globalThis.compilerOptionsMap | undefined): LastRunView | null {
    if (!request) {
        return null;
    }
    const executionMode = resolveReplayMode(request.executionMode, remoteMode);
    const { label, detail } = summarizeLastRun(request, executionMode, describeOverrides(compilerOptions));
    return { label, detail, timestamp: request.timestamp, fullRefresh: request.fullRefresh, executionMode };
}
