import * as vscode from 'vscode';
import { spawn } from 'child_process';
import path from 'path';
import { logger } from '../logger';
import { windowsDataformCliNotAvailableErrorMessage, linuxDataformCliNotAvailableErrorMessage } from '../constants';
import { buildIndices } from './compiledJsonIndex';
import { findExecutableInPaths } from './executableResolver';
import { DataformCompiledJson, GraphError } from '../types';
import { getRemoteCompiledJson, isRemoteMode } from './remoteCompiler';
import { setCompilationInfo } from './compilationInfo';

//NOTE: maybe no test is needed as dataform cli compilation should catch any potential edge cases  ?
function stripQuotes(str:string) {
  return str.replace(/^['"]|['"]$/g, '');
}

/** `--vars` value as the CLI takes it (`a=1,b=2`), or as a JSON object. */
function parseVars(value: string): { [key: string]: string } {
    const vars: { [key: string]: string } = {};
    if (value.trim().startsWith("{")) {
        try {
            const parsed = JSON.parse(value);
            Object.entries(parsed).forEach(([key, val]) => { vars[key] = String(val); });
        } catch {
            logger.error(`Could not parse --vars as JSON: ${value}`);
        }
        return vars;
    }
    value.split(",").forEach((pair) => {
        const separator = pair.indexOf("=");
        if (separator > 0) {
            vars[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
        }
    });
    return vars;
}

const COMPILER_FLAG_TO_API_KEY: { [flag: string]: Exclude<keyof typeof globalThis.compilerOptionsMap, "vars" | "defaultNotebookRuntimeOptions"> } = {
    "--table-prefix": "tablePrefix",
    "--schema-suffix": "schemaSuffix",
    "--database-suffix": "databaseSuffix",
    "--default-database": "defaultDatabase",
    "--default-schema": "defaultSchema",
    "--default-location": "defaultLocation",
    "--assertion-schema": "assertionSchema",
};

export function createCompilerOptionsObjectForApi(compilerOptions: string[]): typeof globalThis.compilerOptionsMap {
    // See https://cloud.google.com/nodejs/docs/reference/dataform/latest/dataform/protos.google.cloud.dataform.v1beta1.icodecompilationconfig
    let compilerOptionsObject: typeof globalThis.compilerOptionsMap = {};

    if (!compilerOptions || compilerOptions.length === 0 || !compilerOptions[0] || typeof compilerOptions[0] !== 'string') {
        return compilerOptionsObject;
    }

    // Split on whitespace outside quotes, as the shell does for the CLI, so `--vars="a=1, b=2"` stays one option
    let compilerOptionsToApi = compilerOptions[0].match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];

    compilerOptionsToApi.forEach((opt: string) => {
        const separator = opt.indexOf("=");
        if (separator === -1) {
            return;
        }

        const flag = opt.slice(0, separator);
        const value = stripQuotes(opt.slice(separator + 1));

        if (flag === "--vars") {
            compilerOptionsObject.vars = { ...compilerOptionsObject.vars, ...parseVars(value) };
        } else if (COMPILER_FLAG_TO_API_KEY[flag]) {
            compilerOptionsObject[COMPILER_FLAG_TO_API_KEY[flag]] = value;
        }
    });

    return compilerOptionsObject;
}

function parseMultipleJSON(str: string) {
    /*
    NOTE: we do this because dataform cli v2.x returns multiple JSON objects in the same string
    so we need to parse them separately to ensure there is no error in parsing and we get the compilation metadata of Dataform project
    */
    const result = [];
    let startIndex = str.indexOf('{');
    let openBraces = 0;

    for (let i = startIndex; i < str.length; i++) {
        if (str[i] === '{') {
            if (openBraces === 0) { startIndex = i; };
            openBraces++;
        } else if (str[i] === '}') {
            openBraces--;
            if (openBraces === 0) {
                const jsonStr = str.substring(startIndex, i + 1);
                result.push(JSON.parse(jsonStr));
            }
        }
    }

    return result;
}

function extractDataformJsonFromMultipleJson(compiledString: string) {
    //NOTE: we do this because dataform cli v2.x returns multiple JSON objects in the same string. From observation, index 1 is the JSON object that has Dataform compilation metadata
    const parsedObjects = parseMultipleJSON(compiledString);
    if (parsedObjects.length >= 2) {
        return parsedObjects[1] as DataformCompiledJson;
    } else {
        const snippet = compiledString.length > 100 ? compiledString.substring(0, 100) + '...' : compiledString;
        throw new Error(`Failed to extract Dataform JSON: Expected at least 2 JSON objects, but found ${parsedObjects.length}. Context: ${snippet}`);
    }
}

export function parseCompiledString(compiledString: string): DataformCompiledJson {
    try {
        return JSON.parse(compiledString);
    } catch (parseError) {
        return extractDataformJsonFromMultipleJson(compiledString);
    }
}

export function getDataformCompilationTimeoutFromConfig() {
    let dataformCompilationTimeoutVal: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('defaultDataformCompileTime');
    if (dataformCompilationTimeoutVal) {
        return dataformCompilationTimeoutVal;
    }
    return "5m";
}

/**
 * Wall-clock deadline for an entire `dataform run`, passed as `--execution-timeout`.
 * Unset by default, matching the Dataform CLI, where the deadline is off unless asked for.
 * Note that `--timeout` only bounds the compilation step of a run.
 */
export function getDataformExecutionTimeoutFromConfig(): string | undefined {
    let dataformExecutionTimeoutVal: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('executionTimeout');
    if (dataformExecutionTimeoutVal) {
        return dataformExecutionTimeoutVal;
    }
    return undefined;
}

export function getDataformCompilerOptions() {
    let dataformCompilerOptions: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('compilerOptions');
    if (dataformCompilerOptions) {
        return dataformCompilerOptions;
    }
    return "";
}

export function getDataformCliCmdBasedOnScope(workspaceFolder: string): string {
    const dataformCliBase = isRunningOnWindows ? 'dataform.cmd' : 'dataform';
    const dataformCliScope: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('dataformCliScope');
    logger.debug(`Dataform CLI scope setting: ${dataformCliScope || 'not set (using global)'}`);

    if (dataformCliScope === 'local') {
        const dataformCliLocalScopePath = isRunningOnWindows
            ? path.join('node_modules', '.bin', 'dataform.cmd')
            : path.join('node_modules', '.bin', 'dataform');
        const fullLocalPath = path.join(workspaceFolder, dataformCliLocalScopePath);
        logger.debug(`Using local dataform CLI: ${fullLocalPath}`);
        return fullLocalPath;
    }

    const resolvedPath = findExecutableInPaths('dataform') || dataformCliBase;
    logger.debug(`Using global dataform CLI: ${resolvedPath}`);
    return resolvedPath;
}

/** The Dataform CLI a compile will run, and whether it comes from PATH, the executable path setting or the project's node_modules. */
function describeDataformCli(workspaceFolder: string): { cliPath: string, cliSource: "path" | "setting" | "local" } {
    const config = vscode.workspace.getConfiguration('vscode-dataform-tools');
    const cliPath = getDataformCliCmdBasedOnScope(workspaceFolder);
    if (config.get<string>('dataformCliScope') === 'local') {
        return { cliPath, cliSource: "local" };
    }
    const configuredPath = config.get<string>('dataformExecutablePath');
    return { cliPath, cliSource: configuredPath && cliPath === configuredPath ? "setting" : "path" };
}

/**
 * Compiles with the compiler options setting, or with `compilerOptionsOverride` (e.g. the prod options
 * used by defer to prod). An override compile leaves `compilerOptionsMap`, which API runs use, untouched.
 */
export function compileDataform(workspaceFolder: string, compilerOptionsOverride?: string): Promise<{ compiledString: string | undefined, errors: GraphError[] | undefined, possibleResolutions: string[] | undefined, compilationTimeMs: number | undefined }> {
    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();
    const isOverride = compilerOptionsOverride !== undefined;
    let dataformCompilerOptions = isOverride ? compilerOptionsOverride.trim() : getDataformCompilerOptions();
    let compilerOptions: string[] = [];
    if (dataformCompilerOptions !== "") {
        compilerOptions.push(dataformCompilerOptions);
    }
    logger.debug(`compilerOptions: ${compilerOptions}`);
    return new Promise((resolve, reject) => {
        const startTime = performance.now();
        let spawnedProcess;
        let customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder);
        logger.debug(`customDataformCliPath: ${customDataformCliPath}`);
        spawnedProcess = spawn(customDataformCliPath, ["compile", '"' + workspaceFolder + '"', ...compilerOptions, "--json", `--timeout=${dataformCompilationTimeoutVal}`], { shell: true });

        let stdOut = '';
        let errorOutput = '';

        spawnedProcess.stdout.on('data', (data: string) => {
            stdOut += data.toString();
        });

        spawnedProcess.stderr.on('data', (data: string) => {
            errorOutput += data.toString();
        });

        spawnedProcess.on('close', async (code: number) => {
            try {
                if (code === 0) {
                    if (!isOverride) {
                        if(compilerOptions.length>0){
                            globalThis.compilerOptionsMap = createCompilerOptionsObjectForApi(compilerOptions);
                        }else{
                            globalThis.compilerOptionsMap = {};
                        }
                        logger.debug(`compilerOptionsMap: ${JSON.stringify(globalThis.compilerOptionsMap)}`);
                    }
                    const endTime = performance.now();
                    resolve({ compiledString: stdOut, errors: undefined, possibleResolutions: undefined, compilationTimeMs: endTime - startTime });
                } else {
                    if (stdOut !== '') {
                        let compiledJson: DataformCompiledJson;
                        try {
                            compiledJson = JSON.parse(stdOut.toString());
                        } catch (parseError) {
                            compiledJson = extractDataformJsonFromMultipleJson(stdOut.toString());
                        }

                        let graphErrors = compiledJson?.graphErrors?.compilationErrors;
                        if (!graphErrors) {
                            const dataformPackageJsonMissingHint = "(missing dataform.json file)";
                            const dataformInstallHintv2 = "Could not find a recent installed version of @dataform/core in the project";
                            const possibleResolutions = [];
                            if (errorOutput.includes(dataformPackageJsonMissingHint)) {
                                possibleResolutions.push("Run `<b>dataform compile</b>` in terminal to get full error");
                                possibleResolutions.push("Verify the dataform version of the project matches the version used in the project (<b>dataform --version</b> in terminal)");
                                possibleResolutions.push("If your project is using dataform version 3.x run <b>npm i -g @dataform/cli</b> in terminal)");
                            } else if (errorOutput.includes(dataformInstallHintv2)) {
                                possibleResolutions.push("run `<b>dataform install</b>` in terminal followed by reload window and compile the file again");
                            }
                            const endTime = performance.now();
                            resolve({ compiledString: undefined, errors: [{ error: `Error compiling Dataform: ${errorOutput}`, fileName: "" }], possibleResolutions: possibleResolutions, compilationTimeMs: endTime - startTime });
                            return;
                        }

                        let errors: GraphError[] = [];
                        graphErrors.forEach((graphError: { message: string, fileName: string, stack?: string }) => {
                            errors.push({ error: graphError.message, fileName: graphError.fileName, stack: graphError.stack });
                        });
                        const endTime = performance.now();
                        resolve({ compiledString: undefined, errors: errors, possibleResolutions: undefined, compilationTimeMs: endTime - startTime });
                    } else {
                        let possibleResolutions = [];
                        const dataformInstallHintv3 = "If using `package.json`, then run `dataform install`";
                        if (errorOutput.includes(dataformInstallHintv3)) {
                            if (workspaceFolder) {
                                const filePath = path.join(workspaceFolder, 'package.json');
                                try {
                                    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                                    possibleResolutions.push("run `<b>dataform install</b>` in terminal");
                                } catch (error) {
                                    vscode.window.showInformationMessage(`Error: ${error}`);
                                }
                            }
                        } else if (errorOutput.includes(windowsDataformCliNotAvailableErrorMessage) || errorOutput.includes(linuxDataformCliNotAvailableErrorMessage)) {
                            possibleResolutions.push("Run `<b>npm install -g @dataform/cli</b>` in terminal");
                            possibleResolutions.push("Or compile with the Dataform API instead: set `<b>vscode-dataform-tools.compilationBackend</b>` to `<b>api</b>` (beta)");
                        };
                        const endTime = performance.now();
                        resolve({ compiledString: undefined, errors: [{ error: `Error compiling Dataform: ${errorOutput}`, fileName: "" }], possibleResolutions: possibleResolutions, compilationTimeMs: endTime - startTime });
                    }
                }
            } catch (err) {
                logger.error(`Error in spawnedProcess close handler: ${err}`);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });

        spawnedProcess.on('error', (err: Error) => {
            reject(err);
        });
    });
}

export async function runCompilation(workspaceFolder: string): Promise<{ dataformCompiledJson: DataformCompiledJson | undefined, errors: GraphError[] | undefined, possibleResolutions: string[] | undefined, compilationTimeMs: number | undefined }> {
    try {
        if (isRemoteMode()) {
            const { dataformCompiledJson, errors, compilationTimeMs } = await getRemoteCompiledJson(workspaceFolder);
            if (dataformCompiledJson) {
                CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
                buildIndices(dataformCompiledJson);
            }
            return { dataformCompiledJson, errors, possibleResolutions: undefined, compilationTimeMs };
        }

        let { compiledString, errors, possibleResolutions, compilationTimeMs } = await compileDataform(workspaceFolder);
        setCompilationInfo({ backend: "cli", compiledAt: Date.now(), durationMs: compilationTimeMs, fromCache: false, hasErrors: !compiledString, ...describeDataformCli(workspaceFolder) });
        if (compiledString) {
            const dataformCompiledJson = parseCompiledString(compiledString);
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
            buildIndices(dataformCompiledJson);
            logger.debug(`Successfully cached compiled dataform JSON. Targets: ${dataformCompiledJson.targets?.length || 0}, Declarations: ${dataformCompiledJson.declarations?.length || 0}`);
            return { dataformCompiledJson: dataformCompiledJson, errors: errors, possibleResolutions: possibleResolutions, compilationTimeMs };
        }
        return { dataformCompiledJson: undefined, errors: errors, possibleResolutions: possibleResolutions, compilationTimeMs };
    } catch (error: any) {
        logger.error(`runCompilation failed: ${error.message}`);
        return { dataformCompiledJson: undefined, errors: [{ error: `Error compiling Dataform: ${error.message}`, fileName: "" }], possibleResolutions: undefined, compilationTimeMs: undefined };
    }
}

export async function getOrCompileDataformJson(
    workspaceFolder: string
): Promise<DataformCompiledJson | undefined> {
    if (CACHED_COMPILED_DATAFORM_JSON) {
        logger.debug('Returning cached compiled dataform JSON');
        return CACHED_COMPILED_DATAFORM_JSON;
    }
    logger.debug('No cached compilation found, compiling dataform project...');
    const backend = isRemoteMode() ? "API" : "CLI";
    vscode.window.showWarningMessage(
        `Compiling Dataform project (${backend}), this may take a moment...`
    );
    const { dataformCompiledJson } = await runCompilation(workspaceFolder);
    return dataformCompiledJson;
}
