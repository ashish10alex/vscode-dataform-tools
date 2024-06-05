// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
const { exec } = require('child_process');

let isEnabled = true;
const compiledSqlFilePath = '/tmp/output.sql';
let executablesToCheck = ['dataform', 'dj'];
let queryStringOffset = 3;

export let declarationsAndTargets: string[] = [];
export let dataformTags: string[] = [];

//TODO:
/*
1. Currently we have to execute two shell commands one to get compiled query another to get dry run stats. This is due
   to the inabilty to parse the Json data when it has query string as one of the keys. i.e when using --compact=false in dj cli
   * Maybe we need to wait for the stdout to be read completely
2. Add docs to functions
*/

import { executableIsAvailable, getLineNumberWhereConfigBlockTerminates, runCurrentFile, } from './utils';
import { writeCompiledSqlToFile, getStdoutFromCliRun, getFileNameFromDocument, getWorkspaceFolder } from './utils';
import { editorSyncDisposable } from './sync';
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable } from './completions';
import { compiledQueryCommand, getTagsCommand, getSourcesCommand, getDryRunCommand } from './commands';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

    let onSaveDisposable: vscode.Disposable | null = null;
    let _sourcesAutoCompletionDisposable: vscode.Disposable | null = null;
    let _dependenciesAutoCompletionDisposable: vscode.Disposable | null = null;
    let _tagsAutoCompletionDisposable: vscode.Disposable | null = null;
    let runCurrentFileCommandDisposable: vscode.Disposable | null = null;
    let runCurrentFileWtDepsCommandDisposable: vscode.Disposable | null = null;

    for (let i = 0; i < executablesToCheck.length; i++) {
        console.log(`Checking if ${executablesToCheck[i]} is available`);
        executableIsAvailable(executablesToCheck[i]);
    }

    let workspaceFolder = getWorkspaceFolder();
    let sourcesCmd = getSourcesCommand(workspaceFolder);
    let tagsCompletionCmd = getTagsCommand(workspaceFolder);


    getStdoutFromCliRun(exec, sourcesCmd).then((sources) => {
        let declarations = JSON.parse(sources).Declarations;
        let targets = JSON.parse(sources).Targets;
        declarationsAndTargets = [...new Set([...declarations, ...targets])];
    }
    ).catch((err) => {
        vscode.window.showWarningMessage(`Error getting sources for project: ${err}`);
    });

    getStdoutFromCliRun(exec, tagsCompletionCmd).then((sources) => {
        let uniqueTags = JSON.parse(sources).tags;
        dataformTags = uniqueTags;
    }
    ).catch((err) => {
        vscode.window.showWarningMessage(`Error getting tags for project: ${err}`);
    });


    let diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
    context.subscriptions.push(diagnosticCollection);

    function registerAllCommands(context: vscode.ExtensionContext) {

        _sourcesAutoCompletionDisposable = sourcesAutoCompletionDisposable();
        context.subscriptions.push(_sourcesAutoCompletionDisposable);

        _dependenciesAutoCompletionDisposable = dependenciesAutoCompletionDisposable();
        context.subscriptions.push(_dependenciesAutoCompletionDisposable);

        _tagsAutoCompletionDisposable = tagsAutoCompletionDisposable();
        context.subscriptions.push(_tagsAutoCompletionDisposable);

        context.subscriptions.push(editorSyncDisposable);

        runCurrentFileCommandDisposable = vscode.commands.registerCommand('dataform-lsp-vscode.runCurrentFile', () => { runCurrentFile(exec, false); });
        context.subscriptions.push(runCurrentFileCommandDisposable);

        runCurrentFileWtDepsCommandDisposable = vscode.commands.registerCommand('dataform-lsp-vscode.runCurrentFileWtDeps', () => { runCurrentFile(exec, true); });
        context.subscriptions.push(runCurrentFileWtDepsCommandDisposable);


        onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            // The code you place here will be executed every time your command is executed
            diagnosticCollection.clear();

            var filename = getFileNameFromDocument(document);
            if (filename === "") { return; }

            let workspaceFolder = getWorkspaceFolder();
            if (workspaceFolder === "") { return; }

            let configBlockRange = getLineNumberWhereConfigBlockTerminates();
            let configBlockStart = configBlockRange[0] || 0;
            let configBlockEnd = configBlockRange[1] || 0;
            let configBlockOffset = (configBlockStart + configBlockEnd) - 1;
            console.log(`configBlockStart: ${configBlockStart} | configBlockEnd: ${configBlockEnd}`);
            let configLineOffset = configBlockOffset - queryStringOffset;

            const sourcesCmd = getSourcesCommand(workspaceFolder);
            const tagsCompletionCmd = getTagsCommand(workspaceFolder);
            const dryRunCmd = getDryRunCommand(workspaceFolder, filename);
            const compiledQueryCmd = compiledQueryCommand(workspaceFolder, filename);


            getStdoutFromCliRun(exec, sourcesCmd).then((sources) => {
                let declarations = JSON.parse(sources).Declarations;
                let targets = JSON.parse(sources).Targets;
                declarationsAndTargets = [...new Set([...declarations, ...targets])];
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



            // BUG: When user is not conneted to the internet not getting an erorr ???
            let showCompiledQueryInVerticalSplitOnSave:boolean|undefined = vscode.workspace.getConfiguration('dataform-lsp-vscode').get('showCompiledQueryInVerticalSplitOnSave');
            if (showCompiledQueryInVerticalSplitOnSave) {

                getStdoutFromCliRun(exec, compiledQueryCmd).then((compiledQuery) => {
                    writeCompiledSqlToFile(compiledQuery, compiledSqlFilePath);
                })
                    .catch((err) => {
                        ;
                        vscode.window.showErrorMessage(`Compiled query error: ${err}`);
                        return;
                    });
            }

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
            if (_sourcesAutoCompletionDisposable !== null) {
                _sourcesAutoCompletionDisposable.dispose();
            }
            if (_dependenciesAutoCompletionDisposable !== null) {
                _dependenciesAutoCompletionDisposable.dispose();
            }
            if (_tagsAutoCompletionDisposable !== null) {
                _tagsAutoCompletionDisposable.dispose();
            }
            if (runCurrentFileCommandDisposable !== null) {
                runCurrentFileCommandDisposable.dispose();
            }
            if (runCurrentFileWtDepsCommandDisposable !== null) {
                runCurrentFileWtDepsCommandDisposable.dispose();
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


