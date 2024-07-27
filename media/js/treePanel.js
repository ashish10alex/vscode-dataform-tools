window.addEventListener('message', event => {
    const treeData = event?.data?.data;
    if (!treeData){
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
        // parentNodeTextOrientation: "right",
        // childNodeTextOrientation: "right"
    });


    const tree = new DependenTree('div#tree', sharedOptions);

    // Adds dependency data to the tree
    tree.addEntities(treeData);

    let currentEntity = '0500_DPR_BUILD_ABS_WIP_TABLEAU';
    let direction = 'upstream';

    // Sets the entity on the tree, displays the upstream dependencies
    // You can also pass 'downstream' to display downstream dependencies
    // tree.setTree('0500_DPR_BUILD_ABS_WIP_TABLEAU', 'upstream');

    // Getting each select dropdown
    const entitySelect = document.getElementById('list');
    const directionSelect = document.getElementById('direction');
    const filterSelect = document.getElementById('filter');

    // function to add options to our entitySelect
    // We need to do this every time the user picks
    // a new entity filter
    const populateEntitySelect = entityList => {
        entityList.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            const text = document.createTextNode(name);
            option.appendChild(text);
            entitySelect.appendChild(option);
        });
    };

    // populate the initial list of entities
    const allEntities = tree.getEntityList();
    populateEntitySelect(allEntities);

    // the two event listeners below change which tree is displayed
    // depending on entity name and upstream or downstream
    entitySelect.addEventListener('change', e => {
        if (e.target.value === '') {return;}
        currentEntity = e.target.value;
        tree.setTree(currentEntity, direction);
    });

    directionSelect.addEventListener('change', e => {
        direction = e.target.value;
        tree.setTree(currentEntity, direction);
    });

    // expand and collapse all buttons
    // document.querySelector('button#form-expand').addEventListener('click', () => t.expandAll());
    // document.querySelector('button#form-collapse').addEventListener('click', () => t.collapseAll());

    // set default values for the tree
    // and the default tree
    tree.setTree(currentEntity, direction);

});


