import { ENDED_RUN_STATES, isExternalRun, isTerminalRun } from './cliRunJobs';

/*
 * When the runs of the history are asked about again. The extension host asks, so a run started through the Dataform
 * API, or a workflow watched, is followed whether or not a panel is open. Pure, so it is tested without VS Code.
 */

export const POLL_FAST_MS = 5000;
/** Cancellation usually settles within a few seconds, so a run that is CANCELING is asked about more often */
export const POLL_CANCELING_MS = 1500;
export const POLL_SLOW_MS = 10000;
/** How long after polling starts it is fast */
export const POLL_FAST_DURATION_MS = 30000;
/** How long the runs this extension started are followed, from when polling started */
export const POLL_TIMEOUT_MS = 30 * 60 * 1000;
/** How many checks of a run in a row may fail before it is no longer asked about */
export const MAX_POLL_FAILURES = 5;

interface PolledRun {
    executionMode?: string;
    state?: string;
    failedActions?: unknown[];
    workflowInvocationId?: string;
    projectId?: string;
    location?: string;
    repositoryName?: string;
    /** A watched workflow whose watching was stopped */
    unwatched?: boolean;
}

/** Whether the Dataform API can be asked about the run: it names an invocation, in a repository it knows */
export function isApiRun(entry: PolledRun): boolean {
    return !isTerminalRun(entry) && !!(entry.workflowInvocationId && entry.projectId && entry.location && entry.repositoryName);
}

/** Whether the run has not ended, or ended as FAILED without the reasons yet */
export function needsPolling(entry: PolledRun): boolean {
    if (!isApiRun(entry) || entry.unwatched) { return false; }
    const ended = !!entry.state && ENDED_RUN_STATES.has(entry.state);
    return !ended || (entry.state === 'FAILED' && !entry.failedActions?.length);
}

/**
 * The runs to ask about. `elapsedMs` is how long polling has gone on for; `gaveUp` has the IDs of the runs whose
 * checks failed too often. The runs this extension started are followed for `POLL_TIMEOUT_MS`; a watched workflow
 * until it ends, or watching is stopped.
 */
export function polledRuns<T extends PolledRun>(history: T[], elapsedMs: number, gaveUp: { has(key: string): boolean } = new Set()): T[] {
    return history.filter((entry) => needsPolling(entry) && !gaveUp.has(entry.workflowInvocationId!)
        && (isExternalRun(entry) || elapsedMs < POLL_TIMEOUT_MS));
}

/** How long to wait before asking about the runs again, or undefined to stop */
export function nextPollDelay(history: PolledRun[], elapsedMs: number, gaveUp: { has(key: string): boolean } = new Set()): number | undefined {
    const polled = polledRuns(history, elapsedMs, gaveUp);
    if (polled.length === 0) { return undefined; }
    if (polled.some((entry) => entry.state === 'CANCELING')) { return POLL_CANCELING_MS; }
    return elapsedMs < POLL_FAST_DURATION_MS || polled.some(isExternalRun) ? POLL_FAST_MS : POLL_SLOW_MS;
}

/** The key a run is selected by: its invocation's ID, or when it started for an entry that has none */
export function runKey(entry: { workflowInvocationId?: string; timestamp: number }): string {
    return entry.workflowInvocationId || String(entry.timestamp);
}
