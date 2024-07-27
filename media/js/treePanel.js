window.addEventListener('message', event => {
    const treeData = event?.data?.data;
    if (!treeData) {
        return;
    }
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


    const tree = new DependenTree('div#tree', sharedOptions);

    // Adds dependency data to the tree
    tree.addEntities(treeData);

    let currentEntity = '0500_DPR_BUILD_ABS_WIP_TABLEAU';
    let direction = 'upstream';

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

        $('.tree-metadata-selection').on('change', function (e) {
            let currentEntity = $(this).find("option:selected").text();
            tree.setTree(currentEntity, direction);
        });

        $('.tree-direction-selection').on('change', function (e) {
            let direction = $(this).find("option:selected").text();
            tree.setTree(currentEntity, direction);
        });

    });

    const allEntities = tree.getEntityList();
    populateEntitySelect(allEntities);

    // expand and collapse all buttons
    // document.querySelector('button#form-expand').addEventListener('click', () => t.expandAll());
    // document.querySelector('button#form-collapse').addEventListener('click', () => t.collapseAll());

    tree.setTree(currentEntity, direction);

});


