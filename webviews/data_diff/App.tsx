import { useState, useEffect } from "react";
import { vscode } from "./utils/vscode";
import Select, { MultiValue } from "react-select";
import * as RadixTabs from "@radix-ui/react-tabs";
import { CodeBlock } from "../components/CodeBlock";

const selectStyles = {
  control: (base: any) => ({ ...base, backgroundColor: 'var(--vscode-input-background)', borderColor: 'var(--vscode-input-border)', minHeight: '26px', fontSize: '11px', boxShadow: 'none' }),
  menu: (base: any) => ({ ...base, backgroundColor: 'var(--vscode-dropdown-background)', border: '1px solid var(--vscode-dropdown-border)', fontSize: '11px', zIndex: 9999 }),
  option: (base: any, state: any) => ({ ...base, backgroundColor: state.isFocused ? 'var(--vscode-list-activeSelectionBackground)' : 'var(--vscode-dropdown-background)', color: state.isFocused ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-dropdown-foreground)', padding: '4px 8px', cursor: 'pointer' }),
  multiValue: (base: any) => ({ ...base, backgroundColor: 'var(--vscode-badge-background)', borderRadius: '2px' }),
  multiValueLabel: (base: any) => ({ ...base, color: 'var(--vscode-badge-foreground)', fontSize: '10px', padding: '1px 4px' }),
  multiValueRemove: (base: any) => ({ ...base, color: 'var(--vscode-badge-foreground)', '&:hover': { backgroundColor: 'transparent', color: 'var(--vscode-errorForeground)' } }),
  input: (base: any) => ({ ...base, color: 'var(--vscode-input-foreground)', margin: 0, padding: 0 }),
  placeholder: (base: any) => ({ ...base, color: 'var(--vscode-input-placeholderForeground)', fontSize: '11px' }),
  valueContainer: (base: any) => ({ ...base, padding: '0 4px' }),
  indicatorsContainer: (base: any) => ({ ...base, '& > div': { padding: '2px' } }),
};

export default function App() {
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [allBranches, setAllBranches] = useState<string[]>([]);
  const [tablePrefix, setTablePrefix] = useState("");
  const [primaryKeysMap, setPrimaryKeysMap] = useState<Record<string, string>>({});
  const [filterConditionsMap, setFilterConditionsMap] = useState<Record<string, string>>({});
  const [excludeColumnsMap, setExcludeColumnsMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [diffResults, setDiffResults] = useState<any[]>([]);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffingFiles, setDiffingFiles] = useState<Set<string>>(new Set());
  const [previewModels, setPreviewModels] = useState<any[] | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "init") {
        setSourceBranch(message.data.currentBranch);
        setAllBranches(message.data.branches);
        setIsLoading(false);
      } else if (message.command === "diffComplete") {
        const newResult = message.data.results[0];
        setDiffResults(prev => {
          const idx = prev.findIndex(r => r.file === newResult.file);
          if (idx >= 0) { const next = [...prev]; next[idx] = newResult; return next; }
          return [...prev, newResult];
        });
        setDiffingFiles(prev => { const next = new Set(prev); next.delete(newResult.file); return next; });
        setDiffError(null);
      } else if (message.command === "diffError") {
        setDiffError(message.data);
        setDiffingFiles(new Set());
      } else if (message.command === "diffModelsPreview") {
        setPreviewModels(message.data);
      }
    };
    window.addEventListener("message", handleMessage);
    vscode.postMessage({ command: "webviewReady" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (sourceBranch && targetBranch && tablePrefix) {
      setPreviewModels(null);
      vscode.postMessage({ command: "previewAffectedModels", data: { sourceBranch, targetBranch, tablePrefix } });
    }
  }, [sourceBranch, targetBranch, tablePrefix]);

  const handleRunSingleDiff = (file: string) => {
    setDiffingFiles(prev => new Set(prev).add(file));
    setDiffError(null);
    vscode.postMessage({
      command: "runSingleModelDiff",
      data: { sourceBranch, targetBranch, tablePrefix, file, primaryKeys: primaryKeysMap[file] || '', filterCondition: filterConditionsMap[file] || '', excludeColumns: excludeColumnsMap[file] || '' },
    });
  };

  const inputCls = "w-full px-1.5 py-1 border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] text-xs rounded";

  if (isLoading) {
    return <div className="p-4 text-[var(--vscode-editor-foreground)]">Loading branch information...</div>;
  }

  return (
    <div className="flex flex-col min-h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)]">
        <h1 className="text-sm font-semibold">Branch Data Diff</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {/* Config inputs */}
        <div className="flex flex-wrap gap-4 mb-6">
          <label className="flex flex-col gap-1 min-w-[160px]">
            <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Source Branch</span>
            <input
              className="px-2 py-1.5 border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] text-sm opacity-60 rounded"
              type="text" value={sourceBranch} disabled
            />
          </label>

          <label className="flex flex-col gap-1 min-w-[200px]">
            <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Target Branch</span>
            <select
              className="px-2 py-1.5 border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] text-sm rounded"
              value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)}
            >
              <option value="" disabled>Select target branch</option>
              {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1 min-w-[160px]">
            <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">
              Table Prefix <span className="font-mono normal-case opacity-70 text-[10px]">--table-prefix</span>
            </span>
            <input
              className="px-2 py-1.5 border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] text-sm rounded"
              type="text" value={tablePrefix} onChange={(e) => setTablePrefix(e.target.value)} placeholder="e.g. feat_123"
            />
          </label>
        </div>

        {/* Models preview */}
        {previewModels === null && targetBranch && tablePrefix && (
          <div className="text-xs text-[var(--vscode-descriptionForeground)] mb-4">Loading models…</div>
        )}

        {previewModels && previewModels.length === 0 && (
          <div className="mb-4 px-3 py-2 border border-[var(--vscode-inputValidation-warningBorder)] bg-[var(--vscode-inputValidation-warningBackground)] text-[var(--vscode-inputValidation-warningForeground)] rounded text-sm">
            No modified models found between the selected branches.
          </div>
        )}

        {previewModels && previewModels.length > 0 && (
          <div className="mb-6 border border-[var(--vscode-widget-border)] rounded overflow-hidden">
            <div className="px-4 py-2 bg-[var(--vscode-sideBar-background)] border-b border-[var(--vscode-widget-border)]">
              <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">
                Models to Compare ({previewModels.length})
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)]">
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">File</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Target (A)</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Source (B)</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Primary Keys</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Exclude Columns</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Filter Condition</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {previewModels.map((model) => {
                    const isFileDiffing = diffingFiles.has(model.file);
                    const bothMissing = !model.baseExists && !model.featExists;
                    return (
                      <tr key={model.file} className="border-b border-[var(--vscode-widget-border)]/40 last:border-0 hover:bg-[var(--vscode-list-hoverBackground)]">
                        <td className="px-3 py-2 font-mono break-all max-w-[120px]" title={model.file}>{model.file.split('/').pop()}</td>
                        <td className="px-3 py-2 font-mono text-[var(--vscode-descriptionForeground)] break-all max-w-[160px]">{model.baseTableName.split('.').pop()}</td>
                        <td className="px-3 py-2 font-mono text-[var(--vscode-descriptionForeground)] break-all max-w-[160px]">{model.featTableName.split('.').pop()}</td>
                        <td className="px-3 py-2 min-w-[160px]">
                          {model.columns?.length > 0 ? (
                            <Select isMulti menuPortalTarget={document.body} menuPosition="fixed"
                              options={model.columns.map((c: string) => ({ value: c, label: c }))}
                              value={(primaryKeysMap[model.file] || '').split(',').filter(Boolean).map(k => ({ value: k.trim(), label: k.trim() }))}
                              onChange={(s: MultiValue<{ value: string; label: string }>) => setPrimaryKeysMap(prev => ({ ...prev, [model.file]: s.map(x => x.value).join(',') }))}
                              placeholder="Select PKs…" styles={selectStyles} />
                          ) : (
                            <input className={inputCls} type="text" value={primaryKeysMap[model.file] || ''} onChange={(e) => setPrimaryKeysMap(prev => ({ ...prev, [model.file]: e.target.value }))} placeholder="e.g. ORG_ID" />
                          )}
                        </td>
                        <td className="px-3 py-2 min-w-[160px]">
                          {model.columns?.length > 0 ? (
                            <Select isMulti menuPortalTarget={document.body} menuPosition="fixed"
                              options={model.columns.map((c: string) => ({ value: c, label: c }))}
                              value={(excludeColumnsMap[model.file] || '').split(',').filter(Boolean).map(k => ({ value: k.trim(), label: k.trim() }))}
                              onChange={(s: MultiValue<{ value: string; label: string }>) => setExcludeColumnsMap(prev => ({ ...prev, [model.file]: s.map(x => x.value).join(',') }))}
                              placeholder="Exclude columns…" styles={selectStyles} />
                          ) : (
                            <input className={inputCls} type="text" value={excludeColumnsMap[model.file] || ''} onChange={(e) => setExcludeColumnsMap(prev => ({ ...prev, [model.file]: e.target.value }))} placeholder="e.g. UPDATED_AT" />
                          )}
                        </td>
                        <td className="px-3 py-2 min-w-[180px]">
                          <input className={inputCls} type="text" value={filterConditionsMap[model.file] || ''} onChange={(e) => setFilterConditionsMap(prev => ({ ...prev, [model.file]: e.target.value }))} placeholder="e.g. date = '2026-01-01'" />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            className="px-3 py-1 rounded text-xs font-medium bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-40 whitespace-nowrap transition-colors"
                            disabled={isFileDiffing || bothMissing}
                            title={bothMissing ? 'Neither table is materialized' : undefined}
                            onClick={() => handleRunSingleDiff(model.file)}
                          >
                            {isFileDiffing ? "Running…" : "Diff"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Diff Results */}
        <div className="border-t border-[var(--vscode-widget-border)] pt-4">
          <h2 className="text-sm font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-4">Diff Results</h2>
          {diffError && (
            <div className="mb-4 px-3 py-2 border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)] rounded text-sm">
              {diffError}
            </div>
          )}

          {diffResults.length > 0 ? (
            <div className="flex flex-col gap-4">
              {diffResults.map((result, idx) => (
                <div key={idx} className="border border-[var(--vscode-widget-border)] rounded overflow-hidden">
                  <div className="px-4 py-2 bg-[var(--vscode-sideBar-background)] border-b border-[var(--vscode-widget-border)]">
                    <span className="text-xs font-mono break-all text-[var(--vscode-editor-foreground)]">{result.file}</span>
                  </div>
                  <div className="p-4">
                    {result.error ? (
                      <p className="text-xs text-[var(--vscode-inputValidation-errorForeground)]">{result.error}</p>
                    ) : (
                      <RadixTabs.Root defaultValue="summary" className="w-full">
                        <RadixTabs.List className="flex border-b border-[var(--vscode-widget-border)] mb-4">
                          <RadixTabs.Trigger value="summary" className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px">
                            Summary
                          </RadixTabs.Trigger>
                          <RadixTabs.Trigger value="query" className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px">
                            Comparison Query
                          </RadixTabs.Trigger>
                        </RadixTabs.List>

                        <RadixTabs.Content value="summary">
                          <div className="mb-3 flex flex-col gap-1.5">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="text-xs text-[var(--vscode-descriptionForeground)] shrink-0">Target:</span>
                              <code className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-1.5 py-0.5 rounded text-xs break-all">{result.baseTableFullName || result.baseTableName}</code>
                              {result.baseLastModified && <span className="text-xs text-[var(--vscode-descriptionForeground)] shrink-0">updated {new Date(result.baseLastModified).toLocaleString()}</span>}
                            </div>
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="text-xs text-[var(--vscode-descriptionForeground)] shrink-0">Source:</span>
                              <code className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-1.5 py-0.5 rounded text-xs break-all">{result.featTableFullName || result.featTableName}</code>
                              {result.featLastModified && <span className="text-xs text-[var(--vscode-descriptionForeground)] shrink-0">updated {new Date(result.featLastModified).toLocaleString()}</span>}
                            </div>
                          </div>

                          {result.filterCondition && (
                            <div className="mb-3 flex items-center gap-2 text-xs text-[var(--vscode-descriptionForeground)]">
                              <span className="shrink-0">Filter:</span>
                              <code className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-1.5 py-0.5 rounded">{result.filterCondition}</code>
                            </div>
                          )}

                          <div className="flex gap-3 mb-4">
                            <span className="bg-green-900/30 text-green-400 border border-green-900/50 px-3 py-1 rounded text-xs">Added: {result.addedCount}</span>
                            <span className="bg-red-900/30 text-red-400 border border-red-900/50 px-3 py-1 rounded text-xs">Removed: {result.removedCount}</span>
                            {result.modifiedCount !== undefined && (
                              <span className="bg-blue-900/30 text-blue-400 border border-blue-900/50 px-3 py-1 rounded text-xs">Modified: {result.modifiedCount}</span>
                            )}
                          </div>

                          {result.schemaAddedCols?.length > 0 && (
                            <p className="text-xs mt-2 text-green-400">Schema Added: {result.schemaAddedCols.join(', ')}</p>
                          )}
                          {result.schemaRemovedCols?.length > 0 && (
                            <p className="text-xs mt-1 text-red-400">Schema Removed: {result.schemaRemovedCols.join(', ')}</p>
                          )}

                          {result.isPairedDiff ? (
                            Object.keys(result.changedColumns || {}).length > 0 && (
                              <div className="mt-4">
                                <h4 className="text-xs font-semibold mb-2 text-[var(--vscode-descriptionForeground)]">Modified Columns (Rows Changed)</h4>
                                <div className="flex flex-wrap gap-2">
                                  {Object.entries(result.changedColumns).sort((a: any, b: any) => b[1] - a[1]).map(([col, count]: [string, any]) => (
                                    <div key={col} className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-2 py-1 rounded text-xs">
                                      {col} <span className="text-[var(--vscode-descriptionForeground)] ml-1 opacity-70">({count})</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          ) : (
                            (result.modifiedCount ?? 0) > 0 && (
                              <div className="mt-4 p-3 bg-[var(--vscode-inputValidation-warningBackground)] border border-[var(--vscode-inputValidation-warningBorder)] rounded flex gap-2">
                                <span className="text-yellow-500 shrink-0">⚠</span>
                                <span className="text-xs text-[var(--vscode-inputValidation-warningForeground)]">
                                  Column-level diff unavailable — this model has no <code className="bg-[var(--vscode-editor-background)] px-1 rounded font-mono">uniqueKey</code>. Add one in your SQLX config to unlock column diffs.
                                </span>
                              </div>
                            )
                          )}
                        </RadixTabs.Content>

                        <RadixTabs.Content value="query">
                          <div className="mt-2 w-full overflow-hidden">
                            <CodeBlock code={result.comparisonQuery || 'No query generated.'} language="sql" showLineNumbers />
                          </div>
                        </RadixTabs.Content>
                      </RadixTabs.Root>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[var(--vscode-descriptionForeground)] text-sm italic">Run a diff to see results here.</p>
          )}
        </div>
      </div>
    </div>
  );
}
