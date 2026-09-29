import * as vscode from 'vscode';
import { pickBackendConfigurationTarget } from '../utils/remoteCompiler';
import { getDeferAvailability, isDeferEnabled } from './index';
import { clearProdTargetCache } from './prodTargets';
import { clearTableExistenceCache } from './tableExistence';
import { removeProxyViews } from './proxyViews';
import { getOrCompileDataformJson } from '../utils/dataformCompiler';

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
    const config = vscode.workspace.getConfiguration('vscode-dataform-tools', workspaceFolder ? vscode.Uri.file(workspaceFolder) : undefined);
    const target = pickBackendConfigurationTarget(config.inspect<boolean>('deferToProd'), !!vscode.workspace.workspaceFolders?.length);
    const value = typeof enabled === 'boolean' ? enabled : !isDeferEnabled(workspaceFolder);
    if (value === isDeferEnabled(workspaceFolder)) {
        return;
    }
    await config.update('deferToProd', value, target);
}

async function clearDeferCaches() {
    clearTableExistenceCache({ includeUnreadable: true });
    await clearProdTargetCache();
}

/** Forgets the prod compile and table listings, then redraws the panel, which looks everything up again */
async function refreshDeferToProd(refreshPanel: () => Promise<void> | void) {
    await clearDeferCaches();
    await refreshPanel();
}

/** `ids` limits it to those proxy views, as the compiled query panel already knows them; otherwise the whole project is scanned */
async function removeProxyViewsCommand(ids?: string[]) {
    if (Array.isArray(ids) && ids.length > 0) {
        await removeProxyViews(undefined, ids);
        return;
    }
    const workspaceFolder = currentWorkspaceFolder();
    await removeProxyViews(workspaceFolder ? await getOrCompileDataformJson(workspaceFolder) : undefined);
}

async function deferToProdActions(refreshPanel: () => Promise<void> | void) {
    const enabled = isDeferEnabled(currentWorkspaceFolder());
    const actions = [
        { label: enabled ? "$(circle-slash) Turn off defer to prod" : "$(cloud-download) Turn on defer to prod", run: () => toggleDeferToProd() },
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
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
    statusBarItem.command = 'vscode-dataform-tools.deferToProdActions';
    context.subscriptions.push(
        statusBarItem,
        vscode.commands.registerCommand('vscode-dataform-tools.toggleDeferToProd', toggleDeferToProd),
        vscode.commands.registerCommand('vscode-dataform-tools.deferToProdActions', () => deferToProdActions(refreshPanel)),
        vscode.commands.registerCommand('vscode-dataform-tools.removeProxyViews', removeProxyViewsCommand),
        vscode.commands.registerCommand('vscode-dataform-tools.refreshDeferToProd', () => refreshDeferToProd(refreshPanel)),
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
