import * as vscode from 'vscode';
import path from 'path';
import { checkIfFileExsists, compiledQueryWtDryRun, fetchGitHubFileContent, formatSqlxFile, getFileNameFromDocument, getSqlfluffConfigPathFromSettings, getWorkspaceFolder, writeContentsToFile } from './utils';
import { getMetadataForSqlxFileBlocks } from './sqlxFileParser';
import {compiledSqlFilePath} from './constants';

export async function formatCurrentFile(diagnosticCollection:any) {
    let document = vscode.window.activeTextEditor?.document;
    if (!document) {
        vscode.window.showErrorMessage("VS Code document object was undefined");
        return;
    }

    var [filename, relativeFilePath, extension] = getFileNameFromDocument(document, true);
    if (!filename || !relativeFilePath || !extension) {
        return;
    }

    if (filename === "" || extension !== "sqlx") {
        vscode.window.showErrorMessage("Formatting is only supported for .sqlx files");
        return;
    }

    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }


    let compileAndDryRunBeforeFormatting = vscode.workspace.getConfiguration('vscode-dataform-tools').get('compileAndDryRunBeforeFormatting');
    if (compileAndDryRunBeforeFormatting === undefined) {
        compileAndDryRunBeforeFormatting = true;
    }

    if (compileAndDryRunBeforeFormatting) {
        let completionItems = await compiledQueryWtDryRun(document, diagnosticCollection, compiledSqlFilePath, false);
        let allDiagnostics = vscode.languages.getDiagnostics(document.uri);
        if (allDiagnostics.length > 0 || !completionItems) {
            vscode.window.showErrorMessage("Please resolve the errors on the current file before formatting");
            return;
        }
    }

    let sqlfluffConfigPath = getSqlfluffConfigPathFromSettings();
    let sqlfluffConfigFilePath = path.join(workspaceFolder, sqlfluffConfigPath);

    let metadataForSqlxFileBlocks = getMetadataForSqlxFileBlocks(document); // take ~1.3ms to parse 200 lines
    if (!checkIfFileExsists(sqlfluffConfigFilePath)) {
        vscode.window.showInformationMessage(`Trying to fetch .sqlfluff file compatable with .sqlx files`);
        let sqlfluffConfigFileContents = await fetchGitHubFileContent();
        writeContentsToFile(sqlfluffConfigFilePath, sqlfluffConfigFileContents);
        vscode.window.showInformationMessage(`Created .sqlfluff file at ${sqlfluffConfigFilePath}`);
    }
    await formatSqlxFile(document, metadataForSqlxFileBlocks, sqlfluffConfigFilePath); // takes ~ 700ms to format 200 lines

    document?.save();
}
