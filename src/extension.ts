// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
var path = require("path");
let isEnabled = true;
const compiledSqlFilePath = '/tmp/output.sql';
let declarationsAndTargets: string[] = [];
let dataformTags : string[] = [];

//TODO:
/*
1. Currently we have to execute two shell commands one to get compiled query another to get dry run stats. This is due
   to the inabilty to parse the Json data when it has query string as one of the keys. i.e when using --compact=false in dj cli
   * Maybe we need to wait for the stdout to be read completely
2. Add docs to functions
*/

import { executableIsAvailable, getLineNumberWhereConfigBlockTerminates, isDataformWorkspace } from './utils';
import { writeCompiledSqlToFile, getStdoutFromCliRun } from './utils';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

    let onSaveDisposable: vscode.Disposable | null = null;
    let editorSyncDisposable: vscode.Disposable | null = null;
    let sourcesAutoCompletionDisposable: vscode.Disposable | null = null;
    let dependenciesAutoCompletionDisposable: vscode.Disposable | null = null;
    let tagsAutoCompletionDisposable: vscode.Disposable | null = null;

    let executablesToCheck = ['dataform', 'dj'];
    let supportedExtensions = ['sqlx'];
    for (let i = 0; i < executablesToCheck.length; i++) {
        console.log(`Checking if ${executablesToCheck[i]} is available`);
        executableIsAvailable(executablesToCheck[i]);
    }

    let queryStringOffset = 3;

    let diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
    context.subscriptions.push(diagnosticCollection);

    function registerAllCommands(context: vscode.ExtensionContext) {


        sourcesAutoCompletionDisposable = vscode.languages.registerCompletionItemProvider(
            // NOTE: Could this be made more reusable, i.e. a function that takes in the trigger and the language
            /*
            you might need to set up the file association to use the auto-completion
            sql should be added as a file association for sqlx
            this will enable both sufficient syntax highlighting and auto-completion
            */
            { language: 'sql', scheme: 'file' },
            {
                provideCompletionItems(document, position, token, context) {

                    const linePrefix = document.lineAt(position).text.substring(0, position.character);
                    if (!linePrefix.endsWith('$')) {
                        return undefined;
                    }
                    let sourceCompletionItem = (text: any) => {
                        let item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Field);
                        item.range = new vscode.Range(position, position);
                        return item;
                    };
                    if (declarationsAndTargets.length === 0) {
                        return undefined;
                    }
                    let sourceCompletionItems: vscode.CompletionItem[] = [];
                    declarationsAndTargets.forEach((source: string) => {
                        source = `{ref("${source}")}`;
                        sourceCompletionItems.push(sourceCompletionItem(source));
                    });
                    return sourceCompletionItems;
                }
            },
            '$' // trigger
        );
        context.subscriptions.push(sourcesAutoCompletionDisposable);

        dependenciesAutoCompletionDisposable = vscode.languages.registerCompletionItemProvider(
            // NOTE: Could this be made more reusable, i.e. a function that takes in the trigger and the language
            { language: 'sql', scheme: 'file' },
            {
                provideCompletionItems(document, position, token, context) {

                    const linePrefix = document.lineAt(position).text.substring(0, position.character);
                    if (!linePrefix.includes('dependencies')) {
                        return undefined;
                    }
                    let sourceCompletionItem = (text: any) => {
                        let item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Field);
                        item.range = new vscode.Range(position, position);
                        return item;
                    };
                    if (declarationsAndTargets.length === 0) {
                        return undefined;
                    }
                    let sourceCompletionItems: vscode.CompletionItem[] = [];
                    declarationsAndTargets.forEach((source: string) => {
                        source = `${source}`;
                        sourceCompletionItems.push(sourceCompletionItem(source));
                    });
                    return sourceCompletionItems;
                },
            },
            ...["'", '"'],
        );
        context.subscriptions.push(dependenciesAutoCompletionDisposable);

        tagsAutoCompletionDisposable = vscode.languages.registerCompletionItemProvider(
            // NOTE: Could this be made more reusable, i.e. a function that takes in the trigger and the language
            { language: 'sql', scheme: 'file' },
            {
                provideCompletionItems(document, position, token, context) {

                    const linePrefix = document.lineAt(position).text.substring(0, position.character);
                    if (!linePrefix.includes('tags')) {
                        return undefined;
                    }
                    let sourceCompletionItem = (text: any) => {
                        let item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Field);
                        item.range = new vscode.Range(position, position);
                        return item;
                    };
                    if (dataformTags.length === 0) {
                        return undefined;
                    }
                    let sourceCompletionItems: vscode.CompletionItem[] = [];
                    dataformTags.forEach((source: string) => {
                        source = `${source}`;
                        sourceCompletionItems.push(sourceCompletionItem(source));
                    });
                    return sourceCompletionItems;
                },
            },
            ...["'", '"'],
        );
        context.subscriptions.push(tagsAutoCompletionDisposable);


        // Implementing the feature to sync scroll between main editor and vertical split editors
        // BUG: git hunks start syncing as well !
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

            let configBlockRange = getLineNumberWhereConfigBlockTerminates();
            let configBlockStart = configBlockRange[0] || 0;
            let configBlockEnd = configBlockRange[1] || 0;
            let configBlockOffset = (configBlockStart + configBlockEnd) - 1;
            console.log(`configBlockStart: ${configBlockStart} | configBlockEnd: ${configBlockEnd}`);
            let configLineOffset = configBlockOffset - queryStringOffset;

            const { exec } = require('child_process'); // NOTE: this should be an import statement ?

            const sourcesCmd = `dataform compile ${workspaceFolder} --json | dj table-ops declarations-and-targets`;
            console.log(`cmd: ${sourcesCmd}`);

            const tagsCompletionCmd = `dataform compile ${workspaceFolder} --json | dj tag-ops --unique`;


            const dryRunCmd = `dataform compile ${workspaceFolder} --json \
		| dj table-ops cost --compact=true --include-assertions=true -t ${filename}`;
            console.log(`cmd: ${dryRunCmd}`);

            const compiledQueryCmd = `dataform compile ${workspaceFolder} --json \
		| dj table-ops query -t ${filename}`;
            console.log(`cmd: ${compiledQueryCmd}`);


            getStdoutFromCliRun(exec, sourcesCmd).then((sources) => {
                let declarations = JSON.parse(sources).Declarations;
                let targets = JSON.parse(sources).Targets;
                declarationsAndTargets = [...new Set([...declarations ,...targets])];
            }
            ).catch((err) => {
                vscode.window.showErrorMessage(`Error getting sources for project: ${err}`);
            });

            getStdoutFromCliRun(exec, tagsCompletionCmd).then((sources) => {
                let uniqueTags = JSON.parse(sources).tags;
                dataformTags = uniqueTags;
            }
            ).catch((err) => {
                vscode.window.showErrorMessage(`Error getting tags for project: ${err}`);
            });



            getStdoutFromCliRun(exec, compiledQueryCmd).then((compiledQuery) => {
                writeCompiledSqlToFile(compiledQuery, compiledSqlFilePath);
            })
                .catch((err) => {
                    ;
                    vscode.window.showErrorMessage(`Compiled query error: ${err}`);
                    return;
                });

            const diagnostics: vscode.Diagnostic[] = [];

            getStdoutFromCliRun(exec, dryRunCmd).then((dryRunString) => {
                //TODO: Handle more elegantly where multiline json is returned
                // this is a hack to handle multiline json by picking only the first json item
                // separated by newline
                let dryRunJson;
                let strLen = dryRunString.split('\n').length;
                if (strLen > 1) {
                    dryRunJson = JSON.parse(dryRunString.split('\n')[0]);
                } else {
                    dryRunJson = JSON.parse(dryRunString);
                }

                let isError = dryRunJson.Error?.IsError;
                if (isError === false) {
                    let GBProcessed = dryRunJson.GBProcessed;
                    let fileName = dryRunJson.FileName;
                    GBProcessed = GBProcessed.toFixed(4);
                    vscode.window.showInformationMessage(`GB ${GBProcessed}: File: ${fileName}`);
                }

                let errLineNumber = dryRunJson.Error?.LineNumber + configLineOffset;
                let errColumnNumber = dryRunJson.Error?.ColumnNumber;


                const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
                const message = dryRunJson.Error?.ErrorMsg || '';
                const severity = vscode.DiagnosticSeverity.Error;
                const diagnostic = new vscode.Diagnostic(range, message, severity);
                if (diagnostics.length === 0) { //NOTE: Did this because we are only showing first error ?
                    diagnostics.push(diagnostic);
                    if (document !== undefined) {
                        diagnosticCollection.set(document.uri, diagnostics);
                    }
                }
            })
                .catch((err) => {
                    if (err.toString() === 'TypeError: message must be set') { // NOTE: not sure how to fix this one?
                        return;
                    }
                    vscode.window.showErrorMessage(`Dry run error: ${err}`);
                    return;
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
            if (sourcesAutoCompletionDisposable !== null) {
                sourcesAutoCompletionDisposable.dispose();
            }
            if (dependenciesAutoCompletionDisposable !== null) {
                dependenciesAutoCompletionDisposable.dispose();
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


