import * as vscode from 'vscode';
import { getDataformCliCmdBasedOnScope, isDataformWorkspace, runCommandInTerminal } from "./utils";
import path from 'path';


export async function initDataformProject(){

    let prompt ="Enter the full path for the Dataform project directory";
    let placeHolder = "/Users/username/path/to/project";
    let validationErrorMessage = "Path can not be empty";
    const projectDir = await enterProjectDir(prompt, placeHolder, validationErrorMessage);
    if (!projectDir) {
        vscode.window.showInformationMessage("Project directory path not provided, aborting...");
        return;
    }

    if(isDataformWorkspace(projectDir)){
        vscode.window.showErrorMessage(`Directory ${projectDir} is already a Dataform workspace`);
        return;
    }

    prompt ="Enter default location";
    placeHolder = "europe-west2";
    validationErrorMessage = "Location can not be empty";
    const defaultLocation = await enterProjectDir(prompt, placeHolder, validationErrorMessage);

    if (!defaultLocation) {
        vscode.window.showInformationMessage("Default location not provided, aborting...");
        return;
    }

    prompt ="Enter GCP project id";
    placeHolder = "gcp-project-id";
    validationErrorMessage = "GCP project id can not be empty";
    const gcpProjectId = await enterProjectDir(prompt, placeHolder, validationErrorMessage);

    if (!gcpProjectId) {
        vscode.window.showInformationMessage("GCP project id not provided, aborting...");
        return;
    }

    const customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder=projectDir);
    runCommandInTerminal(`${customDataformCliPath} init --project-dir "${projectDir}" --default-database "${gcpProjectId}" --default-location "${defaultLocation}"`);

    const folderUri = vscode.Uri.file(path.resolve(projectDir));

    await vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: false });
}

async function enterProjectDir(prompt: string, placeHolder:string, validationErrorMessage: string): Promise<string | undefined> {
    const projectDir = await vscode.window.showInputBox({
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

    return projectDir;
}