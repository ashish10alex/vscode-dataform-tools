import * as vscode from 'vscode';
import { spawn } from 'child_process';
import path from 'path';
import { logger } from '../logger';
import { windowsDataformCliNotAvailableErrorMessage, linuxDataformCliNotAvailableErrorMessage } from '../constants';
import { buildIndices } from './compiledJsonIndex';
import { findExecutableInPaths } from './executableResolver';
import { DataformCompiledJson, GraphError } from '../types';

//NOTE: maybe no test is needed as dataform cli compilation should catch any potential edge cases  ?
function stripQuotes(str:string) {
  return str.replace(/^['"]|['"]$/g, '');
}

function createCompilerOptionsObjectForApi(compilerOptions: string[]) {
    // NOTE: we might need to add support for more code compilation config items from https://cloud.google.com/nodejs/docs/reference/dataform/latest/dataform/protos.google.cloud.dataform.v1beta1.icodecompilationconfig
    let compilerOptionsObject: { [key: string]: string } = {};
    let compilerOptionsToApi = compilerOptions[0].split(" ");

    compilerOptionsToApi.forEach((opt: string) => {
        let value = opt.split("=")[1];
        value = stripQuotes(value);

        if (opt.startsWith("--table-prefix")) {
            compilerOptionsObject["tablePrefix"] = value;
        }

        if (opt.startsWith("--schema-suffix")) {
            compilerOptionsObject["schemaSuffix"] = value;
        }

        if (opt.startsWith("--database-suffix")) {
            compilerOptionsObject["databaseSuffix"] = value;
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
    if (parsedObjects.length > 0) {
        return parsedObjects[1] as DataformCompiledJson;
    } else {
        throw new Error("Failed to parse JSON");
    }
}

export function getDataformCompilationTimeoutFromConfig() {
    let dataformCompilationTimeoutVal: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('defaultDataformCompileTime');
    if (dataformCompilationTimeoutVal) {
        return dataformCompilationTimeoutVal;
    }
    return "5m";
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

export function compileDataform(workspaceFolder: string): Promise<{ compiledString: string | undefined, errors: GraphError[] | undefined, possibleResolutions: string[] | undefined, compilationTimeMs: number | undefined }> {
    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();
    let dataformCompilerOptions = getDataformCompilerOptions();
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
            if (code === 0) {
                if(compilerOptions.length>0){
                    globalThis.compilerOptionsMap = createCompilerOptionsObjectForApi(compilerOptions);
                }else{
                    globalThis.compilerOptionsMap = {};
                }

                logger.debug(`compilerOptionsMap: ${JSON.stringify(globalThis.compilerOptionsMap)}`);
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
                        const _workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                        if (_workspaceFolder) {
                            const filePath = path.join(_workspaceFolder, 'package.json');
                            const packageJsonExsists = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                            if (packageJsonExsists) {
                                possibleResolutions.push("run `<b>dataform install</b>` in terminal");
                            }
                        }
                    } else if (errorOutput.includes(windowsDataformCliNotAvailableErrorMessage) || errorOutput.includes(linuxDataformCliNotAvailableErrorMessage)) {
                        possibleResolutions.push("Run `<b>npm install -g @dataform/cli</b>` in terminal");
                    };
                    const endTime = performance.now();
                    resolve({ compiledString: undefined, errors: [{ error: `Error compiling Dataform: ${errorOutput}`, fileName: "" }], possibleResolutions: possibleResolutions, compilationTimeMs: endTime - startTime });
                }
            }
        });

        spawnedProcess.on('error', (err: Error) => {
            reject(err);
        });
    });
}

export async function runCompilation(workspaceFolder: string): Promise<{ dataformCompiledJson: DataformCompiledJson | undefined, errors: GraphError[] | undefined, possibleResolutions: string[] | undefined, compilationTimeMs: number | undefined }> {
    try {
        let { compiledString, errors, possibleResolutions, compilationTimeMs } = await compileDataform(workspaceFolder);
        if (compiledString) {
            let dataformCompiledJson: DataformCompiledJson;
            try {
                dataformCompiledJson = JSON.parse(compiledString);
            } catch (parseError) {
                dataformCompiledJson = extractDataformJsonFromMultipleJson(compiledString);
            }
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
            buildIndices(dataformCompiledJson);
            logger.debug(`Successfully cached compiled dataform JSON. Targets: ${dataformCompiledJson.targets?.length || 0}, Declarations: ${dataformCompiledJson.declarations?.length || 0}`);
            return { dataformCompiledJson: dataformCompiledJson, errors: errors, possibleResolutions: possibleResolutions, compilationTimeMs };
        }
        return { dataformCompiledJson: undefined, errors: errors, possibleResolutions: possibleResolutions, compilationTimeMs };
    } catch (error: any) {
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
    vscode.window.showWarningMessage(
        "Compiling Dataform project, this may take a moment..."
    );
    const { dataformCompiledJson } = await runCompilation(workspaceFolder);
    return dataformCompiledJson;
}
