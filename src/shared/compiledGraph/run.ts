import { actionsInFile, isRunnable, isTestKind } from './graph';
import type { ActionId, CompiledGraph } from './graph';

/** Selects what a run executes */
export interface RunOptions {
    /** The actions to run */
    actions: ActionId[];
    /** Selects by tag instead: every action with any of them, as the tool finds them. A run has tags or actions, never both */
    tags: string[];
    includeDependencies: boolean;
    includeDependents: boolean;
    fullRefresh: boolean;
    /**
     * Runs what changed since a base instead, as the tool finds it when the run starts: with no `actions` all of
     * it, else those of `actions` that still differ. `base` is what `Changes.changedActions` takes. Only a Backend
     * whose tool can select what changed reads this: dbt, with `state:modified`.
     */
    changed?: { base: string };
}

/** What a run of some actions is recorded as, so that it can be repeated */
export type RecordedRun =
    /** Every action of the file: a repeat runs the file as it is then, with what was added to it since */
    | { file: string }
    | { actions: ActionId[] };

/**
 * How to record a run of the actions `ids`: as their file when they are all of one file and leave out nothing of it
 * that a run executes, else as the actions. A disabled action and a test do not count: no run executes them.
 */
export function runSelection(graph: CompiledGraph, ids: ActionId[]): RecordedRun {
    const asked = new Set(ids);
    const file = graph.actions[ids[0]]?.fileName;
    const whole = !!file
        && ids.every((id) => graph.actions[id]?.fileName === file)
        && actionsInFile(graph, file).every((action) => asked.has(action.id) || action.disabled || !isRunnable(action) || isTestKind(action.kind));
    return whole ? { file } : { actions: ids };
}
