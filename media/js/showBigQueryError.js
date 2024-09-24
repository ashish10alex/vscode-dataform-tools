const vscode = acquireVsCodeApi();


window.addEventListener('message', event => {
    const errorMessage = event?.data?.errorMessage;
    document.getElementById('bigqueryerror').textContent = errorMessage;
});
