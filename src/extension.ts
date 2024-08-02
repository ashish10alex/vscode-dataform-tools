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

import { registerWebViewProvider } from './views/register-sidebar-panel';
import { dataformCodeActionProviderDisposable, applyCodeActionUsingDiagnosticMessage } from './codeActionProvider';
import { DataformRefDefinitionProvider } from './definitionProvider';
import { executablesToCheck, compiledSqlFilePath, tableQueryOffset } from './constants';
import { executableIsAvailable, runCurrentFile, runCommandInTerminal, runCompilation } from './utils';
import { getStdoutFromCliRun, getWorkspaceFolder, compiledQueryWtDryRun, getDependenciesAutoCompletionItems, getDataformTags} from './utils';
import { editorSyncDisposable } from './sync';
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable } from './completions';
import {  getRunTagsCommand, getRunTagsWtDepsCommand, getRunTagsWtDownstreamDepsCommand, getFormatDataformFileCommand } from './commands';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

    for (let i = 0; i < executablesToCheck.length; i++) {
        executableIsAvailable(executablesToCheck[i]);
    }

    let workspaceFolder = getWorkspaceFolder();
    //TODO: Load tags and sources on extension activation

    let dataformCompiledJson = await runCompilation(workspaceFolder);
    if (dataformCompiledJson){
        declarationsAndTargets = await getDependenciesAutoCompletionItems(dataformCompiledJson);
        dataformTags = await getDataformTags(dataformCompiledJson);
    }

    let diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
    context.subscriptions.push(diagnosticCollection);

    registerWebViewProvider(context);

    async function compileAndDryRunWtOpts(document: vscode.TextDocument | undefined, diagnosticCollection: vscode.DiagnosticCollection, queryStringOffset: number, compiledSqlFilePath: string, showCompiledQueryInVerticalSplitOnSave: boolean | undefined) {
        if (document === undefined) {
            document = vscode.window.activeTextEditor?.document;
        }

        if (document === undefined) {
            return;
        }

        let completionItems = await compiledQueryWtDryRun(document, diagnosticCollection, queryStringOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        if (completionItems !== undefined) {
            dataformTags = completionItems[0];
            declarationsAndTargets = completionItems[1];
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
                document.save();

                // recompile the file after the suggestion is applied based on user configuration
                let recompileAfterCodeAction = vscode.workspace.getConfiguration('vscode-dataform-tools').get('recompileAfterCodeAction');
                if (recompileAfterCodeAction) {
                    let showCompiledQueryInVerticalSplitOnSave = undefined;
                    await compileAndDryRunWtOpts(document, diagnosticCollection, tableQueryOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
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

        runCurrentFileCommandDisposable = vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFile', () => { runCurrentFile(false, false); });
        context.subscriptions.push(runCurrentFileCommandDisposable);

        let formatCurrentFileDisposable = vscode.commands.registerCommand('vscode-dataform-tools.formatCurrentfile', async () => {
            executableIsAvailable("formatdataform");
            let document = vscode.window.activeTextEditor?.document;
            document?.save();
            let fileUri = document?.uri;
            if (fileUri === undefined) {
                return;
            }
            let relativeFilePath = vscode.workspace.asRelativePath(fileUri);
            if (relativeFilePath === undefined) {
                return;
            }

            let formatCmd = getFormatDataformFileCommand(relativeFilePath);
            await getStdoutFromCliRun(exec, formatCmd).then((sources) => {
                vscode.window.showInformationMessage(`Formatted: ${relativeFilePath}`);
            }
            ).catch((err) => {
                vscode.window.showErrorMessage(`Error formatting: ${err}`);
                return;
            });

            let showCompiledQueryInVerticalSplitOnSave = undefined;
            await compileAndDryRunWtOpts(document, diagnosticCollection, tableQueryOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        });
        context.subscriptions.push(formatCurrentFileDisposable);

        runCurrentFileWtDepsCommandDisposable = vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDeps', () => { runCurrentFile(true, false); });
        context.subscriptions.push(runCurrentFileWtDepsCommandDisposable);

        runCurrentFileWtDownstreamDepsCommandDisposable = vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDownstreamDeps', () => { runCurrentFile(false, true); });
        context.subscriptions.push(runCurrentFileWtDownstreamDepsCommandDisposable);


        onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            let showCompiledQueryInVerticalSplitOnSave = undefined;
            await compileAndDryRunWtOpts(document, diagnosticCollection, tableQueryOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        });
        context.subscriptions.push(onSaveDisposable);

        compileWtDryRunDisposable = vscode.commands.registerCommand('vscode-dataform-tools.compileWtDryRun', async () => {
            let showCompiledQueryInVerticalSplitOnSave = undefined;
            let document = undefined;
            await compileAndDryRunWtOpts(document, diagnosticCollection, tableQueryOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        });

        context.subscriptions.push(compileWtDryRunDisposable);

        showCompiledQueryWtDryRunDisposable = vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQueryWtDryRun', async () => {
            let showCompiledQueryInVerticalSplitOnSave = true;
            let document = undefined;
            await compileAndDryRunWtOpts(document, diagnosticCollection, tableQueryOffset, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
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


