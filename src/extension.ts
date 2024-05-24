// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
var path = require("path");

//TODO:
/*
1. Add option to toogle compiled output display
2. Could (1) be a plugin settings. How to create plugin settings
3. Currently we have to execute two shell commands one to get compiled query another to get dry run stats. This is due
   to the inabilty to parse the Json data when it has query string as one of the keys. i.e when using --compact=false in dj cli
   * Maybe we need to wait for the stdout to be read completely
4. Add docs to functions
*/

import { executableIsAvailable, getLineNumberWhereConfigBlockTerminates, isDataformWorkspace } from './utils';
import {writeCompiledSqlToFile} from './utils';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

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

    // Implementing the feature to sync scroll between main editor and vertical split editors
	let editorSyncDisposable = vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
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

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
		// The code you place here will be executed every time your command is executed
		diagnosticCollection.clear();

		var filename = document.uri.fsPath;
		let basenameSplit = path.basename(filename).split('.');
		let extension = basenameSplit[1];
		let validFileType  = supportedExtensions.includes(extension);
		if (!validFileType) {
			vscode.window.showWarningMessage(`dataform-lsp-vscode extension currently only supports ${supportedExtensions} files`);
			return;
		}
		filename = basenameSplit[0];

		let workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (workspaceFolder !== undefined){
			if (isDataformWorkspace(workspaceFolder) === false){
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

		let configBlockOffset = (configBlockStart + configBlockEnd ) - 1;
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
			if (errorRunningCli) {return;}
			compiledQuery += data.toString();
		});

        compiledQueryProcess.on('close', (data: any) => {
            if (errorRunningCli) {return;}
            writeCompiledSqlToFile(compiledQuery);
        });

        let dryRunString = '';
		dryRunProcess.stdout.on('data', (data: any) => {
            dryRunString += data.toString();
        })

		dryRunProcess.stdout.on('close', (data: any) => {
			if (errorRunningCli) {return;}

			let jsonData = JSON.parse(dryRunString);

			let isError = jsonData.Error?.IsError;
			if (isError === false) {
				let GBProcessed = jsonData.GBProcessed;
				let fileName = jsonData.FileName;
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
    context.subscriptions.push(editorSyncDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }

