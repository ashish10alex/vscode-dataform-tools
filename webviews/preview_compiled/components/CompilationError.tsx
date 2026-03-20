import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import DOMPurify from 'dompurify';
import { vscode } from '../utils/vscode';
import { WebviewState, CompilationErrorType } from '../types';

interface CompilationErrorProps {
  state: WebviewState;
}

interface AccordionSectionProps {
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  errors: Array<{
    error: string;
    fileName: string;
    lineNumber?: number;
    sourceContext?: string;
  }>;
}

const AccordionSection: React.FC<AccordionSectionProps> = ({
  label,
  count,
  isOpen,
  onToggle,
  errors,
}) => (
  <div className="mb-2 border border-[var(--vscode-inputValidation-errorBorder)] rounded overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 text-left text-sm font-medium text-[var(--vscode-inputValidation-errorForeground)] bg-[var(--vscode-editor-background)] hover:opacity-80 transition-opacity"
    >
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-[var(--vscode-inputValidation-errorBorder)] text-[var(--vscode-inputValidation-errorForeground)] opacity-80">
          {count}
        </span>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 flex-shrink-0" />
        )}
      </div>
    </button>
    {isOpen && (
      <ul className="list-none m-0 p-0 divide-y divide-[var(--vscode-inputValidation-errorBorder)]">
        {errors.map((e, i) => (
          <li
            key={i}
            className="px-3 py-2 text-xs text-[var(--vscode-inputValidation-errorForeground)]"
          >
            <div className="font-medium opacity-90 leading-relaxed">{e.error}</div>
            {e.sourceContext && (
              <pre className="mt-2 mb-1 p-2 text-[11px] font-mono bg-[var(--vscode-editor-background)] opacity-80 rounded border border-[var(--vscode-inputValidation-errorBorder)] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                {e.sourceContext}
              </pre>
            )}
            {e.fileName && (
              <div className="mt-1 font-mono opacity-50 text-[11px] break-all">
                {e.lineNumber !== undefined ? `${e.fileName}:${e.lineNumber}` : e.fileName}
              </div>
            )}
          </li>
        ))}
      </ul>
    )}
  </div>
);

export const CompilationError: React.FC<CompilationErrorProps> = ({ state }) => {
  const {
    errorMessage,
    errorType,
    recompiling,
    missingExecutables,
    relativeFilePath,
    workspaceFolder,
    compilationErrors,
    possibleResolutions,
  } = state;

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    root: true,
    unresolved: false,
    missing: false,
  });

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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

  if (errorType === CompilationErrorType.FILE_NOT_FOUND) {
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

  // Structured compilation errors (COMPILATION_ERROR with structured array)
  if (errorType === CompilationErrorType.COMPILATION_ERROR && compilationErrors) {
    const rootErrors = compilationErrors.filter(
      (e) =>
        !e.error.startsWith('Could not resolve') &&
        !e.error.startsWith('Missing dependency detected')
    );
    const unresolvedRefErrors = compilationErrors.filter((e) =>
      e.error.startsWith('Could not resolve')
    );
    const missingDepErrors = compilationErrors.filter((e) =>
      e.error.startsWith('Missing dependency detected')
    );

    const groups = [
      { key: 'root', label: 'Syntax / Root Errors', errors: rootErrors },
      { key: 'unresolved', label: 'Unresolved References', errors: unresolvedRefErrors },
      { key: 'missing', label: 'Missing Dependencies', errors: missingDepErrors },
    ].filter((g) => g.errors.length > 0);

    return (
      <div className="bg-[var(--vscode-inputValidation-errorBackground)] border-l-4 border-[var(--vscode-inputValidation-errorBorder)] p-4 mb-4 rounded-r shadow-sm">
        <div className="flex items-center mb-3">
          <AlertCircle className="w-5 h-5 text-[var(--vscode-inputValidation-errorForeground)] mr-2 flex-shrink-0" />
          <h3 className="m-0 text-sm font-semibold text-[var(--vscode-inputValidation-errorForeground)]">
            Error compiling Dataform
          </h3>
          <span className="ml-auto text-xs text-[var(--vscode-inputValidation-errorForeground)] opacity-60">
            {compilationErrors.length} error{compilationErrors.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="space-y-1">
          {groups.map((group) => (
            <AccordionSection
              key={group.key}
              label={group.label}
              count={group.errors.length}
              isOpen={openSections[group.key]}
              onToggle={() => toggleSection(group.key)}
              errors={group.errors}
            />
          ))}
        </div>

        <p className="mt-3 mb-0 text-xs text-[var(--vscode-inputValidation-errorForeground)] opacity-60 italic">
          Run{' '}
          <code className="px-1 py-0.5 bg-[var(--vscode-editor-background)] opacity-70 rounded font-mono border border-[var(--vscode-widget-border)]">
            dataform compile
          </code>{' '}
          in the terminal for the full error output.
        </p>

        {possibleResolutions && possibleResolutions.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--vscode-inputValidation-errorBorder)]">
            <h4 className="mt-0 mb-2 text-sm font-semibold text-[var(--vscode-inputValidation-errorForeground)]">
              Possible fixes:
            </h4>
            <ol className="mt-0 ml-4 list-decimal list-outside text-[var(--vscode-inputValidation-errorForeground)] opacity-90 space-y-1 text-sm">
              {possibleResolutions.map((resolution, i) => (
                <li
                  key={i}
                  // eslint-disable-next-line react/no-danger -- resolution strings are author-controlled (from extension source code), not user input; DOMPurify further restricts to b/code only
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(resolution, {
                      ALLOWED_TAGS: ['b', 'code'],
                      ALLOWED_ATTR: [],
                    }),
                  }}
                />
              ))}
            </ol>
          </div>
        )}
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
