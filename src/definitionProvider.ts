import * as vscode from 'vscode';
import { getPostionOfSourceDeclaration, getPostionOfVariableInJsFileOrBlock, getWorkspaceFolder, runCompilation } from './utils';
import { Assertion, DataformCompiledJson, Operation, Table } from './types';
import path from 'path';
import * as fs from 'fs';
import { getMetadataForSqlxFileBlocks } from './sqlxFileParser';

function getSearchTermLocationFromStruct(searchTerm: string, struct: Operation[] | Assertion[] | Table[], workspaceFolder: string): vscode.Location | undefined {
    let location: vscode.Location | undefined;
    for (let i = 0; i < struct.length; i++) {
        let targetName = struct[i].target.name;
        if (searchTerm === targetName) {
            let fullSourcePath = path.join(workspaceFolder, struct[i].fileName);
            let sourcesJsUri = vscode.Uri.file(fullSourcePath);
            const definitionPosition = new vscode.Position(0, 0);
            location = new vscode.Location(sourcesJsUri, definitionPosition);
            return location;
        }
    }
    return location;
}

function getSearchTermLocationFromPath(searchTerm: string, workspaceFolder: string): vscode.Location | undefined {
    let location: vscode.Location | undefined;
    let fullSourcePath = path.join(workspaceFolder, searchTerm);
    let sourcesJsUri = vscode.Uri.file(fullSourcePath);
    const definitionPosition = new vscode.Position(0, 0);
    location = new vscode.Location(sourcesJsUri, definitionPosition);
    return location;
}

function getLocationFromPath(locationPath: string, line: number = 0): vscode.Location | undefined {
    let location: vscode.Location | undefined;
    let sourcesJsUri = vscode.Uri.file(locationPath);
    const definitionPosition = new vscode.Position(line, 0);
    location = new vscode.Location(sourcesJsUri, definitionPosition);
    return location;
}


async function getLocationForRefsAndResolve(document: vscode.TextDocument, searchTerm:string){
    let sourcesJsUri: vscode.Uri = document.uri;

    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder){return;}
    let dataformCompiledJson: DataformCompiledJson | undefined;
    if (!CACHED_COMPILED_DATAFORM_JSON) {
        vscode.window.showWarningMessage('Compile the Dataform project once for faster go to definition');
        let {dataformCompiledJson, errors} = await runCompilation(workspaceFolder); // Takes ~1100ms
        dataformCompiledJson = dataformCompiledJson;
    } else {
        dataformCompiledJson = CACHED_COMPILED_DATAFORM_JSON;
    }

    let declarations = dataformCompiledJson?.declarations;
    let tables = dataformCompiledJson?.tables;
    let operations = dataformCompiledJson?.operations;
    let assertions = dataformCompiledJson?.assertions;
    let tablePrefix = dataformCompiledJson?.projectConfig?.tablePrefix;

    let location: vscode.Location | undefined;

    if (declarations) {
        for (let i = 0; i < declarations.length; i++) {
            let declarationName = declarations[i].target.name;
            if (searchTerm === declarationName) {
                let fullSourcePath = path.join(workspaceFolder, declarations[i].fileName);
                sourcesJsUri = vscode.Uri.file(fullSourcePath);

                const definitionPosition = await getPostionOfSourceDeclaration(sourcesJsUri, searchTerm);
                if(!definitionPosition){
                    return;
                }
                return new vscode.Location(sourcesJsUri, definitionPosition);
            }

        }
    }
    if (tablePrefix) {
        searchTerm = tablePrefix + "_" + searchTerm;
    }

    if (tables) {
        location = getSearchTermLocationFromStruct(searchTerm, tables, workspaceFolder);
    }
    if (location){return location;}

    if (operations) {
        location =  getSearchTermLocationFromStruct(searchTerm, operations, workspaceFolder);
    }
    if (location){return location;}

    if (assertions) {
        return getSearchTermLocationFromStruct(searchTerm, assertions, workspaceFolder);
    }
}

export class DataformRequireDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.LocationLink[] | undefined> {
        const line = document.lineAt(position.line).text;
        const requireRegex = /[const|var|let].+=.+require\(["'](.+?)["']\)/;
        const match = line.match(requireRegex);

        // Early return if no match is found
        if (!match) {
            return undefined;
        }

        const searchTerm = match[1];
        const workspaceFolder = getWorkspaceFolder();

        // Return if no workspace folder is available
        if (!workspaceFolder) {
            return undefined;
        }

        const startIndex = line.indexOf(searchTerm);
        const endIndex = startIndex + searchTerm.length;

        // Check if the click position is within the range of the require path
        if (position.character < startIndex || position.character > endIndex) {
            return undefined;
        }

        const targetLocation = getSearchTermLocationFromPath(searchTerm, workspaceFolder);

        // Return if the target location is not found
        if (!targetLocation) {
            return undefined;
        }

        const range = new vscode.Range(position.line, startIndex, position.line, endIndex);

        // Return a LocationLink to make the full path highlighted
        return [{
            originSelectionRange: range,
            targetUri: targetLocation.uri,
            targetRange: targetLocation.range,
        }] as vscode.LocationLink[];
    }
}
interface ImportedModule {
    module: string;
    path: string;
}

export function getImportedModules(
    document: vscode.TextDocument,
): ImportedModule[] {
    const requireRegex = /(const|var|let)\s+(\w+)\s*=\s*require\(["'](.+?)["']\)/g;
    const importedModules: ImportedModule[] = [];
    const text = document.getText();
    let match: RegExpExecArray | null;

    while ((match = requireRegex.exec(text)) !== null) {
        importedModules.push({ module: match[2], path: match[3] });
    }

    return importedModules;
}

async function findModuleVarDefinition(
    document: vscode.TextDocument,
    workspaceFolder: string,
    jsFileName:string,
    variableName:string,
) {
    const includesPath = path.join(workspaceFolder, 'includes');
    try {
        const fileNames = fs.readdirSync(includesPath);
        for (const fileName of fileNames) {
            if(fileName === jsFileName + ".js"){
                const filePath = path.join(includesPath, fileName);
                const filePathUri = vscode.Uri.file(filePath);
                const position = await getPostionOfVariableInJsFileOrBlock(filePathUri, variableName, 0, -1);
                if (position){
                    return new vscode.Location(filePathUri, position);
                };
            }
        }
    } catch (error) {
        console.error(`Error reading includes directory: ${error}`);
    }
    // If not found in includes directory, check if it is imported
    const importedModules = getImportedModules(document);
    const importedModule = importedModules.find(module => module.module === jsFileName);
    if (importedModule) {
        const filePath = path.join(workspaceFolder, importedModule.path);
        const filePathUri = vscode.Uri.file(filePath);
        const position = await getPostionOfVariableInJsFileOrBlock(filePathUri, variableName, 0, -1);
        if (position){
            return new vscode.Location(filePathUri, position);
        };
    }

    return undefined;
}

/**
 * Extracts the function name from a function call string.
 * 
 * @example
 * extractFunctionName("getDate()"); // Returns "getDate"
 * extractFunctionName("object.method(arg1, arg2)"); // Returns "method"
 * extractFunctionName("namespace.subnamespace.func()"); // Returns "func"
 * extractFunctionName("someVariable"); // Returns null //
 */
function extractFunctionName(functionString:string) {
  const regex = /(?:^|\.)(\w+)\(/;
  const match = functionString.match(regex);
  return match ? match[1] : null;
}


export function findModuleDefinition(
        document: vscode.TextDocument,
        workspaceFolder: string,
        searchTerm: string
    ) {
        const includesPath = path.join(workspaceFolder, 'includes');
        const importedModules = getImportedModules(document);
        const importedModule = importedModules.find(module => module.module === searchTerm);
        if (importedModule) {
            const locationPath = path.join(workspaceFolder, importedModule.path);
            return getLocationFromPath(locationPath);
        }

        const files = fs.readdirSync(includesPath);
        for (const file of files) {
            const filePath = path.join(includesPath, file);
            const stat = fs.statSync(filePath);
            if (!stat.isFile()){
                continue;
            }
            if (file === `${searchTerm}.js`) {
                return getLocationFromPath(filePath);
            }
        }
        return undefined;
}
export class DataformJsDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Location | undefined> {
        const wordRange = document.getWordRangeAtPosition(position);
        if(!wordRange){
            return undefined;
        }
        const searchTerm = document.getText(wordRange);
        const workspaceFolder = getWorkspaceFolder();

        // Return if no workspace folder is available
        if (!workspaceFolder) {
            return undefined;
        }
        const line = document.lineAt(position.line).text;
        // const start = wordRange.start.character;
        // const end = wordRange.end.character;

        // This will often not be inside ${}, rather it will be inside js {}
        if (line.includes('require("')){
            return findModuleDefinition(document, workspaceFolder, searchTerm);
        }

        const regex = /\$\{([^}]+)\}/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
            console.log(`Found reference: ${match[0]}, Content: ${match[1]}`);
            const content =  (match[1]);
            if (content.includes("ref(")  || content.includes("resolve(")) {
                return getLocationForRefsAndResolve(document, searchTerm);
            } else if (content.includes(".")){
                const [jsFileName, variableOrFunctionSignature] = content.split('.'); 
                const variableOrFunctionName = extractFunctionName(variableOrFunctionSignature);
                // console.log(`jsFileName: ${jsFileName}, variableOrfunctionName: ${variableOrFunctionName}`);
                if(variableOrFunctionName !== null){
                    return findModuleVarDefinition(document, workspaceFolder, jsFileName, variableOrFunctionName);
                } else{
                    return findModuleVarDefinition(document, workspaceFolder, jsFileName, variableOrFunctionSignature);
                }
            } else if (content.includes('.') === false && content.trim() !== ''){
                // console.log(`variableOrfunctionName: ${content}`);
                const sqlxFileMetadata = getMetadataForSqlxFileBlocks(document);
                const jsBlock = sqlxFileMetadata.jsBlock;
                if(jsBlock.exists === true){
                    const position = await getPostionOfVariableInJsFileOrBlock(document, searchTerm, jsBlock.startLine, jsBlock.endLine);
                    if(position){
                        return new vscode.Location(document.uri, position);
                    }
                }
            }

        }
        return undefined;

    }
}
