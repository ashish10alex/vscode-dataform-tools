import React, { useState, useEffect, useRef } from "react";
import { WebviewState } from "../types";
import { CodeBlock } from "../../components/CodeBlock";
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
  CheckCircle2,
} from "lucide-react";
import clsx from "clsx";
import { BigQueryTableLink } from "../../components/BigQueryTableLink";
import DOMPurify from "dompurify";


interface CompiledQueryTabProps {
  state: WebviewState;
}

export const CompiledQueryTab: React.FC<CompiledQueryTabProps> = ({
  state,
}) => {
  const [compilerOptions, setCompilerOptions] = useState("");
  const [isCompilerOptionsOpen, setIsCompilerOptionsOpen] = useState(false);
  const [tablePrefix, setTablePrefix] = useState("");
  const [schemaSuffix, setSchemaSuffix] = useState("");
  const [databaseSuffix, setDatabaseSuffix] = useState("");
  const [otherOptions, setOtherOptions] = useState("");

  // Parse initial compiler options
  useEffect(() => {
    // Initialize from prop if available and local state is empty (initial load)
    if (state.compilerOptions && !tablePrefix && !schemaSuffix && !databaseSuffix && !otherOptions) {
        setCompilerOptions(state.compilerOptions);
        setIsCompilerOptionsOpen(true);
        
        const parts = state.compilerOptions.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        let tp = "", ss = "", ds = "", other = [];
        
        for (const part of parts) {
            if (part.startsWith("--table-prefix=")) {
                tp = part.split('=')[1].replace(/"/g, '');
            } else if (part.startsWith("--schema-suffix=")) {
                ss = part.split('=')[1].replace(/"/g, '');
            } else if (part.startsWith("--database-suffix=")) {
                ds = part.split('=')[1].replace(/"/g, '');
            } else {
                other.push(part);
            }
        }
        setTablePrefix(tp);
        setSchemaSuffix(ss);
        setDatabaseSuffix(ds);
        setOtherOptions(other.join(" "));
    }
  }, [state.compilerOptions]); // Run when state.compilerOptions is received

  // Reconstruct compiler options string when individual fields change
  useEffect(() => {
      const parts = [];
      if (tablePrefix) {
          parts.push(`--table-prefix="${tablePrefix}"`);
      }
      if (schemaSuffix) {
          parts.push(`--schema-suffix="${schemaSuffix}"`);
      }
      if (databaseSuffix) {
          parts.push(`--database-suffix="${databaseSuffix}"`);
      }
      if (otherOptions) {
          parts.push(otherOptions);
      }
      
      const newOptions = parts.join(" ");
      if (newOptions !== compilerOptions) {
          setCompilerOptions(newOptions);
      }
  }, [tablePrefix, schemaSuffix, databaseSuffix, otherOptions]);
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

  const isInitialMount = useRef(true);

  // Debounced compiler options update
  useEffect(() => {
    if (isInitialMount.current && !compilerOptions) {
      isInitialMount.current = false;
      return;
    }
    isInitialMount.current = false;

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
  
  const handleRunTest = () => {
    if (state.workspaceFolder) {
        vscode.postMessage({
            command: "runTests",
            value: {
                workspaceFolder: state.workspaceFolder
            }
        });
    }
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

            if (!target) { return null; }

            return (
              <div
                key={index}
                className="bg-[var(--vscode-sideBar-background)] p-4 rounded-lg border border-[var(--vscode-widget-border)] flex flex-col space-y-2 group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    {model.type === 'test' ? (
                      <div className="flex items-center text-sm font-mono text-[var(--vscode-foreground)]">
                         <span className="w-1.5 h-1.5 rounded-full bg-[var(--vscode-symbolIcon-methodForeground)] mr-2"></span>
                         <span className="font-semibold">{model.name}</span>
                         <span className="ml-2 text-[10px] uppercase font-bold tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">
                             TEST
                         </span>
                      </div>
                    ) : (
                      <>
                        <BigQueryTableLink 
                          id={target} 
                          showIcon={true} 
                          className="flex items-center text-sm font-mono text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-foreground)] transition-colors"
                          fallbackClassName="flex items-center text-sm font-mono text-[var(--vscode-errorForeground)]"
                        />
                        <button
                          onClick={() => {
                            const text = `\`${target.database}.${target.schema}.${target.name}\``;
                            navigator.clipboard.writeText(text);
                            setCopiedIndex(index);
                            setTimeout(() => setCopiedIndex(null), 2000);
                          }}
                          className="ml-2 p-1.5 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                          title="Copy table ID with backticks"
                        >
                          {copiedIndex === index ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Last Update Time */}
                {lastUpdateMeta && (
                  <div className="flex items-center space-x-2 text-xs text-[var(--vscode-descriptionForeground)] pl-6">
                    <Clock className="w-3 h-3" />
                    <span>Last updated:</span>
                    {lastUpdateMeta.error?.message ? (
                      <span
                       className="font-mono text-[var(--vscode-descriptionForeground)] opacity-70 cursor-help border-b border-dotted border-[var(--vscode-widget-border)]"
                        title={lastUpdateMeta.error.message}
                      >
                        N/A
                      </span>
                    ) : (
                      <span
                        className={clsx(
                          "font-mono",
                          !lastUpdateMeta.modelWasUpdatedToday
                            ? "text-[var(--vscode-errorForeground)]"
                            : "text-[var(--vscode-foreground)]"
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
      <div className="bg-[var(--vscode-sideBar-background)] rounded-lg border border-[var(--vscode-widget-border)] overflow-hidden">
        <div
          className="flex items-center px-4 py-3 cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors"
          onClick={() => setIsLineageOpen(!isLineageOpen)}
        >
          {isLineageOpen ? (
            <ChevronDown className="w-4 h-4 mr-2 text-zinc-400" />
          ) : (
            <ChevronRight className="w-4 h-4 mr-2 text-zinc-400" />
          )}
          <span className="font-semibold text-[var(--vscode-foreground)]">Data Lineage</span>
        </div>

        {isLineageOpen && (
          <div className="p-4 border-t border-[var(--vscode-widget-border)] space-y-4">
            {/* Dependencies */}
            {state.models && state.models.length > 0 && (
                <div>
                   <h4 className="text-sm font-semibold text-[var(--vscode-descriptionForeground)] mb-2 uppercase tracking-wider">Dependencies</h4>
                   {!state.models[0]?.dependencyTargets?.length && <span className="text-sm text-[var(--vscode-descriptionForeground)] italic">No dependencies</span>}
                   <ul className="space-y-1 pl-2">
                       {state.models.map((model, idx) => (
                           model.dependencyTargets?.map((target: any, tIdx: number) => {
                               const id = `${target.database}.${target.schema}.${target.name}`;
                               return (
                                   <li key={`${idx}-${tIdx}`} className="flex items-center text-sm group">
                                       <span className="w-1.5 h-1.5 rounded-full bg-[var(--vscode-symbolIcon-functionForeground)] opacity-70 mr-2"></span>
                                       <BigQueryTableLink id={target} label={id} />
                                       <button 
                                            onClick={() => {
                                                handleLineageNavigation(id);
                                            }}
                                            className="ml-2 p-1 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-textLink-foreground)] opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Go to definition"
                                       >
                                           <ExternalLink className="w-3 h-3" />
                                       </button>
                                   </li>
                               );
                           })
                       ))}
                   </ul>
                </div>
            )}
            
            {/* Dependents */}
             <div>
                <h4 className="text-sm font-semibold text-[var(--vscode-descriptionForeground)] mb-2 uppercase tracking-wider">Dependents</h4>
                
                {/* Local Dependents Sub-section */}
                <div className="mb-4 ml-2">
                     <h5 className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] opacity-80 mb-1 uppercase tracking-wider">Local Project</h5>
                     {(!state.dependents || state.dependents.length === 0) ? (
                         <span className="text-sm text-[var(--vscode-descriptionForeground)] italic">No local dependents found.</span>
                    ) : (
                        <ul className="space-y-1 pl-2">
                            {state.dependents.map((dependent: any, idx: number) => {
                                 const id = typeof dependent === 'string' ? dependent : `${dependent.database}.${dependent.schema}.${dependent.name}`;
                                 return (
                                    <li key={idx} className="flex items-center text-sm group">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--vscode-symbolIcon-stringForeground)] opacity-70 mr-2"></span>
                                        <BigQueryTableLink id={dependent} label={id} />
                                           <button 
                                                onClick={() => {
                                                    handleLineageNavigation(id);
                                                }}
                                                className="ml-2 p-1 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-textLink-foreground)] opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Go to definition"
                                           >
                                               <ExternalLink className="w-3 h-3" />
                                           </button>
                                    </li>
                                 );
                            })}
                        </ul>
                    )}
                </div>

                {/* Dataplex Dependents Sub-section */}
                 <div className="ml-2">
                     <h5 className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] opacity-80 mb-1 uppercase tracking-wider">Dataplex (Downstream)</h5>
                     
                     {!state.lineageMetadata ? (
                          <button 
                             onClick={handleLineageMetadata}
                             disabled={loadingLineage}
                             className="mt-1 bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-xs px-2 py-1 rounded text-[var(--vscode-button-secondaryForeground)] flex items-center transition-colors disabled:opacity-50"
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
                                                      <BigQueryTableLink id={item} />
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
         <div className="bg-[var(--vscode-inputValidation-warningBackground)] border-l-4 border-[var(--vscode-inputValidation-warningBorder)] p-4 rounded-r shadow-sm flex items-center">
              <Loader2 className="w-5 h-5 text-[var(--vscode-inputValidation-warningForeground)] animate-spin mr-3 flex-shrink-0" />
              <div className="text-[var(--vscode-foreground)] text-sm">
                  <span className="font-semibold text-[var(--vscode-inputValidation-warningForeground)]">Performing dry run...</span>
              </div>
         </div>
       ) : (
         state.dryRunStat && (
             <div className="bg-[var(--vscode-diffEditor-insertedTextBackground)] border border-[var(--vscode-widget-border)] border-l-4 border-l-[var(--vscode-extensionIcon-preReleaseForeground)] p-4 rounded shadow-sm flex items-start">
                  <CheckCircle2 className="w-5 h-5 text-[var(--vscode-extensionIcon-preReleaseForeground)] mt-0.5 mr-2 flex-shrink-0" />
                  <div className="text-[var(--vscode-foreground)] text-sm">
                      <span className="font-semibold">Query will process:</span>
                      {/* eslint-disable-next-line react/no-danger -- sanitized via DOMPurify */}
                      <div className="font-mono mt-1 opacity-90" dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(state.dryRunStat)}} />
                  </div>
             </div>
         )
       )}

      {/* Toolbar */}
       <div className="flex flex-col gap-4 bg-[var(--vscode-sideBar-background)] p-4 rounded-lg border border-[var(--vscode-widget-border)]">
           <div className="flex flex-wrap items-center gap-2">
               <span className="text-sm font-mono text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-2 py-1 rounded">
                   {state.relativeFilePath || " "}
               </span>
               <div className="flex-grow"></div>
               <button onClick={handleFormat} disabled={formatting || state.recompiling} className="flex items-center px-3 py-1.5 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded text-[var(--vscode-button-secondaryForeground)] disabled:opacity-50">
                   <AlignLeft className="w-3 h-3 mr-1.5" /> Format
               </button>
                <button onClick={handleLint} disabled={formatting || state.recompiling} className="flex items-center px-3 py-1.5 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded text-[var(--vscode-button-secondaryForeground)] disabled:opacity-50">
                   <Eye className="w-3 h-3 mr-1.5" /> Lint
               </button>
           </div>

          {/* Compiler Options Section */}
          <div className="bg-[var(--vscode-sideBar-background)] rounded-lg border border-[var(--vscode-widget-border)] overflow-hidden">
              <div 
                  className="flex items-center px-4 py-3 cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors justify-between"
                  onClick={() => setIsCompilerOptionsOpen(!isCompilerOptionsOpen)}
              >
                  <div className="flex items-center">
                      {isCompilerOptionsOpen ? (
                          <ChevronDown className="w-4 h-4 mr-2 text-zinc-400" />
                      ) : (
                          <ChevronRight className="w-4 h-4 mr-2 text-zinc-400" />
                      )}
                      <span className="font-semibold text-zinc-700 dark:text-zinc-200">Compiler Overrides</span>
                  </div>
                  <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        vscode.postMessage({ command: 'openExternal', url: 'https://dataformtools.com/blog/compiler-options' });
                    }}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center"
                  >
                    Docs <ExternalLink className="w-3 h-3 ml-1" />
                  </button>
              </div>

              {isCompilerOptionsOpen && (
                  <div className="p-4 border-t border-[var(--vscode-widget-border)] space-y-3 bg-[var(--vscode-editor-background)]">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
                                  Table Prefix
                              </label>
                              <input 
                                  type="text" 
                                  value={tablePrefix}
                                  onChange={(e) => setTablePrefix(e.target.value)}
                                  placeholder='e.g. AA'
                                  className="w-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded px-3 py-1.5 text-sm text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] transition-colors placeholder:text-[var(--vscode-input-placeholderForeground)]"
                              />
                              <p className="mt-1 text-[10px] text-[var(--vscode-descriptionForeground)] opacity-70">Prefixes all table names (e.g. <code>AA_table</code>)</p>
                          </div>
                          <div>
                              <label className="block text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
                                  Schema Suffix
                              </label>
                              <input 
                                  type="text" 
                                  value={schemaSuffix}
                                  onChange={(e) => setSchemaSuffix(e.target.value)}
                                  placeholder='e.g. dev'
                                  className="w-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded px-3 py-1.5 text-sm text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] transition-colors placeholder:text-[var(--vscode-input-placeholderForeground)]"
                              />
                              <p className="mt-1 text-[10px] text-[var(--vscode-descriptionForeground)] opacity-70">Suffixes dataset names (e.g. <code>dataset_dev</code>)</p>
                          </div>
                          <div>
                              <label className="block text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
                                  Database Suffix
                              </label>
                              <input 
                                  type="text" 
                                  value={databaseSuffix}
                                  onChange={(e) => setDatabaseSuffix(e.target.value)}
                                  placeholder='e.g. dev'
                                  className="w-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded px-3 py-1.5 text-sm text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] transition-colors placeholder:text-[var(--vscode-input-placeholderForeground)]"
                              />
                              <p className="mt-1 text-[10px] text-[var(--vscode-descriptionForeground)] opacity-70">Suffixes project ID (e.g. <code>project_dev</code>)</p>
                          </div>
                           <div>
                              <label className="block text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
                                  Other Options
                              </label>
                              <input 
                                  type="text" 
                                  value={otherOptions}
                                  onChange={(e) => setOtherOptions(e.target.value)}
                                  placeholder='e.g. --vars=key=value'
                                  className="w-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded px-3 py-1.5 text-sm text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] transition-colors placeholder:text-[var(--vscode-input-placeholderForeground)]"
                              />
                              <p className="mt-1 text-[10px] text-[var(--vscode-descriptionForeground)] opacity-70">Additional CLI flags</p>
                          </div>
                      </div>
                      
                      {compilerOptions && (
                          <div className="mt-2 pt-2 border-t border-[var(--vscode-widget-border)]">
                              <span className="text-[10px] font-mono text-[var(--vscode-descriptionForeground)] opacity-70 select-all">
                                  Generated: {compilerOptions}
                              </span>
                          </div>
                      )}
                  </div>
              )}
          </div>

           <div className="flex flex-wrap gap-4 text-sm text-[var(--vscode-foreground)]">
                <label className="flex items-center cursor-pointer space-x-2">
                    <input type="checkbox" checked={includeDependencies} onChange={e => setIncludeDependencies(e.target.checked)} className="form-checkbox h-4 w-4 bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] rounded" />
                    <span>Include Dependencies</span>
                </label>
                <label className="flex items-center cursor-pointer space-x-2">
                    <input type="checkbox" checked={includeDependents} onChange={e => setIncludeDependents(e.target.checked)} className="form-checkbox h-4 w-4 bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] rounded" />
                    <span>Include Dependents</span>
                </label>
                <label className="flex items-center cursor-pointer space-x-2">
                    <input type="checkbox" checked={fullRefresh} onChange={e => setFullRefresh(e.target.checked)} className="form-checkbox h-4 w-4 bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] rounded" />
                    <span>Full Refresh</span>
                </label>
           </div>

           <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--vscode-widget-border)]">
               <button onClick={handleDependencyGraph} disabled={state.recompiling} className="px-3 py-1.5 bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded text-sm flex items-center disabled:opacity-50">
                   <Network className="w-4 h-4 mr-1.5" /> Graph
               </button>
               <button onClick={handlePreviewResults} disabled={state.recompiling} className="px-3 py-1.5 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded text-sm flex items-center disabled:opacity-50">
                   <Eye className="w-4 h-4 mr-1.5" /> Preview Data
               </button>
               {state.testQuery && (
                   <button onClick={handleRunTest} disabled={state.recompiling} className="px-3 py-1.5 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded text-sm flex items-center disabled:opacity-50">
                       <Play className="w-4 h-4 mr-1.5" /> Run Tests
                   </button>
               )}
               {state.actionTypes?.some(t => t !== 'test') && (
                   <>
                       <button onClick={() => handleRunModel(false)} disabled={runningModel || state.recompiling} className="px-3 py-1.5 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded text-sm flex items-center disabled:opacity-50">
                           <Play className="w-4 h-4 mr-1.5" /> Run (CLI)
                       </button>
                        <button onClick={() => handleRunModel(true)} disabled={runningModel || state.recompiling} className="px-3 py-1.5 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded text-sm flex items-center disabled:opacity-50 relative">
                           <Play className="w-4 h-4 mr-1.5" /> Run (API)
                           <span className="absolute -top-2 -right-2 bg-[var(--vscode-statusBarItem-warningBackground)] text-[var(--vscode-statusBarItem-warningForeground)] text-[10px] font-bold px-1.5 rounded-full">NEW</span>
                       </button>
                   </>
               )}
           </div>
      </div>

      {/* Code Blocks */}
      <div className="space-y-6 pb-20">
          {state.preOperations && (
             <div>
                <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold mb-2">Pre Operations</h3>
                <CodeBlock code={state.preOperations} language="sql" />
             </div>
          )}
          {state.postOperations && (
             <div>
                <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold mb-2">Post Operations</h3>
                <CodeBlock code={state.postOperations} language="sql" />
             </div>
          )}
           {state.tableOrViewQuery && (
             <div>
                <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold mb-2">Query</h3>
                <CodeBlock code={state.tableOrViewQuery} language="sql" />
             </div>
          )}
          {state.assertionQuery && (
             <div>
                <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold mb-2">Assertion</h3>
                <CodeBlock code={state.assertionQuery} language="sql" />
             </div>
          )}
          {state.incrementalPreOpsQuery && (
             <div>
                <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold mb-2">Incremental Pre Operations</h3>
                <CodeBlock code={state.incrementalPreOpsQuery} language="sql" />
             </div>
          )}
          {state.incrementalQuery && (
             <div>
                <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold mb-2">Incremental Query</h3>
                 <CodeBlock code={state.incrementalQuery} language="sql" />
             </div>
          )}
          {state.nonIncrementalQuery && (
             <div>
                <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold mb-2">Non Incremental Query</h3>
                 <CodeBlock code={state.nonIncrementalQuery} language="sql" />
             </div>
          )}
          {state.operationsQuery && (
             <div>
                <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold mb-2">Operations</h3>
                 <CodeBlock code={state.operationsQuery} language="sql" />
             </div>
          )}
          {state.testQuery && (
             <div>
                 <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold mb-2">Input Query</h3>
                  <CodeBlock code={state.testQuery} language="sql" />
             </div>
          )}
          {state.expectedOutputQuery && (
             <div>
                 <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold mb-2">Expected Output Query</h3>
                  <CodeBlock code={state.expectedOutputQuery} language="sql" />
             </div>
           )}
       </div>
     </div>
   );
};
