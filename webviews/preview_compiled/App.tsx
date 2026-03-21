import { useState, useEffect } from 'react';
import { useVSCodeMessage } from './hooks/useVSCodeMessage';
import { Loader2, MessageSquareWarning, Info, Settings } from 'lucide-react';
import clsx from 'clsx';
import { CompiledQueryTab } from './components/CompiledQueryTab';
import { SchemaTab } from './components/SchemaTab';
import { CostEstimatorTab } from './components/CostEstimatorTab';
import { WorkflowURLsTab } from './components/WorkflowURLsTab';

import { DeclarationsView } from './components/DeclarationsView';
import { ProjectConfigTab } from './components/ProjectConfigTab';
import { CompilationError } from './components/CompilationError';
import { CompilationErrorType } from './types';
import { SkeletonLoader } from './components/SkeletonLoader';

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
                    <div className="mt-4 border-l-4 border-[var(--vscode-inputValidation-warningBorder)] pl-4 py-3 mr-4 bg-[var(--vscode-inputValidation-warningBackground)] rounded-r-md shadow-sm">
                        <h4 className="flex items-center gap-2 m-0 text-sm font-semibold text-[var(--vscode-inputValidation-warningForeground)] mb-2">
                            <Info className="w-4 h-4" />
                            Note
                        </h4>
                        <div className="text-[13px] text-[var(--vscode-foreground)] opacity-90 leading-relaxed pr-2">
                            <p className="m-0">
                                When specifying <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[12px] border border-[var(--vscode-widget-border)]">dataformCoreVersion</code> in <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[12px] border border-[var(--vscode-widget-border)]">workflow_settings.yaml</code>, Dataform CLI copies over the project to a temporary directory, adds <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[12px] border border-[var(--vscode-widget-border)]">package.json</code>, and installs dataform core by running <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[12px] border border-[var(--vscode-widget-border)]">npm install</code>. This requires a network call and might take time. To avoid this, create a local <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[12px] border border-[var(--vscode-widget-border)]">package.json</code>.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        )}

        {state.recompiling && !state.tableOrViewQuery && !state.testQuery && !state.expectedOutputQuery && !state.projectConfig && !state.packageJsonContent && !state.declarations && !state.errorMessage && !state.compilationErrors && (
            <SkeletonLoader type={isConfigFile ? 'config' : 'default'} />
        )}

        {state.compilationTimeMs !== undefined && state.recompiling === false && (
            <div className="mb-4 flex items-center gap-4 text-xs">
                <span className="text-[var(--vscode-descriptionForeground)]">Compiled in {(state.compilationTimeMs / 1000).toFixed(2)}s</span>
            </div>
        )}

        {(state.errorType === CompilationErrorType.COMPILATION_ERROR ||
          !state.models?.length ||
          (state.missingExecutables && state.missingExecutables.length > 0)) && (
          <CompilationError state={state} />
        )}

        {isConfigFile && <ProjectConfigTab state={state} />}
        {!isConfigFile && (state.isHelperFile || (!state.tableOrViewQuery && !state.testQuery && !state.expectedOutputQuery && !state.declarations && state.relativeFilePath?.endsWith('.js'))) && (
            <div>
                <code className="text-sm font-mono bg-[var(--vscode-editor-background)] px-2 py-1 rounded border border-[var(--vscode-widget-border)] text-[var(--vscode-textPreformat-foreground)]">
                    {state.relativeFilePath}
                </code>
            </div>
        )}

        {!isConfigFile && !state.isHelperFile && activeTab === 'compilation' && (
          state.tableOrViewQuery || 
          state.operationsQuery || 
          state.assertionQuery || 
          state.incrementalQuery || 
          state.testQuery ||
          state.expectedOutputQuery ||
          state.declarations
        ) && <CompiledQueryTab state={state} />}
        {!isConfigFile && !state.isHelperFile && activeTab === 'schema' && <SchemaTab state={state} />}
        {!isConfigFile && !state.isHelperFile && activeTab === 'cost' && <CostEstimatorTab state={state} />}
        {!isConfigFile && !state.isHelperFile && activeTab === 'workflow_urls' && <WorkflowURLsTab state={state} />}

      </div>
    </div>
  );
}

export default App;
