import os from 'os';
import * as vscode from 'vscode';
import path from 'path';
import { SupportedCurrency as SupportedCurrencies } from './types';
const tempDir = os.tmpdir();
export const sqlFileToFormatPath = path.join(tempDir, "format.sql");
export const executablesToCheck: ('dataform' | 'gcloud')[] = ['dataform', 'gcloud'];
export const tableQueryOffset = 2;
export const incrementalTableOffset = 1;
export const assertionQueryOffset = 4;
export const windowsDataformCliNotAvailableErrorMessage = "'dataform.cmd' is not recognized as an internal or external command";
export const linuxDataformCliNotAvailableErrorMessage = "dataform: command not found";
export const costInPoundsForOneGb = 0.005;
export const getBigQueryTimeoutMs = () => vscode.workspace.getConfiguration("vscode-dataform-tools").get<number>("bigQueryTimeoutMs") ?? 20000;

export const configBlockHoverOptions: Record<string, string> = {
  // Assertions
  'nonNull': 'This condition asserts that the specified columns are not null across all table rows.',
  'rowConditions': 'This condition asserts that all table rows follow the custom logic you define.',
  'uniqueKey': 'This condition asserts that, in a specified column, no table rows have the same value.',
  'uniqueKeys': 'This condition asserts that, in the specified columns, no table rows have the same value.',

  // BigQuery
  'partitionBy': 'Expression for partitioning the table (e.g. "DATE(timestamp)").',
  'clusterBy': 'A list of columns by which to cluster the table.',
  'requirePartitionFilter': 'Whether queries must include a partition filter (true/false).',
  'partitionExpirationDays': 'Number of days to retain partitions.',
  'labels': 'A map of BigQuery labels to apply to the table.',
  'updatePartitionFilter': 'Limits the partitions scanned in the target table during a MERGE operation for incremental tables.',
  'iceberg': 'Iceberg table configuration.',

  // General Config
  'type': 'The type of the dataset. "table", "view", "incremental", "inline", "declaration", "operations"',
  'database': 'The database (Google Cloud project ID) to output the dataset to.',
  'schema': 'The schema (BigQuery dataset) to output the dataset to.',
  'name': 'The name of the model.',
  'description': 'The description of the model.',
  'columns': 'A map of column names to descriptions or configurations.',
  'tags': 'A list of tags for the model.',
  'dependencies': 'A list of dependencies for the model.',
  'hasOutput': 'Whether an operations model generates an output.',
  'assertions': 'Assertions to run after this model is created.',
  'bigquery': 'BigQuery-specific configurations.',
  'materialized': 'Whether a view is materialized.',
  'onSchemaChange': 'Action to take when schema changes for incremental models: "IGNORE", "FAIL", "EXTEND", "SYNCHRONIZE".',
  'protected': 'Prevents the model from being rebuilt from scratch (e.g. true/false)'
};

export const errorDenylist = ["CREATE TEMPORARY FUNCTION statements must be followed by an actual query."];

export const bigQueryDryRunCostOneGiBByCurrency: Record<SupportedCurrencies, number> = {
  "USD": 0.005,
  "EUR": 0.0046,
  "GBP": 0.0039,
  "JPY": 0.56,
  "CAD": 0.0067,
  "AUD": 0.0075,
  "INR": 0.41,
};

export const currencySymbolMapping = {
  "USD": "$",
  "EUR": "€",
  "GBP": "£",
  "JPY": "¥",
  "CAD": "C$",
  "AUD": "A$",
  "INR": "₹",
};


export const sqlKeywordsToExcludeFromHoverDefinition = [
  "select",
  "from",
  "where",
  "limit",
  "group",
  "order",
  "partition",
  "offset",
  "join",
  "on",
  "as",
  "with",
  "union",
  "intersect",
  "except",
  "case",
  "when",
  "then",
  "else",
  "end",
  "all",
  "not",
  "and",
  "or",
  "in",
  "is",
  "null",
  "like",
  "having",
  "distinct",
  "by",
  "inner",
  "left",
  "right",
  "full",
  "outer",
  "cross",
  "using",
  "insert",
  "update",
  "delete",
  "create",
  "alter",
  "drop",
  "table",
  "view",
  "values",
  "set",
  "between",
  "exists",
  "desc",
  "asc",
  "unnest",
  "array",
  "struct",
  "over",
  "window",
  "current",
  "row",
  "number",
  "preceding",
  "following",
  "true",
  "false",
  "into",
  "having",
  "qualify"
];

export const gcloudComputeRegions = [
  "asia-east1",
  "asia-east2",
  "asia-northeast1",
  "asia-northeast2",
  "asia-northeast3",
  "asia-south1",
  "asia-south2",
  "asia-southeast1",
  "asia-southeast2",
  "australia-southeast1",
  "australia-southeast2",
  "europe-central2",
  "europe-north1",
  "europe-north2",
  "europe-southwest1",
  "europe-west1",
  "europe-west10",
  "europe-west12",
  "europe-west2",
  "europe-west3",
  "europe-west4",
  "europe-west6",
  "europe-west8",
  "europe-west9",
  "me-central1",
  "me-central2",
  "me-west1",
  "northamerica-northeast1",
  "northamerica-northeast2",
  "northamerica-south1",
  "southamerica-east1",
  "southamerica-west1",
  "us-central1",
  "us-east1",
  "us-east4",
  "us-east5",
  "us-south1",
  "us-west1",
  "us-west2",
  "us-west3",
  "us-west4"
];

export const cacheDurationMs = 5 * 60 * 1000; // 5 minutes

export const defaultCdnLinks = {
  highlightJsCssUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/default.min.css",
  highlightJsUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js",
  highlightJsOneDarkThemeUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/atom-one-dark.min.css",
  highlightJsOneLightThemeUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/atom-one-light.min.css",
  highlightJsLineNoExtUri: "https://cdn.jsdelivr.net/npm/highlightjs-line-numbers.js/dist/highlightjs-line-numbers.min.js",
  tabulatorDarkCssUri: "https://unpkg.com/tabulator-tables@6.3.0/dist/css/tabulator_midnight.min.css",
  tabulatorLightCssUri: "https://unpkg.com/tabulator-tables@6.3.0/dist/css/tabulator_simple.min.css",
  tabulatorUri: "https://unpkg.com/tabulator-tables@6.3.0/dist/js/tabulator.min.js",
};