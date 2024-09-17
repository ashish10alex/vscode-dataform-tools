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

        // Initialize DataTable
        new DataTable('#example', {
            columns: columns,
            data: results,
            pageLength: 50
        });
    }
});
