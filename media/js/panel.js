(function () {
    const vscode = acquireVsCodeApi();

    const loadDepGraphButton = document.querySelector('.load-dependancy-graph-button');

    loadDepGraphButton.addEventListener('click', loadDepGraphButtonClicked);

    function loadDepGraphButtonClicked() {
        vscode.postMessage({
            type: 'load-dependancy-graph-button',
            value: 'load-dependancy-graph-button clicked'
        });
    }
}());
