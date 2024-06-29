// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec as exec } from 'child_process';

let isEnabled = true;

export let declarationsAndTargets: string[] = [];
export let dataformTags: string[] = [];

let onSaveDisposable: vscode.Disposable | null = null;
let fixErrorCommandDisposable: vscode.Disposable | null = null;
let _sourcesAutoCompletionDisposable: vscode.Disposable | null = null;
let _dependenciesAutoCompletionDisposable: vscode.Disposable | null = null;
let _tagsAutoCompletionDisposable: vscode.Disposable | null = null;
let runCurrentFileCommandDisposable: vscode.Disposable | null = null;
let runCurrentFileWtDepsCommandDisposable: vscode.Disposable | null = null;
let compileWtDryRunDisposable: vscode.Disposable | null = null;
let showCompiledQueryWtDryRunDisposable: vscode.Disposable | null = null;
let runTagDisposable: vscode.Disposable | null = null;
let runTagWtDepsDisposable: vscode.Disposable | null = null;
let runTagWtDownstreamDepsDisposable: vscode.Disposable | null = null;
let runCurrentFileWtDownstreamDepsCommandDisposable: vscode.Disposable | null = null;
let dataformRefDefinitionProviderDisposable: vscode.Disposable | null = null;
let _dataformCodeActionProviderDisposable: vscode.Disposable | null = null;

//TODO:
/*
1. Currently we have to execute two shell commands one to get compiled query another to get dry run stats. This is due
   to the inabilty to parse the Json data when it has query string as one of the keys. i.e when using --compact=false in dj cli
   * Maybe we need to wait for the stdout to be read completely
2. Add docs to functions
*/

import { dataformCodeActionProviderDisposable, applyCodeActionUsingDiagnosticMessage } from './codeActionProvider';
import { DataformRefDefinitionProvider } from './definitionProvider';
import { executablesToCheck, compiledSqlFilePath, queryStringOffset } from './constants';
import { executableIsAvailable, runCurrentFile, runCommandInTerminal } from './utils';
import { getStdoutFromCliRun, getWorkspaceFolder, compiledQueryWtDryRun, extractFixFromDiagnosticMessage } from './utils';
import { editorSyncDisposable } from './sync';
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable } from './completions';
import { getTagsCommand, getSourcesCommand, getRunTagsCommand, getRunTagsWtDepsCommand, getRunTagsWtDownstreamDepsCommand, getFormatDataformFileCommand } from './commands';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

    for (let i = 0; i < executablesToCheck.length; i++) {
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
            return;
        }

        let uniqueTags = await compiledQueryWtDryRun(exec, document, diagnosticCollection, queryStringOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        if (uniqueTags !== undefined) {
            dataformTags = uniqueTags;
        }
    }

    function registerAllCommands(context: vscode.ExtensionContext) {

        dataformRefDefinitionProviderDisposable = vscode.languages.registerDefinitionProvider(
            { language: 'sql' },
            new DataformRefDefinitionProvider()
        );
        context.subscriptions.push(dataformRefDefinitionProviderDisposable);

        fixErrorCommandDisposable = vscode.commands.registerCommand('vscode-dataform-tools.fixError',
            async (document: vscode.TextDocument, range: vscode.Range, diagnosticMessage: string) => {
                applyCodeActionUsingDiagnosticMessage(range, diagnosticMessage);

                // recompile the file after the suggestion is applied based on user configuration
                let recompileAfterCodeAction = vscode.workspace.getConfiguration('vscode-dataform-tools').get('recompileAfterCodeAction');
                if (recompileAfterCodeAction) {
                    let showCompiledQueryInVerticalSplitOnSave = undefined;
                    await compileAndDryRunWtOpts(exec, document, diagnosticCollection, queryStringOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
                }

            });

        context.subscriptions.push(fixErrorCommandDisposable);

        _dataformCodeActionProviderDisposable = dataformCodeActionProviderDisposable();
        context.subscriptions.push(_dataformCodeActionProviderDisposable);

        _sourcesAutoCompletionDisposable = sourcesAutoCompletionDisposable();
        context.subscriptions.push(_sourcesAutoCompletionDisposable);

        _dependenciesAutoCompletionDisposable = dependenciesAutoCompletionDisposable();
        context.subscriptions.push(_dependenciesAutoCompletionDisposable);

        _tagsAutoCompletionDisposable = tagsAutoCompletionDisposable();
        context.subscriptions.push(_tagsAutoCompletionDisposable);

        context.subscriptions.push(editorSyncDisposable);

        runCurrentFileCommandDisposable = vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFile', () => { runCurrentFile(exec, false, false); });
        context.subscriptions.push(runCurrentFileCommandDisposable);

        let formatCurrentFileDisposable = vscode.commands.registerCommand('vscode-dataform-tools.formatCurrentfile', () => {
            let document = vscode.window.activeTextEditor?.document;
            let fileUri = document?.uri;
            if (fileUri === undefined) {
                return;
            }
            let relativeFilePath = vscode.workspace.asRelativePath(fileUri);
            if (relativeFilePath === undefined) {
                return;
            }

            let formatCmd = getFormatDataformFileCommand(relativeFilePath);
            getStdoutFromCliRun(exec, formatCmd).then((sources) => {
                vscode.window.showInformationMessage(`Formatted: ${relativeFilePath}`);
            }
            ).catch((err) => {
                vscode.window.showErrorMessage(`Error formatting: ${err}`);
                return;
            });
        });
        context.subscriptions.push(formatCurrentFileDisposable);

        runCurrentFileWtDepsCommandDisposable = vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDeps', () => { runCurrentFile(exec, true, false); });
        context.subscriptions.push(runCurrentFileWtDepsCommandDisposable);

        runCurrentFileWtDownstreamDepsCommandDisposable = vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDownstreamDeps', () => { runCurrentFile(exec, false, true); });
        context.subscriptions.push(runCurrentFileWtDownstreamDepsCommandDisposable);


        onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            let showCompiledQueryInVerticalSplitOnSave = undefined;
            await compileAndDryRunWtOpts(exec, document, diagnosticCollection, queryStringOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        });
        context.subscriptions.push(onSaveDisposable);

        compileWtDryRunDisposable = vscode.commands.registerCommand('vscode-dataform-tools.compileWtDryRun', async () => {
            let showCompiledQueryInVerticalSplitOnSave = undefined;
            let document = undefined;
            await compileAndDryRunWtOpts(exec, document, diagnosticCollection, queryStringOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        });

        context.subscriptions.push(compileWtDryRunDisposable);

        showCompiledQueryWtDryRunDisposable = vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQueryWtDryRun', async () => {
            let showCompiledQueryInVerticalSplitOnSave = true;
            let document = undefined;
            await compileAndDryRunWtOpts(exec, document, diagnosticCollection, queryStringOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        });

        context.subscriptions.push(showCompiledQueryWtDryRunDisposable);

        runTagDisposable = vscode.commands.registerCommand('vscode-dataform-tools.runTag', async () => {
            if (dataformTags.length === 0) {
                vscode.window.showInformationMessage('No tags found in project');
                return;
            }
            vscode.window.showQuickPick(dataformTags, {
                onDidSelectItem: (tag) => {
                    // This is triggered as soon as a item is hovered over
                }
            }).then((selection) => {
                if (!selection) {
                    return;
                }

                let runTagsCmd = getRunTagsCommand(workspaceFolder, selection);

                runCommandInTerminal(runTagsCmd);
            });
        });
        context.subscriptions.push(runTagDisposable);

        runTagWtDepsDisposable = vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDeps', async () => {
            if (dataformTags.length === 0) {
                vscode.window.showInformationMessage('No tags found in project');
                return;
            }
            vscode.window.showQuickPick(dataformTags, {
                onDidSelectItem: (tag) => {
                    // This is triggered as soon as a item is hovered over
                }
            }).then((selection) => {
                if (!selection) {
                    return;
                }

                let runTagsWtDepsCommand = getRunTagsWtDepsCommand(workspaceFolder, selection);

                runCommandInTerminal(runTagsWtDepsCommand);
            });
        });
        context.subscriptions.push(runTagWtDepsDisposable);

        runTagWtDownstreamDepsDisposable = vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDownstreamDeps', async () => {
            if (dataformTags.length === 0) {
                vscode.window.showInformationMessage('No tags found in project');
                return;
            }
            vscode.window.showQuickPick(dataformTags, {
                onDidSelectItem: (tag) => {
                    // This is triggered as soon as a item is hovered over
                }
            }).then((selection) => {
                if (!selection) {
                    return;
                }

                let runTagsWtDownstreamDepsCommand = getRunTagsWtDownstreamDepsCommand(workspaceFolder, selection);

                runCommandInTerminal(runTagsWtDownstreamDepsCommand);
            });
        });
        context.subscriptions.push(runTagWtDownstreamDepsDisposable);

    }


    if (isEnabled) {
        registerAllCommands(context);
    }

    let enableCommand = vscode.commands.registerCommand('vscode-dataform-tools.enable', () => {
        if (!isEnabled) {
            isEnabled = true;
            registerAllCommands(context);
            vscode.window.showInformationMessage('Extension enabled');
        } else {
            vscode.window.showInformationMessage('Extension is already enabled');
        }
    });

    let disableCommand = vscode.commands.registerCommand('vscode-dataform-tools.disable', () => {
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
            if (compileWtDryRunDisposable !== null) {
                compileWtDryRunDisposable.dispose();
            }
            if (showCompiledQueryWtDryRunDisposable !== null) {
                showCompiledQueryWtDryRunDisposable.dispose();
            }
            if (runTagDisposable !== null) {
                runTagDisposable.dispose();
            }
            if (runTagWtDepsDisposable !== null) {
                runTagWtDepsDisposable.dispose();
            }
            if (runTagWtDownstreamDepsDisposable !== null) {
                runTagWtDownstreamDepsDisposable.dispose();
            }
            if (runCurrentFileWtDownstreamDepsCommandDisposable !== null) {
                runCurrentFileWtDownstreamDepsCommandDisposable.dispose();
            }
            if (dataformRefDefinitionProviderDisposable) {
                dataformRefDefinitionProviderDisposable.dispose();
            }
            if (fixErrorCommandDisposable) {
                fixErrorCommandDisposable.dispose();
            }
            if (_dataformCodeActionProviderDisposable) {
                _dataformCodeActionProviderDisposable.dispose();
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


