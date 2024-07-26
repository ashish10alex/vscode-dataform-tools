(function () {
    const vscode = acquireVsCodeApi();

    const btnfourth = document.querySelector('.center-panel-button');

    btnfourth.addEventListener('click', fourthBtnClicked);

    function fourthBtnClicked() {
        vscode.postMessage({
            type: 'center-panel-button',
            value: 'center-panel-button clicked'
        });
    }
}());