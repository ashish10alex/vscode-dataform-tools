import type { Backend } from './detection';

/*
 * Which command-line tools a Project needs before its panel can compile. Only a Backend's own tool is ever required:
 * signing in to Google Cloud is not checked here, a BigQuery call that fails says so.
 */

/** How a Dataform Project is compiled, see "Compilation Mode" in CONTEXT.md */
export type CompilationMode = 'cli' | 'api';

export type Tool = 'dataform' | 'dbt';

/** The tools the Project's panel cannot work without */
export function requiredTools(backend: Backend, options: { compilationMode?: CompilationMode } = {}): Tool[] {
    if (backend === 'dbt') {
        return ['dbt'];
    }
    // The API compiles the pushed commit: the Dataform CLI is not needed
    return options.compilationMode === 'api' ? [] : ['dataform'];
}
