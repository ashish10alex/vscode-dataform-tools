function removeLoadingMessage() {
    var loadingMessage = document.getElementById("loadingMessage");
    if (loadingMessage) {
        loadingMessage.parentNode.removeChild(loadingMessage);
    }
}

function showTableMetadataInSideBar(tables) {
    if (!tables) {
        return;
    }

    //clear the previous tags from nwDiv element
    if (document.getElementById('newDiv')) {
        document.getElementById('newDiv').remove();
    }

    const newDiv = document.createElement('div');
    newDiv.id = 'newDiv';


    // const highlightedCode = hljs.highlight(
    //     message.tableMetadata.fullQuery,
    //     { language: 'sql' }
    // ).value;

    // newDiv.innerHTML = `<pre><code class="language-sql">${highlightedCode}<code></pre>`;
    // document.body.appendChild(newDiv);

    // paragraph.textContent = highlightedCode;
    // newDiv.appendChild(paragraph);
    // document.body.appendChild(newDiv);


    fullTableIds = [];

    const tableHeader = document.createElement('h3');
    tableHeader.innerHTML = "<br><b>Table Name</b><br>";

    const tagHeader = document.createElement('h3');
    tagHeader.innerHTML = "<br><b>Tags</b><br>";

    const tagsList = document.createElement('ul'); // Create an unordered list
    let uniqueTags = [];
    for (let i = 0; i < tables.length; i++) {
        let tags = tables[i].tags;
        if (tags) {
            for (let j = 0; j < tags.length; j++) {
                if (!uniqueTags.includes(tags[j])) {
                    const li = document.createElement('li');
                    li.textContent = tags[j];
                    tagsList.appendChild(li);
                    uniqueTags.push(tags[j]);
                }
            }
        }
    }

    const tableName = document.createElement('pre');
    let tableTarget = tables[0].target;
    let tableId = `${tableTarget.database}.${tableTarget.schema}.${tableTarget.name}`;
    tableName.innerHTML = `<pre><code class="language-bash">${tableId}<code></pre>`;

    const targetsHeader = document.createElement('h3');

    targetsHeader.innerHTML = "<br><b>Dependencies</b><br>";

    const dependencyList = document.createElement('ul'); // Create an unordered list
    for (let i = 0; i < tables.length; i++) {
        let tableTargets = tables[i].dependencyTargets;
        for (let j = 0; j < tableTargets.length; j++) {
            fullTableId = `${tableTargets[j].database}.${tableTargets[j].schema}.${tableTargets[j].name}`;
            fullTableIds.push(fullTableId);

            // Create a list item
            const li = document.createElement('li');

            // Create an anchor element
            const link = document.createElement('a');
            link.href = '#'; // Set the href attribute as needed
            link.textContent = fullTableId;

            // Append the link to the list item
            li.appendChild(link);

            // Append the list item to the unordered list
            dependencyList.appendChild(li);
        }
    }



    newDiv.appendChild(tableHeader);
    newDiv.appendChild(tableName);
    newDiv.appendChild(tagHeader);
    newDiv.appendChild(tagsList);
    newDiv.appendChild(targetsHeader);
    newDiv.appendChild(dependencyList);

    // Append newDiv to the body
    document.body.appendChild(newDiv);


}

window.addEventListener('message', event => {
    const message = event.data;
    let tables = message.tableMetadata.tables;
    showTableMetadataInSideBar(tables);
    removeLoadingMessage();
});

