import  { useState, useEffect } from 'react';
import { useVSCodeMessage } from './hooks/useVSCodeMessage';
import { Loader2, AlertCircle, MessageSquareWarning } from 'lucide-react';
import clsx from 'clsx';
import { CompiledQueryTab } from './components/CompiledQueryTab';
import { SchemaTab } from './components/SchemaTab';
import { CostEstimatorTab } from './components/CostEstimatorTab';
import { WorkflowURLsTab } from './components/WorkflowURLsTab';
import DOMPurify from 'dompurify';

import { DeclarationsView } from './components/DeclarationsView';

function App() {
  const state = useVSCodeMessage();
  const [activeTab, setActiveTab] = useState<'compilation' | 'schema' | 'cost' | 'workflow_urls'>('compilation');

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

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-300 overflow-hidden">
      {/* Header / Tabs */}
      <div className="flex items-center space-x-4 p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 z-10">
        <button
          onClick={() => setActiveTab('compilation')}
          className={clsx(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            activeTab === 'compilation' ? "bg-blue-600 text-white" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          )}
        >
          Compiled Query
        </button>
        <button
          onClick={() => setActiveTab('schema')}
          className={clsx(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            activeTab === 'schema' ? "bg-blue-600 text-white" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          )}
        >
          Schema
        </button>
        <button
          onClick={() => setActiveTab('cost')}
          className={clsx(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            activeTab === 'cost' ? "bg-blue-600 text-white" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          )}
        >
          Cost Estimator
        </button>
        <button
          onClick={() => setActiveTab('workflow_urls')}
          className={clsx(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            activeTab === 'workflow_urls' ? "bg-blue-600 text-white" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          )}
        >
          Workflow Executions
        </button>
        
        <div className="flex-grow"></div>
        
        <a 
            href="https://github.com/ashish10alex/vscode-dataform-tools/issues" 
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-xs text-yellow-600 hover:text-yellow-700 dark:text-yellow-500 dark:hover:text-yellow-400"
        >
            Report an issue
            <MessageSquareWarning className="w-3 h-3 ml-1" />
        </a>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-4">
        {state.recompiling && (
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-4">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Compiling Dataform...</span>
            </div>
        )}



        {state.missingExecutables && state.missingExecutables.length > 0 && !state.recompiling && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 p-4 mb-4 rounded-r shadow-sm">
                <div className="flex items-start">
                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-500 mt-0.5 mr-3 flex-shrink-0" />
                    <div>
                        <h3 className="mt-0 mb-2 text-lg font-semibold text-red-800 dark:text-red-200">Missing Required {state.missingExecutables.length > 1 ? 'CLIs' : 'CLI'}</h3>
                        <p className="mt-0 mb-3 text-red-700 dark:text-red-300">The following mandatory {state.missingExecutables.length > 1 ? 'CLIs are' : 'CLI is'} not installed or not found in your system PATH: <b className="font-mono bg-red-100 dark:bg-red-900/40 px-1 rounded">{state.missingExecutables.join(', ')}</b></p>
                        <p className="mt-0 mb-4 text-red-700 dark:text-red-300"><a href="https://github.com/ashish10alex/vscode-dataform-tools?tab=readme-ov-file#installation" target="_blank" rel="noopener noreferrer" className="text-red-800 dark:text-red-200 underline hover:text-red-900 dark:hover:text-red-100 font-medium">Installation steps on GitHub</a></p>
                        
                        <ol className="mt-0 list-decimal list-inside text-red-700 dark:text-red-300 space-y-3">
                            {state.missingExecutables.includes('dataform') && (
                                <li>
                                    <b className="text-red-800 dark:text-red-200">Dataform CLI</b> (requires Node.js)
                                    <ul className="mt-2 ml-6 pl-3 border-l-2 border-red-200 dark:border-red-800/50 list-none space-y-2">
                                        <li><code className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 rounded font-mono text-sm border border-red-200 dark:border-red-800/50">npm i -g @dataform/cli</code></li>
                                        <li>Run <code className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 rounded font-mono text-sm border border-red-200 dark:border-red-800/50">dataform compile</code> from the root of your project to verify</li>
                                    </ul>
                                </li>
                            )}
                            {state.missingExecutables.includes('gcloud') && (
                                <li>
                                    <b className="text-red-800 dark:text-red-200">Google Cloud CLI</b> (<a href="https://cloud.google.com/sdk/docs/install" target="_blank" rel="noopener noreferrer" className="text-red-800 dark:text-red-200 underline hover:text-red-900 dark:hover:text-red-100">Installation Documentation</a>)
                                    <ul className="mt-2 ml-6 pl-3 border-l-2 border-red-200 dark:border-red-800/50 list-none space-y-2">
                                        <li><code className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 rounded font-mono text-sm border border-red-200 dark:border-red-800/50">gcloud init</code></li>
                                        <li><code className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 rounded font-mono text-sm border border-red-200 dark:border-red-800/50">gcloud auth application-default login</code></li>
                                        <li><code className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 rounded font-mono text-sm border border-red-200 dark:border-red-800/50">gcloud config set project &lt;project_id&gt;</code></li>
                                    </ul>
                                </li>
                            )}
                        </ol>
                        <p className="mt-5 mb-0 text-sm italic text-red-600 dark:text-red-400">Note: You may need to restart VS Code after installing these tools so they are picked up in the system PATH.</p>
                    </div>
                </div>
            </div>
        )}

        {state.errorMessage && !state.recompiling && (!state.missingExecutables || state.missingExecutables.length === 0) && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 p-4 mb-4 rounded-r shadow-sm">
                <div className="flex items-start">
                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-500 mt-0.5 mr-2 flex-shrink-0" />
                    <div className="text-red-800 dark:text-red-200 text-sm overflow-auto" dangerouslySetInnerHTML={{__html: sanitizedError}} />
                </div>
            </div>
        )}

        {activeTab === 'compilation' && <CompiledQueryTab state={state} />}
        {activeTab === 'schema' && <SchemaTab state={state} />}
        {activeTab === 'cost' && <CostEstimatorTab state={state} />}
        {activeTab === 'workflow_urls' && <WorkflowURLsTab state={state} />}

      </div>
    </div>
  );
}

export default App;
