import os from 'os';
import path from 'path';

const tempDir = os.tmpdir();
export const sqlFileToFormatPath = path.join(tempDir, "format.sql");
export const executablesToCheck = ['dataform', 'sqlfluff', 'gcloud'];
export const tableQueryOffset = 2;
export const incrementalTableOffset = 1;
export const assertionQueryOffset = 4;
export const windowsDataformCliNotAvailableErrorMessage = "'dataform.cmd' is not recognized as an internal or external command";
export const linuxDataformCliNotAvailableErrorMessage = "dataform: command not found";
export const bigQuerytimeoutMs = 20000;

export function getFileNotFoundErrorMessageForWebView(relativeFilePath:string){
    let errorMessage = `file "${relativeFilePath}" not found in Dataform compiled json <br>`;
    errorMessage += `<p>Ignore the error if the file you are in is not expected to produce a sql output</p>`;
    errorMessage += `<h4>Possible resolution/fix: </h4>`;

    errorMessage += `<ol>`;

    errorMessage += `<li>Check if running "dataform compile" throws an error</li>`;
    errorMessage += `<li>If the case of the file has been changed and the <b>case does not match</b> what is being shown in the error message, this is a known issue with VSCode <a href="https://github.com/microsoft/vscode/issues/123660">#123660</a>. A workaround for this is:`;

    errorMessage += `<ol>`;
    errorMessage += `<li>Change the filename to something arbitrary and save it</li>`;
    errorMessage += `<li>Reload the VSCode window</li>`;
    errorMessage += `<li>Change the file name to the case you want and recompile Dataform by saving the file</li>`;
    errorMessage += `</ol>`;

    errorMessage += `</li>`;
    errorMessage += `</ol>`;
    return errorMessage;
}