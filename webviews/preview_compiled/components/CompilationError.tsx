import React from 'react';
import { AlertCircle } from 'lucide-react';
import DOMPurify from 'dompurify';
import { vscode } from '../utils/vscode';
import { WebviewState } from '../types';

interface CompilationErrorProps {
  state: WebviewState;
}

export const CompilationError: React.FC<CompilationErrorProps> = ({ state }) => {
  const { 
    errorMessage, 
    errorType, 
    recompiling, 
    missingExecutables, 
    relativeFilePath, 
    workspaceFolder 
  } = state;

  if (recompiling) {
    return null;
  }

  let sanitizedError = '';
  if (errorMessage) {
    try {
      sanitizedError = DOMPurify.sanitize(errorMessage, {
        ALLOWED_TAGS: ['b', 'i', 'strong', 'em', 'code', 'pre', 'br', 'p', 'span', 'a'],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'className']
      });
    } catch (e) {
      sanitizedError = '';
    }
  }

  const isBigQueryClientError = errorMessage && errorMessage.includes("Error creating BigQuery client");

  if (missingExecutables && missingExecutables.length > 0) {
    return (
      <div className="bg-[var(--vscode-inputValidation-errorBackground)] border-l-4 border-[var(--vscode-inputValidation-errorBorder)] p-4 mb-4 rounded-r shadow-sm">
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-[var(--vscode-inputValidation-errorForeground)] mt-0.5 mr-3 flex-shrink-0" />
          <div>
            <h3 className="mt-0 mb-2 text-lg font-semibold text-[var(--vscode-inputValidation-errorForeground)]">Missing Required {missingExecutables.length > 1 ? 'CLIs' : 'CLI'}</h3>
            <p className="mt-0 mb-3 text-[var(--vscode-inputValidation-errorForeground)] opacity-90">The following mandatory {missingExecutables.length > 1 ? 'CLIs are' : 'CLI is'} not installed or not found in your system PATH: <b className="font-mono bg-[var(--vscode-editor-background)] opacity-50 px-1 rounded">{missingExecutables.join(', ')}</b></p>
            <p className="mt-0 mb-4 text-[var(--vscode-inputValidation-errorForeground)] opacity-90"><a href="https://github.com/ashish10alex/vscode-dataform-tools?tab=readme-ov-file#installation" target="_blank" rel="noopener noreferrer" className="text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground)] font-medium">Installation steps on GitHub</a></p>
            
            <ol className="mt-0 list-decimal list-inside text-[var(--vscode-inputValidation-errorForeground)] opacity-90 space-y-3">
              {missingExecutables.includes('dataform') && (
                <li>
                  <b className="text-[var(--vscode-inputValidation-errorForeground)]">Dataform CLI</b> (requires Node.js)
                  <ul className="mt-2 ml-6 pl-3 border-l-2 border-[var(--vscode-inputValidation-errorBorder)] list-none space-y-2">
                    <li><code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">npm i -g @dataform/cli</code></li>
                    <li>Run <code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">dataform compile</code> from the root of your project to verify</li>
                  </ul>
                </li>
              )}
              {missingExecutables.includes('gcloud') && (
                <li>
                  <b className="text-[var(--vscode-inputValidation-errorForeground)]">Google Cloud CLI</b> (<a href="https://cloud.google.com/sdk/docs/install" target="_blank" rel="noopener noreferrer" className="text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground)]">Installation Documentation</a>)
                  <ul className="mt-2 ml-6 pl-3 border-l-2 border-[var(--vscode-inputValidation-errorBorder)] list-none space-y-2">
                    <li><code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">gcloud init</code></li>
                    <li><code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">gcloud auth application-default login</code></li>
                    <li><code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">gcloud config set project &lt;project_id&gt;</code></li>
                  </ul>
                </li>
              )}
            </ol>
            <p className="mt-5 mb-0 text-sm italic text-[var(--vscode-inputValidation-errorForeground)] opacity-80">Note: You may need to restart VS Code after installing these tools so they are picked up in the system PATH.</p>
          </div>
        </div>
      </div>
    );
  }

  if (isBigQueryClientError) {
    return (
      <div className="bg-[var(--vscode-inputValidation-errorBackground)] border-l-4 border-[var(--vscode-inputValidation-errorBorder)] p-4 mb-4 rounded-r shadow-sm">
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-[var(--vscode-inputValidation-errorForeground)] mt-0.5 mr-3 flex-shrink-0" />
          <div>
            {/* eslint-disable-next-line react/no-danger -- sanitizedError is strongly sanitized via DOMPurify with strict allowlist */}
            <div className="text-[var(--vscode-inputValidation-errorForeground)] opacity-90 text-sm overflow-auto mb-3" dangerouslySetInnerHTML={{__html: sanitizedError}} />
            
            <h4 className="mt-0 mb-2 text-md font-semibold text-[var(--vscode-inputValidation-errorForeground)]">Possible fix:</h4>
            <p className="mt-0 mb-3 text-[var(--vscode-inputValidation-errorForeground)] opacity-90">
              <a href="https://cloud.google.com/sdk/docs/install" target="_blank" rel="noopener noreferrer" className="text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground)] font-medium">Install gcloud cli</a>
            </p>
            <p className="mt-0 mb-3 text-[var(--vscode-inputValidation-errorForeground)] opacity-90">After gcloud cli is installed run the following in the terminal in order:</p>
            
            <ol className="mt-0 ml-5 list-decimal list-outside text-[var(--vscode-inputValidation-errorForeground)] opacity-90 space-y-2">
              <li><code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">gcloud init</code></li>
              <li><code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">gcloud auth application-default login</code></li>
              <li><code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">gcloud config set project your-project-id</code> <span className="opacity-70 italic text-sm"># replace with your gcp project id</span></li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  if (errorType === 'FILE_NOT_FOUND') {
    return (
      <div className="bg-[var(--vscode-inputValidation-errorBackground)] border-l-4 border-[var(--vscode-inputValidation-errorBorder)] p-4 mb-4 rounded-r shadow-sm">
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-[var(--vscode-inputValidation-errorForeground)] mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-[var(--vscode-inputValidation-errorForeground)] opacity-90 text-sm overflow-auto">
            <p className="mt-0 mb-2">
              File <b className="font-mono bg-[var(--vscode-editor-background)] opacity-50 px-1 rounded">"{relativeFilePath}"</b> not found in Dataform compiled json with workspace folder <b className="font-mono bg-[var(--vscode-editor-background)] opacity-50 px-1 rounded">"{workspaceFolder}"</b>
            </p>
            <p className="mt-0 mb-3 opacity-90">Ignore the error if the file you are in is not expected to produce a sql output</p>
            
            <h4 className="mt-0 mb-2 text-md font-semibold">Possible resolution/fix(s):</h4>
            <ol className="mt-0 ml-5 list-decimal list-outside opacity-90 space-y-2">
              <li>
                If you are using multi-root workspace, select the correct workspace folder for the file by{' '}
                <a 
                  href="#" 
                  onClick={(e) => {
                    e.preventDefault();
                    vscode.postMessage({ command: 'selectWorkspaceFolder' });
                  }}
                  className="text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground)] font-medium cursor-pointer"
                >
                  clicking here
                </a>
              </li>
              <li>Check if running <code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">dataform compile</code> throws an error</li>
              <li>
                Check if case of the file has been changed and the case does not match what is being shown in the error message above, 
                this is a known issue with VSCode <a href="https://github.com/microsoft/vscode/issues/123660" target="_blank" rel="noopener noreferrer" className="text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground)] font-medium">#123660</a>. 
                A workaround for this is:
                <ol className="mt-2 ml-5 list-[lower-alpha] list-outside space-y-1">
                  <li>Change the filename to something arbitrary and save it</li>
                  <li>Reload the VSCode window</li>
                  <li>Change the file name to the case you want and recompile Dataform by saving the file</li>
                </ol>
              </li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="bg-[var(--vscode-inputValidation-errorBackground)] border-l-4 border-[var(--vscode-inputValidation-errorBorder)] p-4 mb-4 rounded-r shadow-sm">
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-[var(--vscode-inputValidation-errorForeground)] mt-0.5 mr-2 flex-shrink-0" />
          {/* eslint-disable-next-line react/no-danger -- sanitizedError is strongly sanitized via DOMPurify with strict allowlist */}
          <div className="text-[var(--vscode-inputValidation-errorForeground)] opacity-90 text-sm overflow-auto" dangerouslySetInnerHTML={{__html: sanitizedError}} />
        </div>
      </div>
    );
  }

  return null;
};
