import type { RunOptions } from '../../shared/compiledGraph';
import type { BackendRequest, Runner } from '../backend';
import type { DataformOptions } from './options';

/** The Dataform CLI as a command line names it: in quotes when its path has a space */
export function quotedCli(cliPath: string): string {
    return /\s/.test(cliPath) ? `"${cliPath}"` : cliPath;
}

/**
 * The `dataform run` command line for a run of actions, or of tags when the run has any. It is written as the
 * extension has always written it, so the host can send it to the terminal as it is.
 */
export function dataformRunCommand({ root, options, run }: Pick<BackendRequest<DataformOptions>, 'root' | 'options'> & { run: RunOptions }): string {
    let command = `${quotedCli(options.cli?.path ?? 'dataform')} run "${root}" ${options.compilerOptions} --timeout=${options.compileTimeout}`;
    if (options.executionTimeout) {
        command += ` --execution-timeout=${options.executionTimeout}`;
    }
    let scope = '';
    if (run.includeDependencies) {
        scope += ` --include-deps`;
    }
    if (run.includeDependents) {
        scope += ` --include-dependents`;
    }
    if (run.fullRefresh) {
        scope += ` --full-refresh`;
    }
    if (run.actions.length > 0) {
        return command + scope + run.actions.map((action) => ` --actions "${action}"`).join('');
    }
    return command + run.tags.map((tag) => ` --tags=${tag}`).join('') + scope;
}

export const dataformRunner: Runner<DataformOptions> = { command: dataformRunCommand };
