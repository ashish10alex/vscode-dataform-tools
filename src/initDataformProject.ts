import * as vscode from 'vscode';
import { getDataformCliCmdBasedOnScope, isDataformWorkspace, runCommandInTerminal } from "./utils";
import path from 'path';
import { gcloudComputeRegions } from './constants';


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

    let placeHolder ="Enter default location. E.g. europe-west2";
    let validationErrorMessage = "Location can not be empty";
    const defaultLocation = await createSelector(gcloudComputeRegions, placeHolder);

    if (!defaultLocation) {
        vscode.window.showInformationMessage("Default location not provided, aborting...");
        return;
    }

    let prompt ="Enter GCP project id";
    placeHolder = "gcp-project-id";
    validationErrorMessage = "GCP project id can not be empty";
    const gcpProjectId = await createInputBox(prompt, placeHolder, validationErrorMessage);

    if (!gcpProjectId) {
        vscode.window.showInformationMessage("GCP project id not provided, aborting...");
        return;
    }

    const customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder=projectDir);
    runCommandInTerminal(`${customDataformCliPath} init --project-dir "${projectDir}" --default-database "${gcpProjectId}" --default-location "${defaultLocation}"`);

    const folderUri = vscode.Uri.file(path.resolve(projectDir));

    await vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: false });
}

async function createInputBox(prompt: string, placeHolder:string, validationErrorMessage: string): Promise<string | undefined> {
    const inputValue = await vscode.window.showInputBox({
        prompt: prompt,
        placeHolder: placeHolder,
        ignoreFocusOut: true,  // keeps the input open if user clicks outside
        validateInput: (input) => {
            if (!input || input.trim() === "") {
                return validationErrorMessage;
            }
            return null;
        }
    });

    return inputValue;
}

async function createSelector(selectionItems:string[], placeHolder: string): Promise<string | undefined>{
     return await vscode.window.showQuickPick(selectionItems, {
        placeHolder: placeHolder
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