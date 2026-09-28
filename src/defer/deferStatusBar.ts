import * as vscode from 'vscode';
import { pickBackendConfigurationTarget } from '../utils/remoteCompiler';
import { getDeferAvailability, isDeferEnabled } from './index';
import { clearProdTargetCache } from './prodTargets';
import { clearTableExistenceCache } from './tableExistence';

/*
 * Status bar toggle for defer to prod, and the commands behind it. Changing a defer setting refreshes the
 * compiled query panel so its SQL and banner follow straight away.
 */

const DEFER_SETTINGS = ['deferToProd', 'prodCompilerOptions', 'compilerOptions'];

let statusBarItem: vscode.StatusBarItem | undefined;

function currentWorkspaceFolder(): string | undefined {
    return globalThis.workspaceFolder || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
    if (!isDeferEnabled(workspaceFolder)) {
        statusBarItem.text = "$(circle-slash) Defer: off";
        statusBarItem.tooltip = "Defer to prod is off: upstream tables are read from dev. Click for options.";
    } else {
        const availability = getDeferAvailability(workspaceFolder);
        if (availability.available) {
            statusBarItem.text = "$(cloud-download) Defer: prod";
            statusBarItem.tooltip = `Upstream tables not built in dev are read from prod${availability.prodOptions ? ` (${availability.prodOptions})` : " (project defaults)"}. Click for options.`;
        } else {
            statusBarItem.text = "$(warning) Defer: prod";
            statusBarItem.tooltip = `Defer to prod is on but not applied. ${availability.reason}`;
            statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        }
    }
    statusBarItem.show();
}

async function toggleDeferToProd() {
    const workspaceFolder = currentWorkspaceFolder();
    const config = vscode.workspace.getConfiguration('vscode-dataform-tools', workspaceFolder ? vscode.Uri.file(workspaceFolder) : undefined);
    const target = pickBackendConfigurationTarget(config.inspect<boolean>('deferToProd'), !!vscode.workspace.workspaceFolders?.length);
    await config.update('deferToProd', !isDeferEnabled(workspaceFolder), target);
}

async function clearDeferCaches() {
    clearTableExistenceCache({ includeUnreadable: true });
    await clearProdTargetCache();
}

async function deferToProdActions(refreshPanel: () => Promise<void> | void) {
    const enabled = isDeferEnabled(currentWorkspaceFolder());
    const actions = [
        { label: enabled ? "$(circle-slash) Turn off defer to prod" : "$(cloud-download) Turn on defer to prod", run: toggleDeferToProd },
        {
            label: "$(refresh) Refresh prod targets and table cache",
            description: "Recompile with the prod options and look up dev and prod tables again",
            run: async () => {
                await clearDeferCaches();
                await refreshPanel();
            },
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
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
    statusBarItem.command = 'vscode-dataform-tools.deferToProdActions';
    context.subscriptions.push(
        statusBarItem,
        vscode.commands.registerCommand('vscode-dataform-tools.toggleDeferToProd', toggleDeferToProd),
        vscode.commands.registerCommand('vscode-dataform-tools.deferToProdActions', () => deferToProdActions(refreshPanel)),
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (!DEFER_SETTINGS.some((setting) => event.affectsConfiguration(`vscode-dataform-tools.${setting}`))) {
                return;
            }
            refreshStatusBar();
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
