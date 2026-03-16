import * as vscode from 'vscode';
import { getDataformCliCmdBasedOnScope, getDataformCompilationTimeoutFromConfig, getWorkspaceFolder, runCommandInTerminal } from "./utils";

export async function runTests(workspaceFolder?: string) {
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
