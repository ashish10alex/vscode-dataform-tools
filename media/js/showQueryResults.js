function updateDateTime() {
    const now = new Date();
    const options = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    };
    document.getElementById('datetime').textContent = now.toLocaleString('en-US', options);
}


// Create a loading message element
const loadingMessage = document.createElement('div');
loadingMessage.id = 'loading-message';
loadingMessage.textContent = 'Loading data...';
loadingMessage.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 18px;
    font-weight: bold;
`;

// Add the loading message to the document body
document.body.appendChild(loadingMessage);

// Hide the table initially
document.getElementById('example').style.display = 'none';

// Listen for the message event
window.addEventListener('message', event => {
    const columns = event?.data?.columns;
    const results = event?.data?.results;

    if (columns && results) {
        // Remove the loading message
        updateDateTime();
        document.body.removeChild(loadingMessage);

        // Show the table
        document.getElementById('example').style.display = 'table';
        
        const table = new DataTable('#example', {
            data: results,
            columns: columns,
            pageLength: 25,
            // responsive: true,
            columnDefs: [
                {
                    searchable: false,
                    orderable: false,
                    width: 2,
                    targets: 0
                }
            ],
            order: [[1, 'asc']]
        });
        
        function updateIndex() {
            table
                .column(0, { search: 'applied', order: 'applied' })
                .nodes()
                .each(function (cell, i) {
                    const info = table.page.info();
                    const index = info.start + i + 1;
                    cell.innerHTML = index;
                });
        }
        
        table
            .on('order.dt search.dt draw.dt', updateIndex)
            .draw();

    }
});
