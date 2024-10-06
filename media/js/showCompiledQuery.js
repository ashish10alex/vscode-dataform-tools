
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
    };

    Object.entries(data).forEach(([key, value]) => {
        const element = document.getElementById(key);
        const divElement = document.getElementById(key + "Div");

        if (value === undefined || value === null || value === "") {
            divElement.style.display = "none";
        } else {
            divElement.style.display = "";
            element.textContent = value;

            // Reset highlighting
            element.removeAttribute('data-highlighted');
            element.className = element.className.replace(/\bhljs\b/, '');

            // Re-apply highlighting
            hljs.highlightElement(element);
        }
    });

    hljs.addPlugin(new CopyButtonPlugin({
        autohide: false, // Always show the copy button
    }));

    // Apply line numbers
    document.querySelectorAll('pre code').forEach((block) => {
        hljs.lineNumbersBlock(block);
    });
});