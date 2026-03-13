import  { useState, useEffect } from 'react';
import { useVSCodeMessage } from './hooks/useVSCodeMessage';
import { vscode } from './utils/vscode';
import { Loader2, AlertCircle, MessageSquareWarning, Info, Settings  } from 'lucide-react';
import clsx from 'clsx';
import { CompiledQueryTab } from './components/CompiledQueryTab';
import { SchemaTab } from './components/SchemaTab';
import { CostEstimatorTab } from './components/CostEstimatorTab';
import { WorkflowURLsTab } from './components/WorkflowURLsTab';
import DOMPurify from 'dompurify';

import { DeclarationsView } from './components/DeclarationsView';
import { ProjectConfigTab } from './components/ProjectConfigTab';

function App() {
  const state = useVSCodeMessage();
  const [activeTab, setActiveTab] = useState<'compilation' | 'schema' | 'cost' | 'workflow_urls' | 'project_config'>('compilation');

  const isConfigFile = state.relativeFilePath === 'workflow_settings.yaml' || state.relativeFilePath === 'dataform.json' || state.relativeFilePath === 'package.json';

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isDark = document.body.classList.contains('vscode-dark');
          if (isDark) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }
      });
    });

    observer.observe(document.body, { attributes: true });
    
    // Initial check
    if (document.body.classList.contains('vscode-dark')) {
      document.documentElement.classList.add('dark');
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      // Ignore if modifier keys are pressed
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
        return;
      }

      if (e.key === 's') {
        e.preventDefault();
        setActiveTab('schema');
      } else if (e.key === 'c') {
        e.preventDefault();
        setActiveTab('compilation');
      } else if (e.key === 'w') {
        e.preventDefault();
        setActiveTab('workflow_urls');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (state.relativeFilePath === 'workflow_settings.yaml' || state.relativeFilePath === 'dataform.json' || state.relativeFilePath === 'package.json') {
      setActiveTab('project_config');
    } else if (activeTab === 'project_config') {
      setActiveTab('compilation');
    }
  }, [state.relativeFilePath, activeTab]);

  // Handle declarations view (full page override)
  if (state.declarations) {
    return <DeclarationsView declarations={state.declarations} />;
  }

  let sanitizedError = '';
  if (state.errorMessage) {
    try {
      sanitizedError = DOMPurify.sanitize(state.errorMessage);
    } catch (e) {
      sanitizedError = '';
    }
  }

  const isBigQueryClientError = state.errorMessage && state.errorMessage.includes("Error creating BigQuery client");

  return (
    <div className="flex flex-col h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] overflow-hidden">
      {/* Header / Tabs */}
      <div className="flex items-center w-full p-4 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)] z-10">
        {/* Tab Navigation */}
        {!isConfigFile && (
          <div className="flex items-center space-x-2 flex-grow overflow-x-auto scrollbar-thin">
            <button
              onClick={() => setActiveTab('compilation')}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                activeTab === 'compilation' 
                  ? "bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border-[var(--vscode-button-background)]" 
                  : "text-[var(--vscode-foreground)] opacity-70 hover:opacity-100 hover:bg-[var(--vscode-toolbar-hoverBackground)] border-transparent"
              )}
            >
              Compiled Query
            </button>
            <button
              onClick={() => setActiveTab('schema')}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                activeTab === 'schema' 
                  ? "bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border-[var(--vscode-button-background)]" 
                  : "text-[var(--vscode-foreground)] opacity-70 hover:opacity-100 hover:bg-[var(--vscode-toolbar-hoverBackground)] border-transparent"
              )}
            >
              Schema
            </button>
            <button
              onClick={() => setActiveTab('cost')}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                activeTab === 'cost' 
                  ? "bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border-[var(--vscode-button-background)]" 
                  : "text-[var(--vscode-foreground)] opacity-70 hover:opacity-100 hover:bg-[var(--vscode-toolbar-hoverBackground)] border-transparent"
              )}
            >
              Cost Estimator
            </button>
            <button
              onClick={() => setActiveTab('workflow_urls')}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                activeTab === 'workflow_urls' 
                  ? "bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border-[var(--vscode-button-background)]" 
                  : "text-[var(--vscode-foreground)] opacity-70 hover:opacity-100 hover:bg-[var(--vscode-toolbar-hoverBackground)] border-transparent"
              )}
            >
              Workflow Executions
            </button>
            
            <div className="flex-grow"></div>
            
            <a 
                href="https://github.com/ashish10alex/vscode-dataform-tools/issues" 
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center text-xs text-[var(--vscode-textPreformat-foreground)] hover:brightness-110"
            >
                Report an issue
                <MessageSquareWarning className="w-3 h-3 ml-1" />
            </a>
          </div>
        )}

        {isConfigFile && (
          <div className="flex items-center w-full">
            <h2 className="text-sm font-semibold text-[var(--vscode-foreground)] flex items-center">
              <Settings className="w-4 h-4 mr-2" />
              Project Configuration
            </h2>
            <div className="flex-grow"></div>
            <a 
                href="https://github.com/ashish10alex/vscode-dataform-tools/issues" 
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center text-xs text-[var(--vscode-textPreformat-foreground)] hover:brightness-110"
            >
                Report an issue
                <MessageSquareWarning className="w-3 h-3 ml-1" />
            </a>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-4">
        {state.recompiling && (
            <div className="mb-4">
                <div className="flex items-center gap-2 text-[var(--vscode-textLink-foreground)]">
                    <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                    <span>{state.dataformCoreVersion ? `Installing @dataform/core@${state.dataformCoreVersion} and compiling...` : `Compiling Dataform...`}</span>
                </div>
                {state.dataformCoreVersion && (
                    <div className="mt-4 border-l-[3px] border-[var(--vscode-textLink-foreground)] pl-4 py-2 mr-4 bg-[var(--vscode-sideBar-background)] rounded-r-md">
                        <h4 className="flex items-center gap-2 m-0 text-sm font-semibold text-[var(--vscode-textLink-foreground)] mb-2">
                            <Info className="w-4 h-4" />
                            Note
                        </h4>
                        <div className="text-sm text-[var(--vscode-foreground)] opacity-90 leading-relaxed">
                            <p className="m-0">
                                When specifying <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[13px] border border-[var(--vscode-widget-border)]">dataformCoreVersion</code> in <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[13px] border border-[var(--vscode-widget-border)]">workflow_settings.yaml</code>, Dataform CLI copies over the project to a temporary directory, adds <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[13px] border border-[var(--vscode-widget-border)]">package.json</code>, and installs dataform core by running <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[13px] border border-[var(--vscode-widget-border)]">npm install</code>. This requires a network call and might take time if the dependency is not cached in your npm cache. You can avoid this bottleneck by creating a <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[13px] border border-[var(--vscode-widget-border)]">package.json</code> and specifying dataform core locally.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        )}

        {state.compilationTimeMs !== undefined && state.recompiling === false && (
            <div className="mb-4 flex justify-start text-xs text-[var(--vscode-descriptionForeground)]">
                <span>Compiled in {(state.compilationTimeMs / 1000).toFixed(2)}s</span>
            </div>
        )}

        {state.missingExecutables && state.missingExecutables.length > 0 && !state.recompiling && (
            <div className="bg-[var(--vscode-inputValidation-errorBackground)] border-l-4 border-[var(--vscode-inputValidation-errorBorder)] p-4 mb-4 rounded-r shadow-sm">
                <div className="flex items-start">
                    <AlertCircle className="w-5 h-5 text-[var(--vscode-inputValidation-errorForeground)] mt-0.5 mr-3 flex-shrink-0" />
                    <div>
                        <h3 className="mt-0 mb-2 text-lg font-semibold text-[var(--vscode-inputValidation-errorForeground)]">Missing Required {state.missingExecutables.length > 1 ? 'CLIs' : 'CLI'}</h3>
                        <p className="mt-0 mb-3 text-[var(--vscode-inputValidation-errorForeground)] opacity-90">The following mandatory {state.missingExecutables.length > 1 ? 'CLIs are' : 'CLI is'} not installed or not found in your system PATH: <b className="font-mono bg-[var(--vscode-editor-background)] opacity-50 px-1 rounded">{state.missingExecutables.join(', ')}</b></p>
                        <p className="mt-0 mb-4 text-[var(--vscode-inputValidation-errorForeground)] opacity-90"><a href="https://github.com/ashish10alex/vscode-dataform-tools?tab=readme-ov-file#installation" target="_blank" rel="noopener noreferrer" className="text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground)] font-medium">Installation steps on GitHub</a></p>
                        
                        <ol className="mt-0 list-decimal list-inside text-[var(--vscode-inputValidation-errorForeground)] opacity-90 space-y-3">
                            {state.missingExecutables.includes('dataform') && (
                                <li>
                                    <b className="text-[var(--vscode-inputValidation-errorForeground)]">Dataform CLI</b> (requires Node.js)
                                    <ul className="mt-2 ml-6 pl-3 border-l-2 border-[var(--vscode-inputValidation-errorBorder)] list-none space-y-2">
                                        <li><code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">npm i -g @dataform/cli</code></li>
                                        <li>Run <code className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] opacity-50 rounded font-mono text-sm border border-[var(--vscode-widget-border)]">dataform compile</code> from the root of your project to verify</li>
                                    </ul>
                                </li>
                            )}
                            {state.missingExecutables.includes('gcloud') && (
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
        )}

        {isBigQueryClientError && !state.recompiling && (!state.missingExecutables || state.missingExecutables.length === 0) && (
            <div className="bg-[var(--vscode-inputValidation-errorBackground)] border-l-4 border-[var(--vscode-inputValidation-errorBorder)] p-4 mb-4 rounded-r shadow-sm">
                <div className="flex items-start">
                    <AlertCircle className="w-5 h-5 text-[var(--vscode-inputValidation-errorForeground)] mt-0.5 mr-3 flex-shrink-0" />
                    <div>
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
        )}

        {state.errorType === 'FILE_NOT_FOUND' && !state.recompiling && (!state.missingExecutables || state.missingExecutables.length === 0) && (
            <div className="bg-[var(--vscode-inputValidation-errorBackground)] border-l-4 border-[var(--vscode-inputValidation-errorBorder)] p-4 mb-4 rounded-r shadow-sm">
                <div className="flex items-start">
                    <AlertCircle className="w-5 h-5 text-[var(--vscode-inputValidation-errorForeground)] mt-0.5 mr-3 flex-shrink-0" />
                    <div className="text-[var(--vscode-inputValidation-errorForeground)] opacity-90 text-sm overflow-auto">
                        <p className="mt-0 mb-2">
                          File <b className="font-mono bg-[var(--vscode-editor-background)] opacity-50 px-1 rounded">"{state.relativeFilePath}"</b> not found in Dataform compiled json with workspace folder <b className="font-mono bg-[var(--vscode-editor-background)] opacity-50 px-1 rounded">"{state.workspaceFolder}"</b>
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
        )}

        {state.errorMessage && state.errorType !== 'FILE_NOT_FOUND' && !isBigQueryClientError && !state.recompiling && (!state.missingExecutables || state.missingExecutables.length === 0) && (
            <div className="bg-[var(--vscode-inputValidation-errorBackground)] border-l-4 border-[var(--vscode-inputValidation-errorBorder)] p-4 mb-4 rounded-r shadow-sm">
                <div className="flex items-start">
                    <AlertCircle className="w-5 h-5 text-[var(--vscode-inputValidation-errorForeground)] mt-0.5 mr-2 flex-shrink-0" />
                    <div className="text-[var(--vscode-inputValidation-errorForeground)] opacity-90 text-sm overflow-auto" dangerouslySetInnerHTML={{__html: sanitizedError}} />
                </div>
            </div>
        )}

        {!isConfigFile && activeTab === 'compilation' && <CompiledQueryTab state={state} />}
        {!isConfigFile && activeTab === 'schema' && <SchemaTab state={state} />}
        {!isConfigFile && activeTab === 'cost' && <CostEstimatorTab state={state} />}
        {!isConfigFile && activeTab === 'workflow_urls' && <WorkflowURLsTab state={state} />}
        {isConfigFile && <ProjectConfigTab state={state} />}

      </div>
    </div>
  );
}

export default App;
