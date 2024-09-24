const vscode = acquireVsCodeApi();

function updateDateTime(elapsedTime, totalGbBilled) {
    const now = new Date();
    const options = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    };
    let queryStatsText = now.toLocaleString('en-US', options) + ' | Took:  (' + elapsedTime + ' seconds) ' + ' | GB billed:  ' + totalGbBilled ;
    document.getElementById('datetime').textContent = queryStatsText;
}

document.getElementById('cancelBigQueryJobButton').addEventListener('click', function() {
    vscode.postMessage({
        command: 'cancelBigQueryJob'
    });
});


// Create a loading message element
const loadingMessage = document.createElement('div');
loadingMessage.id = 'loading-message';
loadingMessage.textContent = 'Loading data...';
loadingMessage.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 12px;
`;

let startTime = Date.now();
let elapsedTime = 0;

function updateLoadingMessage() {
    elapsedTime = Math.floor((Date.now() - startTime) / 1000);
    loadingMessage.textContent = `Loading data... (${elapsedTime} seconds)`;
    return elapsedTime;
}

elapsedTime = updateLoadingMessage();
const timerInterval = setInterval(updateLoadingMessage, 1000);
document.body.appendChild(loadingMessage);

// Hide the table initially
document.getElementById('example').style.display = 'none';

window.addEventListener('message', event => {
    const results = event?.data?.results;
    const jobStats = event?.data?.jobStats;
    const totalBytesBilled = jobStats.totalBytesBilled;
    let totalGbBilled =  (parseFloat(totalBytesBilled) / 10 ** 9).toFixed(3) + " GB";

    if (results) {
        document.getElementById("cancelBigQueryJobButton").disabled = true;
        updateDateTime(elapsedTime, totalGbBilled);
        clearInterval(timerInterval);
        document.body.removeChild(loadingMessage);

        // Show the table
        document.getElementById('example').style.display = 'table';

        new Tabulator("#example", {
            data:results, //assign data to table
            autoColumns:true, //create columns from data field names
            rowHeader:{formatter:"rownum", headerSort:false, hozAlign:"center", resizable:false, frozen:true},
            pagination:"local",       //paginate the data
            paginationSize:20,         //allow 7 rows per page of data
            paginationCounter:"rows", //display count of paginated rows in footer
        });
    }
});
