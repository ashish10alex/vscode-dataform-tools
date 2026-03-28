import React, { useState, useEffect, useRef } from "react";
import { WebviewState } from "../types";
import { CodeBlock } from "../../components/CodeBlock";
import { vscode } from "../utils/vscode";
import {
  Play,
  Network,
  Eye,
  ShieldCheck,
  Wand2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  Clock,
  AlertCircle,
} from "lucide-react";
import clsx from "clsx";
import { BigQueryTableLink } from "../../components/BigQueryTableLink";
import { ACTION_TYPE_BADGE_STYLES, DEFAULT_BADGE_STYLE } from "../utils/constants";
import * as RadixTabs from "@radix-ui/react-tabs";




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
  const [openQueries, setOpenQueries] = useState<Record<string, boolean>>({});
  const isQueryOpen = (key: string) => openQueries[key] !== false;
  const toggleQuery = (key: string) => setOpenQueries(prev => ({ ...prev, [key]: prev[key] !== false ? false : true }));

  const [collapsedModels, setCollapsedModels] = useState<Record<string, boolean>>({});
  const isModelOpen = (key: string) => collapsedModels[key] !== false;
  const toggleModel = (key: string) => setCollapsedModels(prev => ({ ...prev, [key]: prev[key] !== false ? false : true }));

  const [activeIncrementalTab, setActiveIncrementalTab] = useState<Record<string, string>>({});

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

  const queryLabelByType = (type: string) => {
    if (type === 'view') {return 'View';};
    if (type === 'table') {return 'Table';};
    if (type === 'assertion') {return 'Assertion';};
    if (type === 'operations') {return 'Operations';};
    return 'Query';
  };

  return (
    <div className="space-y-6">
      {/* Filename + Compile Time + Format/Lint */}
      <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-mono text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-2 py-1 rounded">
              {state.relativeFilePath || " "}
          </span>
          {state.compilationTimeMs !== undefined && state.recompiling === false && (
              <span className="text-xs text-[var(--vscode-descriptionForeground)]">
                  Compiled in {(state.compilationTimeMs / 1000).toFixed(2)}s
              </span>
          )}
          <div className="flex-grow"></div>
          <button onClick={handleFormat} disabled={formatting || state.recompiling} className="flex items-center px-3 py-1.5 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded text-[var(--vscode-button-secondaryForeground)] disabled:opacity-50">
              <Wand2 className="w-3 h-3 mr-1.5" /> Format
          </button>
          <button onClick={handleLint} disabled={formatting || state.recompiling} className="flex items-center px-3 py-1.5 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded text-[var(--vscode-button-secondaryForeground)] disabled:opacity-50">
              <ShieldCheck className="w-3 h-3 mr-1.5" /> Lint
          </button>
      </div>

      {/* Model Link */}
      {/* Model Links */}
      {state.models && state.models.length > 0 && (
        <div className="space-y-3">
          {state.models.map((model: any, index: number) => {
            const target = model.target;
            const lastUpdateMeta = state.modelsLastUpdateTimesMeta?.[index];

            if (!target && model.type !== 'test') { return null; }

            const badgeStyle = ACTION_TYPE_BADGE_STYLES[model.type] || DEFAULT_BADGE_STYLE;
            const nodeId = model.target ? `${model.target.database}.${model.target.schema}.${model.target.name}` : null;
            const sameTypeCount = state.models?.filter((m: any) => m.type === model.type).length ?? 0;
            const nodeNameKey = model.type === 'test' ? model.name : nodeId;
            const dryRunStat =
              (nodeNameKey ? state.dryRunStatByNodeName?.[nodeNameKey] : undefined) ??
              (sameTypeCount === 1 ? state.dryRunStatByNodeType?.[model.type] : undefined);

            return (
              <div
                key={index}
                className="relative bg-[var(--vscode-sideBar-background)] px-4 pt-7 pb-4 rounded-xl border border-[var(--vscode-widget-border)]/60 flex flex-col space-y-2 group"
              >
                <span className={`absolute top-2 left-2 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}>
                  {model.type}
                </span>
                {dryRunStat && !state.dryRunning && (
                  <div className="absolute top-2 right-2 text-xs font-mono font-medium text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] px-2 py-0.5 rounded">
                    {dryRunStat.split("<br>").map((line, i) => (
                      <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
                    ))}
                  </div>
                )}
                {state.dryRunning && !state.recompiling && (
                  <Loader2 className="absolute top-2 right-2 w-3.5 h-3.5 text-[var(--vscode-descriptionForeground)] animate-spin" />
                )}
                <div className="flex items-center">
                  <div className="flex items-center min-w-0">
                    {model.type === 'test' ? (
                      <div className="flex items-center text-sm font-mono text-[var(--vscode-foreground)]">
                         <span className="w-1.5 h-1.5 rounded-full bg-[var(--vscode-symbolIcon-methodForeground)] mr-2"></span>
                         <span className="font-semibold">{model.name}</span>
                      </div>
                    ) : (
                      <>
                        <BigQueryTableLink
                          id={target}
                          showIcon={true}
                          className="flex items-center text-sm font-mono text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-foreground)] transition-colors"
                          fallbackClassName="flex items-center text-sm font-mono text-[var(--vscode-errorForeground)]"
                        />
                        {model.type === 'notebook' && model.fileName && (
                          <span className="ml-3 text-xs font-mono text-[var(--vscode-descriptionForeground)] opacity-80">{model.fileName}</span>
                        )}
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

                {/* Inline dry-run error — looked up by node name (precise) then node type (fallback) */}
                {(() => {
                  const nonIncError =
                    (nodeNameKey ? state.dryRunErrorsByNodeName?.[nodeNameKey] : undefined) ??
                    (sameTypeCount === 1 ? state.dryRunErrorsByNodeType?.[model.type] : undefined);
                  const incError =
                    (nodeNameKey ? state.dryRunIncrementalErrorsByNodeName?.[nodeNameKey] : undefined) ??
                    (sameTypeCount === 1 ? state.dryRunIncrementalErrorsByNodeType?.[model.type] : undefined);
                  const modelExpectedOutputError =
                    (nodeNameKey ? state.dryRunExpectedOutputErrorsByNodeName?.[nodeNameKey] : undefined) ??
                    (sameTypeCount === 1 ? state.dryRunExpectedOutputErrorsByNodeType?.[model.type] : undefined);
                  const errorDisplay = [
                    incError ? `(Incremental): ${incError.message}` : '',
                    nonIncError ? (
                        model.type === 'incremental' ? `(Non incremental): ${nonIncError.message}` : 
                        model.type === 'test' && modelExpectedOutputError ? `(Input): ${nonIncError.message}` : nonIncError.message
                    ) : '',
                    (model.type === 'test' && modelExpectedOutputError) ? `(Expected output): ${modelExpectedOutputError.message}` : '',
                  ].filter(Boolean).join('\n');
                  return errorDisplay ? (
                    <div className="mt-1 bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)] px-3 py-2 rounded text-xs text-[var(--vscode-inputValidation-errorForeground)] flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <div className="overflow-auto whitespace-pre-wrap">{errorDisplay}</div>
                    </div>
                  ) : null;
                })()}
              </div>
            );
          })}
        </div>
      )}


      {/* Data Lineage Section */}
      <div className="bg-[var(--vscode-sideBar-background)] rounded-xl border border-[var(--vscode-widget-border)]/60 overflow-hidden">
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


      {/* Toolbar */}
       <div className="flex flex-col gap-4">

          {/* Compiler Options Section */}
          <div className="pb-4 border-b border-[var(--vscode-widget-border)]/40">
              <div
                  className="flex items-center py-2 cursor-pointer hover:opacity-80 transition-opacity justify-between"
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
                  <div className="pt-3 space-y-3">
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

           <div className="flex flex-wrap gap-2">
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

      {/* Code Blocks — one accordion per target per query type */}
      <div className="space-y-3 pb-20">
        {state.models?.flatMap((model: any): React.ReactElement[] => {
          const targetName = model.type === 'test'
            ? model.name
            : model.target ? `${model.target.database}.${model.target.schema}.${model.target.name}` : '';

          const modelId = model.type === 'test'
            ? `test_${model.name}`
            : `${model.type}_${model.target?.database}_${model.target?.schema}_${model.target?.name}`;

          const nodeId = model.target ? `${model.target.database}.${model.target.schema}.${model.target.name}` : null;
          const sameTypeCount = state.models?.filter((m: any) => m.type === model.type).length ?? 0;
          const nodeNameKey = model.type === 'test' ? model.name : nodeId;
          const modelDryRunError =
            (nodeNameKey ? state.dryRunErrorsByNodeName?.[nodeNameKey] : undefined) ??
            (sameTypeCount === 1 ? state.dryRunErrorsByNodeType?.[model.type] : undefined);
          const modelIncrementalDryRunError =
            (nodeNameKey ? state.dryRunIncrementalErrorsByNodeName?.[nodeNameKey] : undefined) ??
            (sameTypeCount === 1 ? state.dryRunIncrementalErrorsByNodeType?.[model.type] : undefined);
          const modelExpectedOutputError =
            (nodeNameKey ? state.dryRunExpectedOutputErrorsByNodeName?.[nodeNameKey] : undefined) ??
            (sameTypeCount === 1 ? state.dryRunExpectedOutputErrorsByNodeType?.[model.type] : undefined);

          const errorAnnotations = modelDryRunError?.location?.line
            ? [{ line: modelDryRunError.location.line, message: modelDryRunError.message }]
            : undefined;
          const incrementalErrorAnnotations = modelIncrementalDryRunError?.location?.line
            ? [{ line: modelIncrementalDryRunError.location.line, message: modelIncrementalDryRunError.message }]
            : undefined;
          const expectedOutputErrorAnnotations = modelExpectedOutputError?.location?.line
            ? [{ line: modelExpectedOutputError.location.line, message: modelExpectedOutputError.message }]
            : undefined;

          if (model.type === 'incremental') {
            const incPreOps = (model.incrementalPreOps || []).join('\n\n');
            const trimmedIncQuery = model.incrementalQuery ?? '';
            const incTabCodeFallback = [incPreOps, incPreOps && trimmedIncQuery ? ';' : '', trimmedIncQuery].filter(Boolean).join('\n');
            const trimmedNonIncQuery = model.query ?? '';
            const nonIncTabCodeFallback = [...(model.preOps || []), trimmedNonIncQuery].filter(Boolean).join('\n\n');
            const incTabCode = (nodeNameKey && state.dryRunIncrementalQueryByNodeName?.[nodeNameKey]) ?? incTabCodeFallback;
            const nonIncTabCode = (nodeNameKey && state.dryRunNonIncrementalQueryByNodeName?.[nodeNameKey]) ?? nonIncTabCodeFallback;
            const activeTab = activeIncrementalTab[modelId] || 'incremental';

            const elements: React.ReactElement[] = [];

            // Collapsible model header + tabbed queries
            elements.push(
              <div key={`inc_${modelId}`} className="rounded-xl border border-[var(--vscode-widget-border)]/50 overflow-hidden">
                {/* Collapsible header */}
                <button
                  type="button"
                  className="w-full flex items-center px-4 py-2.5 cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors text-left"
                  onClick={() => toggleModel(modelId)}
                >
                  {isModelOpen(modelId) ? (
                    <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400" />
                  )}
                  <span className="font-semibold text-[var(--vscode-foreground)] text-sm mr-3">Incremental</span>
                  {targetName && (
                    <span className="text-xs font-mono text-[var(--vscode-descriptionForeground)] opacity-60 truncate">{targetName}</span>
                  )}
                </button>

                {/* Tabbed content */}
                {isModelOpen(modelId) && (
                  <div className="border-t border-[var(--vscode-widget-border)]">
                    <RadixTabs.Root
                      value={activeTab}
                      onValueChange={(val) => setActiveIncrementalTab(prev => ({ ...prev, [modelId]: val }))}
                    >
                      <RadixTabs.List className="flex border-b border-[var(--vscode-widget-border)] px-2 pt-1">
                        <RadixTabs.Trigger
                          value="incremental"
                          className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px"
                        >
                          Incremental Query
                        </RadixTabs.Trigger>
                        <RadixTabs.Trigger
                          value="non-incremental"
                          className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px"
                        >
                          Non-Incremental Query
                        </RadixTabs.Trigger>
                      </RadixTabs.List>
                      <RadixTabs.Content value="incremental">
                        {incTabCode ? (
                          <CodeBlock code={incTabCode} language="sql" showLineNumbers errorAnnotations={incrementalErrorAnnotations} />
                        ) : (
                          <p className="px-4 py-3 text-sm text-[var(--vscode-descriptionForeground)] italic">No incremental query.</p>
                        )}
                      </RadixTabs.Content>
                      <RadixTabs.Content value="non-incremental">
                        {nonIncTabCode ? (
                          <CodeBlock code={nonIncTabCode} language="sql" showLineNumbers errorAnnotations={errorAnnotations} />
                        ) : (
                          <p className="px-4 py-3 text-sm text-[var(--vscode-descriptionForeground)] italic">No non-incremental query.</p>
                        )}
                      </RadixTabs.Content>
                    </RadixTabs.Root>
                  </div>
                )}
              </div>
            );

            // Post-ops as a separate accordion below the tabs
            if (model.postOps?.length) {
              const key = `postOps_${modelId}`;
              elements.push(
                <div key={key} className="rounded-xl border border-[var(--vscode-widget-border)]/50 overflow-hidden">
                  <button
                    type="button"
                    id={`query-button-${key}`}
                    aria-expanded={isQueryOpen(key)}
                    aria-controls={`query-panel-${key}`}
                    className="w-full flex items-center px-4 py-2.5 cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors text-left"
                    onClick={() => toggleQuery(key)}
                  >
                    {isQueryOpen(key) ? (
                      <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400" />
                    )}
                    <span className="font-semibold text-[var(--vscode-foreground)] text-sm mr-3">Post Operations</span>
                    {targetName && (
                      <span className="text-xs font-mono text-[var(--vscode-descriptionForeground)] opacity-60 truncate">{targetName}</span>
                    )}
                  </button>
                  {isQueryOpen(key) && (
                    <div
                      id={`query-panel-${key}`}
                      role="region"
                      aria-labelledby={`query-button-${key}`}
                      className="border-t border-[var(--vscode-widget-border)]"
                    >
                      <CodeBlock code={model.postOps.join('\n')} language="sql" showLineNumbers />
                    </div>
                  )}
                </div>
              );
            }

            return elements;
          }

          // Test models: tabbed Input Query / Expected Output Query
          if (model.type === 'test') {
            const activeTab = activeIncrementalTab[modelId] || 'input';
            return [
              <div key={`test_${modelId}`} className="rounded-xl border border-[var(--vscode-widget-border)]/50 overflow-hidden">
                {/* Collapsible header */}
                <button
                  type="button"
                  className="w-full flex items-center px-4 py-2.5 cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors text-left"
                  onClick={() => toggleModel(modelId)}
                >
                  {isModelOpen(modelId) ? (
                    <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400" />
                  )}
                  <span className="font-semibold text-[var(--vscode-foreground)] text-sm mr-3">Test</span>
                  {targetName && (
                    <span className="text-xs font-mono text-[var(--vscode-descriptionForeground)] opacity-60 truncate">{targetName}</span>
                  )}
                </button>

                {/* Tabbed content */}
                {isModelOpen(modelId) && (
                  <div className="border-t border-[var(--vscode-widget-border)]">
                    <RadixTabs.Root
                      value={activeTab}
                      onValueChange={(val) => setActiveIncrementalTab(prev => ({ ...prev, [modelId]: val }))}
                    >
                      <RadixTabs.List className="flex border-b border-[var(--vscode-widget-border)] px-2 pt-1">
                        <RadixTabs.Trigger
                          value="input"
                          className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px"
                        >
                          Input Query
                        </RadixTabs.Trigger>
                        <RadixTabs.Trigger
                          value="expected"
                          className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px"
                        >
                          Expected Output Query
                        </RadixTabs.Trigger>
                      </RadixTabs.List>
                      <RadixTabs.Content value="input">
                        {model.testQuery ? (
                          <CodeBlock code={model.testQuery} language="sql" showLineNumbers errorAnnotations={errorAnnotations} />
                        ) : (
                          <p className="px-4 py-3 text-sm text-[var(--vscode-descriptionForeground)] italic">No input query.</p>
                        )}
                      </RadixTabs.Content>
                      <RadixTabs.Content value="expected">
                        {model.expectedOutputQuery ? (
                          <CodeBlock code={model.expectedOutputQuery} language="sql" showLineNumbers errorAnnotations={expectedOutputErrorAnnotations} />
                        ) : (
                          <p className="px-4 py-3 text-sm text-[var(--vscode-descriptionForeground)] italic">No expected output query.</p>
                        )}
                      </RadixTabs.Content>
                    </RadixTabs.Root>
                  </div>
                )}
              </div>
            ];
          }

          // Non-incremental models: existing accordion logic
          const blocks: { key: string; label: string; code: string }[] = [];

          const nodeDisplayQuery = (nodeNameKey && state.dryRunQueryByNodeName?.[nodeNameKey])
            ?? model.query ?? '';

          if (model.preOps?.length) {
            blocks.push({ key: `preOps_${modelId}`, label: 'Pre Operations', code: model.preOps.join('\n') });
          }
          if (model.query) {
            blocks.push({ key: `query_${modelId}`, label: queryLabelByType(model.type), code: nodeDisplayQuery });
          }
          if (model.postOps?.length) {
            blocks.push({ key: `postOps_${modelId}`, label: 'Post Operations', code: model.postOps.join('\n') });
          }

          return blocks.map(({ key, label, code }) => (
            <div key={key} className="rounded-xl border border-[var(--vscode-widget-border)]/50 overflow-hidden">
              <button
                type="button"
                id={`query-button-${key}`}
                aria-expanded={isQueryOpen(key)}
                aria-controls={`query-panel-${key}`}
                className="w-full flex items-center px-4 py-2.5 cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors text-left"
                onClick={() => toggleQuery(key)}
              >
                {isQueryOpen(key) ? (
                  <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400" />
                )}
                <span className="font-semibold text-[var(--vscode-foreground)] text-sm mr-3">{label}</span>
                {targetName && (
                  <span className="text-xs font-mono text-[var(--vscode-descriptionForeground)] opacity-60 truncate">{targetName}</span>
                )}
              </button>
              {isQueryOpen(key) && (
                <div
                  id={`query-panel-${key}`}
                  role="region"
                  aria-labelledby={`query-button-${key}`}
                  className="border-t border-[var(--vscode-widget-border)]"
                >
                  <CodeBlock code={code} language="sql" showLineNumbers errorAnnotations={key.startsWith('query_') ? errorAnnotations : undefined} />
                </div>
              )}
            </div>
          ));
        })}
      </div>
     </div>
   );
};
