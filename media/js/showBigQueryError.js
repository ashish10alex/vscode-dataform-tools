const vscode = acquireVsCodeApi();

document.getElementById('runQueryButton').addEventListener('click', function() {
    document.getElementById("runQueryButton").disabled = true;
    vscode.postMessage({
        command: 'runBigQueryJob'
    });
});


window.addEventListener('message', event => {
    const errorMessage = event?.data?.errorMessage;
    document.getElementById('bigqueryerror').textContent = errorMessage;
});
