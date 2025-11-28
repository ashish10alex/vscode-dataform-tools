import os from 'os';
import path from 'path';
import { SupportedCurrency as SupportedCurrencies } from './types';
import { getWorkspaceFolder } from './utils';

const tempDir = os.tmpdir();
export const sqlFileToFormatPath = path.join(tempDir, "format.sql");
export const executablesToCheck: ('dataform' | 'gcloud')[] = ['dataform', 'gcloud'];
export const tableQueryOffset = 2;
export const incrementalTableOffset = 1;
export const assertionQueryOffset = 4;
export const windowsDataformCliNotAvailableErrorMessage = "'dataform.cmd' is not recognized as an internal or external command";
export const linuxDataformCliNotAvailableErrorMessage = "dataform: command not found";
export const costInPoundsForOneGb = 0.005;
export const bigQuerytimeoutMs = 20000;

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


export async function getFileNotFoundErrorMessageForWebView(relativeFilePath: string) {

  if (!workspaceFolder) {
    workspaceFolder = await getWorkspaceFolder();
  }

  // Create a single HTML string with the error message
  const errorMessage = `
      <div>
        <p>File <b>"${relativeFilePath}"</b> not found in Dataform compiled json with workspace folder <b>"${workspaceFolder}"</b></p>
        <p>Ignore the error if the file you are in is not expected to produce a sql output</p>
        <h4>Possible resolution/fix(s):</h4>
        <ol>
          <li>If you are using multi-root workspace, select the correct workspace folder for the file by <a href="#" id="selectWorkspaceLink" onclick="selectWorkspaceLinkClickHandler(event)">clicking here</a></li>
          <li>Check if running "dataform compile" throws an error</li>
          <li>
            Check if case of the file has been changed and the case does not match what is being shown in the error message above, 
            this is a known issue with VSCode <a href="https://github.com/microsoft/vscode/issues/123660">#123660</a>. 
            A workaround for this is:
            <ol>
              <li>Change the filename to something arbitrary and save it</li>
              <li>Reload the VSCode window</li>
              <li>Change the file name to the case you want and recompile Dataform by saving the file</li>
            </ol>
          </li>
        </ol>
      </div>
    `;

  return errorMessage;
}



export const defaultCdnLinks = {
  highlightJsCssUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css",
  highlightJsUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
  highlightJsOneDarkThemeUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css",
  highlightJsOneLightThemeUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css",
  highlightJsLineNoExtUri: "https://cdn.jsdelivr.net/npm/highlightjs-line-numbers.js/dist/highlightjs-line-numbers.min.js",
  tabulatorDarkCssUri: "https://unpkg.com/tabulator-tables@6.2.5/dist/css/tabulator_midnight.min.css",
  tabulatorLightCssUri: "https://unpkg.com/tabulator-tables@6.2.5/dist/css/tabulator_simple.min.css",
  tabulatorUri: "https://unpkg.com/tabulator-tables@6.3.0/dist/js/tabulator.min.js",
}