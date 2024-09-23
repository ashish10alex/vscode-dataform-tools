const {BigQuery} = require('@google-cloud/bigquery');

export async function queryBigQuery(query:string) {
  const bigqueryClient = new BigQuery();

  const [rows] = await bigqueryClient.query(query);

  if (rows.length === 0){
    return { results: undefined };
  }

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

  // Transform rows into the desired format for Datatables
  // const results = [
  //    {col1:col1_val, col2:col2_val, ...},
  //    ...
  // ];

  const results = rows.map((row: { [s: string]: unknown }) => {
    const obj: { [key: string]: any } = {};
    Object.entries(row).forEach(([key, value]) => {
      obj[key] = extractValue(value);
    });
    return obj;
  });

  return { results: results };
}
