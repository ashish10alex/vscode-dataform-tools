import * as vscode from 'vscode';
import { getDataformCliCmdBasedOnScope, getDataformCompilationTimeoutFromConfig, runCommandInTerminal } from "./utils";

export async function runTests(workspaceFolder: string) {
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("Unable to run tests: Workspace folder could not be determined.");
        return;
    }
    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();
    const customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder);
    
    if (dataformCompilationTimeoutVal) {
        dataformCompilationTimeoutVal = `--timeout=${dataformCompilationTimeoutVal}`;
    } else {
        dataformCompilationTimeoutVal = "";
    }
    let cmd = `${customDataformCliPath} test "${workspaceFolder}" ${dataformCompilationTimeoutVal}`;
    
    runCommandInTerminal(cmd);
}
