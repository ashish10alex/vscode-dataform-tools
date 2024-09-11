const vscode = acquireVsCodeApi();

function toggleNavbar() {
    var navbar = document.querySelector('.navbar');
    navbar.classList.toggle('collapsed');
}

const isDarkTheme = document.body.classList.contains('vscode-dark');
const isLightTheme = document.body.classList.contains('vscode-light');

/** This function creates a legend for the datasets that are present in the graph
    @param {Array} uniqueDatasets - An array of unique datasets
    @param {Number} circleSize - The size of the circle
    @param {Number} circleStrokeWidth - The width of the circle stroke
    @param {Object} schema_idx_colors - A dictionary that maps schema index to color
 */
function createDatasetSvgLegend(uniqueDatasets, circleSize, circleStrokeWidth, schema_idx_colors){
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
    .attr("r", circleSize)
    .attr("stroke-width", circleStrokeWidth)
    .style("stroke", function(d) {
        // return getRandomColor();
        return Object.keys(schema_idx_colors)[d._schema_idx];
    })
    .style("fill", "white");

    circles.append("text")
    .attr("x", 90)
    .attr("y", function(d, i) { return (i / 3) * 100 + 60; })
    .text(function(d) { return d._schema;});
    // .text(function(d) { return "aaaaaa"})
}

/** sets the height of the the dataset lengend svg
    @param {Number} newHeight - The new height of the svg
*/
function updateSvgLegendsHeight(newHeight) {
    document.documentElement.style.setProperty('--svg-legends-height', newHeight + 'px');
}

let textStyleColor = "white";
if (isDarkTheme) {
    //NOTE: leaving this if we need to handle anything specific in the future
} else if (isLightTheme) {
    textStyleColor = "black";
}

/**
    take an entity with a _name in the format of "project_id.database.table" and return just "table" to be displayed without modifying the _name property itself.
    this facilitates the display of the entity name in the tree without cluttering it with the project_id and database.
    @param {Object} nodeData - The node data Object
    @returns {String} - The modified entity name
*/
const modifyEntityName = nodeData => {
    const { _name } = nodeData;
    const i = _name.lastIndexOf('.');
    return _name.slice(i + 1);
};

const textClick = async (event, nodeData) => {
    vscode.postMessage({
        entity: 'openNodeSource',
        value: {
            _name: nodeData._name,
            _fileName: nodeData._fileName,
            _schema: nodeData._schema_idx
        }
    });
};

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
    marginRight: 600,
    textStyleColor: textStyleColor,
    modifyEntityName: modifyEntityName,
    textClick: textClick
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

    let statsDiv = document.getElementById("dataform-stats");
    let newParagraph = document.createElement("p");
    newParagraph.textContent = `Total nodes in the graph: ${treeData.length}`;
    statsDiv.appendChild(newParagraph);

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

         let spaceOccupiedByNavButton = 50;
         let approxSpaceForSingleDatasetInLegend = 40;
         let heightOfDatasetsLegend = approxSpaceForSingleDatasetInLegend * (uniqueDatasets.length + 1) + spaceOccupiedByNavButton;
         updateSvgLegendsHeight(heightOfDatasetsLegend);

        createDatasetSvgLegend(uniqueDatasets, sharedOptions.circleSize, sharedOptions.circleStrokeWidth, schema_idx_colors);

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
