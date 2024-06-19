import * as vscode from 'vscode';
import { getDryRunCommand, getSourcesCommand, getTagsCommand, compiledQueryCommand } from './commands';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let supportedExtensions = ['sqlx'];

export let declarationsAndTargets: string[] = [];

const shell = (cmd: string) => execSync(cmd, { encoding: 'utf8' });

export function executableIsAvailable(name: string) {
    try { shell(`which ${name}`); return true; }
    catch (error) {
        vscode.window.showErrorMessage((error as Error).message);
        return false;
    }
}

export function getFileNameFromDocument(document: vscode.TextDocument): string {
    var filename = document.uri.fsPath;
    let basenameSplit = path.basename(filename).split('.');
    let extension = basenameSplit[1];
    let validFileType = supportedExtensions.includes(extension);
    if (!validFileType) {
        // vscode.window.showWarningMessage(`vscode-dataform-tools extension currently only supports ${supportedExtensions} files`);
        return "";
    }
    filename = basenameSplit[0];
    return filename;
}

export function getWorkspaceFolder(): string {
    let workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (workspaceFolder !== undefined) {
        if (isDataformWorkspace(workspaceFolder) === false) {
            vscode.window.showWarningMessage(`Not a Dataform workspace. Workspace: ${workspaceFolder} does not have workflow_settings.yaml or dataform.json`);
            return "";
        }
        return workspaceFolder;
    }
    return "";
}

export function isDataformWorkspace(workspacePath: string) {
    const dataformSignatureFiles = ['workflow_settings.yaml', 'dataform.json'];
    let fileExists = false;

    for (let i = 0; dataformSignatureFiles.length; i++) {
        const filePath = path.join(workspacePath, dataformSignatureFiles[i]);
        let fileExists = fs.existsSync(filePath);
        if (fileExists) {
            return fileExists;
        }
    }
    return fileExists;
}

export function runCommandInTerminal(command: string) {
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

// Get start and end line number of the config block in the .sqlx file
// This assumes that the user is using config { } block at the top of the .sqlx file
//
// @return [start_of_config_block: number, end_of_config_block: number]
export const getLineNumberWhereConfigBlockTerminates = (): [number, number] => {
    let startOfConfigBlock = 0;
    let endOfConfigBlock = 0;
    let isInInnerConfigBlock = false;
    let innerConfigBlockCount = 0;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return [0, 0];
    }

    const document = editor.document;
    document.save();
    const totalLines = document.lineCount;

    for (let i = 0; i < totalLines; i++) {
        const lineContents = document.lineAt(i).text;

        if (lineContents.match("config")) {
            startOfConfigBlock = i + 1;
        } else if (lineContents.match("{")) {
            isInInnerConfigBlock = true;
            innerConfigBlockCount += 1;
        } else if (lineContents.match("}") && isInInnerConfigBlock && innerConfigBlockCount >= 1) {
            innerConfigBlockCount -= 1;
        } else if (lineContents.match("}") && innerConfigBlockCount === 0) {
            endOfConfigBlock = i + 1;
            return [startOfConfigBlock, endOfConfigBlock];
        }
    }

    return [0, 0];
};

export function isNotUndefined(value: unknown): any {
    if (typeof value === undefined) { throw new Error("Not a string"); }
}

function getFullTableIdFromDjDryRunJson(dryRunJson:any):string{
    let fileName = dryRunJson.FileName;
    let schema = dryRunJson.Schema;
    let database = dryRunJson.Database;
    let fullTableId = `${database}.${schema}.${fileName}`
    return fullTableId
}


export async function writeCompiledSqlToFile(compiledQuery: string, filePath: string) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf8');
    }

    // Write the compiled output to the file
    fs.writeFileSync(filePath, compiledQuery, 'utf8');

    // Open the output file in a vertical split
    const outputDocument = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(outputDocument, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
}

export async function getStdoutFromCliRun(exec: any, cmd: string): Promise<any> {
    return new Promise((resolve, reject) => {

        exec(cmd, (err: any, stdout: any, stderr: any) => {
            if (err) {
                vscode.window.showErrorMessage(`Error sourcesProcess: ${err}`);
                reject(err);
                return;
            }
            if (stderr) {
                vscode.window.showErrorMessage(`Error sourcesProcess: ${stderr}`);
                reject(new Error(stderr));
                return;
            }

            try {
                const output = stdout.toString();
                resolve(output);
            } catch (parseError) {
                reject(parseError);
            }
        });
    });
}


export function runCurrentFile(exec: any, includDependencies: boolean, includeDownstreamDependents: boolean) {
    let document = vscode.window.activeTextEditor?.document;
    if (document === undefined) {
        vscode.window.showErrorMessage('No active document');
        return;
    }
    var filename = getFileNameFromDocument(document);
    let workspaceFolder = getWorkspaceFolder();

    const getDryRunCmd = getDryRunCommand(workspaceFolder, filename);

    getStdoutFromCliRun(exec, getDryRunCmd).then((dryRunString) => {

        let allActions = dryRunString.split('\n');
        let actionsList: string[] = [];
        let dataformActionCmd = "";


        // get a list of tables & assertions that will be ran
        for (let i = 0; i < allActions.length - 1; i++) {
            let dryRunJson = JSON.parse(allActions[i]);
            let projectId = dryRunJson.Database;
            let dataset = dryRunJson.Schema;
            let table = dryRunJson.FileName;
            let fullTableName = `${projectId}.${dataset}.${table}`;
            actionsList.push(fullTableName);
        }

        // create the dataform run command for the list of actions from actionsList
        for (let i = 0; i < actionsList.length; i++) {
            let fullTableName = actionsList[i];
            if (i === 0) {
                if (includDependencies) {
                    dataformActionCmd = (`dataform run ${workspaceFolder} --actions "${fullTableName}" --include-deps`);
                } else if (includeDownstreamDependents) {
                    dataformActionCmd = (`dataform run ${workspaceFolder} --actions "${fullTableName}" --include-dependents`);
                }
                else {
                    dataformActionCmd = `dataform run ${workspaceFolder} --actions "${fullTableName}"`;
                }
            } else {
                if (includDependencies) {
                    dataformActionCmd += ` --actions "${fullTableName}"`;
                } else {
                    dataformActionCmd += ` --actions "${fullTableName}"`;
                }
            }
        }

        runCommandInTerminal(dataformActionCmd);
    })
        .catch((err) => {
            ;
            vscode.window.showErrorMessage(`Error running file: ${err}`);
            return;
        });

};

export async function compiledQueryWtDryRun(exec: any, document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, queryStringOffset: number, compiledSqlFilePath: string, showCompiledQueryInVerticalSplitOnSave: boolean | undefined) {
    diagnosticCollection.clear();

    var filename = getFileNameFromDocument(document);
    if (filename === "") { return; }

    let workspaceFolder = getWorkspaceFolder();
    if (workspaceFolder === "") { return; }

    let configBlockRange = getLineNumberWhereConfigBlockTerminates();
    let configBlockStart = configBlockRange[0] || 0;
    let configBlockEnd = configBlockRange[1] || 0;
    let configBlockOffset = (configBlockStart + configBlockEnd) - 1;
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
        return;
    });

    // BUG: When user is not conneted to the internet not getting an error ???
    if (showCompiledQueryInVerticalSplitOnSave !== true) {
        showCompiledQueryInVerticalSplitOnSave = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
    }
    if (showCompiledQueryInVerticalSplitOnSave) {

        getStdoutFromCliRun(exec, compiledQueryCmd).then((compiledQuery) => {
            writeCompiledSqlToFile(compiledQuery, compiledSqlFilePath);
        })
            .catch((err) => {
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
            let fullTableId = getFullTableIdFromDjDryRunJson(dryRunJson)
            GBProcessed = GBProcessed.toFixed(4);
            vscode.window.showInformationMessage(`GB ${GBProcessed} : ${fullTableId}`);
            return;
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

        let showCompiledQueryInVerticalSplitOnSave = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        if (showCompiledQueryInVerticalSplitOnSave && isError === true) {
            let compiledQueryDiagnostics: vscode.Diagnostic[] = [];
            let errLineNumberForCompiledQuery = dryRunJson.Error?.LineNumber - 1;
            let range = new vscode.Range(new vscode.Position(errLineNumberForCompiledQuery, errColumnNumber), new vscode.Position(errLineNumberForCompiledQuery, errColumnNumber + 5));
            const testDiagnostic = new vscode.Diagnostic(range, message, severity);
            compiledQueryDiagnostics.push(testDiagnostic);
            let visibleEditors = vscode.window.visibleTextEditors;
            visibleEditors.forEach((editor) => {
                let documentUri = editor.document.uri;
                if (documentUri.toString() === "file://" + compiledSqlFilePath) {
                    diagnosticCollection.set(documentUri, compiledQueryDiagnostics);
                }
            });
        }

    })
        .catch((err) => {
            if (err.toString() === 'TypeError: message must be set') { // NOTE: not sure how to fix this one?
                return;
            }
            vscode.window.showErrorMessage(`Dry run error: ${err}`);
            return;
        });

    let dataformTags: string[] = [];
    await getStdoutFromCliRun(exec, tagsCompletionCmd).then((sources) => {
        let uniqueTags = JSON.parse(sources).tags;
        dataformTags = uniqueTags;
    }
    ).catch((err) => {
        vscode.window.showErrorMessage(`Error getting tags for project: ${err}`);
    });

    return dataformTags;
}
