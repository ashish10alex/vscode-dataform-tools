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

import { executableIsAvailable, runCurrentFile, } from './utils';
import { getStdoutFromCliRun, getWorkspaceFolder, compiledQueryWtDryRun } from './utils';
import { editorSyncDisposable } from './sync';
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable } from './completions';
import { getTagsCommand, getSourcesCommand } from './commands';

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

    async function compileAndDryRunWtOpts(exec: any, document: vscode.TextDocument | undefined, diagnosticCollection: vscode.DiagnosticCollection, queryStringOffset: number, compiledSqlFilePath: string, showCompiledQueryInVerticalSplitOnSave: boolean | undefined) {
        if (document === undefined) {
            document = vscode.window.activeTextEditor?.document;
        }

        if (document === undefined) {
            return
        }

        let uniqueTags = await compiledQueryWtDryRun(exec, document, diagnosticCollection, queryStringOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        if (uniqueTags !== undefined) {
            dataformTags = uniqueTags;
        }
    }

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
            let showCompiledQueryInVerticalSplitOnSave = undefined;
            await compileAndDryRunWtOpts(exec, document, diagnosticCollection, queryStringOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        });
        context.subscriptions.push(onSaveDisposable);

        let compileWtDryRunDisposable = vscode.commands.registerCommand('dataform-lsp-vscode.compileWtDryRun', async () => {
            let showCompiledQueryInVerticalSplitOnSave = undefined;
            let document = undefined;
            await compileAndDryRunWtOpts(exec, document, diagnosticCollection, queryStringOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        });

        context.subscriptions.push(compileWtDryRunDisposable);

        let showCompiledQueryWtDryRunDisposable = vscode.commands.registerCommand('dataform-lsp-vscode.showCompiledQueryWtDryRun', async () => {
            let showCompiledQueryInVerticalSplitOnSave = true;
            let document = undefined;
            await compileAndDryRunWtOpts(exec, document, diagnosticCollection, queryStringOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        });

        context.subscriptions.push(showCompiledQueryWtDryRunDisposable);


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


