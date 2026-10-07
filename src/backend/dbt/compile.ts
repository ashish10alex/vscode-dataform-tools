import fs from 'fs';
import path from 'path';
import type { BackendRequest, CompileError, CompileResult, CompileScope } from '../backend';
import { buildCompiledGraph } from '../../shared/compiledGraph';
import { invocationErrors } from './errors';
import type { DbtProjectData } from './graph';
import { DbtCommand, invokeDbt } from './invoke';
import { readManifest } from './manifest';
import type { DbtOptions } from './options';

/*
 * How a dbt Project is compiled, which differs by engine (ADR 0003):
 *
 * - dbt v2 compiles the whole Project every time. It runs the Project's on-run hooks against the warehouse when it
 *   compiles, so the Project is parsed first, and a Project that has hooks is left parsed, with a notice, unless
 *   `compileWithHooks` is on.
 * - dbt-core compiles only the actions of the file on show (`--select path:<file>`), which brings the tests of
 *   those actions with it and leaves every other action without compiled SQL. With no file it parses. It never
 *   compiles the whole Project.
 */

export interface DbtCompileResult extends CompileResult {
    /** What the dbt Backend keeps of the manifest, private to it. Unset when dbt wrote no manifest */
    dbt?: DbtProjectData;
    /** The dbt commands that were run, in order, without the binary: for the log and the panel's progress line */
    commands: string[][];
    /** The Project was parsed and nothing was compiled, though a compile was wanted: it has on-run hooks, or errors */
    parsedOnly: boolean;
}

type CompileRequest = BackendRequest<DbtOptions> & CompileScope;

/** Where `dbt deps` installs packages; `dbt_modules` is where it did before dbt 1.0 */
const PACKAGE_DIRS = ['dbt_packages', 'dbt_modules'];
const PROJECT_FILE = 'dbt_project.yml';

/**
 * The state of the files that can define an on-run hook: `on-run-start` and `on-run-end` are only in a
 * `dbt_project.yml`, the Project's and each installed package's.
 */
export function hookFingerprint(root: string): string {
    const files = [path.join(root, PROJECT_FILE)];
    for (const dir of PACKAGE_DIRS) {
        let packages: string[] = [];
        try {
            packages = fs.readdirSync(path.join(root, dir)).sort();
        } catch {
            // No packages installed
        }
        files.push(...packages.map((name) => path.join(root, dir, name, PROJECT_FILE)));
    }
    return files
        .map((file) => {
            try {
                const stat = fs.statSync(file);
                return `${file} ${stat.size} ${stat.mtimeMs}`;
            } catch {
                return '';
            }
        })
        .filter(Boolean)
        .join('\n');
}

/** Compiles dbt Projects. One for the life of the Backend: it remembers which Projects a parse found to have no hooks */
export class DbtCompiler {
    /** By Project root: the fingerprint of its hook files when a parse found no hook in them */
    private readonly hookless = new Map<string, string>();

    async compile(request: CompileRequest): Promise<DbtCompileResult> {
        return request.options.flavour === 'dbt-core' ? this.compileWithCore(request) : this.compileWithV2(request);
    }

    private async compileWithCore(request: CompileRequest): Promise<DbtCompileResult> {
        if (!request.file) {
            return { ...(await run(request, 'parse')), parsedOnly: false };
        }
        // By path, so that nothing has to be known of the Project beforehand. A file that defines no action (a
        // macro, the Project's settings) selects nothing, which dbt-core answers with the parsed Project
        const file = request.file.split('/').join(path.sep);
        return { ...(await run(request, 'compile', ['--select', `path:${file}`])), parsedOnly: false };
    }

    private async compileWithV2(request: CompileRequest): Promise<DbtCompileResult> {
        const { root, options } = request;
        const commands: string[][] = [];
        if (!options.compileWithHooks && this.hookless.get(root) !== hookFingerprint(root)) {
            // Taken before the parse, so that a change made while it runs is not missed
            const fingerprint = hookFingerprint(root);
            const parsed = await run(request, 'parse');
            const hooks = Object.values(parsed.graph.actions).filter((action) => action.kind === 'operation');
            if (hooks.length > 0) {
                const files = [...new Set(hooks.map((hook) => hook.fileName).filter(Boolean))].join(', ');
                const notice = `SQL not compiled: ${options.label ?? 'dbt v2'} runs on-run-start and on-run-end hooks when it compiles, and this Project has ${hooks.length}${files ? ` (in ${files})` : ''}.`;
                return { ...parsed, notice, parsedOnly: true };
            }
            if (parsed.errors.length > 0) {
                // Hooks could not be ruled out, and the compile would only report the same errors
                return { ...parsed, parsedOnly: true };
            }
            this.hookless.set(root, fingerprint);
            commands.push(...parsed.commands);
        }
        const compiled = await run(request, 'compile');
        return { ...compiled, commands: [...commands, ...compiled.commands], parsedOnly: false };
    }
}

/**
 * Runs one dbt command and reads what it left: the graph of the manifest it wrote, and the errors it reported when it
 * failed. A dbt-core that fails before it writes a manifest gives its errors with an empty graph. Rejects when dbt
 * left neither a manifest nor an error to show.
 */
async function run(request: CompileRequest, command: DbtCommand, extra: string[] = []): Promise<Omit<DbtCompileResult, 'parsedOnly'>> {
    const invocation = await invokeDbt(request, command, extra);
    const errors: CompileError[] = invocation.exitCode === 0 ? [] : invocationErrors(invocation);
    const commands = [invocation.args];
    if (invocation.manifestPath) {
        const { graph, dbt } = await readManifest(invocation.manifestPath, request.signal);
        return { graph, dbt, errors, commands };
    }
    if (errors.length > 0) {
        return { graph: buildCompiledGraph([]), errors, commands };
    }
    const { binary } = request.options;
    throw new Error(invocation.exitCode === 0 ? `${binary} ${command} wrote no manifest` : `${binary} ${command} failed with exit status ${invocation.exitCode} and reported no error`);
}
