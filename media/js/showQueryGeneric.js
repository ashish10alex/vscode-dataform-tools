
const vscode = acquireVsCodeApi();

document.getElementById('runQueryButton').addEventListener('click', function() {
    document.getElementById("runQueryButton").disabled = true;
    vscode.postMessage({
        command: 'runBigQueryJob'
    });
});


window.addEventListener('message', event => {
    const bigQueryJobId = event?.data?.bigQueryJobId;
    document.querySelector('.bigquery-job-cancelled').textContent = `❕ BigQuery Job was cancelled, jobId: ${bigQueryJobId}`;
});