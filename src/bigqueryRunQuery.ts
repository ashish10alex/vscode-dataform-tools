const {BigQuery} = require('@google-cloud/bigquery');

export async function queryBigQuery(query:string) {
  const bigqueryClient = new BigQuery();

  const [rows] = await bigqueryClient.query(query);

  // Transform columns to the desired format for Datatables
  // const columns = [
  //   { title: "Index", data: null },
  //   { title: "Column 1", data: 0 },
  //   { title: "Column 2", data: 1 },
  //   { title: "Column 3", data: 2 }
  // ];
  const columns = [
    { title: "", data: null },
    ...Object.keys(rows[0]).map((key, index) => ({ 
      title: key, 
      data: index.toString() 
    }))
  ];

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
  //   ['data', 'data', 'data'],
  //   ['data', 'data', 'data'],
  //   // ... more rows
  // ];
  const results = rows.map((row: { [s: string]: unknown; } | ArrayLike<unknown>) => 
    Object.values(row).map(value => extractValue(value))
  );

  return { columns, results };
}
