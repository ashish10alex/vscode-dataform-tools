const vscode = acquireVsCodeApi();

const isDarkTheme = document.body.classList.contains('vscode-dark');
const isLightTheme = document.body.classList.contains('vscode-light');

let textStyleColor = "white";

if (isDarkTheme) {
    //NOTE: leaving this if we need to handle anything specific in the future
} else if (isLightTheme) {
    textStyleColor = "black";
}

const sharedOptions = ({
    circleStrokeWidth: 5,
    circleSize: 10,
    // textOffset: 10,
    verticalSpacBetweenNodes: 140,
    horizontalSpaceBetweenNodes: 600,
    textStyleFont: '20px sans-serif',
    wrapNodeName: false,
    animationDuration: 0,
    marginLeft: 450,
    marginRight: 450,
    textStyleColor: textStyleColor
    // circleStrokeColor: "yellow",
    // circleStrokeColor: "steelblue",
    // parentNodeTextOrientation: "right",
    // childNodeTextOrientation: "right"
});

window.addEventListener('message', event => {
    const treeData = event?.data?.dataformTreeMetadata;
    if (!treeData) {
        return;
    }

    const _treeRoot = event?.data?.treeRoot;
    const _direction = event?.data?.direction;

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

        let uniqueDatasets = event?.data?.declarationsLegendMetadata;

        let svg = d3.select('#my-svg')
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("overflow", "visible");

        let circles = svg.selectAll("g")
        .data(uniqueDatasets)
        .enter()
        .append("g");

        circles.append("circle")
        .attr("cx", 50)
        .attr("cy", function(d, i) {
            return (i / 3) * 100 + 50;
        })
        .attr("r", sharedOptions.circleSize)
        .attr("stroke-width", sharedOptions.circleStrokeWidth)
        .style("stroke", function(d) {
            // return getRandomColor();
            return Object.keys(schema_idx_colors)[d._schema_idx];
        })
        .style("fill", "white");

        circles.append("text")
        .attr("x", 90)
        .attr("y", function(d, i) { return (i / 3) * 100 + 60; })
        .text(function(d) { return d._schema })
        // .text(function(d) { return "aaaaaa"})


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


