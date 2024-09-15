const {BigQuery} = require('@google-cloud/bigquery');

export async function queryBigQuery(query:string) {
  // Create a client
  const bigqueryClient = new BigQuery();

  // Run the query
  const [rows] = await bigqueryClient.query(query);

  // Extract column names
  const columns = Object.keys(rows[0]).map(key => ({ title: key }));

  // Function to recursively extract values from nested objects and handle Big objects
  const extractValue:any = (value:any) => {
    if (typeof value === 'object' && value !== null) {
      if (value.constructor && value.constructor.name === 'Big') {
        // Handle Big objects
        return value.toString();
      } else if (Array.isArray(value)) {
        return value.map(extractValue);
      } else {
        return Object.values(value).map(extractValue).join(', ');
      }
    }
    return value;
  };

  // Transform rows into the desired format
  const results = rows.map((row: { [s: string]: unknown; } | ArrayLike<unknown>) => 
    Object.values(row).map(value => extractValue(value))
  );

//   console.log('Columns:', columns);
//   console.log('Results:', results);

  return { columns, results };
}
