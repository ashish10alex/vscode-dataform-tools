import React, { useState } from 'react';
import { useVSCodeMessage } from './hooks/useVSCodeMessage';
import { vscode } from './utils/vscode';
import { Loader2, AlertCircle, CheckCircle2, MessageSquareWarning } from 'lucide-react';
import clsx from 'clsx';
import { CompiledQueryTab } from './components/CompiledQueryTab';
import { SchemaTab } from './components/SchemaTab';
import { CostEstimatorTab } from './components/CostEstimatorTab';

function App() {
  const state = useVSCodeMessage();
  const [activeTab, setActiveTab] = useState<'compilation' | 'schema' | 'cost'>('compilation');

  // Handle declarations view (full page override)
  if (state.declarationsHtml) {
    return (
      <div className="p-4 text-zinc-300">
        <h2 className="text-xl font-bold mb-4">Declarations</h2>
        <div dangerouslySetInnerHTML={{ __html: state.declarationsHtml }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-zinc-300 overflow-hidden">
      {/* Header / Tabs */}
      <div className="flex items-center space-x-4 p-4 border-b border-zinc-800 bg-zinc-900 z-10">
        <button
          onClick={() => setActiveTab('compilation')}
          className={clsx(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            activeTab === 'compilation' ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-800"
          )}
        >
          Compiled Query
        </button>
        <button
          onClick={() => setActiveTab('schema')}
          className={clsx(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            activeTab === 'schema' ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-800"
          )}
        >
          Schema
        </button>
        <button
          onClick={() => setActiveTab('cost')}
          className={clsx(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            activeTab === 'cost' ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-800"
          )}
        >
          Cost Estimator
        </button>
        
        <div className="flex-grow"></div>
        
        <a 
            href="https://github.com/ashish10alex/vscode-dataform-tools/issues" 
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-xs text-zinc-500 hover:text-zinc-300"
        >
            Report an issue
            <MessageSquareWarning className="w-3 h-3 ml-1" />
        </a>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-4">
        {state.recompiling && (
            <div className="flex items-center gap-2 text-blue-400 mb-4">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Compiling Dataform...</span>
            </div>
        )}



        {state.errorMessage && !state.recompiling && (
            <div className="bg-red-900/20 border-l-4 border-red-600 p-4 mb-4 rounded-r shadow-sm">
                <div className="flex items-start">
                    <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 mr-2 flex-shrink-0" />
                    <div className="text-red-200 text-sm overflow-auto" dangerouslySetInnerHTML={{__html: state.errorMessage}} />
                </div>
            </div>
        )}

        {activeTab === 'compilation' && <CompiledQueryTab state={state} />}
        {activeTab === 'schema' && <SchemaTab state={state} />}
        {activeTab === 'cost' && <CostEstimatorTab state={state} />}

      </div>
    </div>
  );
}

export default App;
