import * as vscode from 'vscode';
import { delay, getDataformCliCmdBasedOnScope, isDataformWorkspace, runCommandInTerminal } from "./utils";
import path from 'path';
import { gcloudComputeRegions } from './constants';
import { ProjectsClient } from '@google-cloud/resource-manager';


export async function initDataformProject(){

    const projectDir = await openFolderSelector();
    if (!projectDir) {
        vscode.window.showInformationMessage("Project directory path not provided, aborting...");
        return;
    }

    if(isDataformWorkspace(projectDir)){
        vscode.window.showErrorMessage(`Directory ${projectDir} is already a Dataform workspace`);
        return;
    }

    let placeHolder ="Select default location. E.g. europe-west2";
    const defaultLocation = await createSelector(gcloudComputeRegions, placeHolder);

    if (!defaultLocation) {
        vscode.window.showInformationMessage("Default location not provided, aborting...");
        return;
    }
    placeHolder = "Select GCP project id";
    let gcpProjectIds = [];

    //TODO: need to check what happens when there is an error ?
    const client = new ProjectsClient();
    const projects = client.searchProjectsAsync();
    vscode.window.showInformationMessage("Loading available GCP projects...");
    for await (const project of projects) {
        if(project.projectId){
            gcpProjectIds.push(project.projectId);
        }
    }
    const gcpProjectId = await createSelector(gcpProjectIds, placeHolder);

    if (!gcpProjectId) {
        vscode.window.showInformationMessage("GCP project id not provided, aborting...");
        return;
    }

    const customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder=projectDir);
    runCommandInTerminal(`${customDataformCliPath} init --project-dir "${projectDir}" --default-database "${gcpProjectId}" --default-location "${defaultLocation}"`);
    // NOTE: wait for half a second before a new vscode workspace at projectDir
    // NOTE: otherwise opening the folder make the terminal command not run as the terminal context is somehow lost
    await delay(1500); 

    const folderUri = vscode.Uri.file(path.resolve(projectDir));

    await vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: false });

}

async function createSelector(selectionItems:string[], placeHolder: string): Promise<string | undefined>{
     return await vscode.window.showQuickPick(selectionItems, {
        placeHolder: placeHolder,
    });
}


async function openFolderSelector(){
    const folderUris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Dataform project folder",
        canSelectFiles: false // only folders selectable
    });

    if (folderUris && folderUris.length > 0) {
        return folderUris[0].fsPath;
    }
    return undefined;
}