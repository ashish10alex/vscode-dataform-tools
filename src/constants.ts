import os from 'os';
import path from 'path';
import { SupportedCurrency as SupportedCurrencies } from './types';
import { getWorkspaceFolder } from './utils';

const tempDir = os.tmpdir();
export const sqlFileToFormatPath = path.join(tempDir, "format.sql");
export const executablesToCheck = ['dataform', 'gcloud'];
export const tableQueryOffset = 2;
export const incrementalTableOffset = 1;
export const assertionQueryOffset = 4;
export const windowsDataformCliNotAvailableErrorMessage = "'dataform.cmd' is not recognized as an internal or external command";
export const linuxDataformCliNotAvailableErrorMessage = "dataform: command not found";
export const costInPoundsForOneGb = 0.005;
export const bigQuerytimeoutMs = 20000;

export const bigQueryDryRunCostOneGbByCurrency: Record<SupportedCurrencies, number> = {
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

export async function getFileNotFoundErrorMessageForWebView(relativeFilePath:string){

    if(!workspaceFolder){
      workspaceFolder = await getWorkspaceFolder();
    }
    
    // Create a single HTML string with the error message
    const errorMessage = `
      <script>
        function postSelectWorkspaceMessage() {
          const vscode = acquireVsCodeApi();
          vscode.postMessage({
            command: 'selectWorkspaceFolder'
          });
        }
      </script>
      <div>
        <p>File <b>"${relativeFilePath}"</b> not found in Dataform compiled json with workspace folder <b>"${workspaceFolder}"</b></p>
        <p>Ignore the error if the file you are in is not expected to produce a sql output</p>
        <h4>Possible resolution/fix(s):</h4>
        <ol>
          <li>Check if running "dataform compile" throws an error</li>
          <li>Select the workspace folder by <a href="#" onclick="postSelectWorkspaceMessage()">clicking here</a></li>
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