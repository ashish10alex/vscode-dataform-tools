import * as vscode from 'vscode';
import path from 'path';
import { getWorkspaceFolder } from './workspaceUtils';

export function showLoadingProgress<T extends any[]>(
    title: string,
    operation: (
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken,
        ...args: T
    ) => Thenable<void>,
    cancellationMessage: string = "Dataform tools: operation cancelled",
    ...args:any
): Thenable<void> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: title,
            cancellable: true
        },
        async (progress, token) => {
            token.onCancellationRequested(() => {
                console.log(cancellationMessage);
            });

            await operation(progress, token, ...args);
        }
    );
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function createSelector(selectionItems:string[], placeHolder: string): Promise<string | undefined>{
     return await vscode.window.showQuickPick(selectionItems, {
        placeHolder: placeHolder,
    });
}

export function getNonce() {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function arrayToCsv(data: Record<string, any>[]): string {
    // FIXME: we do not support elegant exports of nested columns outputs yet
    const separator = ',';
    const keys = Object.keys(data[0] ?? {});
    const csvRows = [
        keys.join(separator),
        ...data.map(row =>
            keys.map(key => {
                let cell = row[key] === null || row[key] === undefined ? '' : row[key];
                cell = cell instanceof Date
                    ? cell.toLocaleString()
                    : String(cell).replace(/"/g, '""');
                if (cell.search(/("|,|\n)/g) >= 0) {
                    cell = `"${cell}"`;
                }
                return cell;
            }).join(separator)
        )
    ];
    return csvRows.join('\n');
}

export async function saveCsvFile(filename: string, data: Record<string, any>[]) {
    const csvContent = arrayToCsv(data);
    const uint8array = new TextEncoder().encode(csvContent);
    const fileUri = vscode.Uri.file(filename);
    await vscode.workspace.fs.writeFile(fileUri, uint8array);
    vscode.window.showInformationMessage(
    `csv exported: ${fileUri.toString()}`,
    "Open folder"
).then(selection => {
    if (selection === "Open folder") {
        if (vscode.env.remoteName === 'wsl') {
            vscode.commands.executeCommand('remote-wsl.revealInExplorer', fileUri);
        } else {
            vscode.commands.executeCommand('revealFileInOS', fileUri);
        }
    }
});

}
export function getVSCodeDocument(): vscode.TextDocument | undefined {
    let document = vscode.window.activeTextEditor?.document;
    if (!document) {
        return;
    }
    return document;
}

export function getLineUnderCursor(): string | undefined {
    let document = getVSCodeDocument();
    if (!document) {
        return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
    }

    const position = editor.selection.active;
    const line = editor.document.lineAt(position.line).text;
    return line;

}

export function runCommandInTerminal(command: string) {
    if(isRunningOnWindows){
        command = "cmd /C " + command;
    }
    if (vscode.window.activeTerminal === undefined) {
        const terminal = vscode.window.createTerminal('dataform');
        terminal.sendText(command);
        terminal.show();
    } else {
        const terminal = vscode.window.activeTerminal;
        vscode.window.activeTerminal.sendText(command);
        terminal.show();
    }
}

export async function openFileOnLeftEditorPane(filePath: string, position: vscode.Position){
    const workspaceFolder = await getWorkspaceFolder();
    if(workspaceFolder && filePath){
        const fullFilePath = path.join(workspaceFolder, filePath);
        const filePathUri = vscode.Uri.file(fullFilePath);
        const document = await vscode.workspace.openTextDocument(filePathUri);

        vscode.window.showTextDocument(document, vscode.ViewColumn.One, false).then(editor => {
            const range = new vscode.Range(position, position);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(position, position);
        });
    }
}
