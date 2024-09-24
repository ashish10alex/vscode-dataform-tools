
const vscode = acquireVsCodeApi();

document.getElementById('runQueryButton').addEventListener('click', function() {
    document.getElementById("runQueryButton").disabled = true;
    vscode.postMessage({
        command: 'runBigQueryJob'
    });
});
