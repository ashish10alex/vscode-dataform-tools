// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
var path = require("path");
let isEnabled = true;

//TODO:
/*
0. Bering in sources for auto-completion from dj cli
1. Currently we have to execute two shell commands one to get compiled query another to get dry run stats. This is due
   to the inabilty to parse the Json data when it has query string as one of the keys. i.e when using --compact=false in dj cli
   * Maybe we need to wait for the stdout to be read completely
2. Add docs to functions
*/

import { executableIsAvailable, getLineNumberWhereConfigBlockTerminates, isDataformWorkspace } from './utils';
import { writeCompiledSqlToFile } from './utils';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

    let onSaveDisposable: vscode.Disposable | null = null;
    let editorSyncDisposable: vscode.Disposable | null = null;
    let autoCompletionDisposable: vscode.Disposable | null = null;

    let executablesToCheck = ['dataform', 'dj'];
    let supportedExtensions = ['sqlx'];
    for (let i = 0; i < executablesToCheck.length; i++) {
        if (executableIsAvailable(executablesToCheck[i]) !== true) {
            vscode.window.showErrorMessage(`${executablesToCheck[i]} does not exsits`);
            return;
        }
    }

    let queryStringOffset = 3;

    let diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
    context.subscriptions.push(diagnosticCollection);

    function registerAllCommands(context: vscode.ExtensionContext) {


        autoCompletionDisposable = vscode.languages.registerCompletionItemProvider(
            // sql is a file association for sqlx.
            // you might need to set up the file association to use the auto-completion
            { language: 'sql', scheme: 'file' },
            {
                provideCompletionItems(document, position, token, context) {

                    const linePrefix = document.lineAt(position).text.substring(0, position.character);
                    console.log(linePrefix);
                    if (!linePrefix.endsWith('$')) {
                        return undefined;
                    }
                    let myitem = (text:any) => {
                        let item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Text);
                        item.range = new vscode.Range(position, position);
                        return item;
                    };
                    return [
                        //TODO: replace this with real sources from dj cli.
                        //This can perhaps be pre-computed to give smoother experice when typing
                        myitem('{ref("TABLE_ONE")}'),
                        myitem('{ref("TABLE_TWO")}'),
                        myitem('{ref("TABLE_THREE")}'),
                    ];
                }
            },
            '$' // trigger
        );
        context.subscriptions.push(autoCompletionDisposable);

        // Implementing the feature to sync scroll between main editor and vertical split editors
        editorSyncDisposable = vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
            let splitEditors = vscode.window.visibleTextEditors;
            let activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                splitEditors.forEach((editor) => {
                    if (editor !== activeEditor) {
                        editor.revealRange(activeEditor.visibleRanges[0]);
                    }
                });
            }
        });
        context.subscriptions.push(editorSyncDisposable);

        onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            // The code you place here will be executed every time your command is executed
            diagnosticCollection.clear();

            var filename = document.uri.fsPath;
            let basenameSplit = path.basename(filename).split('.');
            let extension = basenameSplit[1];
            let validFileType = supportedExtensions.includes(extension);
            if (!validFileType) {
                vscode.window.showWarningMessage(`dataform-lsp-vscode extension currently only supports ${supportedExtensions} files`);
                return;
            }
            filename = basenameSplit[0];

            let workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (workspaceFolder !== undefined) {
                if (isDataformWorkspace(workspaceFolder) === false) {
                    vscode.window.showWarningMessage(`Not a Dataform workspace. Workspace: ${workspaceFolder} does not have workflow_settings.yaml or dataform.json`);
                }
            }
            console.log(`filename: ${filename}`);
            console.log(`workspaceFolder: ${workspaceFolder}`);

            const { spawn } = require('child_process');
            let errorRunningCli = false;
            let configBlockRange = getLineNumberWhereConfigBlockTerminates();

            let configBlockStart = configBlockRange[0] || 0;
            let configBlockEnd = configBlockRange[1] || 0;

            let configBlockOffset = (configBlockStart + configBlockEnd) - 1;
            console.log(`configBlockStart: ${configBlockStart} | configBlockEnd: ${configBlockEnd}`);

            let configLineOffset = configBlockOffset - queryStringOffset;

            const dryRunCmd = `dataform compile ${workspaceFolder} --json \
		| dj table-ops cost --compact=true --include-assertions=true -t ${filename}`;
            console.log(`cmd: ${dryRunCmd}`);
            const dryRunProcess = spawn(dryRunCmd, [], { shell: true });

            const compiledQueryCmd = `dataform compile ${workspaceFolder} --json \
		| dj table-ops query -t ${filename}`;
            console.log(`cmd: ${compiledQueryCmd}`);
            const compiledQueryProcess = spawn(compiledQueryCmd, [], { shell: true });

            const diagnostics: vscode.Diagnostic[] = [];

            dryRunProcess.stderr.on('data', (data: any) => {
                vscode.window.showErrorMessage(`Error dryRunProcess: ${data}`);
                errorRunningCli = true;
                return;
            });

            compiledQueryProcess.stderr.on('data', (data: any) => {
                vscode.window.showErrorMessage(`Error compiledQueryProcess: ${data}`);
                errorRunningCli = true;
                return;
            });

            let compiledQuery = '';
            compiledQueryProcess.stdout.on('data', (data: any) => {
                if (errorRunningCli) { return; }
                compiledQuery += data.toString();
            });

            compiledQueryProcess.on('close', (data: any) => {
                if (errorRunningCli) { return; }
                writeCompiledSqlToFile(compiledQuery);
            });

            let dryRunString = '';
            dryRunProcess.stdout.on('data', (data: any) => {
                dryRunString += data.toString();
            });

            dryRunProcess.on('close', (data: any) => {
                if (errorRunningCli) { return; }

                let jsonData = JSON.parse(dryRunString);

                let isError = jsonData.Error?.IsError;
                if (isError === false) {
                    let GBProcessed = jsonData.GBProcessed;
                    let fileName = jsonData.FileName;
                    GBProcessed = GBProcessed.toFixed(4);
                    vscode.window.showInformationMessage(`GB ${GBProcessed}: File: ${fileName}`);
                }

                let errLineNumber = jsonData.Error?.LineNumber + configLineOffset;
                let errColumnNumber = jsonData.Error?.ColumnNumber;


                const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
                const message = jsonData.Error?.ErrorMsg;
                const severity = vscode.DiagnosticSeverity.Error;
                const diagnostic = new vscode.Diagnostic(range, message, severity);
                if (diagnostics.length === 0) {
                    diagnostics.push(diagnostic);
                    if (document !== undefined) {
                        diagnosticCollection.set(document.uri, diagnostics);
                    }
                }
            });
        });
        context.subscriptions.push(onSaveDisposable);

    }

    if (isEnabled) {
        registerAllCommands(context);
    }

    let enableCommand = vscode.commands.registerCommand('dataform-lsp-vscode.enable', () => {
        if (!isEnabled) {
            isEnabled = true;
            registerAllCommands(context);
            vscode.window.showInformationMessage('Extension enabled');
        } else {
            vscode.window.showInformationMessage('Extension is already enabled');
        }
    });

    let disableCommand = vscode.commands.registerCommand('dataform-lsp-vscode.disable', () => {
        if (isEnabled) {
            isEnabled = false;
            if (onSaveDisposable !== null) {
                onSaveDisposable.dispose();
            }
            if (editorSyncDisposable !== null) {
                editorSyncDisposable.dispose();
            }
            if (autoCompletionDisposable !== null) {
                autoCompletionDisposable.dispose();
            }
            vscode.window.showInformationMessage('Extension disabled');
        } else {
            vscode.window.showInformationMessage('Extension is already disabled');
        }
    });

    context.subscriptions.push(enableCommand);
    context.subscriptions.push(disableCommand);

}

// This method is called when your extension is deactivated
export function deactivate() {
    console.log('Extension "enable-disable-extension" is now deactivated.');
}


