import * as vscode from 'vscode';
import { PendingRun, RunStages, cliOutputSaysRunning } from './shared/runStages';
import { ExecutionMode } from './types';
import { resolveExecutionMode } from './utils/remoteCompiler';

/*
 * Tells the panel of a run from the moment it is invoked, before it is in the history: the host's checks, defer to
 * prod and a terminal's start take seconds in which nothing else says that the click was taken. See
 * src/shared/runStages.ts for the stages.
 */

/** How long a CLI run whose jobs are not followed is told of when the terminal tells nothing of it */
const UNTRACKED_SILENT_MS = 15_000;
/** How long it is told of at most */
const UNTRACKED_MAX_MS = 2 * 60_000;

let pending: PendingRun | undefined;
/** How many of the run functions that tell of a run are in one another: a run of files runs their actions */
let depth = 0;
/** The terminal of a CLI run whose jobs are not followed, while it is told of */
let untrackedTerminal: vscode.Terminal | undefined;
let untrackedTimer: ReturnType<typeof setTimeout> | undefined;

/** The run that was invoked and is not in the history, if there is one */
export function pendingRun(): PendingRun | undefined {
    return pending;
}

function show() {
    // The command is the panel's, and is not there before the extension has registered it
    vscode.commands.executeCommand('vscode-dataform-tools.refreshWorkflowUrls').then(undefined, () => undefined);
}

function clear() {
    clearTimeout(untrackedTimer);
    untrackedTerminal = undefined;
    if (pending) {
        pending = undefined;
        show();
    }
}

/**
 * Runs `run`, which invokes a run of `mode`, and tells the panel of it meanwhile. When `run` is done the run is in
 * the history, or was given up, and is told of no more; but for a CLI run whose jobs are not followed, which is told
 * of until the terminal says it is running.
 */
export async function withRunFeedback<T>(mode: ExecutionMode, run: () => Promise<T>): Promise<T> {
    if (depth++ === 0) {
        clear();
        pending = { via: resolveExecutionMode(mode) === 'cli' ? 'cli' : 'api', stages: { invokedAt: Date.now() } };
        show();
    }
    try {
        return await run();
    } finally {
        if (--depth === 0 && !untrackedTerminal) {
            clear();
        }
    }
}

/** The host's own work before the run is done: it is about to be sent */
export function runPrepared() {
    if (pending && !pending.stages.preparedAt) {
        pending.stages.preparedAt = Date.now();
        show();
    }
}

/**
 * The stages of the run that is put in the history at `sentAt`, which is told of from there on. The caller shows
 * the history.
 */
export function takeRunStages(sentAt: number): RunStages {
    const stages: RunStages = { ...(pending?.stages ?? { invokedAt: sentAt }), sentAt };
    pending = undefined;
    return stages;
}

/** A CLI run whose jobs are not followed was sent to `terminal`: its stages are told until it is running */
export function runSentUntracked(terminal: vscode.Terminal) {
    if (!pending) {
        return;
    }
    pending.stages.sentAt = Date.now();
    untrackedTerminal = terminal;
    untrackedTimer = setTimeout(clear, UNTRACKED_SILENT_MS);
    show();
}

interface ShellExecution { read?: () => AsyncIterable<string> }

/** Calls `then` once the Dataform CLI run by `execution` says it is running the actions. Never, where the output can't be read */
export function whenCliSaysRunning(execution: ShellExecution, then: () => void) {
    if (typeof execution.read !== 'function') {
        return;
    }
    const stream = execution.read();
    void (async () => {
        let output = '';
        try {
            for await (const chunk of stream) {
                // The line is among the first the CLI prints: what comes long after is not looked at
                output = (output + chunk).slice(-4000);
                if (cliOutputSaysRunning(output)) {
                    then();
                    return;
                }
            }
        } catch {
            // The terminal went
        }
    })();
}

export function initRunFeedback(context: vscode.ExtensionContext) {
    const events = vscode.window as unknown as {
        onDidStartTerminalShellExecution?: vscode.Event<{ terminal: vscode.Terminal; execution: ShellExecution }>;
        onDidEndTerminalShellExecution?: vscode.Event<{ terminal: vscode.Terminal }>;
    };
    if (events.onDidStartTerminalShellExecution && events.onDidEndTerminalShellExecution) {
        context.subscriptions.push(
            events.onDidStartTerminalShellExecution(({ terminal, execution }) => {
                if (terminal !== untrackedTerminal || !pending || pending.stages.startedAt) {
                    return;
                }
                pending.stages.startedAt = Date.now();
                clearTimeout(untrackedTimer);
                untrackedTimer = setTimeout(clear, UNTRACKED_MAX_MS);
                whenCliSaysRunning(execution, () => terminal === untrackedTerminal && clear());
                show();
            }),
            events.onDidEndTerminalShellExecution(({ terminal }) => {
                if (terminal === untrackedTerminal && pending?.stages.startedAt) {
                    clear();
                }
            }),
        );
    }
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => terminal === untrackedTerminal && clear()),
        { dispose: clear },
    );
}
