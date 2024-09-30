const vscode = acquireVsCodeApi();

const runQueryButton = document.getElementById('runQueryButton');
if (runQueryButton){
    document.getElementById('runQueryButton').addEventListener('click', function() {
        document.getElementById("runQueryButton").disabled = true;
        vscode.postMessage({
            command: 'runBigQueryJob'
        });
    });
}

const cancelBigQueryJobButton = document.getElementById('cancelBigQueryJobButton');
if (cancelBigQueryJobButton){
    document.getElementById('cancelBigQueryJobButton').addEventListener('click', function() {
        vscode.postMessage({
            command: 'cancelBigQueryJob'
        });
    });
}

const queryLimit = document.getElementById('queryLimit');
if (queryLimit){
    document.getElementById("queryLimit").addEventListener("change", function() {
    var selectedValue = this.value;
    vscode.postMessage({
        command: 'queryLimit',
        value: selectedValue
    });
    });
}

window.addEventListener('message', event => {
    const bigQueryJobId = event?.data?.bigQueryJobId;
    const errorMessage = event?.data?.errorMessage;
    if (bigQueryJobId){
        document.querySelector('.bigquery-job-cancelled').textContent = `❕ BigQuery Job was cancelled, jobId: ${bigQueryJobId}`;
    }
    if (errorMessage){
        document.getElementById('bigqueryerror').textContent = errorMessage;
    }
});
