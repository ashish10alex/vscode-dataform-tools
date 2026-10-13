/*
 * The stages a run goes through between the moment it is invoked and its first job, so that the panel can say which
 * wait the user is in. No `vscode` import: the host's part is src/runFeedback.ts and src/cliRunJobs.ts.
 *
 * A CLI run: the host prepares it (its checks, defer to prod), sends the command to the terminal, the terminal
 * starts it, the CLI compiles, and then it starts its jobs. A run through the Dataform API: the host prepares it,
 * then submits it.
 */

/** Epoch ms at which each stage of a run was reached. One that is unset was not reached, or nothing told of it */
export interface RunStages {
    /** A run path was invoked */
    invokedAt: number;
    /** The host's own work before the run was done */
    preparedAt?: number;
    /** CLI: the command was sent to the terminal. API: the workflow invocation was made */
    sentAt?: number;
    /** CLI: the terminal told that the command began */
    startedAt?: number;
    /** CLI: the CLI said that it had compiled and was running the actions */
    compiledAt?: number;
    /** CLI: the first of the run's BigQuery jobs was found */
    firstJobAt?: number;
    /** CLI: the terminal tells nothing of its commands, so starting and compiling can't be told apart */
    silentShell?: boolean;
}

export type RunVia = 'cli' | 'api';

/** A run that was invoked and is not in the history yet, or never will be: a CLI run whose jobs are not followed */
export interface PendingRun {
    via: RunVia;
    stages: RunStages;
}

export type RunStage = 'preparing' | 'starting' | 'compiling' | 'starting jobs' | 'submitting';

/** With no word from the terminal for this long after a command was sent, it is taken to tell nothing */
export const SILENT_SHELL_MS = 10_000;

/** The stage a run is in, in the pill's words. Undefined once it is past them: its jobs or actions tell the rest */
export function runStage(stages: RunStages, via: RunVia): RunStage | undefined {
    if (via === 'api') {
        return stages.sentAt ? undefined : stages.preparedAt ? 'submitting' : 'preparing';
    }
    if (stages.firstJobAt) {
        return undefined;
    }
    if (stages.compiledAt) {
        return 'starting jobs';
    }
    if (stages.startedAt) {
        return 'compiling';
    }
    return stages.sentAt ? 'starting' : 'preparing';
}

export interface RunStageLine {
    label: string;
    /** `current` is the stage the run is in; `failed` the one it ended in before any job */
    state: 'done' | 'current' | 'todo' | 'failed';
    /** How long the stage took, or has taken so far. Unset for a stage not reached */
    ms?: number;
    /** A short name for the stage, for where the stages are summed up in a line */
    short: string;
}

/**
 * The stages of a run as lines of a checklist, in order. `ended` is a run that ended before its first job: the stage
 * it was in is the one that failed. A stage nothing told of is left out, and its time goes to the one before.
 */
export function runStageLines(stages: RunStages, via: RunVia, now: number, ended = false): RunStageLine[] {
    const steps: { label: string; short: string; from?: number }[] = via === 'api'
        ? [
            { label: 'Preparing', short: 'prep', from: stages.invokedAt },
            { label: 'Submitting to Dataform', short: 'submit', from: stages.preparedAt },
        ]
        : stages.silentShell
            ? [
                { label: 'Preparing', short: 'prep', from: stages.invokedAt },
                { label: 'Starting and compiling in the terminal', short: 'terminal and compile', from: stages.sentAt },
            ]
            : [
                { label: 'Preparing', short: 'prep', from: stages.invokedAt },
                { label: 'Starting terminal', short: 'terminal', from: stages.sentAt },
                { label: 'Compiling', short: 'compile', from: stages.startedAt },
                { label: 'Starting jobs', short: 'jobs', from: stages.compiledAt },
            ];
    const end = via === 'api' ? stages.sentAt : stages.firstJobAt;
    const reached = steps.filter((step) => step.from !== undefined);
    const lines: RunStageLine[] = reached.map((step, index) => {
        const next = reached[index + 1]?.from ?? end;
        if (next !== undefined) {
            return { label: step.label, short: step.short, state: 'done', ms: Math.max(0, next - step.from!) };
        }
        return { label: step.label, short: step.short, state: ended ? 'failed' : 'current', ms: ended ? undefined : Math.max(0, now - step.from!) };
    });
    if (end === undefined && !ended) {
        // What is still to come, as far as it is known to come: a stage the run skipped is not there to wait for
        const last = reached[reached.length - 1];
        for (const step of steps.slice(steps.indexOf(last) + 1)) {
            lines.push({ label: step.label, short: step.short, state: 'todo' });
        }
    }
    return lines;
}

/** How long a run took to get to its first job, or to be submitted. Undefined while it has not */
export function timeToStart(stages: RunStages, via: RunVia): number | undefined {
    const end = via === 'api' ? stages.sentAt : stages.firstJobAt;
    return end === undefined ? undefined : Math.max(0, end - stages.invokedAt);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** Terminal output without its colours and other escape sequences */
export function stripAnsi(text: string): string {
    return text.replace(ANSI, '');
}

/**
 * Whether what the Dataform CLI has printed so far says that it has compiled and is running the actions: it prints
 * "Running..." on a line of its own then. A dry run prints "Dry running..." and is not a run.
 */
export function cliOutputSaysRunning(output: string): boolean {
    return /^\s*Running\.\.\.\s*$/m.test(stripAnsi(output).replace(/\r/g, ''));
}
