import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertCircle, Check, ChevronDown, ChevronUp, Cloud, Copy, RefreshCw, Terminal } from 'lucide-react';
import DOMPurify from 'dompurify';
import { vscode } from '../utils/vscode';
import { PanelState, CompilationErrorType } from '../types';
import { CompilerOverrides } from './CompilerOverrides';
import { CompilationInfoBadge } from './CompilationInfoBadge';
import { panelProblem } from '../utils/panelProblem';
import { fileOnShow } from '../../../src/shared/panelState';

interface CompilationErrorProps {
  state: PanelState;
}

/**
 * Offered on failed compiles so either Compilation Mode is always one click away: remote mode compiles without
 * the Dataform CLI, and the CLI compiles local changes that are not pushed yet.
 */
const SwitchBackendButton: React.FC<{ to: 'cli' | 'api' }> = ({ to }) => (
  <button
    type="button"
    onClick={() => vscode.postMessage({ command: 'dataform.switchCompilationMode', compilationMode: to })}
    className="mt-3 flex items-center px-3 py-1.5 text-xs bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] rounded text-[var(--vscode-button-foreground)]"
  >
    {to === 'api'
      ? <><Cloud className="w-3 h-3 mr-1.5" /> Compile with the Dataform API instead (beta)</>
      : <><Terminal className="w-3 h-3 mr-1.5" /> Compile with the Dataform CLI instead</>}
  </button>
);

const PRIMARY_BUTTON = "flex items-center px-3 py-1.5 rounded text-sm bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]";
const SECONDARY_BUTTON = "flex items-center px-3 py-1.5 rounded text-sm bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] disabled:opacity-60";
const BOX = "rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)]";
const MUTED = "text-[var(--vscode-descriptionForeground)]";
/** A problem is said in the panel's own colours: only its icon is red */
const CALM_BOX = clsx(BOX, "p-4 mb-4");
const INSTALL_COMMAND = "npm i -g @dataform/cli";
/** How long "Look again" says it is looking: the host answers only by compiling, when the CLI is there */
const LOOK_AGAIN_MS = 1500;

/**
 * The Dataform CLI was not found. The host looks for it again every few seconds while this is on show, and compiles
 * once it is there, so the page goes away by itself after an install.
 */
const DataformCliMissing: React.FC<{ lookedIn: string[] }> = ({ lookedIn }) => {
  const [look, setLook] = useState<'idle' | 'looking' | 'not found'>('idle');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (look !== 'looking') {
      return;
    }
    const timer = setTimeout(() => setLook('not found'), LOOK_AGAIN_MS);
    return () => clearTimeout(timer);
  }, [look]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), LOOK_AGAIN_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="mb-4 space-y-4" data-testid="dataform-cli-missing">
      <div>
        <h2 className="text-lg font-semibold m-0">The Dataform CLI was not found</h2>
        <p className={clsx("mt-1 mb-0 text-sm", MUTED)}>It compiles your project on this machine. Install it and this page goes away by itself.</p>
      </div>

      <div className={clsx(BOX, "p-3 space-y-3")}>
        <div className="text-sm font-medium">Install it with npm <span className={clsx("font-normal", MUTED)}>(needs <a href="https://nodejs.org/en/download" target="_blank" rel="noopener noreferrer" className="text-[var(--vscode-textLink-foreground)] underline">Node.js</a>)</span></div>
        <div className="flex items-center gap-2">
          <pre className="m-0 flex-1 px-2 py-1.5 text-xs font-mono whitespace-pre-wrap rounded bg-[var(--vscode-textCodeBlock-background)]">{INSTALL_COMMAND}</pre>
          <button
            type="button"
            title="Copy the command"
            aria-label="Copy the command"
            className={SECONDARY_BUTTON}
            onClick={() => { vscode.postMessage({ command: 'copyToClipboard', text: INSTALL_COMMAND }); setCopied(true); }}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PRIMARY_BUTTON} onClick={() => vscode.postMessage({ command: 'dataform.installCli' })}>
            <Terminal className="w-3.5 h-3.5 mr-1.5" /> Install in terminal
          </button>
          <button type="button" className={SECONDARY_BUTTON} disabled={look === 'looking'} onClick={() => { setLook('looking'); vscode.postMessage({ command: 'dataform.lookForCliAgain' }); }}>
            <RefreshCw className={clsx("w-3.5 h-3.5 mr-1.5", look === 'looking' && "animate-spin")} /> Look again
          </button>
          {look === 'not found' && <span className={clsx("text-xs", MUTED)}>Still not found</span>}
        </div>
      </div>

      {lookedIn.length > 0 && (
        <div>
          <div className="text-sm mb-1.5">Looked in, in this order:</div>
          <ol className={clsx("text-xs font-mono space-y-1 list-none p-0 m-0", MUTED)}>
            {lookedIn.map((place, index) => (
              <li key={index}>✕&nbsp;&nbsp;{place}</li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <div className="text-sm mb-2">Already installed, or would rather not install it?</div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={SECONDARY_BUTTON} onClick={() => vscode.postMessage({ command: 'dataform.chooseExecutable' })}>
            Choose a dataform executable…
          </button>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => vscode.postMessage({ command: 'dataform.switchCompilationMode', compilationMode: 'api' })}>
            <Cloud className="w-3.5 h-3.5 mr-1.5" /> Compile with the Dataform API instead (beta)
          </button>
        </div>
        <p className={clsx("mt-2 mb-0 text-xs", MUTED)}>
          If Node.js itself is new on this machine, VS Code may not have its folder on PATH yet: reload the window, or choose the executable.
        </p>
      </div>
    </div>
  );
};

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
  <div className="mb-2 border border-[var(--vscode-widget-border)] rounded overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 text-left text-sm font-medium text-[var(--vscode-foreground)] bg-[var(--vscode-editor-background)] hover:opacity-80 transition-opacity"
    >
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]">
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
      <ul className="list-none m-0 p-0 divide-y divide-[var(--vscode-widget-border)]">
        {errors.map((e, i) => (
          <li
            key={i}
            className="px-3 py-2 text-xs text-[var(--vscode-foreground)]"
          >
            <div className="font-medium opacity-90 leading-relaxed">{e.error}</div>
            {e.sourceContext && (
              <pre className="mt-2 mb-1 p-2 text-[11px] font-mono bg-[var(--vscode-editor-background)] opacity-80 rounded border border-[var(--vscode-widget-border)] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
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
  const { type: errorType, message: errorMessage, compiling: recompiling, missingTools: missingExecutables, compileErrors } = panelProblem(state);
  // As the sections below name an error's parts
  const compilationErrors = compileErrors.map((error) => ({ error: error.message, fileName: error.fileName ?? '', lineNumber: error.line, sourceContext: error.sourceContext }));
  const { possibleResolutions, compilationInfo } = state.dataform;
  const relativeFilePath = fileOnShow(state);
  const workspaceFolder = state.project?.root;
  // The selected Compilation Mode, not compilationInfo: an API compile that fails early records no info,
  // which would leave the last CLI compile describing the error.
  const mode = state.dataform.compilationMode ?? compilationInfo?.mode ?? 'cli';
  const cliCompileFailed = mode !== 'api';
  const otherBackend = cliCompileFailed ? 'api' : 'cli';

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
    const status = state.compile?.status === 'compiling' ? state.settled : state.compile;
    return <DataformCliMissing lookedIn={status?.status === 'tool not found' ? status.lookedIn : []} />;
  }

  if (isBigQueryClientError) {
    return (
      <div className={CALM_BOX}>
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-[var(--vscode-errorForeground)] mt-0.5 mr-3 flex-shrink-0" />
          <div>
            {/* eslint-disable-next-line react/no-danger -- sanitizedError is strongly sanitized via DOMPurify with strict allowlist */}
            <div className="text-[var(--vscode-foreground)] opacity-90 text-sm overflow-auto mb-3" dangerouslySetInnerHTML={{__html: sanitizedError}} />

            <h4 className="mt-0 mb-2 text-md font-semibold text-[var(--vscode-foreground)]">Possible fix:</h4>
            <p className="mt-0 mb-3 text-[var(--vscode-foreground)] opacity-90">
              <a href="https://cloud.google.com/sdk/docs/install" target="_blank" rel="noopener noreferrer" className="text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground)] font-medium">Install gcloud cli</a>
            </p>
            <p className="mt-0 mb-3 text-[var(--vscode-foreground)] opacity-90">After gcloud cli is installed run the following in the terminal in order:</p>

            <ol className="mt-0 ml-5 list-decimal list-outside text-[var(--vscode-foreground)] opacity-90 space-y-2">
              <li><code className="px-1.5 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded font-mono text-sm border border-[var(--vscode-widget-border)]">gcloud init</code></li>
              <li><code className="px-1.5 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded font-mono text-sm border border-[var(--vscode-widget-border)]">gcloud auth application-default login</code></li>
              <li><code className="px-1.5 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded font-mono text-sm border border-[var(--vscode-widget-border)]">gcloud config set project your-project-id</code> <span className="opacity-70 italic text-sm"># replace with your gcp project id</span></li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  if (errorType === CompilationErrorType.FILE_NOT_FOUND) {
    return (
      <div className={CALM_BOX}>
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-[var(--vscode-errorForeground)] mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-[var(--vscode-foreground)] opacity-90 text-sm overflow-auto">
            <p className="mt-0 mb-2">
              File <b className="font-mono bg-[var(--vscode-textCodeBlock-background)] px-1 rounded">"{relativeFilePath}"</b> not found in Dataform compiled json with workspace folder <b className="font-mono bg-[var(--vscode-textCodeBlock-background)] px-1 rounded">"{workspaceFolder}"</b>
            </p>
            <p className="mt-0 mb-3 opacity-90">Ignore the error if the file you are in is not expected to produce a sql output</p>

            {!cliCompileFailed && (
              <CompilationInfoBadge info={compilationInfo} mode={mode} className="mb-3 opacity-80" />
            )}

            <h4 className="mt-0 mb-2 text-md font-semibold">Possible resolution/fix(s):</h4>
            <ol className="mt-0 ml-5 list-decimal list-outside opacity-90 space-y-2">
              {!cliCompileFailed && (
                <li>
                  API mode compiles the pushed commit of the current branch, so a new or renamed file is missing until it is committed and pushed.
                  Push your changes, or compile your local files with the Dataform CLI:
                  <SwitchBackendButton to="cli" />
                </li>
              )}
              <li>
                If you are using multi-root workspace, select the correct workspace folder for the file by{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    vscode.postMessage({ command: 'selectProject' });
                  }}
                  className="text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground)] font-medium cursor-pointer"
                >
                  clicking here
                </a>
              </li>
              {cliCompileFailed && (
                <li>Check if running <code className="px-1.5 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded font-mono text-sm border border-[var(--vscode-widget-border)]">dataform compile</code> throws an error</li>
              )}
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
  if (
    errorType === CompilationErrorType.COMPILATION_ERROR &&
    Array.isArray(compilationErrors) &&
    compilationErrors.length > 0
  ) {
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
      <>
        <div className={CALM_BOX}>
          <div className="flex items-center mb-3">
            <AlertCircle className="w-5 h-5 text-[var(--vscode-errorForeground)] mr-2 flex-shrink-0" />
            <h3 className="m-0 text-sm font-semibold text-[var(--vscode-foreground)]">
              Error compiling Dataform
            </h3>
            <span className="ml-auto text-xs text-[var(--vscode-foreground)] opacity-60">
              {compilationErrors.length} error{compilationErrors.length !== 1 ? 's' : ''}
            </span>
          </div>
          <CompilationInfoBadge info={compilationInfo} mode={mode} className="mb-3 text-[var(--vscode-foreground)] opacity-80" />

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

          {cliCompileFailed && (
          <p className="mt-3 mb-0 text-xs text-[var(--vscode-foreground)] opacity-60 italic">
            Run{' '}
            <code className="px-1 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded font-mono border border-[var(--vscode-widget-border)]">
              dataform compile
            </code>{' '}
            in the terminal for the full error output.
          </p>
          )}

          <SwitchBackendButton to={otherBackend} />

          {possibleResolutions && possibleResolutions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--vscode-widget-border)]">
              <h4 className="mt-0 mb-2 text-sm font-semibold text-[var(--vscode-foreground)]">
                Possible fixes:
              </h4>
              <ol className="mt-0 ml-4 list-decimal list-outside text-[var(--vscode-foreground)] opacity-90 space-y-1 text-sm">
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
        <CompilerOverrides initialCompilerOptions={state.dataform.compilerOptions} />
      </>
    );
  }

  if (errorMessage) {
    // Neither compilation status nor a switch of Compilation Mode applies to a file or folder outside a Dataform project
    const offerSwitch = errorType !== CompilationErrorType.UNSUPPORTED_FILE_TYPE && errorType !== CompilationErrorType.NOT_A_DATAFORM_WORKSPACE;
    return (
      <>
        <div className={CALM_BOX}>
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-[var(--vscode-errorForeground)] mt-0.5 mr-2 flex-shrink-0" />
            {/* eslint-disable-next-line react/no-danger -- sanitizedError is strongly sanitized via DOMPurify with strict allowlist */}
            <div className="text-[var(--vscode-foreground)] opacity-90 text-sm overflow-auto" dangerouslySetInnerHTML={{__html: sanitizedError}} />
          </div>
          {offerSwitch && (
            <>
              <CompilationInfoBadge info={compilationInfo} mode={mode} className="mt-3 text-[var(--vscode-foreground)] opacity-80" />
              <SwitchBackendButton to={otherBackend} />
            </>
          )}
        </div>
        <CompilerOverrides initialCompilerOptions={state.dataform.compilerOptions} />
      </>
    );
  }

  return null;
};
