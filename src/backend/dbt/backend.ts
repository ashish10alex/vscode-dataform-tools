import type { Backend, BackendRequest, CompileScope, Runner } from '../backend';
import type { CompileFiles } from '../compileFiles';
import { DbtCompileResult, DbtCompiler } from './compile';
import type { DbtOptions } from './options';
import { dbtRunCommand } from './run';

/**
 * What affects a dbt compile, from xf's watch spec: models, tests, macros, seeds, snapshots, analyses and docs in
 * any directory but dbt's own output, and the Project's settings files. A Project names its own directories in
 * `dbt_project.yml`, so every directory counts rather than a fixed list, installed packages included.
 */
export const DBT_COMPILE_FILES: CompileFiles = {
    skip: ['target', 'logs'],
    extensions: ['.sql', '.yml', '.yaml', '.csv', '.py', '.md', '.jinja', '.jinja2'],
    rootFiles: ['dbt_project.yml', 'packages.yml', 'dependencies.yml', 'selectors.yml', 'profiles.yml'],
};

/**
 * The dbt Backend of one Project. It compiles with the dbt the host found (see compile.ts for how, which differs by
 * engine) and gives the command line of a run. Besides the Compiled Graph it keeps what the last compile learnt
 * that only dbt features read: what dbt calls each action, the macros, the active dbt target. It has no "changes"
 * part: Changed Actions are not offered for dbt yet.
 */
export class DbtBackend implements Backend<DbtOptions> {
    readonly name = 'dbt';
    readonly compileFiles = DBT_COMPILE_FILES;
    /**
     * A run selects actions by the names dbt gave them in the last compile, so it throws for an action that compile
     * did not have. A run of tags needs no compile.
     */
    readonly runner: Runner<DbtOptions> = {
        command: (request) => dbtRunCommand(request, this.last?.dbt?.names ?? {}),
    };
    private readonly compiler = new DbtCompiler();
    private last: DbtCompileResult | undefined;

    /**
     * What the Project last compiled to, with what the dbt Backend keeps beside the graph. A compile that rejects, as
     * a cancelled one does, leaves the last one in place. Undefined before the first result.
     */
    get lastResult(): DbtCompileResult | undefined {
        return this.last;
    }

    /** Drops the last result */
    forget() {
        this.last = undefined;
    }

    /** Puts `result` back as the last one: a compile that added nothing to it does not replace it */
    keep(result: DbtCompileResult) {
        this.last = result;
    }

    async compile(request: BackendRequest<DbtOptions> & CompileScope): Promise<DbtCompileResult> {
        const result = await this.compiler.compile(request);
        request.signal.throwIfAborted();
        this.last = result;
        return result;
    }
}
