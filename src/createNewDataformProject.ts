import * as vscode from 'vscode';
import { createSelector, delay, getDataformCliCmdBasedOnScope, getGcpProjectIds, isDataformWorkspace, runCommandInTerminal } from "./utils";
import path from 'path';
import { gcloudComputeRegions } from './constants';
import fs from 'fs';
import { logger } from './logger';
import { isRemoteMode } from './project/dataformOptions';
import { quotedCli } from './backend/dataform/run';

export async function createNewDataformProject(){

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
    const gcpProjectIds = await getGcpProjectIds();
    const gcpProjectId = await createSelector(gcpProjectIds, placeHolder);

    if (!gcpProjectId) {
        vscode.window.showInformationMessage("GCP project id not provided, aborting...");
        return;
    }

    if (isRemoteMode()) {
        await writeDataformProjectFiles(projectDir, gcpProjectId, defaultLocation);
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path.resolve(projectDir)), { forceNewWindow: false });
        return;
    }

    const customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder=projectDir);
    runCommandInTerminal(`${quotedCli(customDataformCliPath)} init --project-dir "${projectDir}" --default-database "${gcpProjectId}" --default-location "${defaultLocation}"`);
    // NOTE: wait for half a second before a new vscode workspace at projectDir
    // NOTE: otherwise opening the folder make the terminal command not run as the terminal context is somehow lost
    await delay(2500); 

    const folderUri = vscode.Uri.file(path.resolve(projectDir));

    await vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: false });

}

const FALLBACK_DATAFORM_CORE_VERSION = "3.0.70";

async function getLatestDataformCoreVersion(): Promise<string> {
    try {
        const response = await fetch("https://registry.npmjs.org/@dataform/core/latest");
        if (response.ok) {
            const { version } = await response.json() as { version?: string };
            if (version) {
                return version;
            }
        }
    } catch (error) {
        logger.error(`Could not fetch latest @dataform/core version: ${error}`);
    }
    return FALLBACK_DATAFORM_CORE_VERSION;
}

/** Writes the files `dataform init` would create, for remote mode where the Dataform CLI is not installed. */
async function writeDataformProjectFiles(projectDir: string, gcpProjectId: string, defaultLocation: string) {
    const dataformCoreVersion = await getLatestDataformCoreVersion();
    const workflowSettings = [
        `defaultProject: ${gcpProjectId}`,
        `defaultLocation: ${defaultLocation}`,
        `defaultDataset: dataform`,
        `defaultAssertionDataset: dataform_assertions`,
        `dataformCoreVersion: ${dataformCoreVersion}`,
        ``,
    ].join("\n");

    await fs.promises.mkdir(path.join(projectDir, "definitions"), { recursive: true });
    await fs.promises.mkdir(path.join(projectDir, "includes"), { recursive: true });
    await fs.promises.writeFile(path.join(projectDir, "workflow_settings.yaml"), workflowSettings);
    // The folder may be inside an existing clone; keep any .gitignore already there
    await fs.promises.writeFile(path.join(projectDir, ".gitignore"), "node_modules/\n", { flag: "wx" }).catch((error) => {
        if (error.code !== "EEXIST") {
            throw error;
        }
    });
    vscode.window.showInformationMessage(`Created Dataform project with @dataform/core ${dataformCoreVersion}. Push it to the git repository connected to your Dataform repository to compile it remotely.`);
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