import { getDataformCliCmdBasedOnScope, getDataformCompilationTimeoutFromConfig, runCommandInTerminal } from "./utils";

export async function runTests(workspaceFolder: string) {
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
