const vscode = acquireVsCodeApi();

// Get all navigation links
const navLinks = document.querySelectorAll('.topnav a');

// Add click event listener to each link
navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
    // Remove active class from all links
    navLinks.forEach(link => link.classList.remove('active'));
    
    // Add active class to clicked link
    this.classList.add('active');
    console.log(this);
    if (this.getAttribute('href') === '#results') {
        document.getElementById("resultBlock").style.display = "";
        document.getElementById("codeBlock").style.display = "none";
    } else {
        document.getElementById("codeBlock").style.display = "";
        document.getElementById("resultBlock").style.display = "none";
    }
    });
});

// Set initial active link (optional)
document.querySelector('.topnav a').classList.add('active');

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

// Hide the table initially
const bigQueryResults = document.getElementById('bigqueryResults');
if (bigQueryResults){
    bigQueryResults.style.display = 'none';
}

let timerInterval = undefined;
let elapsedTime = 0;
let loadingMessage = undefined;

function postRunCleanup(){
    clearInterval(timerInterval);
    if (loadingMessage){
        document.body.removeChild(loadingMessage);
    }
    updateDateTime(elapsedTime, '0');
    document.getElementById("cancelBigQueryJobButton").disabled = true;
}

window.addEventListener('message', event => {
    const results = event?.data?.results;
    const columns = event?.data?.columns;
    const jobStats = event?.data?.jobStats;
    const noResults = event?.data?.noResults;
    const totalBytesBilled = jobStats?.totalBytesBilled;

    const bigQueryJobId = event?.data?.bigQueryJobId;
    const errorMessage = event?.data?.errorMessage;
    const query = event?.data?.query;

    const showLoadingMessage = event?.data?.showLoadingMessage;

    let totalGbBilled =  (parseFloat(totalBytesBilled) / 10 ** 9).toFixed(3) + " GB";

    if (results && columns) {
        document.getElementById("runQueryButton").disabled = false;
        document.getElementById("cancelBigQueryJobButton").disabled = true;
        updateDateTime(elapsedTime, totalGbBilled);
        clearInterval(timerInterval);
        document.body.removeChild(loadingMessage);

        // Show the table
        document.getElementById('bigqueryResults').style.display = 'table';

        new Tabulator("#bigqueryResults", {
            data:results,
            columns:columns,
            // autoColumns:true,
            dataTree:true,
            dataTreeStartExpanded:false,
            rowHeader:{formatter:"rownum", headerSort:false, hozAlign:"center", resizable:false, frozen:true},
            pagination:"local",
            paginationSize:20,
            paginationCounter:"rows",
        });
    }

    if (bigQueryJobId){
        postRunCleanup();
        const jobCancelled = document.querySelector('.bigquery-job-cancelled');
        if(jobCancelled){
            jobCancelled.textContent = `❕ BigQuery Job was cancelled, jobId: ${bigQueryJobId}`;
        }
    }

    if(noResults){
        postRunCleanup();
        const noResultsForQuery = document.getElementById('no-results');
        if (noResultsForQuery){
            noResultsForQuery.textContent = `❕ There is no data to display`;
        }
    }

    if (query){
        // document.getElementById('bigqueryerror').textContent = errorMessage;
        document.getElementById("sqlCodeBlock").textContent = query;
        hljs.addPlugin( new CopyButtonPlugin({
            autohide: false, // Always show the copy button
        }));
        hljs.highlightAll();
        hljs.initLineNumbersOnLoad();
        document.getElementById("codeBlock").style.display = "none";
    }

    if (errorMessage){
        postRunCleanup();
        document.getElementById('bigqueryerror').textContent = errorMessage;
    }

    if (showLoadingMessage){
        // Create a loading message element
        loadingMessage = document.createElement('div');
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

        function updateLoadingMessage() {
            elapsedTime = Math.floor((Date.now() - startTime) / 1000);
            loadingMessage.textContent = `Loading data... (${elapsedTime} seconds)`;
            return elapsedTime;
        }

        elapsedTime = updateLoadingMessage();
        timerInterval = setInterval(updateLoadingMessage, 1000);
        document.body.appendChild(loadingMessage);
    }
});
