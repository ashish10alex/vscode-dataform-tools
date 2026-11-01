import * as vscode from 'vscode';
import { currentDataformRoot, onDidChangeActiveProject, projects } from '../project';
import { getDeferAvailability, isDeferEnabled } from './index';
import { clearProdTargetCache } from './prodTargets';
import { clearTableExistenceCache } from './tableExistence';
import { removeProxyViews } from './proxyViews';
import { getOrCompileDataformJson } from '../utils/dataformCompiler';
import { pickConfigurationTarget, resolveDataformOptions } from '../project/dataformOptions';
import { extensionConfiguration } from '../project/settings';
import { dbtOptions, dbtSettings, forgetDbtCompile } from '../project/dbtCompile';
import { dbtDeferToProdState, dbtProdTarget, forgetDbtProdManifest } from '../project/dbtDefer';
import type { ProjectState } from '../project/registry';
import { joinProdOptions, splitProdProject } from '../shared/prodOptions';
import { readDefaultProjectFromSettings } from '../utils/remoteCompiler';
import { projectFileSettings, SETTINGS_SECTION, settingsFileOf, settingValueRange } from '../project/settingsFile';

/*
 * Status bar toggle for defer to prod, and the commands behind it. Changing a defer setting refreshes the
 * compiled query panel so its SQL and banner follow straight away.
 *
 * The switch is one setting for both Backends. In a dbt Project dbt defers itself, to the manifest of the prod dbt
 * target (src/project/dbtDefer.ts): there are no prod compiler options and no proxy views there.
 */

const DEFER_SETTINGS = ['deferToProd', 'prodCompilerOptions', 'compilerOptions', 'dbtProdTarget', 'dbtTarget'];

/** The active Project when it is a dbt one: defer to prod is then dbt's */
function activeDbtProject(): ProjectState | undefined {
    return projects.active?.backend === 'dbt' ? projects.active : undefined;
}

/** The dbt target the Project is compiled and run with, where it is known */
function dbtTargetInUse(project: ProjectState): string | undefined {
    return dbtSettings(project.root).target ?? project.dbtBackend?.lastResult?.target;
}

let statusBarItem: vscode.StatusBarItem | undefined;
/** Redraws the compiled query panel; set by `initDeferToProd` */
let refreshPanelAfterWrite: (() => Promise<void> | void) | undefined;

function currentWorkspaceFolder(): string | undefined {
    return activeDbtProject()?.root ?? currentDataformRoot() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function refreshStatusBar() {
    if (!statusBarItem) {
        return;
    }
    const workspaceFolder = currentWorkspaceFolder();
    if (!workspaceFolder) {
        statusBarItem.hide();
        return;
    }
    statusBarItem.backgroundColor = undefined;
    const dbt = activeDbtProject();
    if (dbt) {
        const state = dbtDeferToProdState(dbt.root, dbtTargetInUse(dbt));
        if (!state.enabled) {
            statusBarItem.text = "$(circle-slash) Defer: off";
            statusBarItem.tooltip = "Defer to prod is off: upstream tables are read from your dbt target. Click for options.";
        } else if (state.available) {
            statusBarItem.text = "$(cloud-download) Defer: prod";
            statusBarItem.tooltip = `Upstream tables not built in your dbt target are read from prod in the compiled query, dry runs, previews and runs (dbt --defer, to the dbt target ${dbtProdTarget(dbt.root)}). Click for options.`;
        } else {
            statusBarItem.text = "$(warning) Defer: prod";
            statusBarItem.tooltip = `Defer to prod is on but not applied. ${state.reason}`;
            statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        }
    } else if (!isDeferEnabled(workspaceFolder)) {
        statusBarItem.text = "$(circle-slash) Defer: off";
        statusBarItem.tooltip = "Defer to prod is off: upstream tables are read from dev. Click for options.";
    } else {
        const availability = getDeferAvailability(workspaceFolder);
        if (availability.available) {
            statusBarItem.text = "$(cloud-download) Defer: prod";
            statusBarItem.tooltip = `Upstream tables not built in dev are read from prod in previews, dry runs and runs${availability.prodOptions ? ` (${availability.prodOptions})` : " (project defaults)"}. Click for options.`;
        } else {
            statusBarItem.text = "$(warning) Defer: prod";
            statusBarItem.tooltip = `Defer to prod is on but not applied. ${availability.reason}`;
            statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        }
    }
    statusBarItem.show();
}

/** Flips defer to prod, or sets it to `enabled` when given, so a caller with a stale view of the setting cannot invert it */
async function toggleDeferToProd(enabled?: boolean) {
    const workspaceFolder = currentWorkspaceFolder();
    const config = extensionConfiguration(workspaceFolder ? vscode.Uri.file(workspaceFolder) : undefined);
    const target = pickConfigurationTarget(config.inspect<boolean>('deferToProd'), !!vscode.workspace.workspaceFolders?.length);
    const value = typeof enabled === 'boolean' ? enabled : !isDeferEnabled(workspaceFolder);
    if (value === isDeferEnabled(workspaceFolder)) {
        return;
    }
    await config.update('deferToProd', value, target);
}

/**
 * Writes the prodCompilerOptions setting where it is already set, so a User setting does not leak into the team's
 * workspace settings. A Project below a workspace folder that sets it in its own `.vscode/settings.json` has it
 * changed there, as VS Code's settings come after that file.
 */
export async function setProdCompilerOptions(prodOptions: string) {
    const workspaceFolder = currentWorkspaceFolder();
    const ownFile = workspaceFolder && !(vscode.workspace.workspaceFolders ?? []).some((folder) => folder.uri.fsPath === workspaceFolder)
        && Object.prototype.hasOwnProperty.call(projectFileSettings(workspaceFolder), 'prodCompilerOptions');
    if (ownFile) {
        await setInProjectFile(workspaceFolder, prodOptions.trim());
        return;
    }
    const config = extensionConfiguration(workspaceFolder ? vscode.Uri.file(workspaceFolder) : undefined);
    const target = pickConfigurationTarget(config.inspect<string>('prodCompilerOptions'), !!vscode.workspace.workspaceFolders?.length);
    await config.update('prodCompilerOptions', prodOptions.trim(), target);
}

/**
 * Replaces the string value of prodCompilerOptions in the Project's own settings file, keeping its comments, then
 * does what a change of the setting does, as VS Code sends no event for that file. Where the value cannot be
 * replaced in place (it is not a string, or the file has unsaved edits) the file is opened for the user to change.
 */
async function setInProjectFile(root: string, prodOptions: string) {
    const uri = vscode.Uri.file(settingsFileOf(root));
    const document = await vscode.workspace.openTextDocument(uri);
    const range = settingValueRange(document.getText(), 'prodCompilerOptions');
    if (!range || document.isDirty) {
        await vscode.window.showTextDocument(document);
        void vscode.window.showWarningMessage(`This Project sets "${SETTINGS_SECTION}.prodCompilerOptions" in ${vscode.workspace.asRelativePath(uri)}. Set it there to "${prodOptions}".`);
        return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(document.positionAt(range.start), document.positionAt(range.end)), JSON.stringify(prodOptions));
    if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save())) {
        void vscode.window.showWarningMessage(`Could not write prodCompilerOptions to ${vscode.workspace.asRelativePath(uri)}.`);
        return;
    }
    refreshStatusBar();
    await clearDeferCaches();
    await refreshPanelAfterWrite?.();
}

/** Asks for the Google Cloud project prod is in and keeps the other prod compiler options */
async function askForProdProject() {
    const workspaceFolder = currentWorkspaceFolder();
    const { project, rest } = splitProdProject(extensionConfiguration(workspaceFolder ? vscode.Uri.file(workspaceFolder) : undefined).get<string>('prodCompilerOptions'));
    const defaultProject = workspaceFolder ? readDefaultProjectFromSettings(workspaceFolder) : undefined;
    const typed = await vscode.window.showInputBox({
        title: "Defer to prod: prod project",
        prompt: `The Google Cloud project of your prod tables, given to the prod compile as --default-database.${defaultProject ? ` Leave it empty for the project default, ${defaultProject}.` : ""}`,
        placeHolder: defaultProject ?? "my-prod-project",
        value: project,
    });
    if (typed !== undefined) {
        await setProdCompilerOptions(joinProdOptions(typed, rest));
    }
}

async function clearDeferCaches() {
    clearTableExistenceCache({ includeUnreadable: true });
    await clearProdTargetCache();
}

/** Forgets the Project's prod manifest and what was compiled with it: the panel's next showing of the file parses prod and compiles again */
async function forgetDbtDefer(project: ProjectState) {
    await forgetDbtProdManifest(project, await dbtOptions(project.root));
    forgetDbtCompile(project);
}

/** Forgets the prod compile and table listings, then redraws the panel, which looks everything up again */
async function refreshDeferToProd(refreshPanel: () => Promise<void> | void) {
    const dbt = activeDbtProject();
    if (dbt) {
        await forgetDbtDefer(dbt);
    } else {
        await clearDeferCaches();
    }
    await refreshPanel();
}

/** `ids` limits it to those proxy views, as the compiled query panel already knows them; otherwise the whole project is scanned */
async function removeProxyViewsCommand(ids?: string[]) {
    if (Array.isArray(ids) && ids.length > 0) {
        await removeProxyViews(undefined, ids);
        return;
    }
    const workspaceFolder = currentWorkspaceFolder();
    await removeProxyViews(workspaceFolder ? await getOrCompileDataformJson(workspaceFolder, resolveDataformOptions(workspaceFolder)) : undefined);
}

async function deferToProdActions(refreshPanel: () => Promise<void> | void) {
    const enabled = isDeferEnabled(currentWorkspaceFolder());
    const actions = activeDbtProject() ? [
        { label: enabled ? "$(circle-slash) Turn off defer to prod" : "$(cloud-download) Turn on defer to prod", run: () => toggleDeferToProd() },
        {
            label: "$(refresh) Parse the prod manifest again",
            description: "For when the prod dbt target of your profile has changed",
            run: () => refreshDeferToProd(refreshPanel),
        },
        {
            label: "$(settings) Open defer to prod settings",
            run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-dataform-tools dbtProdTarget deferToProd'),
        },
    ] : [
        { label: enabled ? "$(circle-slash) Turn off defer to prod" : "$(cloud-download) Turn on defer to prod", run: () => toggleDeferToProd() },
        {
            label: "$(edit) Set the prod project",
            description: "The Google Cloud project prod tables are read from (--default-database)",
            run: () => askForProdProject(),
        },
        {
            label: "$(refresh) Refresh prod targets and table cache",
            description: "Recompile with the prod options and look up dev and prod tables again",
            run: () => refreshDeferToProd(refreshPanel),
        },
        {
            label: "$(trash) Remove proxy views",
            description: "Delete the dev views that deferred runs created",
            run: () => removeProxyViewsCommand(),
        },
        {
            label: "$(settings) Open defer to prod settings",
            run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-dataform-tools prodCompilerOptions deferToProd deferPreviewScanWarningGiB'),
        },
    ];
    const picked = await vscode.window.showQuickPick(actions, { placeHolder: "Defer to prod" });
    await picked?.run();
}

export function initDeferToProd(context: vscode.ExtensionContext, refreshPanel: () => Promise<void> | void) {
    refreshPanelAfterWrite = refreshPanel;
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
    statusBarItem.command = 'vscode-dataform-tools.deferToProdActions';
    context.subscriptions.push(
        statusBarItem,
        onDidChangeActiveProject(() => refreshStatusBar()),
        vscode.commands.registerCommand('vscode-dataform-tools.toggleDeferToProd', toggleDeferToProd),
        vscode.commands.registerCommand('vscode-dataform-tools.deferToProdActions', () => deferToProdActions(refreshPanel)),
        vscode.commands.registerCommand('vscode-dataform-tools.removeProxyViews', removeProxyViewsCommand),
        vscode.commands.registerCommand('vscode-dataform-tools.refreshDeferToProd', () => refreshDeferToProd(refreshPanel)),
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (!DEFER_SETTINGS.some((setting) => event.affectsConfiguration(`vscode-dataform-tools.${setting}`))) {
                return;
            }
            refreshStatusBar();
            if (activeDbtProject()) {
                // The panel follows these settings itself: it shows the dbt file again, which compiles it
                return;
            }
            if (event.affectsConfiguration('vscode-dataform-tools.prodCompilerOptions')) {
                await clearDeferCaches();
            }
            // The compiler options setting only changes whether defer is available; it does not recompile today
            if (event.affectsConfiguration('vscode-dataform-tools.deferToProd') || event.affectsConfiguration('vscode-dataform-tools.prodCompilerOptions')) {
                await refreshPanel();
            }
        }),
    );
    refreshStatusBar();
}
