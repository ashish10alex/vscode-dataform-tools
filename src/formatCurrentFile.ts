import * as vscode from 'vscode';
import path from 'path';
import beautify from 'js-beautify';
import { exec as exec } from 'child_process';
import { checkIfFileExsists, compiledQueryWtDryRun, fetchGitHubFileContent, getFileNameFromDocument, getSqlfluffExecutablePathFromSettings, getTextForBlock, getWorkspaceFolder,  writeCompiledSqlToFile, writeContentsToFile, getStdoutFromCliRun, readFile,  getSqlfluffConfigPathFromSettings, runCommandInTerminal } from './utils';
import { getMetadataForSqlxFileBlocks } from './sqlxFileParser';
import {sqlFileToFormatPath} from './constants';
import { SqlxBlockMetadata } from './types';
import { logger } from './logger';

export async function formatDataformSqlxFile(document:vscode.TextDocument){
    let formattingCli = vscode.workspace.getConfiguration("vscode-dataform-tools").get("formattingCli");
    if (formattingCli === "sqlfluff") {
        const formattedText:any = await formatCurrentFile(diagnosticCollection);
        if (formattedText) {
            // Create a text edit that replaces the entire document with the formatted text

            if(!document){
                document = activeDocumentObj || vscode.window.activeTextEditor?.document;
                if(!document){
                    vscode.window.showErrorMessage("Could not determine current active editor to write formatted text to");
                    return undefined;
                }
            }
            // get fsPath from document
            const fsPath = document.uri.fsPath;
            console.log(`fsPath: ${fsPath}`);
            const entireRange = new vscode.Range(
                document.lineAt(0).range.start,
                document.lineAt(document.lineCount - 1).range.end
            );
            return [vscode.TextEdit.replace(entireRange, formattedText)];
        }
    } else if (formattingCli === "dataform") {
        await formatCurrentFileWithDataform();
    }
    return [];
}


export async function formatSqlxFile(document:vscode.TextDocument, currentActiveEditorFilePath:string, metadataForSqlxFileBlocks: SqlxBlockMetadata, sqlfluffConfigFilePath:string){

    let jsBlockMeta = metadataForSqlxFileBlocks.jsBlock;
    let configBlockMeta = metadataForSqlxFileBlocks.configBlock;
    let preOpsBlockMeta = metadataForSqlxFileBlocks.preOpsBlock.preOpsList;
    let postOpsBlockMeta = metadataForSqlxFileBlocks.postOpsBlock.postOpsList;
    let sqlBlockMeta = metadataForSqlxFileBlocks.sqlBlock;

    let spaceBetweenBlocks = '\n\n\n';
    let spaceBetweenSameOps = '\n\n';

    let sqlBlockText = await getTextForBlock(document, sqlBlockMeta);
    writeCompiledSqlToFile(sqlBlockText, sqlFileToFormatPath);

    let [jsBlockText] = await Promise.all([ getTextForBlock(document, jsBlockMeta) ]);
    try {
        if (jsBlockText && jsBlockText !== ""){
            jsBlockText = beautify.js(jsBlockText, { "indent_size": 2 });
        }
    } catch (error) {
        vscode.window.showErrorMessage("Could to format js block");
    }

    let [configBlockText] = await Promise.all([ getTextForBlock(document, configBlockMeta) ]);
    try {
        if (configBlockText && configBlockText !== ""){
            configBlockText = beautify.js(configBlockText, { "indent_size": 2 });
        }
    } catch (error) {
        vscode.window.showErrorMessage("Could to format config block");
    }

    let myPromises:any = [];
    preOpsBlockMeta.forEach((block:any) => {
        myPromises.push(getTextForBlock(document, block));
    });
    let preOpsBlockTextList: string[] = await Promise.all(myPromises);

    myPromises = [];
    postOpsBlockMeta.forEach((block:any) => {
        myPromises.push(getTextForBlock(document, block));
    });
    let postOpsBlockTextList = await Promise.all(myPromises);

    let preOpsBlockText: string = preOpsBlockTextList.map((text: string) => text + spaceBetweenSameOps).join('');
    let postOpsBlockText: string = postOpsBlockTextList.map((text: string) => text + spaceBetweenSameOps).join('');

    (preOpsBlockText === "") ? preOpsBlockText: preOpsBlockText =  (spaceBetweenBlocks + preOpsBlockText).slice(0, -spaceBetweenSameOps.length);
    (postOpsBlockText === "") ? postOpsBlockText: postOpsBlockText = (spaceBetweenBlocks + postOpsBlockText).slice(0, -spaceBetweenSameOps.length);
    (jsBlockText === "") ? jsBlockText: jsBlockText = (spaceBetweenBlocks + jsBlockText);

    const sqlfluffExecutablePath = getSqlfluffExecutablePathFromSettings();
    let formatCmd = `${sqlfluffExecutablePath} fix -q --config=${sqlfluffConfigFilePath} ${sqlFileToFormatPath}`;

    try {
        await getStdoutFromCliRun(exec, formatCmd);
        let formattedSql = await readFile(sqlFileToFormatPath);
        (formattedSql === "") ? formattedSql: formattedSql = spaceBetweenBlocks + formattedSql;

        if (typeof formattedSql === 'string'){
            let finalFormattedSqlx = configBlockText + jsBlockText + preOpsBlockText +  postOpsBlockText + formattedSql;
            if (!currentActiveEditorFilePath){
                vscode.window.showErrorMessage("Could not determine current active editor to write formatted text to");
                return undefined;
            }
            return finalFormattedSqlx;
        }
    } catch (err) {
        vscode.window.showErrorMessage(`[Error formatting]: Ran: ${formatCmd}. Error: ${err}`);
    }
    
    return undefined;
}

export async function formatCurrentFile(diagnosticCollection:any) {
    let document = vscode.window.activeTextEditor?.document;
    if (!document) {
        document = activeDocumentObj;
        if (!document) {
            vscode.window.showErrorMessage("[Error formatting]: VS Code document object was undefined");
            return null;
        }
    }

    var result = getFileNameFromDocument(document, false);
    if (result.success === false) {
        return null;
    }
    const [filename, _, extension] = result.value;
    
    let currentActiveEditorFilePath = document.uri.fsPath;
    logger.debug(`currentActiveEditorFilePath: ${currentActiveEditorFilePath}`);
    if(!currentActiveEditorFilePath){
        return null;
    }

    if (filename === "" || extension !== "sqlx") {
        vscode.window.showErrorMessage("Formatting is only supported for .sqlx files");
        return null;
    }

    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
        return null;
    }

    let compileAndDryRunBeforeFormatting = vscode.workspace.getConfiguration('vscode-dataform-tools').get('compileAndDryRunBeforeFormatting');
    if (compileAndDryRunBeforeFormatting === undefined) {
        compileAndDryRunBeforeFormatting = true;
    }

    if (compileAndDryRunBeforeFormatting) {
        let completionItems = await compiledQueryWtDryRun(document, diagnosticCollection, false);
        let allDiagnostics = vscode.languages.getDiagnostics(document.uri);
        if (allDiagnostics.length > 0 || !completionItems) {
            vscode.window.showErrorMessage("Please resolve the errors on the current file before formatting");
            return null;
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
    return await formatSqlxFile(document, currentActiveEditorFilePath, metadataForSqlxFileBlocks, sqlfluffConfigFilePath); // takes ~ 700ms to format 200 lines
}

export async function formatCurrentFileWithDataform() {
    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
    }
    if (isRunningOnWindows) {
        workspaceFolder = path.win32.normalize(workspaceFolder);
    }
    runCommandInTerminal(`dataform format ${workspaceFolder}`);
}