import * as vscode from 'vscode';
import { getDataformCliCmdBasedOnScope, getWorkspaceFolder, runCommandInTerminal } from "./utils";
import { getDataformCompilationTimeoutFromConfig, isRemoteMode } from './project/dataformOptions';

export async function runTests(workspaceFolder?: string) {
    if (isRemoteMode()) {
        vscode.window.showInformationMessage("Dataform unit tests need the Dataform CLI and are unavailable in remote mode. Set `vscode-dataform-tools.compilationBackend` to `cli` to run them.");
        return;
    }
    const resolvedWorkspaceFolder = workspaceFolder ?? await getWorkspaceFolder();
    if (!resolvedWorkspaceFolder) {
        vscode.window.showErrorMessage("Unable to run tests: Workspace folder could not be determined.");
        return;
    }
    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();
    const customDataformCliPath = getDataformCliCmdBasedOnScope(resolvedWorkspaceFolder);
    
    if (dataformCompilationTimeoutVal) {
        dataformCompilationTimeoutVal = `--timeout=${dataformCompilationTimeoutVal}`;
    } else {
        dataformCompilationTimeoutVal = "";
    }
    let cmd = `${customDataformCliPath} test "${resolvedWorkspaceFolder}" ${dataformCompilationTimeoutVal}`;
    
    runCommandInTerminal(cmd);
}
