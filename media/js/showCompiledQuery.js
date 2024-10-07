

window.addEventListener('message', event => {
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

    hljs.addPlugin(new CopyButtonPlugin({
        autohide: false, // Always show the copy button
    }));

    Object.entries(data).forEach(([key, value]) => {
        const element = document.getElementById(key);
        const divElement = document.getElementById(key + "Div");

        if (value === undefined || value === null || value === "") {
            if (divElement?.style){
                divElement.style.display = "none";
            }
        } else {
            if(key === "errorMessage"){
                if (value === " "){
                    divElement.style.display = "none";
                } else {
                    divElement.style.display = "";
                    element.textContent = value;
                }
            }
            else if (key === "dryRunStat"){
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
            }
        }
    });

    // Apply line numbers
    document.querySelectorAll("pre code").forEach((block) => {
        const id = block.getAttribute('id');
        let skipElements = id === "relativeFilePath" || id === "errorMessage" || id === "dryRunStat";
        if (!skipElements) {
            hljs.lineNumbersBlock(block);
        }
    });

});