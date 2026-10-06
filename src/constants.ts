import os from 'os';
import * as vscode from 'vscode';
import path from 'path';
import { SupportedCurrency as SupportedCurrencies } from './types';
const tempDir = os.tmpdir();
export const sqlFileToFormatPath = path.join(tempDir, "format.sql");
export const windowsDataformCliNotAvailableErrorMessage = "'dataform.cmd' is not recognized as an internal or external command";
export const linuxDataformCliNotAvailableErrorMessage = "dataform: command not found";
export const getBigQueryTimeoutMs = () => vscode.workspace.getConfiguration("vscode-dataform-tools").get<number>("bigQueryTimeoutMs") ?? 20000;


/** BigQuery on-demand query pricing: https://cloud.google.com/bigquery/pricing#on_demand_pricing */
const bigQueryOnDemandUsdPerTiB = 6.25;

/** Approximate conversion rates from USD (as of Sep 2026), used only to show cost estimates in the user's currency. */
const usdExchangeRates: Record<SupportedCurrencies, number> = {
  "USD": 1,
  "EUR": 0.88,
  "GBP": 0.76,
  "JPY": 158,
  "CAD": 1.41,
  "AUD": 1.42,
  "INR": 96,
};

export const bigQueryDryRunCostOneGiBByCurrency = Object.fromEntries(
  Object.entries(usdExchangeRates).map(([currency, rate]) => [currency, (bigQueryOnDemandUsdPerTiB / 1024) * rate])
) as Record<SupportedCurrencies, number>;

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
};
// Beyond this the hover becomes a long scroll pane; the Schema tab is the place for wide tables.
export const maxHoverSchemaRows = 150;
