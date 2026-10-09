import * as vscode from 'vscode';
import { projects } from './index';
import { projectFileSettings, SETTINGS_SECTION, settingsFileOf } from './settingsFile';

/*
 * The extension's settings, as every part of it reads them. They are VS Code's, except that a Project below a
 * workspace folder also has those of its own `.vscode/settings.json`, which VS Code does not read there.
 */

/** The root of the Project the settings are asked for: that of `scope`, else the active one. Only when VS Code does not read its settings file */
function projectBelowAFolder(scope: vscode.Uri | undefined): string | undefined {
    let root: string | undefined;
    if (scope?.scheme === 'file') {
        const found = projects.forFile(scope.fsPath);
        root = found.kind === 'project' ? found.project.root : found.kind === 'ambiguous' ? found.candidates[0].root : undefined;
    } else if (!scope) {
        root = projects.active?.root;
    }
    if (!root || (vscode.workspace.workspaceFolders ?? []).some((folder) => folder.uri.fsPath === root)) {
        return undefined;
    }
    return root;
}

/**
 * The extension's settings for `scope`, a file or a Project root; without one, for the active Project. What the
 * Project's own settings file sets comes before what the window sets, as a workspace folder's settings do. Writes go
 * to VS Code's settings. A window that is not trusted reads no file of its own accord.
 */
export function extensionConfiguration(scope?: vscode.Uri): vscode.WorkspaceConfiguration {
    const ofWindow = vscode.workspace.getConfiguration(SETTINGS_SECTION, scope);
    const root = vscode.workspace.isTrusted ? projectBelowAFolder(scope) : undefined;
    const ofProject = root ? projectFileSettings(root) : {};
    if (Object.keys(ofProject).length === 0) {
        return ofWindow;
    }
    const has = (name: string) => Object.prototype.hasOwnProperty.call(ofProject, name);
    const configuration = {
        get: (name: string, defaultValue?: unknown) => (has(name) ? ofProject[name] : ofWindow.get(name, defaultValue)),
        has: (name: string) => has(name) || ofWindow.has(name),
        inspect: (name: string) => {
            const inspected = ofWindow.inspect(name);
            return has(name) ? { ...(inspected ?? { key: `${SETTINGS_SECTION}.${name}` }), workspaceFolderValue: ofProject[name] } : inspected;
        },
        update: async (name: string, ...rest: [unknown, (vscode.ConfigurationTarget | boolean | null)?, boolean?]) => {
            await ofWindow.update(name, ...rest);
            if (has(name)) {
                // The write went to the window's settings, and the Project's file is read before them
                void vscode.window.showWarningMessage(`"${SETTINGS_SECTION}.${name}" is set in ${vscode.workspace.asRelativePath(settingsFileOf(root!))}, which comes before the window's settings. Change it there for it to take effect.`);
            }
        },
    };
    return configuration as unknown as vscode.WorkspaceConfiguration;
}
