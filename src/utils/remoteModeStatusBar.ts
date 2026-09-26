import * as vscode from 'vscode';

export type RemoteModeStatus =
    | { state: "idle" }
    | { state: "compiling" }
    | { state: "compiled", sha: string, stale: boolean, reason?: string, hasErrors: boolean }
    | { state: "error", message: string };

let statusBarItem: vscode.StatusBarItem | undefined;

export function initRemoteModeStatusBar(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    context.subscriptions.push(statusBarItem);
}

/**
 * Shown in remote mode, and in CLI mode once the user has set the backend explicitly so there is
 * always a visible way back to remote mode.
 */
export function refreshRemoteModeStatusBar(remote: boolean, backendExplicitlySet: boolean) {
    if (!statusBarItem) {
        return;
    }
    if (remote) {
        statusBarItem.command = "vscode-dataform-tools.remoteModeActions";
        if (!statusBarItem.text || statusBarItem.text.includes("Dataform CLI")) {
            updateRemoteModeStatusBar({ state: "idle" });
        }
        statusBarItem.show();
    } else if (backendExplicitlySet) {
        statusBarItem.command = "vscode-dataform-tools.switchCompilationBackend";
        statusBarItem.text = "$(terminal) Dataform CLI";
        statusBarItem.tooltip = "Compiling locally with the Dataform CLI. Click to switch to the Dataform API (beta).";
        statusBarItem.backgroundColor = undefined;
        statusBarItem.show();
    } else {
        statusBarItem.hide();
    }
}

export function updateRemoteModeStatusBar(status: RemoteModeStatus) {
    if (!statusBarItem) {
        return;
    }
    statusBarItem.backgroundColor = undefined;
    switch (status.state) {
        case "idle":
            statusBarItem.text = "$(cloud) Dataform API";
            statusBarItem.tooltip = "Dataform remote mode (beta): not compiled yet. Click for actions.";
            break;
        case "compiling":
            statusBarItem.text = "$(sync~spin) Dataform API";
            statusBarItem.tooltip = "Compiling remotely with the Dataform API…";
            break;
        case "compiled": {
            const shortSha = status.sha.slice(0, 7);
            const icon = status.hasErrors ? "$(error)" : status.stale ? "$(warning)" : "$(cloud)";
            statusBarItem.text = `${icon} Dataform API @ ${shortSha}`;
            const lines = [`Dataform remote mode (beta): compiled from pushed commit ${shortSha}.`];
            if (status.hasErrors) {
                lines.push("The remote compilation has errors.");
            }
            if (status.stale) {
                lines.push(status.reason ?? "Local code differs from the compiled commit.");
                statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
            }
            lines.push("Click for actions.");
            statusBarItem.tooltip = lines.join("\n");
            break;
        }
        case "error":
            statusBarItem.text = "$(error) Dataform API";
            statusBarItem.tooltip = `Remote compilation failed: ${status.message}\nClick for actions.`;
            statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
            break;
    }
}
