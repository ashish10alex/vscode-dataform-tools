import type { BackendName } from '../project/detection';
import type { ActionId, CompiledGraph, RunOptions } from '../shared/compiledGraph';
import type { CompileFiles } from './compileFiles';

/*
 * The seam between the extension and the tool that compiles a Project (see "Backend" in CONTEXT.md and ADR 0002).
 * A Backend takes plain data and returns plain data, asynchronously, and never imports `vscode`: the host resolves
 * its options from settings and passes them in, so a Backend runs in plain Node against recorded tool output.
 *
 * Every Backend can compile and can say which files affect a compile. Running and listing Changed Actions are
 * optional parts: an absent part means unsupported, and the host hides the controls for it (`backendParts`).
 */

/** Where a Backend writes what it has to say. The host's logger fits it */
export interface BackendLogger {
    info(message: string): void;
    debug(message: string): void;
    error(message: string, error?: unknown): void;
}

/** What every call into a Backend is given */
export interface BackendRequest<Options> {
    /** Absolute path of the Project's root */
    root: string;
    /** The Backend's own options, resolved by the host: Dataform's compiler options and Compilation Mode, dbt's binary and dbt target */
    options: Options;
    logger: BackendLogger;
    /** Aborted when the result is no longer wanted. The call then rejects with the signal's reason */
    signal: AbortSignal;
}

/** One error the tool reported while compiling */
export interface CompileError {
    /** The file the error is about, relative to the Project root with forward slashes. Unset when it is not about a file */
    fileName?: string;
    message: string;
    /** 1-based, and set only when the tool gave a line */
    line?: number;
    /** The tool's own code for the error, where it has one */
    code?: string;
}

/**
 * What a compile gives back. The graph and the errors come together: a Project with errors can still have a graph,
 * and may have an empty one.
 */
export interface CompileResult {
    graph: CompiledGraph;
    errors: CompileError[];
    /** Something about this compile the user should know, such as that the Project was only parsed. Unset for most */
    notice?: string;
}

/** new: not at the base; sql: a query differs; config: a setting that changes what is built differs */
export type ChangeReason = 'new' | 'sql' | 'config';

export interface ChangedActions {
    changed: Array<{ id: ActionId; reasons: ChangeReason[] }>;
    /** Actions at the base that the Project no longer defines */
    deleted: ActionId[];
}

/** The optional part of a Backend that runs a Project's actions with its tool's command line */
export interface Runner<Options> {
    /** The command line that runs `run` from the Project root, quoted so a user can paste it into a shell */
    command(request: Pick<BackendRequest<Options>, 'root' | 'options'> & { run: RunOptions }): string;
}

/** The optional part of a Backend that lists Changed Actions */
export interface Changes<Options> {
    /** The actions whose compiled output differs from the Project at the commit `base` */
    changedActions(request: BackendRequest<Options> & { base: string }): Promise<ChangedActions>;
}

export interface Backend<Options = unknown> {
    readonly name: BackendName;
    /**
     * Compiles the Project. Errors in the Project come back in the result; the promise rejects only when there is
     * no graph at all, e.g. the tool could not be started, or the compile was cancelled.
     */
    compile(request: BackendRequest<Options>): Promise<CompileResult>;
    /** Which files affect a compile */
    readonly compileFiles: CompileFiles;
    readonly runner?: Runner<Options>;
    readonly changes?: Changes<Options>;
}

export type BackendPart = 'runner' | 'changes';

/** Which optional parts the Backend has, for the host to turn into context keys */
export function backendParts(backend: Backend<never>): Record<BackendPart, boolean> {
    return { runner: backend.runner !== undefined, changes: backend.changes !== undefined };
}
