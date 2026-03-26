import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import { FileNameMetadataResult, FileNameMetadata } from '../types';

const supportedExtensions = ['sqlx', 'js', 'yaml', 'json'];

export function getRelativePath(filePath: string) {
    const fileUri = vscode.Uri.file(filePath);
    let relativePath = vscode.workspace.asRelativePath(fileUri);
    if (isRunningOnWindows) {
        relativePath = path.win32.normalize(relativePath);
    }
    const firstDefinitionIndex = relativePath.indexOf("definitions");
    if (firstDefinitionIndex !== -1) {
        relativePath = relativePath.slice(firstDefinitionIndex);
    }
    return relativePath;
}

export async function selectWorkspaceFolder() {
    const availableFolders = vscode.workspace.workspaceFolders;

    if (availableFolders) {
        let folderOptions = availableFolders.map(folder => {
            return {
                label: folder.name,
                description: folder.uri.fsPath,
                value: folder.uri.fsPath
            };
        });

        if (folderOptions.length === 1) {
            workspaceFolder = folderOptions[0].value;
            return workspaceFolder;
        }

        folderOptions = folderOptions.filter(folder => isDataformWorkspace(folder.description));

        if (folderOptions.length === 1) {
            workspaceFolder = folderOptions[0].value;
            return workspaceFolder;
        }

        const selectedFolder = await vscode.window.showQuickPick(folderOptions, { placeHolder: "Select the Dataform workspace which this file belongs to" });
        if (selectedFolder) {
            workspaceFolder = selectedFolder.value;
            return workspaceFolder;
        }
        return undefined;
    }
    return undefined;
}

export function getFileNameFromDocument(
    document: vscode.TextDocument,
    showErrorMessage: boolean
): FileNameMetadataResult<FileNameMetadata, string> {
    const filePath = document.uri.fsPath;
    const extWithDot = path.extname(filePath);
    const extension = extWithDot.startsWith('.') ? extWithDot.slice(1) : extWithDot;
    const rawFileName = path.basename(filePath, extWithDot);
    const relativeFilePath = getRelativePath(filePath);
    const validFileType = supportedExtensions.includes(extension);

    if (!validFileType) {
        if (showErrorMessage) {
            vscode.window.showErrorMessage(
                `File type not supported. Supported file types are ${supportedExtensions.join(', ')}`
            );
        }
        return { success: false, error: `File type not supported. Supported file types are ${supportedExtensions.join(', ')}` };
    }
    return { success: true, value: [rawFileName, relativeFilePath, extension] };
}

//
//WARN: What if user has multiple workspaces open in the same window
//TODO: we are taking the first workspace from the active workspaces. Is it possible to handle cases where there are multiple workspaces in the same window ?
//
//TODO: What if user has no workspaces open ?
//
export async function getWorkspaceFolder(): Promise<string | undefined> {
    if (!workspaceFolder) {
        workspaceFolder = await selectWorkspaceFolder();
    }
    if (workspaceFolder === undefined) {
        logger.debug(`Workspace could not be determined. Please open folder with your dataform project`);
        vscode.window.showWarningMessage(`Workspace could not be determined. Please open folder with your dataform project`);
        return undefined;
    }
    if (isDataformWorkspace(workspaceFolder)) {
        logger.debug(`Workspace: ${workspaceFolder} is a Dataform workspace`);
        return workspaceFolder;
    }
    logger.debug(`Not a Dataform workspace. Workspace: ${workspaceFolder} does not have workflow_settings.yaml or dataform.json at its root`);
    vscode.window.showWarningMessage(`Not a Dataform workspace. Workspace: ${workspaceFolder} does not have workflow_settings.yaml or dataform.json at its root`);
    return undefined;
}

export function isDataformWorkspace(workspacePath: string) {
    const dataformSignatureFiles = ['workflow_settings.yaml', 'dataform.json'];
    return dataformSignatureFiles.some(file => {
        let filePath = path.join(workspacePath, file);
        return fs.existsSync(filePath);
    });
}

export async function getAllFilesWtAnExtension(workspaceFolder: string, extension: string) {
    let trimInitial = false;
    const globPattern = new vscode.RelativePattern(workspaceFolder, `**/*${extension}`);
    const workspaces = vscode.workspace.workspaceFolders;
    if(workspaces && workspaces?.length > 1){
        trimInitial = true;
    }
    let files = await vscode.workspace.findFiles(globPattern);
    const fileList = files.map((file) => {
        if(trimInitial){
            const pathParts = vscode.workspace.asRelativePath(file).split(path.posix.sep);
            if(isRunningOnWindows){
            return path.win32.normalize(pathParts.slice(1).join(path.win32.sep));
            }
            return path.posix.normalize(pathParts.slice(1).join(path.posix.sep));
        }
         const relativePath = vscode.workspace.asRelativePath(file);
         if(isRunningOnWindows){
             return path.win32.normalize(relativePath);
         }
         return relativePath;
    });
    return fileList;
}

export async function getStdoutFromCliRun(exec: any, cmd: string): Promise<any> {
    let workspaceFolder = await getWorkspaceFolder();

    if (!workspaceFolder) {
        return;
    }

    return new Promise((resolve, reject) => {

        exec(cmd, { cwd: workspaceFolder }, (_: any, stdout: any, stderr: any) => {
            if (stderr) {
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
