import * as vscode from 'vscode';
import path from 'path';
import { logger } from '../logger';
import { FileNameMetadataResult, FileNameMetadata } from '../types';
import { activateProject, detectProjects, projects } from '../project';

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

/**
 * The Project picker: asks which Dataform Project to work in when the window holds several, and makes it the active
 * Project. With one there is nothing to ask. Returns its root.
 */
export async function selectWorkspaceFolder(): Promise<string | undefined> {
    const dataformProjects = projects.projects.filter((project) => project.backend === 'dataform');
    if (dataformProjects.length === 0) {
        return undefined;
    }
    let picked = dataformProjects[0];
    if (dataformProjects.length > 1) {
        const options = dataformProjects.map((project) => ({ label: path.basename(project.root), description: project.root, project }));
        const selection = await vscode.window.showQuickPick(options, { placeHolder: "Select the Dataform Project to work in" });
        if (!selection) {
            return undefined;
        }
        picked = selection.project;
    }
    activateProject(picked);
    workspaceFolder = picked.root;
    return workspaceFolder;
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

/**
 * The root of the Dataform Project to work in: the active Project, which follows the editor in focus, else the one
 * used last, else the one the user picks. Undefined when the window has no Dataform Project.
 *
 * Says nothing when there is none: this is also called for hovers and for every editor switch. `explain` is for a
 * command the user ran, which should say why it did nothing.
 */
export async function getWorkspaceFolder(options: { explain?: boolean } = {}): Promise<string | undefined> {
    const active = projects.active;
    if (active?.backend === 'dataform') {
        workspaceFolder = active.root;
        return workspaceFolder;
    }
    if (workspaceFolder && projects.find(workspaceFolder, 'dataform')) {
        return workspaceFolder;
    }
    workspaceFolder = await selectWorkspaceFolder();
    if (workspaceFolder === undefined) {
        logger.debug('No Dataform Project to work in');
        if (options.explain) {
            vscode.window.showInformationMessage('No Dataform project found. Open a folder that has workflow_settings.yaml or dataform.json at its root.');
        }
    }
    return workspaceFolder;
}

export function isDataformWorkspace(workspacePath: string) {
    return detectProjects(workspacePath).some((project) => project.backend === 'dataform');
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
