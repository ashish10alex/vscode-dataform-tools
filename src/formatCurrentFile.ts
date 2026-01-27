import * as vscode from 'vscode';
import path from 'path';
import beautify from 'js-beautify';
import { exec as exec } from 'child_process';
import { ensureSqlfluffConfigExists, compiledQueryWtDryRun, getFileNameFromDocument, getSqlfluffExecutablePathFromSettings, getTextForBlock, getWorkspaceFolder,  writeCompiledSqlToFile, getStdoutFromCliRun, readFile,  getSqlfluffConfigPathFromSettings, runCommandInTerminal } from './utils';
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

    let workspaceFolder = await getWorkspaceFolder();
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
    await ensureSqlfluffConfigExists(sqlfluffConfigFilePath);
    return await formatSqlxFile(document, currentActiveEditorFilePath, metadataForSqlxFileBlocks, sqlfluffConfigFilePath); // takes ~ 700ms to format 200 lines
}

export async function formatCurrentFileWithDataform() {
    let workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
    }
    if (isRunningOnWindows) {
        workspaceFolder = path.win32.normalize(workspaceFolder);
    }
    runCommandInTerminal(`dataform format ${workspaceFolder}`);
}

interface SqlfluffViolation {
    start_line_no: number;
    start_line_pos: number;
    code: string;
    description: string;
    name: string;
    warning: boolean;
    start_file_pos: number;
    end_line_no: number;
    end_line_pos: number;
    end_file_pos: number;
}

interface SqlfluffOutput {
    filepath: string;
    violations: SqlfluffViolation[];
}

export async function lintSqlxFile(document: vscode.TextDocument, metadataForSqlxFileBlocks: SqlxBlockMetadata, sqlfluffConfigFilePath: string, diagnosticCollection: vscode.DiagnosticCollection) {
    let sqlBlockMeta = metadataForSqlxFileBlocks.sqlBlock;
    let sqlBlockText = await getTextForBlock(document, sqlBlockMeta);

    writeCompiledSqlToFile(sqlBlockText, sqlFileToFormatPath);

    const sqlfluffExecutablePath = getSqlfluffExecutablePathFromSettings();
    // lint the temp file
    let lintCmd = `${sqlfluffExecutablePath} lint "${sqlFileToFormatPath}" --config "${sqlfluffConfigFilePath}" --format json`;

    try {
        const stdout = await new Promise<string>((resolve, reject) => {
            exec(lintCmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                if (stderr) {
                    // Just log stderr, as some tools output warnings to stderr
                    logger.error(`Linting stderr: ${stderr}`);
                }
                
                // If we have stdout, we assume it might be valid JSON output even if exit code is non-zero
                if (stdout) {
                    resolve(stdout);
                    return;
                }

                if (error) { 
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });

        const lintResults: SqlfluffOutput[] | SqlfluffOutput = JSON.parse(stdout);
        const fileResults = Array.isArray(lintResults) ? lintResults : [lintResults];

        const diagnostics: vscode.Diagnostic[] = [];

        for (const fileResult of fileResults) {
            for (const violation of fileResult.violations) {
                const startLine = (sqlBlockMeta.startLine - 1) + (violation.start_line_no - 1);
                const startChar = violation.start_line_pos - 1; 
                const endLine = (sqlBlockMeta.startLine - 1) + (violation.end_line_no - 1);
                const endChar = violation.end_line_pos - 1;

                const range = new vscode.Range(startLine, startChar, endLine, endChar);
                const message = `${violation.code}: ${violation.description}`;
                const severity = vscode.DiagnosticSeverity.Warning;

                const diagnostic = new vscode.Diagnostic(range, message, severity);
                diagnostic.source = 'sqlfluff';
                diagnostic.code = {
                    value: violation.code,
                    target: vscode.Uri.parse(`https://docs.sqlfluff.com/en/stable/reference/rules.html#rule-${violation.code}`)
                };
                
                diagnostics.push(diagnostic);
            }
        }

        diagnosticCollection.set(document.uri, diagnostics);
        
        if (diagnostics.length === 0) {
             vscode.window.showInformationMessage(`Linting completed. No errors found.`);
        }

    } catch (err) {
        logger.error(`Linting failed: ${err}`);
        vscode.window.showErrorMessage(`Linting failed: ${err}`);
    }
}

export async function lintCurrentFile(diagnosticCollection: vscode.DiagnosticCollection) {
    let document = vscode.window.activeTextEditor?.document;
    if (!document) {
        document = activeDocumentObj;
        if (!document) {
            vscode.window.showErrorMessage("[Error linting]: VS Code document object was undefined");
            return;
        }
    }

    var result = getFileNameFromDocument(document, false);
    if (result.success === false) {
        return;
    }
    const [filename, _, extension] = result.value;

    let currentActiveEditorFilePath = document.uri.fsPath;
    if (!currentActiveEditorFilePath) {
        return;
    }

    if (filename === "" || extension !== "sqlx") {
        vscode.window.showErrorMessage("Linting is only supported for .sqlx files");
        return;
    }

    let workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    let sqlfluffConfigPath = getSqlfluffConfigPathFromSettings();
    let sqlfluffConfigFilePath = path.join(workspaceFolder, sqlfluffConfigPath);

    await ensureSqlfluffConfigExists(sqlfluffConfigFilePath);

    // New logic used for sqlx files to only lint the sql block
    let metadataForSqlxFileBlocks = getMetadataForSqlxFileBlocks(document);
    await lintSqlxFile(document, metadataForSqlxFileBlocks, sqlfluffConfigFilePath, diagnosticCollection);
}