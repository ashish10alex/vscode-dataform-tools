import React, { useState, useEffect } from "react";
import { WebviewState } from "../types";
import { CodeBlock } from "./CodeBlock";
import { vscode } from "../utils/vscode";
import {
  Play,
  Network,
  Eye,
  AlignLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  Clock,
} from "lucide-react";
import clsx from "clsx";

const getUrlToNavigateToTableInBigQuery = (
  gcpProjectId: string,
  datasetId: string,
  tableName: string
) => {
  return `https://console.cloud.google.com/bigquery?project=${gcpProjectId}&ws=!1m5!1m4!4m3!1s${gcpProjectId}!2s${datasetId}!3s${tableName}`;
};

interface CompiledQueryTabProps {
  state: WebviewState;
}

export const CompiledQueryTab: React.FC<CompiledQueryTabProps> = ({
  state,
}) => {
  const [compilerOptions, setCompilerOptions] = useState("");
  const [includeDependencies, setIncludeDependencies] = useState(false);
  const [includeDependents, setIncludeDependents] = useState(false);
  const [fullRefresh, setFullRefresh] = useState(false);
  const [isLineageOpen, setIsLineageOpen] = useState(false);
  const [runningModel, setRunningModel] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [loadingLineage, setLoadingLineage] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const localDependentIds = new Set(
    state.dependents?.map((d: any) =>
      typeof d === "string" ? d : `${d.database}.${d.schema}.${d.name}`
    ) || []
  );

  // Debounced compiler options update
  useEffect(() => {
    const timer = setTimeout(() => {
      vscode.postMessage({
        command: "updateCompilerOptions",
        value: compilerOptions,
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [compilerOptions]);

  const handleRunModel = (api: boolean) => {
    setRunningModel(true);
    vscode.postMessage({
      command: api ? "runModelApi" : "runModel",
      value: {
        runMode: true,
        includeDependents,
        includeDependencies,
        fullRefresh,
      },
    });
    setTimeout(() => setRunningModel(false), api ? 3000 : 10000);
  };

  const handleFormat = () => {
    setFormatting(true);
    vscode.postMessage({ command: "formatCurrentFile", value: true });
    setTimeout(() => setFormatting(false), 100);
  };

  const handleLint = () => {
    vscode.postMessage({ command: "lintCurrentFile", value: true });
  };

  const handlePreviewResults = () => {
    vscode.postMessage({ command: "previewResults", value: true });
  };

  const handleDependencyGraph = () => {
    vscode.postMessage({ command: "dependencyGraph", value: true });
  };

  const handleLineageNavigation = (id: string) => {
    vscode.postMessage({ command: "lineageNavigation", value: id });
  };

  const handleLineageMetadata = () => {
    setLoadingLineage(true);
    vscode.postMessage({ command: "lineageMetadata", value: true });
    // Reset loading state after a timeout or when data triggers a re-render (handled via effect if strictly needed, but simple timeout/state update from parent is okay for now)
    // Actually, better to let the App's state update trigger a re-render. 
    // Since we don't have a direct "lineage loaded" event here easily without complex effect, 
    // we can rely on the fact that the state update will cause a re-render. 
    // However, if we want to turn off loading specifically when lineageMetadata arrives, we might need an effect.
    // For now, let's just set a timeout fallback or rely on state.lineageMetadata check.
    // But since `state` comes from prop, we can check if `state.lineageMetadata` changes.
  };

  useEffect(() => {
      if (state.lineageMetadata || state.errorMessage) {
          setLoadingLineage(false);
      }
  }, [state.lineageMetadata, state.errorMessage]);

  return (
    <div className="space-y-6">
      {/* Model Link */}
      {/* Model Links */}
      {state.models && state.models.length > 0 && (
        <div className="space-y-3">
          {state.models.map((model: any, index: number) => {
            const target = model.target;
            const lastUpdateMeta = state.modelsLastUpdateTimesMeta?.[index];

            if (!target) return null;

            return (
              <div
                key={index}
                className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 flex flex-col space-y-2 group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <a
                      href={getUrlToNavigateToTableInBigQuery(
                        target.database,
                        target.schema,
                        target.name
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center text-sm font-mono text-zinc-700 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      {target.database}.{target.schema}.{target.name}
                    </a>
                    <button
                      onClick={() => {
                        const text = `\`${target.database}.${target.schema}.${target.name}\``;
                        navigator.clipboard.writeText(text);
                        setCopiedIndex(index);
                        setTimeout(() => setCopiedIndex(null), 2000);
                      }}
                      className="ml-2 p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      title="Copy table ID with backticks"
                    >
                      {copiedIndex === index ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Last Update Time */}
                {lastUpdateMeta && (
                  <div className="flex items-center space-x-2 text-xs text-zinc-500 pl-6">
                    <Clock className="w-3 h-3" />
                    <span>Last updated:</span>
                    {lastUpdateMeta.error?.message ? (
                      <span
                        className="font-mono text-zinc-400 cursor-help border-b border-dotted border-zinc-300 dark:border-zinc-600"
                        title={lastUpdateMeta.error.message}
                      >
                        N/A
                      </span>
                    ) : (
                      <span
                        className={clsx(
                          "font-mono",
                          !lastUpdateMeta.modelWasUpdatedToday
                            ? "text-red-500 dark:text-red-400"
                            : "text-zinc-600 dark:text-zinc-300"
                        )}
                      >
                        {lastUpdateMeta.lastModifiedTime}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Data Lineage Section */}
      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <div
          className="flex items-center px-4 py-3 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          onClick={() => setIsLineageOpen(!isLineageOpen)}
        >
          {isLineageOpen ? (
            <ChevronDown className="w-4 h-4 mr-2 text-zinc-400" />
          ) : (
            <ChevronRight className="w-4 h-4 mr-2 text-zinc-400" />
          )}
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">Data Lineage</span>
        </div>

        {isLineageOpen && (
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 space-y-4">
            {/* Dependencies */}
            {state.models && state.models.length > 0 && (
                <div>
                   <h4 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wider">Dependencies</h4>
                   {!state.models[0]?.dependencyTargets?.length && <span className="text-sm text-zinc-500 italic">No dependencies</span>}
                   <ul className="space-y-1 pl-2">
                       {state.models.map((model, idx) => (
                           model.dependencyTargets?.map((target: any, tIdx: number) => {
                               const id = `${target.database}.${target.schema}.${target.name}`;
                               return (
                                   <li key={`${idx}-${tIdx}`} className="flex items-center text-sm group">
                                       <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-2"></span>
                                       <span className="text-zinc-600 dark:text-zinc-300 font-mono select-all hover:text-zinc-900 dark:hover:text-white transition-colors">
                                            {id}
                                       </span>
                                       <button 
                                            onClick={() => handleLineageNavigation(id)}
                                            className="ml-2 p-1 text-zinc-400 dark:text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Go to definition"
                                       >
                                           <ExternalLink className="w-3 h-3" />
                                       </button>
                                   </li>
                               )
                           })
                       ))}
                   </ul>
                </div>
            )}
            
            {/* Dependents */}
             <div>
                <h4 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wider">Dependents</h4>
                
                {/* Local Dependents Sub-section */}
                <div className="mb-4 ml-2">
                    <h5 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 mb-1 uppercase tracking-wider">Local Project</h5>
                    {(!state.dependents || state.dependents.length === 0) ? (
                        <span className="text-sm text-zinc-500 italic">No local dependents found.</span>
                    ) : (
                        <ul className="space-y-1 pl-2">
                            {state.dependents.map((dependent: any, idx: number) => {
                                 const id = typeof dependent === 'string' ? dependent : `${dependent.database}.${dependent.schema}.${dependent.name}`;
                                 return (
                                    <li key={idx} className="flex items-center text-sm group">
                                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 mr-2"></span>
                                        <span className="text-zinc-600 dark:text-zinc-300 font-mono select-all hover:text-zinc-900 dark:hover:text-white transition-colors">
                                             {id}
                                        </span>
                                           <button 
                                                onClick={() => handleLineageNavigation(id)}
                                                className="ml-2 p-1 text-zinc-400 dark:text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Go to definition"
                                           >
                                               <ExternalLink className="w-3 h-3" />
                                           </button>
                                    </li>
                                 )
                            })}
                        </ul>
                    )}
                </div>

                {/* Dataplex Dependents Sub-section */}
                <div className="ml-2">
                    <h5 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 mb-1 uppercase tracking-wider">Dataplex (Downstream)</h5>
                    
                    {!state.lineageMetadata ? (
                         <button 
                            onClick={handleLineageMetadata}
                            disabled={loadingLineage}
                            className="mt-1 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-xs px-2 py-1 rounded text-zinc-700 dark:text-zinc-300 flex items-center transition-colors disabled:opacity-50"
                         >
                            {loadingLineage ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Network className="w-3 h-3 mr-1" />}
                            Load Dataplex Dependencies
                         </button>
                    ) : (
                        <div className="mt-1">
                            {state.lineageMetadata.error ? (
                                <div className="text-red-500 dark:text-red-400 text-sm mb-1">
                                    Error: {state.lineageMetadata.error.message || "Unknown error"}
                                </div>
                            ) : (
                                <>
                                    {(!state.lineageMetadata.dependencies || state.lineageMetadata.dependencies.length === 0) ? (
                                         <span className="text-sm text-zinc-500 italic">No Dataplex dependents found.</span>
                                    ) : (
                                        <ul className="space-y-1 pl-2">
                                            {state.lineageMetadata.dependencies.map((item: string, idx: number) => {
                                                const isExternal = !localDependentIds.has(item);
                                                return (
                                                  <li key={idx} className="flex items-center text-sm">
                                                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-2"></span>
                                                      <span className="text-zinc-600 dark:text-zinc-300 font-mono select-all">{item}</span>
                                                      {isExternal && (
                                                          <span className="ml-2 text-[10px] uppercase font-bold tracking-wider bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                                                              External
                                                          </span>
                                                      )}
                                                  </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
             </div>
          </div>
        )}
      </div>

      {/* Dry Run Stats */}
      {state.dryRunning && !state.recompiling ? (
        <div className="bg-yellow-100 dark:bg-yellow-900/20 border-l-4 border-yellow-500 dark:border-yellow-600 p-4 rounded-r shadow-sm flex items-center">
             <Loader2 className="w-5 h-5 text-yellow-600 dark:text-yellow-500 animate-spin mr-3 flex-shrink-0" />
             <div className="text-zinc-700 dark:text-zinc-300 text-sm">
                 <span className="font-semibold text-yellow-700 dark:text-yellow-400">Performing dry run...</span>
             </div>
        </div>
      ) : (
        state.dryRunStat && (
            <div className="bg-green-100 dark:bg-green-900/20 border-l-4 border-green-500 dark:border-green-600 p-4 rounded-r shadow-sm flex items-start">
                 <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-500 mt-0.5 mr-2 flex-shrink-0" />
                 <div className="text-zinc-700 dark:text-zinc-300 text-sm">
                     <span className="font-semibold text-green-700 dark:text-green-400">Query will process:</span>
                     <div className="font-mono mt-1 text-green-800 dark:text-green-300" dangerouslySetInnerHTML={{__html: state.dryRunStat}} />
                 </div>
            </div>
        )
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-4 bg-zinc-50 dark:bg-zinc-800/30 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-mono text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 rounded">
                  {state.relativeFilePath || "No file selected"}
              </span>
              <div className="flex-grow"></div>
              <button onClick={handleFormat} disabled={formatting} className="flex items-center px-3 py-1.5 text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded text-zinc-700 dark:text-zinc-200 disabled:opacity-50">
                  <AlignLeft className="w-3 h-3 mr-1.5" /> Format
              </button>
               <button onClick={handleLint} className="flex items-center px-3 py-1.5 text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded text-zinc-700 dark:text-zinc-200">
                  <Eye className="w-3 h-3 mr-1.5" /> Lint
              </button>
          </div>

          <div className="flex items-center gap-2">
              <a 
                href="https://dataformtools.com/blog/compiler-options"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap flex items-center group/link"
              >
                Compiler options:
                <ExternalLink className="w-3 h-3 ml-1 opacity-50 group-hover/link:opacity-100 transition-opacity" />
              </a>
              <input 
                type="text" 
                value={compilerOptions}
                onChange={(e) => setCompilerOptions(e.target.value)}
                placeholder='E.g. --table-prefix="AA"'
                className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              />
          </div>

           <div className="flex flex-wrap gap-4 text-sm text-zinc-600 dark:text-zinc-300">
                <label className="flex items-center cursor-pointer space-x-2">
                    <input type="checkbox" checked={includeDependencies} onChange={e => setIncludeDependencies(e.target.checked)} className="form-checkbox h-4 w-4 text-blue-600 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800" />
                    <span>Include Dependencies</span>
                </label>
                <label className="flex items-center cursor-pointer space-x-2">
                    <input type="checkbox" checked={includeDependents} onChange={e => setIncludeDependents(e.target.checked)} className="form-checkbox h-4 w-4 text-blue-600 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800" />
                    <span>Include Dependents</span>
                </label>
                <label className="flex items-center cursor-pointer space-x-2">
                    <input type="checkbox" checked={fullRefresh} onChange={e => setFullRefresh(e.target.checked)} className="form-checkbox h-4 w-4 text-blue-600 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800" />
                    <span>Full Refresh</span>
                </label>
           </div>

           <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700/50">
               <button onClick={handleDependencyGraph} className="px-3 py-1.5 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-800 dark:text-white rounded text-sm flex items-center">
                   <Network className="w-4 h-4 mr-1.5" /> Graph
               </button>
               <button onClick={handlePreviewResults} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm flex items-center">
                   <Eye className="w-4 h-4 mr-1.5" /> Preview Data
               </button>
               <button onClick={() => handleRunModel(false)} disabled={runningModel} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm flex items-center disabled:opacity-50">
                   <Play className="w-4 h-4 mr-1.5" /> Run (CLI)
               </button>
                <button onClick={() => handleRunModel(true)} disabled={runningModel} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm flex items-center disabled:opacity-50 relative">
                   <Play className="w-4 h-4 mr-1.5" /> Run (API)
                   <span className="absolute -top-2 -right-2 bg-yellow-500 text-black text-[10px] font-bold px-1.5 rounded-full">NEW</span>
               </button>
           </div>
      </div>

      {/* Code Blocks */}
      <div className="space-y-6 pb-20">
          {state.preOperations && (
             <div>
                <h3 className="text-zinc-500 dark:text-zinc-400 font-semibold mb-2">Pre Operations</h3>
                <CodeBlock code={state.preOperations} language="sql" />
             </div>
          )}
          {state.postOperations && (
             <div>
                <h3 className="text-zinc-500 dark:text-zinc-400 font-semibold mb-2">Post Operations</h3>
                <CodeBlock code={state.postOperations} language="sql" />
             </div>
          )}
           {state.tableOrViewQuery && (
             <div>
                <h3 className="text-zinc-500 dark:text-zinc-400 font-semibold mb-2">Query</h3>
                <CodeBlock code={state.tableOrViewQuery} language="sql" />
             </div>
          )}
          {state.assertionQuery && (
             <div>
                <h3 className="text-zinc-500 dark:text-zinc-400 font-semibold mb-2">Assertion</h3>
                <CodeBlock code={state.assertionQuery} language="sql" />
             </div>
          )}
          {state.incrementalPreOpsQuery && (
             <div>
                <h3 className="text-zinc-500 dark:text-zinc-400 font-semibold mb-2">Incremental Pre Operations</h3>
                <CodeBlock code={state.incrementalPreOpsQuery} language="sql" />
             </div>
          )}
          {state.incrementalQuery && (
             <div>
                <h3 className="text-zinc-500 dark:text-zinc-400 font-semibold mb-2">Incremental Query</h3>
                 <CodeBlock code={state.incrementalQuery} language="sql" />
             </div>
          )}
          {state.nonIncrementalQuery && (
             <div>
                <h3 className="text-zinc-500 dark:text-zinc-400 font-semibold mb-2">Non Incremental Query</h3>
                 <CodeBlock code={state.nonIncrementalQuery} language="sql" />
             </div>
          )}
          {state.operationsQuery && (
             <div>
                <h3 className="text-zinc-500 dark:text-zinc-400 font-semibold mb-2">Operations</h3>
                 <CodeBlock code={state.operationsQuery} language="sql" />
             </div>
          )}
      </div>
    </div>
  );
};

// Start of Selection
import { CheckCircle2 } from "lucide-react"; // Ensure this import exists
// End of Selection
