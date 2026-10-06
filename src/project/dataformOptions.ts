import * as vscode from 'vscode';
import type { DataformOptions } from '../backend/dataform/options';
import { getDataformCliCmdBasedOnScope } from '../utils/executableResolver';
import { currentDataformRoot } from './index';
import type { CompilationMode } from './tools';

/*
 * The host's side of a Dataform compile: reads the settings a compile depends on and hands them over as plain data.
 * The compile code (src/utils/dataformCompiler.ts, src/utils/remoteCompiler.ts) reads no setting itself.
 */

const RELEASE_CONFIG_STATE_KEY = "vscode_dataform_tools_remote_release_config";

let extensionContext: vscode.ExtensionContext | undefined;

export function initDataformOptions(context: vscode.ExtensionContext) {
    extensionContext = context;
}

function backendConfig() {
    const root = currentDataformRoot();
    return vscode.workspace.getConfiguration('vscode-dataform-tools', root ? vscode.Uri.file(root) : vscode.workspace.workspaceFolders?.[0]?.uri);
}

/** Whether the Compilation Mode is API: the pushed commit is compiled with the Dataform API */
export function isRemoteMode(): boolean {
    return backendConfig().get<string>('compilationBackend') === 'api';
}

/** True when the user has set the Compilation Mode at any scope, i.e. they have engaged with remote mode. */
export function isBackendExplicitlySet(): boolean {
    const inspected = backendConfig().inspect<string>('compilationBackend');
    return inspected?.globalValue !== undefined || inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined;
}

/**
 * Writes the Compilation Mode to the most specific scope that already has a value, so the change takes effect
 * instead of being shadowed by e.g. a workspace value when only the user setting is updated.
 */
export async function setCompilationBackend(value: CompilationMode) {
    const config = backendConfig();
    const target = pickBackendConfigurationTarget(config.inspect<string>('compilationBackend'), !!vscode.workspace.workspaceFolders?.length);
    await config.update('compilationBackend', value, target);
}

/** The most specific scope that already has a value; the workspace (or user settings without one) otherwise. */
export function pickBackendConfigurationTarget(
    inspected: { globalValue?: unknown, workspaceValue?: unknown, workspaceFolderValue?: unknown } | undefined,
    hasWorkspace: boolean
): vscode.ConfigurationTarget {
    if (inspected?.workspaceFolderValue !== undefined) {
        return vscode.ConfigurationTarget.WorkspaceFolder;
    }
    if (inspected?.workspaceValue !== undefined) {
        return vscode.ConfigurationTarget.Workspace;
    }
    if (inspected?.globalValue !== undefined || !hasWorkspace) {
        return vscode.ConfigurationTarget.Global;
    }
    return vscode.ConfigurationTarget.Workspace;
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

export function isPersistCompilationEnabled(): boolean {
    return vscode.workspace.getConfiguration('vscode-dataform-tools').get<boolean>('persistCompilation') ?? true;
}

/** The release config remote mode compiles with, by its full name; undefined for the default settings */
export function getSelectedReleaseConfig(): string | undefined {
    return extensionContext?.workspaceState.get<string>(RELEASE_CONFIG_STATE_KEY);
}

export async function setSelectedReleaseConfig(releaseConfig: string | undefined) {
    await extensionContext?.workspaceState.update(RELEASE_CONFIG_STATE_KEY, releaseConfig);
}

/** The Dataform CLI a compile will run, and whether it comes from PATH, the executable path setting or the project's node_modules. */
function describeDataformCli(root: string): NonNullable<DataformOptions['cli']> {
    const config = vscode.workspace.getConfiguration('vscode-dataform-tools');
    const cliPath = getDataformCliCmdBasedOnScope(root);
    if (config.get<string>('dataformCliScope') === 'local') {
        return { path: cliPath, source: "local" };
    }
    const configuredPath = config.get<string>('dataformExecutablePath');
    return { path: cliPath, source: configuredPath && cliPath === configuredPath ? "setting" : "path" };
}

/**
 * What a compile of the Dataform Project at `root` is to be told, as the settings stand now. Resolve it for each
 * compile: a setting may have changed since the last one. `compilationMode` is for a caller that has already chosen
 * how to compile, whatever the setting says by now.
 */
export function resolveDataformOptions(root: string, compilationMode: CompilationMode = isRemoteMode() ? 'api' : 'cli'): DataformOptions {
    const config = vscode.workspace.getConfiguration('vscode-dataform-tools');
    return {
        compilationMode,
        compilerOptions: getDataformCompilerOptions(),
        compileTimeout: getDataformCompilationTimeoutFromConfig(),
        executionTimeout: getDataformExecutionTimeoutFromConfig(),
        cli: compilationMode === 'cli' ? describeDataformCli(root) : undefined,
        persistCompilation: isPersistCompilationEnabled(),
        api: {
            gcpProjectId: config.get<string>('gcpProjectId') || undefined,
            serviceAccountJsonPath: config.get<string>('serviceAccountJsonPath') || undefined,
            releaseConfig: getSelectedReleaseConfig(),
        },
    };
}
