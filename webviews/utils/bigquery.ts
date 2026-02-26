export const getUrlToNavigateToTableInBigQuery = (
  gcpProjectId: string,
  datasetId: string,
  tableName: string
) => {
  return `https://console.cloud.google.com/bigquery?project=${gcpProjectId}&ws=!1m5!1m4!4m3!1s${gcpProjectId}!2s${datasetId}!3s${tableName}`;
};

export const parseBigQueryTableId = (
  id: any
): { database: string; schema: string; name: string } | null => {
  if (typeof id === "string") {
    const parts = id.split(".");
    if (parts.length === 3) {
      return { database: parts[0], schema: parts[1], name: parts[2] };
    }
    return null;
  }
  if (id && typeof id === "object" && id.database && id.schema && id.name) {
    return { database: id.database, schema: id.schema, name: id.name };
  }
  return null;
};
