const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    hljs.addPlugin(new CopyButtonPlugin({
        autohide: false, // Always show the copy button
    }));
});

const runModelButton = document.getElementById('runModel');
const costEstimatorButton = document.getElementById('costEstimator');
const includeDependenciesCheckbox = document.getElementById('includeDependencies');
const includeDependentsCheckBox = document.getElementById('includeDependents');
const fullRefreshCheckBox = document.getElementById('fullRefresh');
const noSchemaBlockDiv = document.getElementById("noSchemaBlock");


function populateDropdown(tags) {
    const dropdown = document.getElementById('tags');
    dropdown.innerHTML = '<option disabled selected>Tags</option>';
    tags.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        dropdown.appendChild(option);
    });
}

function runModelClickHandler() {
    runModelButton.disabled = true;
    vscode.postMessage({
        command: 'runModel',
        value: {
            runMode: true,
            includeDependents: includeDependentsCheckBox.checked,
            includeDependencies: includeDependenciesCheckbox.checked,
            fullRefresh: fullRefreshCheckBox.checked,
        }
    });

    setTimeout(() => {
        runModelButton.disabled = false;
    }, 10000);
}

function costEstimatorClickHandler() {
    costEstimatorButton.disabled = true;
    const dropdown = document.getElementById("tags");
    const selectedTag = dropdown.value;
    vscode.postMessage({
        command: 'costEstimator',
        value: {
            selectedTag: selectedTag
        }
    });

    setTimeout(() => {
        costEstimatorButton.disabled = false;
    }, 3000);
}

if (runModelButton) {
    runModelButton.addEventListener('click', runModelClickHandler);
}

if(costEstimatorButton){
    costEstimatorButton.addEventListener('click', costEstimatorClickHandler);
}

const previewResultsButton = document.getElementById('previewResults');
function previewResultsClickHandler() {
    vscode.postMessage({
        command: 'previewResults',
        value: true
    });
}

if (previewResults) {
    previewResultsButton.addEventListener('click', previewResultsClickHandler);
}


const depsDiv = document.getElementById("depsDiv");
const dependencyHeader = document.querySelector('.dependency-header');
const arrowToggle = document.querySelector('.arrow-toggle');

dependencyHeader.addEventListener('click', () => {
    arrowToggle.classList.toggle('open');
    depsDiv.classList.toggle('open');
});

const compiledQueryloadingIcon = document.getElementById("compiledQueryloadingIcon");
const dryRunloadingIcon = document.getElementById("dryRunloadingIcon");
const navLinks = document.querySelectorAll('.topnav a');

navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
        // Remove active class from all links
        navLinks.forEach(link => link.classList.remove('active'));

        // Add active class to clicked link
        this.classList.add('active');
        if (this.getAttribute('href') === '#compilation') {
            document.getElementById("compilationBlock").style.display = "";
            document.getElementById("costBlock").style.display = "none";
            document.getElementById("schemaBlock").style.display = "none";
        } else if (this.getAttribute('href') === '#schema')  {
            document.getElementById("schemaBlock").style.display = "";
            document.getElementById("costBlock").style.display = "none";
            document.getElementById("compilationBlock").style.display = "none";
        } else if (this.getAttribute('href') === '#cost')  {
            document.getElementById("costBlock").style.display = "";
            document.getElementById("schemaBlock").style.display = "none";
            document.getElementById("compilationBlock").style.display = "none";
        }
    });
});

const getUrlToNavigateToTableInBigQuery = (gcpProjectId, datasetId, tableName) => {
    return `https://console.cloud.google.com/bigquery?project=${gcpProjectId}&ws=!1m5!1m4!4m3!1s${gcpProjectId}!2s${datasetId}!3s${tableName}`;
};


// Function to update and rehighlight code blocks
function removeExistingCopyElements() {
    document.querySelectorAll('.hljs-copy-wrapper').forEach(el => {
        el.classList.remove('hljs-copy-wrapper');
    });
    document.querySelectorAll('.hljs-copy-button').forEach(el => {
        el.remove();
    });
}

window.addEventListener('message', event => {
    dryRunloadingIcon.style.display = "";
    let data = {
        "preOperations": event?.data?.preOperations,
        "postOperations": event?.data?.postOperations,
        "tableOrViewQuery": event?.data?.tableOrViewQuery,
        "assertionQuery": event?.data?.assertionQuery,
        "incrementalPreOpsQuery": event?.data?.incrementalPreOpsQuery,
        "incrementalQuery": event?.data?.incrementalQuery,
        "nonIncrementalQuery": event?.data?.nonIncrementalQuery,
        "operationsQuery": event?.data?.operationsQuery,
        "relativeFilePath": event?.data?.relativeFilePath,
        "errorMessage": event?.data?.errorMessage,
        "dryRunStat": event?.data?.dryRunStat,
    };
    removeExistingCopyElements();

    let dataformTags = event?.data?.dataformTags;
    if(dataformTags){
        populateDropdown(dataformTags);
    }

    const dependents = event?.data?.dependents;
    const models = event?.data?.models;
    const lineageMetadata = event?.data?.lineageMetadata;
    if (models){

        let targetTableOrView = event?.data?.targetTableOrView;
        if (targetTableOrView){
            const targetTableOrViewLink = document.getElementById('targetTableOrViewLink');
            targetTableOrViewLink.href = getUrlToNavigateToTableInBigQuery(targetTableOrView.database, targetTableOrView.schema, targetTableOrView.name);
            targetTableOrViewLink.textContent = `${targetTableOrView.database}.${targetTableOrView.schema}.${targetTableOrView.name}`;
        }


        const upstreamHeader = document.createElement("header");
        upstreamHeader.innerHTML = "<h4>Dependencies</h4>";

        fullTableIds = [];
        const dependencyList = document.createElement('ol');
        for (let i = 0; i < models.length; i++) {
            let tableTargets = models[i]?.dependencyTargets;
            if (!tableTargets){
                continue;
            }
            for (let j = 0; j < tableTargets.length; j++) {
                fullTableId = `${tableTargets[j].database}.${tableTargets[j].schema}.${tableTargets[j].name}`;
                fullTableIds.push(fullTableId);

                const li = document.createElement('li');
                const link = document.createElement('a');
                link.href = getUrlToNavigateToTableInBigQuery(tableTargets[j].database, tableTargets[j].schema, tableTargets[j].name);
                link.textContent = fullTableId;
                li.appendChild(link);
                dependencyList.appendChild(li);
            }
        }

        depsDiv.innerHTML = "";
        depsDiv.appendChild(upstreamHeader);
        depsDiv.appendChild(dependencyList);

        if (dependents && dependents.length > 0){
            const downstreamHeader = document.createElement("header");
            downstreamHeader.innerHTML = "<h4>Dependents</h4>";

            const dependentsList = document.createElement('ol');
            for (let j = 0; j < dependents.length; j++) {
                    fullTableId = `${dependents[j].database}.${dependents[j].schema}.${dependents[j].name}`;
                    fullTableIds.push(fullTableId);

                    const li = document.createElement('li');
                    const link = document.createElement('a');
                    link.href = getUrlToNavigateToTableInBigQuery(dependents[j].database, dependents[j].schema, dependents[j].name);
                    link.textContent = fullTableId;
                    li.appendChild(link);
                    dependentsList.appendChild(li);
            }
            depsDiv.appendChild(downstreamHeader);
            depsDiv.appendChild(dependentsList);
        }

        const lineageMetadataButton = document.createElement('button');
        lineageMetadataButton.id = 'lineageMetadata';
        lineageMetadataButton.classList.add('lineage-metadata-button');

        const buttonText = document.createElement('h4');
        if(lineageMetadata?.dependencies){
            buttonText.textContent = '[beta] Dataplex Downstream  ▼ ';
        } else {
            buttonText.textContent = '[beta] Dataplex Downstream  ▶︎ ';
        }
        buttonText.style.margin = '0';
        lineageMetadataButton.appendChild(buttonText);
        depsDiv.appendChild(lineageMetadataButton);

        const explainLineagePara = document.createElement('p');
        explainLineagePara.innerHTML = `When clicked will retreive downstream lineage using Data Lineage API , similar to "LINEAGE" on BigQuery console. Requires <pre style="display: inline; white-space: pre-wrap;">roles/datalineage.viewer</pre> permissions`;

        depsDiv.appendChild(explainLineagePara);

        const lineageMetadataButttonId = document.getElementById('lineageMetadata');
        lineageMetadataButttonId.addEventListener('click', function() {
            vscode.postMessage({
                command: 'lineageMetadata',
                value: true
            });
            const lineageLoadingIconDiv = document.createElement('div');
            lineageLoadingIconDiv.id = "lineageLoadingIcon";
            lineageLoadingIconDiv.innerHTML = `
            <svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="25" cy="25" r="10" fill="none" stroke="#3498db" stroke-width="4">
                        <animate attributeName="stroke-dasharray" dur="2s" repeatCount="indefinite"
                        values="0 126;126 126;126 0"/>
                        <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite"
                        values="0;-126;-252"/>
                    </circle>
            </svg>`;
            depsDiv.appendChild(lineageLoadingIconDiv);
        });

        if(lineageMetadata?.error){
            const dataplexHeader = document.createElement("header");
            dataplexHeader.innerHTML = `<h4 style="color: #FFB3BA;">${lineageMetadata.error}</h4>`;
            depsDiv.appendChild(dataplexHeader);
        }

        // NOTE: sacrifice O(N) memory for O(N*M) runtime where M,N are number of external and internal deps
        const _dependentsList = [];
        for (const dep of dependents) {
            _dependentsList.push(`${dep.database}.${dep.schema}.${dep.name}`);
        }
        _dependentsList.push((`${targetTableOrView.database}.${targetTableOrView.schema}.${targetTableOrView.name}`));

        const liniageDependencies = lineageMetadata?.dependencies;
        if (lineageMetadata && liniageDependencies?.length > 0 && !lineageMetadata.error){
            const downstreamHeader = document.createElement("header");

            const dependentsList = document.createElement('ol');
            const listItems = [];

            for (let j = 0; j < liniageDependencies.length; j++) {
                const fullTableId = liniageDependencies[j];
                fullTableIds.push(fullTableId);

                const li = document.createElement('li');
                const link = document.createElement('a');

                let exists = _dependentsList.includes(fullTableId);

                const [projectId, datasetId, tableId] = fullTableId.split(".");
                link.href = getUrlToNavigateToTableInBigQuery(projectId, datasetId, tableId);
                link.textContent = fullTableId;
                li.appendChild(link);

                if (!exists) {
                    const externalTag = document.createElement('span');
                    externalTag.className = 'external-tag';
                    externalTag.textContent = 'external';
                    li.appendChild(externalTag);
                }

                listItems.push({ element: li, isExternal: !exists });
            }

            listItems.sort((a, b) => {
                if (a.isExternal === b.isExternal) {return 0;}
                return a.isExternal ? -1 : 1;
            });

            listItems.forEach(item => dependentsList.appendChild(item.element));
            depsDiv.appendChild(dependentsList);
            depsDiv.appendChild(downstreamHeader);
        } else if (liniageDependencies?.length === 0){
            const noExternalDeps = document.createElement("p");
            noExternalDeps.innerHTML = "<p>No dependents found!</p>";
            depsDiv.appendChild(noExternalDeps);
        }

    }

    let compiledQuerySchema =  event?.data?.compiledQuerySchema;
    if (compiledQuerySchema){
        noSchemaBlockDiv.innerHTML = "";
        new Tabulator("#schemaTable", {
            data: compiledQuerySchema.fields,
            columns: [
                {title: "name", field: "name", headerFilter: "input",  formatter: "plaintext"},
                {title: "type", field: "type", headerFilter: "input",  formatter: "plaintext"},
                {title: "description", field: "description",  formatter: "plaintext", width: 900, variableHeight: true },
            ],
            pagination:"local",
            paginationSize:50,
            paginationCounter:"rows",
            selectable: false,
            movableRows: false,
            rowHeader: {
                formatter: "rownum",
                headerSort: false,
                hozAlign: "center",
                resizable: false,
                frozen: true,
                width: 40
            },
            autoColumnsDefinitions: function(definitions) {
                definitions.forEach(function(column) {
                    column.headerFilter = "input";
                    column.headerFilterLiveFilter = true;
                });
                return definitions;
            },
        });
    }

    let costEstimatorData =  event?.data?.costEstimatorData;
    if(costEstimatorData){
        new Tabulator("#costTable", {
        data: costEstimatorData,
        columns: [
            {title: "Target", field: "targetName", headerFilter: "input", formatter: "plaintext"},
            {title: "Type", field: "type", headerFilter: "input", formatter: "plaintext"},
            {title: "Statement type", field: "statementType", headerFilter: "input", formatter: "plaintext"},
            {title: "Accuracy", field: "totalBytesProcessedAccuracy", headerFilter: "input", formatter: "plaintext"},
            {
                title: "GB proc.",
                field: "totalGBProcessed",
                formatter: function(cell, formatterParams) {
                        const value = parseFloat(cell.getValue());
                        return isNaN(value) ? "" : value.toFixed(2);
                },
                bottomCalc: function(values) {
                    const sum = values.reduce((acc, val) => acc + parseFloat(val) || 0, 0);
                    return sum.toFixed(2);
                },
                bottomCalcFormatter: function(cell, formatterParams) {
                    return cell.getValue();
                }
            },
            {
                title: "Cost",
                field: "cost",
                formatter: "money",
                formatterParams: {
                    precision: 2,
                    symbol: "£"
                },
                bottomCalc: "sum",
                bottomCalcFormatter: "money",
                bottomCalcFormatterParams: {
                    precision: 2,
                    symbol: "£"
                }
            },
            {title: "error", field: "error",  formatter: "plaintext",  cssClass: "error-column" },
        ],
        pagination: "local",
        paginationSize: 20,
        paginationCounter: "rows",
        selectable: false,
        movableRows: false,
        rowHeader: {
            formatter: "rownum",
            headerSort: false,
            hozAlign: "center",
            resizable: false,
            frozen: true,
            width: 40
        },
        autoColumnsDefinitions: function(definitions) {
            definitions.forEach(function(column) {
            column.headerFilter = "input";
            column.headerFilterLiveFilter = true;
            });
            return definitions;
        },
        footerElement: "<div id='total-cost'></div>",
        });
    }


    const compiledQuerySchemaNotAvailable = compiledQuerySchema && compiledQuerySchema.length === 1 && compiledQuerySchema[0].name === "" && compiledQuerySchema[0].type === "";
    if(compiledQuerySchemaNotAvailable && event?.data?.dryRunStat){
        noSchemaBlockDiv.innerHTML = "";
        const noSchemaHeader = document.createElement("header");
        noSchemaHeader.innerHTML = "<h4>Schema could not be infered for the transaction defined in the current model</h4>";
        noSchemaHeader.style.color = "#FFA500"; // orange
        noSchemaBlockDiv.appendChild(noSchemaHeader);
    }

    compiledQueryloadingIcon.style.display = "none";

    Object.entries(data).forEach(([key, value]) => {
        const element = document.getElementById(key);
        const divElement = document.getElementById(key + "Div");

        if (value === undefined || value === null || value === "") {
            if (divElement?.style){
                divElement.style.display = "none";
            }
        } else {
            if(key === "errorMessage"){
                dryRunloadingIcon.style.display = "none";
                if (value === " "){
                    divElement.style.display = "none";
                } else {
                    divElement.style.display = "";
                    element.innerHTML = value;
                }
            }
            else if (key === "dryRunStat"){
                dryRunloadingIcon.style.display = "none";
                if (value === "0 GB"){
                    divElement.style.display = "none";
                } else {
                    divElement.style.display = "";
                    element.textContent = `This query will process ${value} when run.`;
                }
            } else {
                if (divElement?.style){
                    divElement.style.display = "";
                }
                element.textContent = value;

                // Reset highlighting
                element.removeAttribute('data-highlighted');
                element.className = element.className.replace(/\bhljs\b/, '');

                // Re-apply highlighting
                hljs.highlightElement(element);
                hljs.lineNumbersBlock(element);
            }
        }
    });
});
