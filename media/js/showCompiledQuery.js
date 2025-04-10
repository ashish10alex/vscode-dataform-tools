const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    hljs.addPlugin(new CopyButtonPlugin({
        autohide: false, // Always show the copy button
    }));
});

function createCopyButton(modelName){
    return `
        <div class="copy-button-container">
            <button class="copy-model-button" title="Copy model name" onclick="copyModelNameHandler('${modelName}')">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span class="button-text"></span>
            </button>
        </div>
    `;
}


const costEstimatorloadingIcon = document.getElementById("costEstimatorloadingIcon");
const runModelButton = document.getElementById('runModel');
const costEstimatorButton = document.getElementById('costEstimator');
const includeDependenciesCheckbox = document.getElementById('includeDependencies');
const includeDependentsCheckBox = document.getElementById('includeDependents');
const fullRefreshCheckBox = document.getElementById('fullRefresh');
const noSchemaBlockDiv = document.getElementById("noSchemaBlock");
const targetTableOrViewLink = document.getElementById('targetTableOrViewLink');
const dryRunStatDiv = document.getElementById("dryRunStatDiv");
const errorMessageDiv = document.getElementById("errorMessageDiv");
const dataLineageDiv = document.getElementById("dataLineageDiv");
const modelLinkDiv = document.getElementById("modelLinkDiv");
const copyModelNameButton = document.getElementById("copyModelNameButton");
const dependencyGraphButton = document.getElementById("dependencyGraph");
const schemaCodeBlock = document.getElementById("schemaCodeBlock");
const compilerOptionsInput = document.getElementById("compilerOptionsInput");
let fullModelName = "";
let descriptionData = {}; // Variable to store description data

function dependencyGraphClickHandler() {
    vscode.postMessage({
        command: 'dependencyGraph',
        value: true
    });
}

if (dependencyGraphButton) {
    dependencyGraphButton.addEventListener('click', dependencyGraphClickHandler);
}

if (compilerOptionsInput) {
    compilerOptionsInput.addEventListener('input', debounce(updateCompilerOptions, 500));
    
    // Debounce function to delay execution until user stops typing
    function debounce(func, wait) {
        let timeout;
        return function() {
            const context = this;
            const args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(context, args);
            }, wait);
        };
    }
}

function updateCompilerOptions() {
    const compilerOptions = compilerOptionsInput.value;
    vscode.postMessage({
        command: 'updateCompilerOptions',
        value: compilerOptions
    });
}

function populateDropdown(tags, defaultTag = undefined) {
    const dropdown = document.getElementById('tags');
    dropdown.innerHTML = '<option disabled selected>Tags</option>';
    tags.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        if (defaultTag && tag === defaultTag) {
            option.selected = true;
        }
        dropdown.appendChild(option);
    });
}


function formatCurrentFileClickHandler() {
    formatButton.disabled = true;
    vscode.postMessage({
        command: 'formatCurrentFile',
        value: true
    });
    setTimeout(() => {
        formatButton.disabled = false;
    }, 100);
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
    costEstimatorloadingIcon.style.display = "";
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

function copyModelNameHandler(modelName){
    const textToCopy = "`" + modelName + "`";
    const button = event.currentTarget;
    const buttonText = button.querySelector('.button-text');
    navigator.clipboard.writeText(textToCopy).then(() => {
        buttonText.textContent = 'copied!';
        setTimeout(() => {
            buttonText.textContent = '';
        }, 500);
    }).catch(function(err) {
        console.error('Failed to copy model name: ', err);
    });
}

if(copyModelNameButton){
    copyModelNameButton.removeEventListener('click', copyModelNameHandler);
}

if (runModelButton) {
    runModelButton.addEventListener('click', runModelClickHandler);
}

if(costEstimatorButton){
    costEstimatorButton.addEventListener('click', costEstimatorClickHandler);
}

if(formatButton){
    formatButton.addEventListener('click', formatCurrentFileClickHandler);
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
            modelLinkDiv.style.display = "";
            dataLineageDiv.style.display = "";
            document.getElementById("compilationBlock").style.display = "";
            document.getElementById("costBlock").style.display = "none";
            document.getElementById("schemaBlock").style.display = "none";
            document.getElementById("schemaCodeBlockDiv").style.display = "none";
        } else if (this.getAttribute('href') === '#schema')  {
            modelLinkDiv.style.display = "";
            dataLineageDiv.style.display = "";
            document.getElementById("schemaBlock").style.display = "";
            document.getElementById("schemaCodeBlockDiv").style.display = "";
            document.getElementById("costBlock").style.display = "none";
            document.getElementById("compilationBlock").style.display = "none";
        } else if (this.getAttribute('href') === '#cost')  {
            document.getElementById("costBlock").style.display = "";
            document.getElementById("schemaBlock").style.display = "none";
            document.getElementById("compilationBlock").style.display = "none";
            document.getElementById("schemaCodeBlockDiv").style.display = "none";
            modelLinkDiv.style.display = "none";
            dataLineageDiv.style.display = "none";
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

    const hasError = event?.data?.errorMessage && event?.data?.errorMessage !== " ";

    const formatButton = document.getElementById('formatButton');
    if (formatButton) {
        formatButton.disabled = hasError;
    }

    let dataformTags = event?.data?.dataformTags;
    if(dataformTags){
        populateDropdown(dataformTags, event?.data?.selectedTag);
    }

    let currencySymbol = event?.data?.currencySymbol;
    const dependents = event?.data?.dependents;
    const models = event?.data?.models;
    const lineageMetadata = event?.data?.lineageMetadata;
    let modelsLastUpdateTimesMeta = event?.data?.modelsLastUpdateTimesMeta;
    if (models){

        let targetTablesOrViews = event?.data?.targetTablesOrViews;
        if (targetTablesOrViews) {
            modelLinkDiv.style.display = "";
            targetTableOrViewLink.style.display = "";
            
            let linksHtml = '';
            for (const [index, targetTableOrView] of targetTablesOrViews.entries()) {
                const modelName = `${targetTableOrView.target.database}.${targetTableOrView.target.schema}.${targetTableOrView.target.name}`;
                const modelUrl = getUrlToNavigateToTableInBigQuery(targetTableOrView.target.database, targetTableOrView.target.schema, targetTableOrView.target.name);
                fullModelName = modelName;

                if (modelsLastUpdateTimesMeta) {
                    const modelLastUpdateTime = modelsLastUpdateTimesMeta[index]?.lastModifiedTime;
                    const modelWasUpdatedToday = modelsLastUpdateTimesMeta[index]?.modelWasUpdatedToday;
                    linksHtml += `
                        <div>
                            <span class="modified-time ${modelWasUpdatedToday === false ? 'outdated' : ''}" 
                                    title="Last modified: ${modelLastUpdateTime || 'n/a'}">
                                <small>Last modified: ${modelLastUpdateTime || 'n/a'}</small>
                            </span><br>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <a href="${modelUrl}">${modelName}</a>
                                ${createCopyButton(modelName)}
                            </div>
                        </div>
                    `;
                } else {
                    linksHtml += `
                        <div>
                            <span class="modified-time">
                                <small>Last modified: n/a</small>
                            </span><br>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <a href="${modelUrl}">${modelName}</a>
                                ${createCopyButton(modelName)}
                            </div>
                        </div>
                    `;
                }
            }
            targetTableOrViewLink.innerHTML = linksHtml;
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
            buttonText.textContent = 'Dataplex Downstream  ▼ ';
        } else {
            buttonText.textContent = 'Dataplex Downstream  ▶︎ ';
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
        for (const targetTable of targetTablesOrViews) {
            _dependentsList.push(`${targetTable.target.database}.${targetTable.target.schema}.${targetTable.target.name}`);
        }

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
        const schemaTable =new Tabulator("#schemaTable", {
            data: compiledQuerySchema.fields,
            columns: [
                {title: "name", field: "name", headerFilter: "input",  formatter: "plaintext"},
                {title: "type", field: "type", headerFilter: "input",  formatter: "plaintext"},
                {title: "description", field: "description",  formatter: "plaintext", width: 900, variableHeight: true , editor: "input"},
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
        schemaTable.on("cellEdited", function(cell) {
            const row = cell.getRow();
            const fieldName = row.getData().name;
            const newDescription = cell.getValue();
            descriptionData[fieldName] = newDescription;
            schemaCodeBlock.textContent = JSON.stringify(descriptionData, null, 2).replace(/"([^"]+)":/g, '$1:');
            // remove existing highlight and line numbers
            schemaCodeBlock.removeAttribute('data-highlighted');
            schemaCodeBlock.className = schemaCodeBlock.className.replace(/\bhljs\b/, '');
            // re-apply highlighting
            hljs.highlightElement(schemaCodeBlock);
            hljs.lineNumbersBlock(schemaCodeBlock);
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
                    // Check if the error message contains HTML
                    if (value.includes('<')) {
                        // For structured HTML error messages
                        element.innerHTML = `
                            <div class="error-content">
                                ${value}
                            </div>
                        `;
                    } else {
                        // For simple error messages
                        element.innerHTML = `
                            <div class="error-content">
                                <div class="error-details">${value}</div>
                            </div>
                        `;
                    }
                }
            }
            else if (key === "dryRunStat") {
                dryRunloadingIcon.style.display = "none";
                if (event?.data?.errorMessage !== " ") {
                    divElement.style.display = "none";
                } else {
                    divElement.style.display = "";
                    // Parse the dryRunStat to separate the bytes and cost
                    const [bytes, cost] = value.split(' (');
                    const formattedCost = cost ? ` (${cost}` : '';
                    
                    element.innerHTML = `
                        <div class="stats-content">
                            <span class="stats-label">Query will process:</span>
                            <span class="stats-value">${bytes}</span>
                            <span class="stats-cost">${formattedCost}</span>
                        </div>
                    `;
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

    let tagDryRunStatsMeta =  event?.data?.tagDryRunStatsMeta;
    if(tagDryRunStatsMeta?.tagDryRunStatsList && !tagDryRunStatsMeta?.error?.message){
        costEstimatorloadingIcon.style.display = "none";
        targetTableOrViewLink.style.display = "none";
        dryRunStatDiv.style.display = "none";
        dataLineageDiv.style.display = "none";

        new Tabulator("#costTable", {
        data: tagDryRunStatsMeta.tagDryRunStatsList,
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
                field: "costOfRunningModel",
                formatter: "money",
                formatterParams: {
                    precision: 2,
                    symbol: currencySymbol
                },
                bottomCalc: "sum",
                bottomCalcFormatter: "money",
                bottomCalcFormatterParams: {
                    precision: 2,
                    symbol: currencySymbol
                }
            },
            {title: "error", field: "error",  formatter: "plaintext",  cssClass: "error-column" },
        ],
        initialSort: [
            {column: "error", dir: "desc"}
        ],
        pagination: "local",
        paginationSize:30,
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

});
