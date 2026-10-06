import type { ActionId } from './graph';

/** Selects what a run executes */
export interface RunOptions {
    /** The actions to run */
    actions: ActionId[];
    /** Selects by tag instead: every action with any of them, as the tool finds them. A run has tags or actions, never both */
    tags: string[];
    includeDependencies: boolean;
    includeDependents: boolean;
    fullRefresh: boolean;
}
