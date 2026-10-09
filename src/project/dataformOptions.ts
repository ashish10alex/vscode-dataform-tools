import * as vscode from 'vscode';
import type { DataformOptions } from '../backend/dataform/options';
import { getDataformCliCmdBasedOnScope } from '../utils/executableResolver';
import { currentDataformRoot } from './index';
import type { CompilationMode } from './tools';
import { extensionConfiguration } from './settings';

/*
 * The host's side of a Dataform compile: reads the settings a compile depends on and hands them over as plain data.
 * The compile code (src/utils/dataformCompiler.ts, src/utils/remoteCompiler.ts) reads no setting itself.
 */

const RELEASE_CONFIG_STATE_KEY = "vscode_dataform_tools_remote_release_config";

let extensionContext: vscode.ExtensionContext | undefined;

export function initDataformOptions(context: vscode.ExtensionContext) {
    extensionContext = context;
}

function compilationModeConfig() {
    const root = currentDataformRoot();
    return extensionConfiguration(root ? vscode.Uri.file(root) : vscode.workspace.workspaceFolders?.[0]?.uri);
}

/** Whether the Compilation Mode is API: the pushed commit is compiled with the Dataform API */
export function isRemoteMode(): boolean {
    return compilationModeConfig().get<string>('compilationBackend') === 'api';
}

/** True when the user has set the Compilation Mode at any scope, i.e. they have engaged with remote mode. */
export function isCompilationModeExplicitlySet(): boolean {
    const inspected = compilationModeConfig().inspect<string>('compilationBackend');
    return inspected?.globalValue !== undefined || inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined;
}

/**
 * Writes the Compilation Mode to the most specific scope that already has a value, so the change takes effect
 * instead of being shadowed by e.g. a workspace value when only the user setting is updated.
 */
export async function setCompilationMode(value: CompilationMode) {
    const config = compilationModeConfig();
    const target = pickConfigurationTarget(config.inspect<string>('compilationBackend'), !!vscode.workspace.workspaceFolders?.length);
    await config.update('compilationBackend', value, target);
}

/** The most specific scope that already has a value; the workspace (or user settings without one) otherwise. */
export function pickConfigurationTarget(
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

/** The settings of the Project at `root`; without one, of the active Project */
const settingsOf = (root?: string) => extensionConfiguration(root ? vscode.Uri.file(root) : undefined);

export function getDataformCompilationTimeoutFromConfig(root?: string) {
    let dataformCompilationTimeoutVal: string | undefined = settingsOf(root).get('defaultDataformCompileTime');
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
export function getDataformExecutionTimeoutFromConfig(root?: string): string | undefined {
    let dataformExecutionTimeoutVal: string | undefined = settingsOf(root).get('executionTimeout');
    if (dataformExecutionTimeoutVal) {
        return dataformExecutionTimeoutVal;
    }
    return undefined;
}

export function getDataformCompilerOptions(root?: string) {
    let dataformCompilerOptions: string | undefined = settingsOf(root).get('compilerOptions');
    if (dataformCompilerOptions) {
        return dataformCompilerOptions;
    }
    return "";
}

export function isPersistCompilationEnabled(root?: string): boolean {
    return settingsOf(root).get<boolean>('persistCompilation') ?? true;
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
    const config = settingsOf(root);
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
    const config = settingsOf(root);
    return {
        compilationMode,
        compilerOptions: getDataformCompilerOptions(root),
        compileTimeout: getDataformCompilationTimeoutFromConfig(root),
        executionTimeout: getDataformExecutionTimeoutFromConfig(root),
        cli: compilationMode === 'cli' ? describeDataformCli(root) : undefined,
        persistCompilation: isPersistCompilationEnabled(root),
        api: {
            gcpProjectId: config.get<string>('gcpProjectId') || undefined,
            serviceAccountJsonPath: config.get<string>('serviceAccountJsonPath') || undefined,
            releaseConfig: getSelectedReleaseConfig(),
        },
    };
}
