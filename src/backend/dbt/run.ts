import path from 'path';
import type { ActionId, RunOptions } from '../../shared/compiledGraph';
import type { BackendRequest } from '../backend';
import { shellJoin } from '../shellQuote';
import type { DbtName } from './graph';
import type { DbtOptions } from './options';

/*
 * The command line of a dbt run (xf#54). A run is always `dbt build`, which builds models, seeds and snapshots and
 * runs tests in the order of the graph, so a model's tests run after it. It runs from the Project root with the
 * same dbt, dbt target, variables and profiles directory as compiles, and writes to the Project's own `target/` and
 * `logs/`, as a run typed into a terminal would. A port of xf's internal/backend/dbt/run.go.
 */

type RunRequest = Pick<BackendRequest<Pick<DbtOptions, 'binary' | 'target' | 'vars' | 'profilesDir'>>, 'root' | 'options'> & { run: RunOptions };

/**
 * The arguments of the run, without the binary. Actions are selected by their fully qualified names, which both
 * engines match to exactly one action, and tags as `tag:<name>`, which dbt unions; `+` in front adds what the
 * selection reads from, `+` behind what reads from it. Throws when an action has no name dbt can select.
 */
export function dbtRunArguments({ options, run }: Omit<RunRequest, 'root'>, names: Record<ActionId, DbtName>): string[] {
    let selectors: string[];
    if (run.tags.length > 0) {
        selectors = run.tags.map((tag) => `tag:${tag}`);
    } else {
        const unnamed = run.actions.filter((action) => !names[action]?.qualifiedName);
        if (unnamed.length > 0 || run.actions.length === 0) {
            throw new Error(unnamed.length > 0 ? `dbt cannot select ${unnamed.join(', ')}: no dbt name is known for ${unnamed.length === 1 ? 'it' : 'them'}` : 'Nothing to run');
        }
        selectors = run.actions.map((action) => names[action].qualifiedName);
    }
    const args = ['build', '--select', ...selectors.map((selector) => `${run.includeDependencies ? '+' : ''}${selector}${run.includeDependents ? '+' : ''}`)];
    if (run.fullRefresh) {
        args.push('--full-refresh');
    }
    if (options.target) {
        args.push('--target', options.target);
    }
    if (options.vars?.trim()) {
        args.push('--vars', options.vars);
    }
    if (options.profilesDir) {
        args.push('--profiles-dir', options.profilesDir);
    }
    return args;
}

/** How the command line names the dbt: by its path from the Project root when it is inside it, as a `.venv`'s is */
function binaryName(binary: string, root: string): string {
    if (!path.isAbsolute(binary)) {
        return binary;
    }
    const relative = path.relative(root, binary);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return binary;
    }
    // Not a bare name, which a shell would look up on PATH
    return relative.includes(path.sep) ? relative : `.${path.sep}${relative}`;
}

/** The command line that runs `run` from the Project root, quoted so that a user can paste it into a shell */
export function dbtRunCommand(request: RunRequest, names: Record<ActionId, DbtName>, platform: NodeJS.Platform = process.platform): string {
    return shellJoin([binaryName(request.options.binary, request.root), ...dbtRunArguments(request, names)], platform);
}
