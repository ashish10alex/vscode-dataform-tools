import * as vscode from 'vscode';
import { getPostionOfSourceDeclaration, getWorkspaceFolder, runCompilation } from './utils';
import { Assertion, DataformCompiledJson, Operation, Table } from './types';
import path from 'path';
import * as fs from 'fs';

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


export class DataformRefDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ) {
        let searchTerm = document.getText(document.getWordRangeAtPosition(position));
        const line = document.lineAt(position.line).text;

        // early return
        if (line.indexOf("${ref(") === -1 && line.indexOf("${resolve(") === -1) {
            return undefined;
        }

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

function extractVariableDeclarations(content: string): Record<string, string> {
    const variableRegex = /(const|let|var)\s+(\w+)\s*=\s*["']?.+?["']?/g;
    const variables: Record<string, string> = {};
    let match: RegExpExecArray | null;

    while ((match = variableRegex.exec(content)) !== null) {
        variables[match[2]] = match[1];
    }
    return variables;
}
function extractFunctionDeclarations(content: string): Record<string, string> {
    const functionsRegex = /(function)\s+(\w+)\s*\([^)]*\)\s*\{/g;
    const functions: Record<string, string> = {};
    let match: RegExpExecArray | null;

    while ((match = functionsRegex.exec(content)) !== null) {
        functions[match[2]] = match[1];
    }
    return functions;
}
function extractExports(content: string): string[] {
    const exportsRegex = /module\.exports\s*=\s*{([\s\S]*?)}/;
    const match = content.match(exportsRegex);
    return match ? match[1].split(',').map(exportItem => exportItem.trim()): [];
}

function findLineNumber(content: string, searchTerm: string): number {
    const lines = content.split('\n');
    return lines.findIndex(line => line.includes(searchTerm));
}

function searchInFile(filePath: string, searchTerm: string): vscode.Location | undefined {
    try{
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) { return undefined; }

        const content = fs.readFileSync(filePath, 'utf-8');
        const variables = {
            ...extractVariableDeclarations(content),
            ...extractFunctionDeclarations(content)
        };
        const exports = extractExports(content);

        if (exports.includes(searchTerm) && variables[searchTerm]) {
            // TODO: This search needs to be changed to a regexp
            const lineNumber = findLineNumber(content, `${variables[searchTerm]} ${searchTerm}`); 
            if (lineNumber !== -1) {
                return getLocationFromPath(filePath, lineNumber);
            }
        }
    } catch (error) {
    console.error(`Error reading file: ${filePath}`);
    }
    return undefined;
};

export function findModuleVarDefinition(
    document: vscode.TextDocument,
    workspaceFolder: string,
    searchTerm: string
) {
    const includesPath = path.join(workspaceFolder, 'includes');

    const importedModules = getImportedModules(document);
    for (const importedModule of importedModules) {
        const searchPath = path.join(workspaceFolder, importedModule.path);
        const location = searchInFile(searchPath, searchTerm);
        if (location){
            return location;
        };
    }

    try {
        const files = fs.readdirSync(includesPath);
        for (const file of files) {
            const filePath = path.join(includesPath, file);
            const location = searchInFile(filePath, searchTerm);
            if (location){
                return location;
            };
        }
    } catch (error) {
        console.error(`Error reading includes directory: ${error}`);
    }

    return undefined;
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
        const start = wordRange.start.character;
        const end = wordRange.end.character;

        // We assume it is an import statement
        if (line.includes('require("')) {
            return findModuleDefinition(document, workspaceFolder, searchTerm);
        }
        // We assume the click is on a variable part (module.variable)
        if (start > 0 && line[start - 1] === '.') {
            return findModuleVarDefinition(document, workspaceFolder, searchTerm);
        }
        // We assume it is a click on the module part (module.variable)
        if (end < line.length && line[end] === '.') {
            return findModuleDefinition(document, workspaceFolder, searchTerm);
        }

        return undefined;

    }
}
