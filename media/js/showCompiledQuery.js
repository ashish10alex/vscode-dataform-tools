document.addEventListener('DOMContentLoaded', () => {
    hljs.addPlugin(new CopyButtonPlugin({
        autohide: false, // Always show the copy button
    }));
});

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
            document.getElementById("schemaBlock").style.display = "none";
        } else {
            document.getElementById("schemaBlock").style.display = "";
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

    const models = event?.data?.models;
    if (models){
        fullTableIds = [];

        const dependencyList = document.createElement('ul');
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
        depsDiv.appendChild(dependencyList);
    }

    let targetTableOrView = event?.data?.targetTableOrView;
    if (targetTableOrView){
        const targetTableOrViewLink = document.getElementById('targetTableOrViewLink');
        targetTableOrViewLink.href = getUrlToNavigateToTableInBigQuery(targetTableOrView.database, targetTableOrView.schema, targetTableOrView.name);
        targetTableOrViewLink.textContent = `${targetTableOrView.database}.${targetTableOrView.schema}.${targetTableOrView.name}`;
    }

    let compiledQuerySchema =  event?.data?.compiledQuerySchema;
    if (compiledQuerySchema){
        compiledQuerySchema = compiledQuerySchema.fields.map(({ name, type }) => ({ name, type }));
        new Tabulator("#schemaTable", {
            data: compiledQuerySchema,
            autoColumns: true,
            layout: "fitColumns",
            rowHeader: {
                formatter: "rownum", 
                headerSort: false, 
                hozAlign: "center", 
                resizable: false, 
                frozen: true,
                width: 40
            },
        });
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