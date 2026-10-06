import { DataformBackend } from '../backend/dataform/backend';
import { runCompilation } from '../utils/dataformCompiler';

/*
 * The host's side of the Dataform Backend: gives it the extension's CLI and API compile paths, which still report
 * progress through VS Code and so cannot live in the Backend itself.
 */

/** A Dataform Backend for one Project, compiling as the extension does today */
export function createDataformBackend(): DataformBackend {
    return new DataformBackend(async ({ root, options }) => {
        // Picks the CLI or the API by `options.compilationMode`. A later compile of the same Project replaces this one
        const { dataformCompiledJson, errors } = await runCompilation(root, options);
        return {
            compiled: dataformCompiledJson,
            errors: errors?.map((error) => ({ message: error.error, fileName: error.fileName, stack: error.stack })),
        };
    });
}
