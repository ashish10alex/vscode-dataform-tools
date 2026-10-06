import { buildCompiledGraph } from '../../shared/compiledGraph';
import type { DataformCompiledJson } from '../../types';
import type { Backend, BackendRequest, CompileResult } from '../backend';
import type { CompileFiles } from '../compileFiles';
import { RawCompileError, buildDataformGraph, toCompileError } from './graph';
import type { DataformOptions } from './options';

/** What affects a Dataform compile: definitions/ and includes/, and the Project's settings files */
export const DATAFORM_COMPILE_FILES: CompileFiles = {
    directories: ['definitions', 'includes'],
    extensions: ['.sqlx', '.js', '.sql', '.json', '.yaml', '.yml', '.ipynb'],
    rootFiles: ['workflow_settings.yaml', 'dataform.json'],
};

/** What the Dataform CLI or the Dataform API gave for a compile: a result, or the errors that left it without one */
export interface RawCompile {
    compiled?: DataformCompiledJson;
    errors?: RawCompileError[];
}

/**
 * Compiles a Project with the Dataform CLI or the Dataform API, as `options.compilationMode` says. The host supplies
 * it, because both compile paths still report progress through VS Code.
 */
export type RawCompiler = (request: BackendRequest<DataformOptions>) => Promise<RawCompile>;

/**
 * The Dataform Backend of one Project. Besides the Compiled Graph it keeps the raw compile result, which Dataform-only
 * features (defer, column lineage, config block, Dataform API runs) read through `rawResult`.
 */
export class DataformBackend implements Backend<DataformOptions> {
    readonly name = 'dataform';
    readonly compileFiles = DATAFORM_COMPILE_FILES;
    private raw: DataformCompiledJson | undefined;

    constructor(private readonly compileRaw: RawCompiler) {}

    /**
     * What the Project last compiled to, as Dataform gave it. A compile that gives no result leaves the last one in
     * place, as the extension has always kept it. Undefined before the first result.
     */
    get rawResult(): DataformCompiledJson | undefined {
        return this.raw;
    }

    async compile(request: BackendRequest<DataformOptions>): Promise<CompileResult> {
        const { compiled, errors = [] } = await this.compileRaw(request);
        request.signal.throwIfAborted();
        if (compiled) {
            this.raw = compiled;
        }
        const graphErrors = compiled?.graphErrors?.compilationErrors ?? [];
        return {
            graph: compiled ? buildDataformGraph(compiled) : buildCompiledGraph([]),
            errors: [...graphErrors, ...errors].map(toCompileError),
        };
    }
}
