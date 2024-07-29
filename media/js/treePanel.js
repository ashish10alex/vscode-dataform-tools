const vscode = acquireVsCodeApi();

window.addEventListener('message', event => {
    const treeData = event?.data?.dataformTreeMetadata;
    if (!treeData) {
        return;
    }

    const _treeRoot = event?.data?.treeRoot;
    const _direction = event?.data?.direction;

    const sharedOptions = ({
        // circleStrokeWidth: 5,
        // circleSize: 10,
        // textOffset: 10,
        verticalSpacBetweenNodes: 90,
        horizontalSpaceBetweenNodes: 500,
        textStyleFont: '20px sans-serif',
        wrapNodeName: false,
        animationDuration: 0,
        marginLeft: 450,
        marginRight: 450,
        textStyleColor: "white",
        // circleStrokeColor: "yellow",
        // circleStrokeColor: "steelblue",
        // parentNodeTextOrientation: "right",
        // childNodeTextOrientation: "right"
    });

    let direction = _direction ?? 'upstream';

    const tree = new DependenTree('div#tree', sharedOptions);
    tree.addEntities(treeData);

    const entitySelect = document.getElementById('list');

    const populateEntitySelect = entityList => {
        entityList.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            const text = document.createTextNode(name);
            option.appendChild(text);
            entitySelect.appendChild(option);
        });
    };

    $(document).ready(function () {
        $('.tree-metadata-selection').select2();
        $('.tree-direction-selection').select2({
            minimumResultsForSearch: Infinity
        }
        );
        $('.tree-direction-selection').val(direction ?? "upstream").trigger('change');

        $('.tree-metadata-selection').on('change', function (e) {
            currentEntity = $(this).find("option:selected").text();
            vscode.postMessage({
                entity: 'treeRoot',
                value: currentEntity
            });
            tree.setTree(currentEntity, direction);
        });

        $('.tree-direction-selection').on('change', function (e) {
            let direction = $(this).find("option:selected").text();
            vscode.postMessage({
                entity: 'direction',
                value: direction
            });
            tree.setTree(currentEntity, direction);
        });

    });

    const allEntities = tree.getEntityList();
    populateEntitySelect(allEntities);

    // expand and collapse all buttons
    // document.querySelector('button#form-expand').addEventListener('click', () => t.expandAll());
    // document.querySelector('button#form-collapse').addEventListener('click', () => t.collapseAll());

    let currentEntity = _treeRoot ?? allEntities[0];
    $('.tree-metadata-selection').val(currentEntity ).trigger('change');
    tree.setTree(currentEntity, direction);

});


