import type { CompilationMode } from '../../project/tools';

/**
 * What a compile of a Dataform Project needs to be told. The host resolves it from settings (src/project/dataformOptions.ts)
 * and passes it in, so the compile code reads no setting itself.
 */
export interface DataformOptions {
    compilationMode: CompilationMode;
    /** The compiler options as the CLI takes them, e.g. `--schema-suffix=dev --vars=env=dev`. Empty for none */
    compilerOptions: string;
    /** How long a CLI compile may take, as `--timeout` takes it */
    compileTimeout: string;
    /** The Dataform CLI to run and where it was found. Not resolved in API mode, which needs no CLI */
    cli?: { path: string; source: 'path' | 'setting' | 'local' };
    /** Whether CLI compile results are kept across sessions */
    persistCompilation: boolean;
    /** For the Dataform API */
    api: {
        /** The `gcpProjectId` setting. Unset means the Project's own default project */
        gcpProjectId?: string;
        serviceAccountJsonPath?: string;
        /** The release config whose compilation settings are used in place of `compilerOptions`, by its full name */
        releaseConfig?: string;
    };
}
