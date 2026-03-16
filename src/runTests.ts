import { getDataformCliCmdBasedOnScope, getDataformCompilationTimeoutFromConfig, runCommandInTerminal } from "./utils";

export async function runTests(workspaceFolder: string, testName: string) {
    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();
    const customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder);
    
    // dataform test --timeout=5m --tests="test_name"
    let cmd = `${customDataformCliPath} test "${workspaceFolder}" --timeout=${dataformCompilationTimeoutVal} --tests="${testName}"`;
    
    runCommandInTerminal(cmd);
}
