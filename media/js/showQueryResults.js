const vscode = acquireVsCodeApi();

let incrementalCheckBoxDiv =  document.getElementById("incrementalCheckBoxDiv");

const checkbox = document.getElementById('incrementalCheckbox');
checkbox.addEventListener('change', function() {
    if (this.checked) {
        vscode.postMessage({
            command: 'incrementalCheckBox',
            value: true
        });
    } else {
        vscode.postMessage({
            command: 'incrementalCheckBox',
            value: false
        });
    }
});

document.getElementById("cancelBigQueryJobButton").disabled = true;

// Get all navigation links
const navLinks = document.querySelectorAll('.topnav a');

// Add click event listener to each link
navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
    // Remove active class from all links
    navLinks.forEach(link => link.classList.remove('active'));

    // Add active class to clicked link
    this.classList.add('active');
    if (this.getAttribute('href') === '#results') {
        document.getElementById("resultBlock").style.display = "";
        document.getElementById("codeBlock").style.display = "none";
        // Also show multi-results block if it's visible
        if (document.getElementById("multiResultsBlock").style.display !== "none") {
            document.getElementById("multiResultsBlock").style.display = "";
        }
    } else {
        document.getElementById("codeBlock").style.display = "";
        document.getElementById("resultBlock").style.display = "none";
        document.getElementById("multiResultsBlock").style.display = "none";
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

function clearLoadingMessage() {
    if (loadingMessage && document.body.contains(loadingMessage)) {
        document.body.removeChild(loadingMessage);
    }
    loadingMessage = undefined;
}

function hideNavLinks(){
    navLinks[0].style.display = 'none';
    navLinks[1].style.display = 'none';
}

function showNavLinks(){
    navLinks[0].style.display = '';
    navLinks[1].style.display = '';
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


// Add event listener for the Back to Summary button
const backToSummaryButton = document.getElementById('backToSummaryButton');
if (backToSummaryButton) {
    backToSummaryButton.addEventListener('click', function() {
        hideQuery();
        hideNavLinks();
        // Hide the back button
        document.getElementById('backToSummaryDiv').style.display = 'none';
        
        // Hide details view
        document.getElementById('resultBlock').style.display = 'none';
        document.getElementById('noResultsDiv').style.display = 'none';
        document.getElementById('errorsDiv').style.display = 'none';
        
        // Clear any displayed data
        document.getElementById('bigqueryResults').innerHTML = '';
        document.getElementById('bigqueryerror').textContent = '';
        
        // Show multi-results view
        document.getElementById('multiResultsBlock').style.display = 'block';
        
        // Recreate the summary table if needed
        if (currentSummaryData) {
            const columns = [
                {title: "Id", field: "index", headerSort: true, width: 80},
                {title: "Status", field: "status", headerSort: true, width: 120},
                {title: "Action", field: "index", formatter: function(cell) {
                    return "<button class='view-result-btn'>View Results</button>";
                }, cellClick: function(e, cell) {
                    if (e.target.classList.contains('view-result-btn')) {
                        const rowData = cell.getRow().getData();
                        handleViewResultClick(rowData.index);
                        showNavLinks();
                    }
                }, headerSort: false, width: 160},
                {title: "Query", field: "query", headerSort: true, width: 2500},
            ];
            
            new Tabulator("#multiQueryResults", {
                layout: "fitDataFill",
                height: "calc(100vh - 250px)",
                data: currentSummaryData,
                columns: columns,
                pagination: "local",
                paginationSize: 20,
                paginationCounter: "rows",
            });
        }
    });
}

// Store summary data for later use when switching back to summary view
let currentSummaryData = null;

function updateDateTime(elapsedTime, jobCostMeta, bigQueryJobEndTime) {
    let queryStatsText = bigQueryJobEndTime  + ' | Took:  (' + elapsedTime + ' seconds) ' + ' | billed:  ' + jobCostMeta ;
    document.getElementById('datetime').textContent = "Query results ran at: " + queryStatsText;
}

function updateBigQueryJobLink(bigQueryJobId) {
    const bigQueryJobLink = document.getElementById('bigQueryJobLink');
    const bigQueryJobLinkDivider = document.getElementById('bigQueryJobLinkDivider');
    const projectId = bigQueryJobId.split(':')[0];
    const jobId = bigQueryJobId.split(':')[1].replace('.', ':');
    const bigQueryLink = `https://console.cloud.google.com/bigquery?project=${projectId}&j=bq:${jobId}&page=queryresults`;

    bigQueryJobLinkDivider.textContent = ' | '; 
    bigQueryJobLink.href = bigQueryLink;
    bigQueryJobLink.textContent = `View job in BigQuery`;
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
    clearLoadingMessage();
    updateDateTime(elapsedTime, '0');
    document.getElementById("cancelBigQueryJobButton").disabled = true;
}

function handleViewResultClick(resultIndex) {
    // Clear any previous results first
    document.getElementById('bigqueryResults').innerHTML = '';
    document.getElementById('noResultsDiv').style.display = 'none';
    document.getElementById('errorsDiv').style.display = 'none';
    document.getElementById('bigqueryerror').textContent = '';
    
    // Show the back button
    document.getElementById('backToSummaryDiv').style.display = 'block';
    
    // Hide multi-results block and show single result block
    document.getElementById('multiResultsBlock').style.display = 'none';
    document.getElementById('resultBlock').style.display = 'block';
    
    // Request the specific result
    vscode.postMessage({
        command: 'viewResultDetail',
        resultIndex: resultIndex
    });
}

function handleShowQueryClick(query) {
    // Set the SQL content
    document.getElementById("sqlCodeBlock").textContent = query;

    // Switch to code view
    document.getElementById("resultBlock").style.display = "none";
    document.getElementById("multiResultsBlock").style.display = "none";
    document.getElementById("codeBlock").style.display = "";
    
    // Update the nav links to show the code tab as active
    const navLinks = document.querySelectorAll('.topnav a');
    navLinks.forEach(link => link.classList.remove('active'));
    navLinks[1].classList.add('active');
}

function hideQuery(){
    document.getElementById("sqlCodeBlock").textContent = '';
    document.getElementById("resultBlock").style.display = "block";
    document.getElementById("multiResultsBlock").style.display = "block";
    document.getElementById("codeBlock").style.display = "none";
    const navLinks = document.querySelectorAll('.topnav a');
    navLinks.forEach(link => link.classList.remove('active'));
    navLinks[0].classList.add('active');
}

window.addEventListener('message', event => {
    const results = event?.data?.results;
    const columns = event?.data?.columns;
    const jobStats = event?.data?.jobStats;
    const noResults = event?.data?.noResults;
    const jobCostMeta = jobStats?.jobCostMeta;
    const bigQueryJobEndTime = jobStats?.bigQueryJobEndTime;
    const bigQueryJobId =  event?.data?.bigQueryJobId || jobStats?.bigQueryJobId;
    const bigQueryJobCancelled = event?.data?.bigQueryJobCancelled;
    const errorMessage = event?.data?.errorMessage;
    const query = event?.data?.query;
    const showLoadingMessage = event?.data?.showLoadingMessage;
    const type = event?.data?.type;
    const incrementalCheckBox = event?.data?.incrementalCheckBox;
    const multiResults = event?.data?.multiResults;
    const summaryData = event?.data?.summaryData;
    
    if (checkbox) {
        checkbox.checked = incrementalCheckBox;
    }

    if (type === "incremental"){
       incrementalCheckBoxDiv.style.display = "";
    } else {
       incrementalCheckBoxDiv.style.display = "none";
    }

    // Handle multiple query results
    if (multiResults && summaryData) {
        hideQuery();
        hideNavLinks();
        document.getElementById("runQueryButton").disabled = false;
        document.getElementById("cancelBigQueryJobButton").disabled = true;
        clearInterval(timerInterval);
        clearLoadingMessage();
        
        // Hide the single result display
        document.getElementById('resultBlock').style.display = 'none';
        
        // Hide the back button
        document.getElementById('backToSummaryDiv').style.display = 'none';
        
        // Show the multi-results block
        const multiResultsBlock = document.getElementById('multiResultsBlock');
        multiResultsBlock.style.display = 'block';
        
        // Store summary data for later use
        currentSummaryData = summaryData;
        
        // Create columns for the summary table - removed Query column as requested
        const columns = [
            {title: "Id", field: "index", headerSort: true, width: 80},
            {title: "Status", field: "status", headerSort: true, width: 120},
            {title: "Action", field: "index", formatter: function(cell) {
                return "<button class='view-result-btn'>View Results</button>";
            }, cellClick: function(e, cell) {
                if (e.target.classList.contains('view-result-btn')) {
                    const rowData = cell.getRow().getData();
                    handleViewResultClick(rowData.index);
                    showNavLinks();
                }
            }, headerSort: false, width: 160},
            {title: "Query", field: "query", headerSort: true, width: 2500}
        ];
        
        // Create the tabulator table
        new Tabulator("#multiQueryResults", {
            layout: "fitDataFill",
            height: "calc(100vh - 250px)",
            data: summaryData,
            columns: columns,
            pagination: "local",
            paginationSize: 20,
            paginationCounter: "rows",
        });
    }

    if (bigQueryJobId) {
        updateBigQueryJobLink(bigQueryJobId);
    }

    if (results && columns) {
        document.getElementById("runQueryButton").disabled = false;
        document.getElementById("cancelBigQueryJobButton").disabled = true;
        updateDateTime(elapsedTime, jobCostMeta, bigQueryJobEndTime);
        clearInterval(timerInterval);
        clearLoadingMessage();

        const errorMessageBlock = document.getElementById('errorMessage');
        const errorMessageDiv = document.getElementById('errorsDiv');
        if (errorMessageBlock){
            if (type === "assertion"){
                errorMessageDiv.style.display = "";
                errorMessageBlock.textContent = `Assertion failed !`;
            } else {
                errorMessageDiv.style.display = "none";
            }
        }

        // Ensure result block is visible and clear any previous table
        document.getElementById('resultBlock').style.display = 'block';
        document.getElementById('bigqueryResults').innerHTML = '';
        
        // Show the table
        document.getElementById('bigqueryResults').style.display = 'table';

        new Tabulator("#bigqueryResults", {
            layout: "fitDataFill",
            height: "calc(100vh - 200px)",
            data: results,
            columns: columns,
            // autoColumns:true,
            dataTree: true,
            dataTreeStartExpanded: false,
            rowHeader: { formatter: "rownum", headerSort: false, hozAlign: "center", resizable: false, frozen: true, width: 60 },
            pagination: "local",
            paginationSize: 20,
            paginationCounter: "rows",
        });
    }

    if (bigQueryJobCancelled && bigQueryJobId){
        postRunCleanup();
        const jobCancelled = document.querySelector('.bigquery-job-cancelled');
        if(jobCancelled){
            jobCancelled.textContent = `❕ BigQuery Job was cancelled, bigQueryJobId: ${bigQueryJobId}`;
        }
    }

    if(noResults){
        postRunCleanup();
        const noResultsForQuery = document.getElementById('noResults');
        const noResultsDiv = document.getElementById('noResultsDiv');
        if (noResultsForQuery){
            noResultsDiv.style.display = "";
            if (type === "assertion"){
                noResultsForQuery.textContent = `Assertion passed !`;
                updateDateTime(elapsedTime, jobCostMeta, bigQueryJobEndTime);
                updateBigQueryJobLink(bigQueryJobId);
            } else {
                noResultsForQuery.textContent = `There is no data to display`;
            }
        }
    }

    if (query){
        document.getElementById("sqlCodeBlock").textContent = query;
        hljs.addPlugin( new CopyButtonPlugin({
            autohide: false, // Always show the copy button
        }));
        hljs.highlightAll();
    }

    if (errorMessage){
        postRunCleanup();
        document.getElementById('bigqueryerror').textContent = errorMessage;
    }

    if (showLoadingMessage){
        document.getElementById("cancelBigQueryJobButton").disabled = false;
        
        // Clear any existing loading message first
        clearLoadingMessage();
        
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
            if (loadingMessage) {
                loadingMessage.textContent = `Loading data... (${elapsedTime} seconds)`;
            }
            return elapsedTime;
        }

        elapsedTime = updateLoadingMessage();
        timerInterval = setInterval(updateLoadingMessage, 1000);
        document.body.appendChild(loadingMessage);
    }
});
