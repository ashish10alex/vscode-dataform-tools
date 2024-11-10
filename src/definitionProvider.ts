import * as vscode from 'vscode';
import { getPostionOfSourceDeclaration, getWorkspaceFolder, runCompilation } from './utils';
import { Assertion, DataformCompiledJson, Operation, Table } from './types';
import path from 'path';

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
            dataformCompiledJson = await runCompilation(workspaceFolder);
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
        const requireRegex = /const.+=.+require\(["'](.+?)["']\)/;
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

export class DataformJsFunctionDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Location | undefined> {
        let searchTerm = document.getText(document.getWordRangeAtPosition(position));
        const documentText = document.getText();
        const line = document.lineAt(position.line).text;

        if (line.indexOf("${") === -1) {
            return undefined;
        }
        let workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

        const importRegex = /const\s+(\w+)\s*=\s*require\(["'](.+?)["']\)/g;
        let match;
        const importedFunctions = new Map<string, string>();

        while ((match = importRegex.exec(documentText)) !== null) {
            importedFunctions.set(match[1].trim(), match[2].trim());
        }

        if (importedFunctions.size === 0) {
            return undefined;
        }
        const importPath = importedFunctions.get(searchTerm);
        if (!importPath) {
            return undefined;
        }

        return getSearchTermLocationFromPath(importPath, workspaceFolder);
    }
}