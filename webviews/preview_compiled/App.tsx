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
            className="flex items-center text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
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



        {state.errorMessage && !state.recompiling && (
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
