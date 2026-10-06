import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import { logger } from '../logger';
import { perfCount, perfStart, perfTimed } from '../perf';
import { windowsDataformCliNotAvailableErrorMessage, linuxDataformCliNotAvailableErrorMessage } from '../constants';
import { clearCompiled, compiledJson, setCompiled } from '../project';
import { getDataformCliCmdBasedOnScope } from './executableResolver';
import { DataformCompiledJson, GraphError } from '../types';
import { getRemoteCompiledJson, isRemoteMode } from './remoteCompiler';
import { setCompilationInfo } from './compilationInfo';
import { CompileFingerprint, computeCompileFingerprint, fingerprintsMatch, isPersistCompilationEnabled, loadCliCompile, saveCliCompile, staleReason } from './cliCompileCache';

const compileFinished = new vscode.EventEmitter<DataformCompiledJson>();
/** Fires after a compile of the current files replaces the cached compilation */
export const onDidCompile = compileFinished.event;

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
    let inString = false;

    for (let i = startIndex; i < str.length; i++) {
        // Braces inside JSON strings (e.g. SQL like `select '{'`) must not change the depth
        if (inString) {
            if (str[i] === '\\') {
                i++;
            } else if (str[i] === '"') {
                inString = false;
            }
        } else if (str[i] === '"') {
            if (openBraces > 0) { inString = true; }
        } else if (str[i] === '{') {
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
type CliCompileOutput = { compiledString: string | undefined, errors: GraphError[] | undefined, possibleResolutions: string[] | undefined, compilationTimeMs: number | undefined };

export function compileDataform(workspaceFolder: string, compilerOptionsOverride?: string, onSpawn?: (child: ChildProcess) => void): Promise<CliCompileOutput> {
    perfCount('cli.compile');
    const endSpan = perfStart('compile', { override: compilerOptionsOverride !== undefined });
    const compilation = spawnDataformCompile(workspaceFolder, compilerOptionsOverride, onSpawn);
    compilation.then(() => endSpan(), () => endSpan({ failed: true }));
    return compilation;
}

function spawnDataformCompile(workspaceFolder: string, compilerOptionsOverride?: string, onSpawn?: (child: ChildProcess) => void): Promise<CliCompileOutput> {
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
        // Its own process group outside Windows, so killProcessTree can stop the CLI's compile worker too
        spawnedProcess = spawn(customDataformCliPath, ["compile", '"' + workspaceFolder + '"', ...compilerOptions, "--json", `--timeout=${dataformCompilationTimeoutVal}`], { shell: true, detached: !isRunningOnWindows });
        onSpawn?.(spawnedProcess);

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

type CompilationResult = { dataformCompiledJson: DataformCompiledJson | undefined, errors: GraphError[] | undefined, possibleResolutions: string[] | undefined, compilationTimeMs: number | undefined };

/** Bumped by every CLI compile, so a slower earlier compile cannot replace the result of a later one */
let latestCompileId = 0;
/** The CLI compile of the project in flight. A later one kills it and hands its callers the later result */
let cliCompileInFlight: { child?: ChildProcess, handOver?: Promise<CompilationResult> } | undefined;

/** Stops a CLI compile and the compile worker it forked */
function killProcessTree(child: ChildProcess) {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    try {
        if (isRunningOnWindows) {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
            process.kill(-child.pid, 'SIGTERM');
        }
    } catch (error) {
        logger.debug(`Could not stop a superseded compilation: ${error}`);
    }
}
/**
 * Answers a compile whose inputs have not changed since without running the CLI: the compilation loaded
 * from disk on startup, the outcome of the startup compile, or the last successful compile. A failure is
 * only handed out once.
 */
let reusable: { fingerprint: CompileFingerprint, result: CompilationResult } | undefined;
/** The startup compile, which a compile of the same inputs joins instead of starting another */
let startupCompile: { fingerprint: CompileFingerprint, promise: Promise<CompilationResult> } | undefined;
/** The cached JSON is a saved compilation of inputs that have changed since, shown until the startup compile replaces it */
let stale = false;
let onStartupCompileSettled: (() => void) | undefined;

export function isCompilationStale(): boolean {
    return stale;
}

export function setOnStartupCompileSettled(callback: () => void) {
    onStartupCompileSettled = callback;
}

function currentFingerprint(workspaceFolder: string): Promise<CompileFingerprint> {
    return computeCompileFingerprint(workspaceFolder, getDataformCliCmdBasedOnScope(workspaceFolder), getDataformCompilerOptions());
}

function compileWithCli(workspaceFolder: string, fingerprint?: CompileFingerprint): Promise<CompilationResult> {
    const previous = cliCompileInFlight;
    const current: NonNullable<typeof cliCompileInFlight> = {};
    cliCompileInFlight = current;
    const result = runCliCompile(workspaceFolder, fingerprint, current).then((compiled) => {
        // Killed or overtaken by a later compile: its callers get the later, more current result
        return current.handOver ?? compiled;
    }).finally(() => {
        if (cliCompileInFlight === current) {
            cliCompileInFlight = undefined;
        }
    });
    if (previous) {
        previous.handOver = result;
        if (previous.child) {
            logger.debug('Stopping a compilation that a later one replaces');
            killProcessTree(previous.child);
        }
    }
    return result;
}

async function runCliCompile(workspaceFolder: string, fingerprint: CompileFingerprint | undefined, inFlight: NonNullable<typeof cliCompileInFlight>): Promise<CompilationResult> {
    const compileId = ++latestCompileId;
    reusable = undefined;
    let compiled: Awaited<ReturnType<typeof compileDataform>>;
    let dataformCompiledJson: DataformCompiledJson | undefined;
    try {
        compiled = await compileDataform(workspaceFolder, undefined, (child) => { inFlight.child = child; });
        if (inFlight.handOver) {
            // Killed: its output is incomplete
            return { dataformCompiledJson: undefined, errors: undefined, possibleResolutions: undefined, compilationTimeMs: undefined };
        }
        dataformCompiledJson = compiled.compiledString ? parseCompiledString(compiled.compiledString) : undefined;
    } catch (error: any) {
        if (inFlight.handOver) {
            return { dataformCompiledJson: undefined, errors: undefined, possibleResolutions: undefined, compilationTimeMs: undefined };
        }
        // A CLI that fails to start, or output that does not parse, is a failed compile like any other: a rejection
        // would leave compiles joined on the startup compile failing, and the outdated saved compilation in use
        logger.error(`Dataform CLI compilation failed: ${error?.message ?? error}`);
        compiled = { compiledString: undefined, errors: [{ error: `Error compiling Dataform: ${error?.message ?? error}`, fileName: "" }], possibleResolutions: undefined, compilationTimeMs: undefined };
    }
    const { compiledString, errors, possibleResolutions, compilationTimeMs } = compiled;
    const superseded = compileId !== latestCompileId;
    if (!superseded) {
        setCompilationInfo({ backend: "cli", compiledAt: Date.now(), durationMs: compilationTimeMs, fromCache: false, hasErrors: !dataformCompiledJson, ...describeDataformCli(workspaceFolder) });
    }
    if (compiledString && dataformCompiledJson) {
        if (superseded) {
            logger.debug('Discarding a compilation that finished after a later one started');
            return { dataformCompiledJson, errors, possibleResolutions, compilationTimeMs };
        }
        setCompiled(workspaceFolder, dataformCompiledJson);
        stale = false;
        compileFinished.fire(dataformCompiledJson);
        if (fingerprint) {
            saveCliCompile({ workspaceFolder, fingerprint, compiledAt: Date.now() }, compiledString);
            // Taken before the compile, so an edit made while it ran still forces the next one
            reusable = { fingerprint, result: { dataformCompiledJson, errors, possibleResolutions, compilationTimeMs } };
        }
        logger.debug(`Successfully cached compiled dataform JSON. Targets: ${dataformCompiledJson.targets?.length || 0}, Declarations: ${dataformCompiledJson.declarations?.length || 0}`);
        return { dataformCompiledJson: dataformCompiledJson, errors: errors, possibleResolutions: possibleResolutions, compilationTimeMs };
    }
    if (stale && !superseded) {
        // The saved compilation must not outlive a failed compile of the current files
        clearCompiled(workspaceFolder);
        stale = false;
    }
    return { dataformCompiledJson: undefined, errors: errors, possibleResolutions: possibleResolutions, compilationTimeMs };
}

export async function runCompilation(workspaceFolder: string): Promise<CompilationResult> {
    try {
        if (isRemoteMode()) {
            const { dataformCompiledJson, errors, compilationTimeMs } = await getRemoteCompiledJson(workspaceFolder);
            if (dataformCompiledJson) {
                setCompiled(workspaceFolder, dataformCompiledJson);
                compileFinished.fire(dataformCompiledJson);
            }
            return { dataformCompiledJson, errors, possibleResolutions: undefined, compilationTimeMs };
        }

        if (!isPersistCompilationEnabled()) {
            return await compileWithCli(workspaceFolder);
        }
        const fingerprint = await currentFingerprint(workspaceFolder);
        if (reusable && fingerprintsMatch(reusable.fingerprint, fingerprint)) {
            logger.debug('Compile inputs unchanged since the last compilation, reusing it');
            const { result } = reusable;
            if (!result.dataformCompiledJson) {
                reusable = undefined;
            }
            return result;
        }
        if (startupCompile && fingerprintsMatch(startupCompile.fingerprint, fingerprint)) {
            logger.debug('Joining the startup compilation');
            return await startupCompile.promise;
        }
        return await compileWithCli(workspaceFolder, fingerprint);
    } catch (error: any) {
        logger.error(`runCompilation failed: ${error.message}`);
        return { dataformCompiledJson: undefined, errors: [{ error: `Error compiling Dataform: ${error.message}`, fileName: "" }], possibleResolutions: undefined, compilationTimeMs: undefined };
    }
}

/**
 * Called on activation: loads the project's saved compilation so the compiled query panel can show it without
 * waiting for the CLI. When the project changed since (or nothing was saved), compiles in the background; a
 * changed project's saved compilation is shown as outdated meanwhile.
 */
export async function prewarmCliCompilation(workspaceFolder: string): Promise<void> {
    if (isRemoteMode() || !isPersistCompilationEnabled()) {
        return;
    }
    const [fingerprint, saved] = await Promise.all([currentFingerprint(workspaceFolder), loadCliCompile(workspaceFolder)]);
    if (latestCompileId !== 0 || compiledJson(workspaceFolder)) {
        return; // Something compiled while the saved compilation was being read
    }

    let savedJson: DataformCompiledJson | undefined;
    if (saved) {
        try {
            savedJson = parseCompiledString(saved.compiledString);
        } catch (error) {
            logger.error(`Ignoring an unreadable saved compilation: ${error}`);
        }
    }
    if (saved && savedJson) {
        const reason = staleReason(saved.meta.fingerprint, fingerprint);
        setCompiled(workspaceFolder, savedJson);
        const compilerOptions = getDataformCompilerOptions();
        globalThis.compilerOptionsMap = compilerOptions ? createCompilerOptionsObjectForApi([compilerOptions]) : {};
        setCompilationInfo({ backend: "cli", compiledAt: saved.meta.compiledAt, fromCache: true, stale: !!reason, staleReason: reason, ...describeDataformCli(workspaceFolder) });
        if (!reason) {
            logger.info('Loaded the saved compilation; compile inputs are unchanged');
            reusable = { fingerprint, result: { dataformCompiledJson: savedJson, errors: undefined, possibleResolutions: undefined, compilationTimeMs: undefined } };
            perfStart('startup.compile', { source: 'saved' })();
            return;
        }
        logger.info(`Showing the saved compilation until a fresh one finishes: ${reason}`);
        stale = true;
    }

    const promise = perfTimed('startup.compile', () => compileWithCli(workspaceFolder, fingerprint), { source: 'cli' });
    const compileId = latestCompileId;
    startupCompile = { fingerprint, promise };
    // compileWithCli reports failures in its result rather than rejecting
    promise.then((result) => {
        if (startupCompile?.promise === promise) {
            startupCompile = undefined;
        }
        if (compileId === latestCompileId) {
            reusable = { fingerprint, result };
            onStartupCompileSettled?.();
        }
    }).catch((error) => logger.error(`Failed to finish the startup compilation: ${error}`));
}

/** Waits for a fresh compilation when the cached JSON is an outdated saved one, so nothing is run or estimated from it. */
export async function ensureFreshCompilation(workspaceFolder: string): Promise<void> {
    if (stale && !isRemoteMode()) {
        await runCompilation(workspaceFolder);
    }
}

export async function getOrCompileDataformJson(
    workspaceFolder: string
): Promise<DataformCompiledJson | undefined> {
    await ensureFreshCompilation(workspaceFolder);
    const compiled = compiledJson(workspaceFolder);
    if (compiled) {
        logger.debug('Returning cached compiled dataform JSON');
        return compiled;
    }
    logger.debug('No cached compilation found, compiling dataform project...');
    const backend = isRemoteMode() ? "API" : "CLI";
    vscode.window.showWarningMessage(
        `Compiling Dataform project (${backend}), this may take a moment...`
    );
    const { dataformCompiledJson } = await runCompilation(workspaceFolder);
    return dataformCompiledJson;
}
